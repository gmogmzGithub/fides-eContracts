#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
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

const DATABASE_URL =
  process.env.FIDES_SMOKE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  DEFAULT_DATABASE_URL;
const settings = {
  ...queueSettings(),
  endpoint:
    process.env.FIDES_QUEUE_HTTP_ENDPOINT ??
    process.env.FIDES_QUEUE_ENDPOINT ??
    "http://127.0.0.1:9324",
};
const sql = postgres(DATABASE_URL, {
  max: 1,
  onnotice: () => undefined,
  connection: { search_path: "fides,public" },
});
const sqs = createSqsClient(settings);
const probe = randomUUID();
const ids = [];

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(label, run, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await run();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} no ocurrió en ${timeoutMs} ms`);
}

async function job(id) {
  const [row] = await sql`
    SELECT id, kind, status, attempts, dispatch_attempts, queue_message_id,
           last_error
    FROM background_jobs WHERE id = ${id}
  `;
  return row ?? null;
}

try {
  const [mainQueueUrl, dlqUrl] = await Promise.all([
    queueUrl(sqs, settings.queueName),
    queueUrl(sqs, settings.dlqName),
  ]);

  const [successful] = await sql`
    INSERT INTO background_jobs (kind, payload, dedupe_key)
    VALUES (
      'ai_review',
      ${sql.json({ attemptId: randomUUID() })}::jsonb,
      ${`queue-smoke-success:${probe}`}
    )
    RETURNING id
  `;
  ids.push(successful.id);
  const completed = await waitFor("el trabajo publicado y consumido", async () => {
    const row = await job(successful.id);
    return row?.status === "done" ? row : null;
  });
  expect(completed.dispatch_attempts >= 1, "el dispatcher no registró su intento");
  expect(completed.queue_message_id, "el dispatcher no conservó el MessageId de SQS");

  // Una cola estándar puede entregar duplicados. Se publica deliberadamente el
  // mismo UUID y se comprueba que el consumidor lo confirma sin volver a
  // reclamar o ejecutar la fila ya concluida.
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: mainQueueUrl,
      MessageBody: jobMessageBody(successful.id),
    })
  );
  await waitFor("el duplicado confirmado sin reejecución", async () => {
    const result = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: mainQueueUrl,
        AttributeNames: [
          "ApproximateNumberOfMessages",
          "ApproximateNumberOfMessagesNotVisible",
        ],
      })
    );
    const total =
      Number(result.Attributes?.ApproximateNumberOfMessages ?? "0") +
      Number(result.Attributes?.ApproximateNumberOfMessagesNotVisible ?? "0");
    return total === 0;
  });
  expect(
    (await job(successful.id))?.attempts === 1,
    "un mensaje duplicado volvió a ejecutar el trabajo concluido"
  );

  const [failing] = await sql`
    INSERT INTO background_jobs (kind, payload, dedupe_key)
    VALUES ('queue_smoke_failure', '{}'::jsonb, ${`queue-smoke-dlq:${probe}`})
    RETURNING id
  `;
  ids.push(failing.id);
  const failed = await waitFor("el trabajo movido a DLQ", async () => {
    const row = await job(failing.id);
    return row?.status === "failed" ? row : null;
  }, 90000);
  expect(failed.attempts >= 3, "la DLQ se alcanzó sin agotar los reintentos");

  const deadLetter = await waitFor("el mensaje conservado en DLQ", async () => {
    const response = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        VisibilityTimeout: 10,
      })
    );
    for (const message of response.Messages ?? []) {
      if (!message.Body || !message.ReceiptHandle) continue;
      try {
        if (parseJobMessage(message.Body).jobId === failing.id) return message;
      } catch {
        // Otro mensaje inválido sigue siendo evidencia de la DLQ; no se borra.
      }
      await sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: dlqUrl,
          ReceiptHandle: message.ReceiptHandle,
          VisibilityTimeout: 0,
        })
      );
    }
    return null;
  }, 30000);

  // Corrige la causa sintética y ejecuta el mismo redrive explícito que la
  // herramienta operativa: el mensaje conserva el UUID y PostgreSQL aporta la
  // clase/payload vigente del trabajo.
  await sql`
    UPDATE background_jobs
    SET kind = 'ai_review', payload = ${sql.json({ attemptId: randomUUID() })}::jsonb,
        status = 'pending', attempts = 0, last_error = NULL,
        completed_at = NULL, run_after = NOW(), dispatched_at = NOW()
    WHERE id = ${failing.id}
  `;
  const redriven = await sqs.send(
    new SendMessageCommand({
      QueueUrl: mainQueueUrl,
      MessageBody: jobMessageBody(failing.id),
    })
  );
  await sql`
    UPDATE background_jobs SET queue_message_id = ${redriven.MessageId ?? null}
    WHERE id = ${failing.id}
  `;
  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: dlqUrl,
      ReceiptHandle: deadLetter.ReceiptHandle,
    })
  );

  const recovered = await waitFor("el trabajo redirigido", async () => {
    const row = await job(failing.id);
    return row?.status === "done" ? row : null;
  });
  expect(recovered.attempts === 1, "el redrive no reinició el contador canónico");

  process.stdout.write(
    "[smoke:queue] dispatcher, consumo idempotente, tres intentos, DLQ y redrive verificados\n"
  );
} catch (error) {
  process.stderr.write(`[smoke:queue] ${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (ids.length > 0) {
    await sql`DELETE FROM background_jobs WHERE id IN ${sql(ids)}`.catch(() => undefined);
  }
  await Promise.allSettled([sql.end({ timeout: 5 }), sqs.destroy()]);
}
