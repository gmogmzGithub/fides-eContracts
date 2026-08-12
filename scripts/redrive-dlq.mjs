#!/usr/bin/env node

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import postgres from "postgres";
import { DEFAULT_DATABASE_URL } from "./defaults.mjs";
import {
  createSqsClient,
  jobMessageBody,
  parseJobMessage,
  queueSettings,
  queueUrl,
} from "./sqs-client.mjs";

const DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const onlyJobId = process.argv
  .find((value) => value.startsWith("--job-id="))
  ?.slice("--job-id=".length);
const requestedMax = Number(
  process.argv.find((value) => value.startsWith("--max="))?.slice("--max=".length) ?? 100
);
const maxMessages = Number.isInteger(requestedMax) && requestedMax > 0 ? requestedMax : 100;

const settings = queueSettings();
const sqs = createSqsClient(settings);
const sql = postgres(DATABASE_URL, {
  max: 1,
  onnotice: () => undefined,
  connection: { search_path: "fides,public" },
});

let moved = 0;
let inspected = 0;
let sourceUrl = null;
const skippedReceipts = [];

try {
  const urls = await Promise.all([
    queueUrl(sqs, settings.dlqName),
    queueUrl(sqs, settings.queueName),
  ]);
  [sourceUrl] = urls;
  const destinationUrl = urls[1];

  while (inspected < maxMessages && (!onlyJobId || moved === 0)) {
    const response = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: sourceUrl,
        MaxNumberOfMessages: Math.min(10, maxMessages - inspected),
        WaitTimeSeconds: inspected === 0 ? 1 : 0,
        VisibilityTimeout: 30,
      })
    );
    const messages = response.Messages ?? [];
    if (messages.length === 0) break;

    for (const message of messages) {
      inspected += 1;
      if (!message.Body || !message.ReceiptHandle) continue;
      let payload;
      try {
        payload = parseJobMessage(message.Body);
      } catch {
        skippedReceipts.push(message.ReceiptHandle);
        continue;
      }
      if (onlyJobId && payload.jobId !== onlyJobId) {
        skippedReceipts.push(message.ReceiptHandle);
        continue;
      }

      const rows = await sql`
        UPDATE background_jobs
        SET status = 'pending', attempts = 0, last_error = NULL,
            completed_at = NULL, run_after = NOW(),
            dispatched_at = NOW(), dispatch_last_error = NULL
        WHERE id = ${payload.jobId}
        RETURNING id
      `;
      if (rows.length === 0) {
        skippedReceipts.push(message.ReceiptHandle);
        continue;
      }

      const sent = await sqs.send(
        new SendMessageCommand({
          QueueUrl: destinationUrl,
          MessageBody: jobMessageBody(payload.jobId),
        })
      );
      await sql`
        UPDATE background_jobs
        SET queue_message_id = ${sent.MessageId ?? null}
        WHERE id = ${payload.jobId}
      `;
      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: sourceUrl,
          ReceiptHandle: message.ReceiptHandle,
        })
      );
      moved += 1;
      process.stdout.write(`[redrive] trabajo ${payload.jobId} reenviado\n`);
      if (onlyJobId || moved >= maxMessages) break;
    }
  }

  process.stdout.write(
    `[redrive] ${moved} trabajo(s) reenviado(s); ${inspected} mensaje(s) inspeccionado(s)\n`
  );
  if (onlyJobId && moved === 0) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`[redrive] ${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (sourceUrl) {
    for (const receiptHandle of skippedReceipts) {
      await sqs
        .send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: sourceUrl,
            ReceiptHandle: receiptHandle,
            VisibilityTimeout: 0,
          })
        )
        .catch(() => undefined);
    }
  }
  await Promise.allSettled([sql.end({ timeout: 5 }), sqs.destroy()]);
}
