import { GetQueueUrlCommand, SQSClient } from "@aws-sdk/client-sqs";

export const JOB_MESSAGE_SCHEMA = 1;

export function queueSettings() {
  return {
    endpoint: process.env.FIDES_QUEUE_ENDPOINT?.replace(/\/$/, "") || null,
    region: process.env.AWS_REGION ?? "mx-central-1",
    queueName: process.env.FIDES_JOB_QUEUE ?? "fides-background-jobs",
    dlqName:
      process.env.FIDES_JOB_DLQ ?? "fides-background-jobs-dlq",
  };
}

export function createSqsClient(settings = queueSettings()) {
  const config = { region: settings.region };
  if (settings.endpoint) {
    config.endpoint = settings.endpoint;
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "local",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "local",
    };
  }
  return new SQSClient(config);
}

export async function queueUrl(client, queueName) {
  const result = await client.send(new GetQueueUrlCommand({ QueueName: queueName }));
  if (!result.QueueUrl) throw new Error(`SQS no devolvió la URL de '${queueName}'`);
  return result.QueueUrl;
}

export function jobMessageBody(jobId) {
  return JSON.stringify({ schemaVersion: JOB_MESSAGE_SCHEMA, jobId });
}

export function parseJobMessage(body) {
  const value = JSON.parse(body);
  if (
    value?.schemaVersion !== JOB_MESSAGE_SCHEMA ||
    typeof value.jobId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.jobId
    )
  ) {
    throw new Error("mensaje de trabajo inválido");
  }
  return { jobId: value.jobId };
}
