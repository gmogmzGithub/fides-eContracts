#!/usr/bin/env node
// Worker de Fides: entrega del outbox y trabajos de fondo.
//
// La aplicación nunca contacta a un proveedor externo dentro de una
// transacción de negocio: escribe en `notification_outbox` y en
// `background_jobs`, y este proceso entrega de forma idempotente.
//
// PostgreSQL conserva el outbox y el estado canónico. En Docker, un dispatcher
// publica sólo el UUID en una cola compatible con SQS y el consumidor reclama
// la fila de forma idempotente. Sin cola configurada permanece disponible el
// polling directo para pruebas aisladas.
//
// Variables: DATABASE_URL, FIDES_APP_URL, FIDES_PUBLIC_URL,
// FIDES_SINK_URL, FIDES_AI_URL, FIDES_WORKER_TOKEN y, para SQS,
// FIDES_QUEUE_MODE, FIDES_QUEUE_ENDPOINT, FIDES_JOB_QUEUE,
// FIDES_JOB_DLQ, AWS_REGION y credenciales AWS locales o de rol.

import process from "node:process";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import postgres from "postgres";
import { DEFAULT_DATABASE_URL, appUrl } from "./defaults.mjs";
import {
  createSqsClient,
  jobMessageBody,
  parseJobMessage,
  queueSettings,
  queueUrl,
} from "./sqs-client.mjs";

const DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const APP_URL = appUrl();
const PUBLIC_URL = (process.env.FIDES_PUBLIC_URL ?? APP_URL).replace(/\/$/, "");
const SINK_URL = process.env.FIDES_SINK_URL ?? "http://127.0.0.1:8025/api/messages";
const AI_URL = process.env.FIDES_AI_URL ?? "http://127.0.0.1:8030/analizar";
const WORKER_TOKEN = process.env.FIDES_WORKER_TOKEN ?? "";
const QUEUE_MODE = process.env.FIDES_QUEUE_MODE ?? "database";
const QUEUE_ENABLED = QUEUE_MODE === "sqs";

const POLL_MS = Number(process.env.FIDES_WORKER_POLL_MS ?? 1000);
const SWEEP_MS = Number(process.env.FIDES_WORKER_SWEEP_MS ?? 30000);
const NOTIFICATION_BATCH = 10;
const MAX_NOTIFICATION_ATTEMPTS = 5;
const MAX_JOB_ATTEMPTS = Number(process.env.FIDES_MAX_JOB_ATTEMPTS ?? 5);
const RETRY_BASE_SECONDS = Number(
  process.env.FIDES_WORKER_RETRY_BASE_SECONDS ?? 5
);
const LEASE_SECONDS = 300;
const SINK_TIMEOUT_MS = 5000;
const AI_TIMEOUT_MS = 20000;
const APP_TIMEOUT_MS = 120000;
const DISPATCH_LEASE_SECONDS = 300;
const DLQ_POLL_MS = 2000;

const DELEGATED_KINDS = new Set([
  "seal_cold_package",
  "move_to_cold",
  "recovery",
  "export",
]);

const sql = postgres(DATABASE_URL, {
  max: 2,
  onnotice: () => undefined,
  connect_timeout: 10,
  connection: { search_path: "fides,public" },
});
const queueConfig = QUEUE_ENABLED ? queueSettings() : null;
const sqs = QUEUE_ENABLED ? createSqsClient(queueConfig) : null;
let jobQueueUrl = null;
let deadLetterQueueUrl = null;

let running = true;
let lastSweepAt = 0;
let lastDlqPollAt = 0;

function log(message) {
  process.stdout.write(`[worker] ${message}\n`);
}

function logError(message) {
  process.stderr.write(`[worker] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error) {
  const text = error?.message ?? String(error ?? "error desconocido");
  return text.slice(0, 900);
}

/** Espera creciente: 5 s, 20 s, 45 s, 80 s… */
function backoffSeconds(attempts) {
  return Math.min(300, RETRY_BASE_SECONDS * attempts * attempts);
}

/**
 * `jsonb` puede llegar como objeto o como texto según cómo se haya escrito la
 * fila, así que el worker acepta ambas formas antes de leer una clave.
 */
function asObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function readString(source, ...keys) {
  const object = asObject(source);
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Outbox de notificaciones
// ---------------------------------------------------------------------------

async function deliverToSink(row) {
  const response = await fetch(SINK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: row.id,
      channel: row.channel,
      recipient: row.recipient,
      template: row.template,
      organizationId: row.organization_id,
      payload: asObject(row.payload),
      createdAt: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(SINK_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`captura local respondió ${response.status}`);
  }
  await response.text();
}

async function processNotifications() {
  return sql.begin(async (tx) => {
    const rows = await tx`
      SELECT id, organization_id, channel, recipient, template, payload, attempts
      FROM notification_outbox
      WHERE status = 'pending' AND available_at <= NOW()
      ORDER BY available_at
      LIMIT ${NOTIFICATION_BATCH}
      FOR UPDATE SKIP LOCKED
    `;

    for (const row of rows) {
      const attempts = row.attempts + 1;
      try {
        await deliverToSink(row);
        // El enlace lleva el token de un solo uso: una vez entregado se
        // retira del outbox para que sólo su hash siga en la base.
        await tx`
          UPDATE notification_outbox
          SET status = 'sent', attempts = ${attempts},
              delivered_at = NOW(), last_error = NULL,
              payload = payload - 'url'
          WHERE id = ${row.id}
        `;
        log(`mensaje ${row.channel} ${row.template} → ${row.recipient} entregado`);
      } catch (error) {
        const detail = errorText(error);
        if (attempts >= MAX_NOTIFICATION_ATTEMPTS) {
          await tx`
            UPDATE notification_outbox
            SET status = 'failed', attempts = ${attempts}, last_error = ${detail}
            WHERE id = ${row.id}
          `;
          logError(
            `mensaje ${row.id} descartado tras ${attempts} intento(s): ${detail}`
          );
        } else {
          const wait = backoffSeconds(attempts);
          await tx`
            UPDATE notification_outbox
            SET attempts = ${attempts}, last_error = ${detail},
                available_at = NOW() + ${wait} * INTERVAL '1 second'
            WHERE id = ${row.id}
          `;
          logError(
            `mensaje ${row.id} falló (intento ${attempts}), reintento en ${wait} s: ${detail}`
          );
        }
      }
    }

    return rows.length;
  });
}

// ---------------------------------------------------------------------------
// Trabajos delegados al dominio TypeScript de la aplicación web
// ---------------------------------------------------------------------------

async function callApplication(kind, payload, jobId) {
  const response = await fetch(`${APP_URL}/api/interno/trabajos`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fides-worker-token": WORKER_TOKEN,
    },
    body: JSON.stringify({ jobId: jobId ?? null, kind, payload: payload ?? {} }),
    signal: AbortSignal.timeout(APP_TIMEOUT_MS),
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok || body?.ok !== true) {
    const detail = body?.error ?? `HTTP ${response.status}`;
    throw new Error(`la aplicación rechazó '${kind}': ${detail}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Revisión asistida por AI
// ---------------------------------------------------------------------------

function normalizeConfidence(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const clamped = Math.min(9.999, Math.max(0, numeric));
  return Number(clamped.toFixed(3));
}

function normalizeRecommendation(value) {
  return value === "accept" || value === "repeat" || value === "inconclusive"
    ? value
    : null;
}

async function loadAiInput(attemptId) {
  const [attempt] = await sql`
    SELECT a.id, a.contract_id, a.organization_id, a.sequence,
           c.reference, c.video_statement, c.review_policy,
           o.name AS organization_name
    FROM acceptance_attempts a
    JOIN contracts c ON c.id = a.contract_id
    JOIN organizations o ON o.id = a.organization_id
    WHERE a.id = ${attemptId}
  `;
  if (!attempt) return null;

  const evidence = await sql`
    SELECT kind, content_type, byte_size, sha256, metadata
    FROM evidence_items
    WHERE attempt_id = ${attemptId}
    ORDER BY kind
  `;

  return {
    attempt,
    evidence: evidence.map((item) => ({
      kind: item.kind,
      fileName: readString(
        item.metadata,
        "fileName",
        "file_name",
        "filename",
        "originalName",
        "nombre",
        "name"
      ),
      contentType: item.content_type,
      byteSize: item.byte_size,
      sha256: item.sha256,
    })),
  };
}

async function storeAiReport(attempt, report) {
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO ai_review_reports (
        attempt_id, contract_id, organization_id, model, configuration_version,
        status, transcript, expected_statement, findings, confidence,
        limitations, recommendation
      ) VALUES (
        ${attempt.id}, ${attempt.contract_id}, ${attempt.organization_id},
        ${report.model}, ${report.configurationVersion}, ${report.status},
        ${report.transcript}, ${report.expectedStatement},
        ${sql.json(report.findings)}::jsonb, ${report.confidence},
        ${report.limitations}, ${report.recommendation}
      )
    `;

    if (report.recommendation !== "repeat") return;

    // Alerta operativa: sólo referencia, Organización y una dirección del
    // portal. Nunca texto del Contrato, transcripción, evidencia ni el enlace
    // del Firmante.
    const [task] = await tx`
      SELECT id FROM review_tasks WHERE attempt_id = ${attempt.id} LIMIT 1
    `;
    const portalUrl = task
      ? `${PUBLIC_URL}/app/revision/${task.id}`
      : `${PUBLIC_URL}/app/revision`;

    const reviewers = await tx`
      SELECT m.account_id, a.email
      FROM organization_members m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.organization_id = ${attempt.organization_id}
        AND 'reviewer' = ANY (m.roles)
      ORDER BY a.email
    `;

    for (const reviewer of reviewers) {
      await tx`
        INSERT INTO notification_outbox (
          organization_id, channel, recipient, template, payload, dedupe_key
        ) VALUES (
          ${attempt.organization_id}, 'whatsapp', ${reviewer.email},
          'revision_ai_recomienda_repetir',
          ${sql.json({
            reference: attempt.reference,
            organization: attempt.organization_name,
            portalUrl,
          })}::jsonb,
          ${`ai-repeat:${attempt.id}:${reviewer.account_id}`}
        )
        ON CONFLICT (dedupe_key) DO NOTHING
      `;
    }

    if (reviewers.length > 0) {
      log(
        `alerta de repetición encolada para ${reviewers.length} revisor(es) · ${attempt.reference}`
      );
    }
  });
}

async function handleAiReview(job) {
  const attemptId = readString(job.payload, "attemptId", "attempt_id");
  if (!attemptId) throw new Error("ai_review sin attemptId en el payload");

  const [existing] = await sql`
    SELECT id FROM ai_review_reports
    WHERE attempt_id = ${attemptId} AND status = 'completed'
    LIMIT 1
  `;
  if (existing) {
    log(`ai_review ${attemptId} ya tenía informe; nada que hacer`);
    return;
  }

  const loaded = await loadAiInput(attemptId);
  if (!loaded) {
    log(`ai_review ${attemptId}: el Intento ya no existe`);
    return;
  }

  const { attempt, evidence } = loaded;
  const expectedStatement = attempt.video_statement ?? "";

  let provider = null;
  let providerError = null;
  try {
    const response = await fetch(AI_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reference: attempt.reference,
        expectedStatement,
        organization: attempt.organization_name,
        evidence: evidence.map((item) => ({
          kind: item.kind,
          fileName: item.fileName,
          byteSize: item.byteSize,
          sha256: item.sha256,
        })),
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok || body?.status === "failed") {
      throw new Error(
        `el proveedor de revisión respondió ${response.status}${
          body?.error ? `: ${body.error}` : ""
        }`
      );
    }
    provider = body ?? {};
  } catch (error) {
    providerError = errorText(error);
  }

  if (providerError) {
    // Una falla del proveedor no decide nada: el Contrato permanece
    // `A revisión` para que una persona con rol Revisor lo resuelva.
    if (job.attempts < MAX_JOB_ATTEMPTS) {
      throw new Error(providerError);
    }
    await storeAiReport(attempt, {
      model: "desconocido",
      configurationVersion: "desconocida",
      status: "failed",
      transcript: "",
      expectedStatement,
      findings: [],
      confidence: null,
      limitations:
        "La revisión asistida no produjo resultado. Requiere lectura humana. " +
        `Detalle técnico: ${providerError}`,
      recommendation: null,
    });
    log(
      `ai_review ${attemptId}: falla del proveedor registrada; el Contrato sigue A revisión`
    );
    return;
  }

  const recommendation = normalizeRecommendation(provider.recommendation);
  await storeAiReport(attempt, {
    model: readString(provider, "model") || "doble-local-revision",
    configurationVersion: readString(provider, "configurationVersion") || "local-1",
    status: provider.status === "failed" ? "failed" : "completed",
    transcript: typeof provider.transcript === "string" ? provider.transcript : "",
    expectedStatement:
      typeof provider.expectedStatement === "string"
        ? provider.expectedStatement
        : expectedStatement,
    findings: Array.isArray(provider.findings) ? provider.findings : [],
    confidence: normalizeConfidence(provider.confidence),
    limitations: typeof provider.limitations === "string" ? provider.limitations : "",
    recommendation,
  });

  log(
    `ai_review ${attempt.reference}: recomendación ${recommendation ?? "sin recomendación"}`
  );
}

// ---------------------------------------------------------------------------
// Ciclo de trabajos de fondo
// ---------------------------------------------------------------------------

async function initializeQueue() {
  if (!sqs || !queueConfig) return;
  let lastError;
  for (let attempt = 1; running && attempt <= 60; attempt += 1) {
    try {
      [jobQueueUrl, deadLetterQueueUrl] = await Promise.all([
        queueUrl(sqs, queueConfig.queueName),
        queueUrl(sqs, queueConfig.dlqName),
      ]);
      log(
        `cola lista · ${queueConfig.queueName} · DLQ ${queueConfig.dlqName}`
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 60) await sleep(500);
    }
  }
  throw new Error(`cola SQS no disponible: ${errorText(lastError)}`);
}

/**
 * Reclama filas para publicación. `dispatched_at` funciona como lease del
 * dispatcher: evita dos publicaciones normales y permite recuperar un crash
 * entre reclamar la fila y enviarla. Una duplicación excepcional sigue siendo
 * segura porque el mensaje sólo contiene el UUID canónico del trabajo.
 */
async function claimJobsForDispatch() {
  return sql`
    UPDATE background_jobs
    SET dispatched_at = NOW(), dispatch_attempts = dispatch_attempts + 1,
        dispatch_last_error = NULL
    WHERE id IN (
      SELECT id FROM background_jobs
      WHERE status = 'pending' AND run_after <= NOW()
        AND (
          dispatched_at IS NULL OR
          dispatched_at <= NOW() - ${DISPATCH_LEASE_SECONDS} * INTERVAL '1 second'
        )
      ORDER BY run_after, created_at
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `;
}

async function dispatchJobsToQueue() {
  if (!sqs || !jobQueueUrl) return 0;
  const rows = await claimJobsForDispatch();
  for (const row of rows) {
    try {
      const sent = await sqs.send(
        new SendMessageCommand({
          QueueUrl: jobQueueUrl,
          MessageBody: jobMessageBody(row.id),
        })
      );
      await sql`
        UPDATE background_jobs
        SET queue_message_id = ${sent.MessageId ?? null},
            dispatch_last_error = NULL
        WHERE id = ${row.id} AND status = 'pending'
      `;
      log(`trabajo ${row.id} publicado en SQS`);
    } catch (error) {
      const detail = errorText(error);
      await sql`
        UPDATE background_jobs
        SET dispatched_at = NULL, dispatch_last_error = ${detail}
        WHERE id = ${row.id} AND status = 'pending'
      `;
      logError(`no se pudo publicar ${row.id} en SQS: ${detail}`);
    }
  }
  return rows.length;
}

async function claimQueuedJob(jobId) {
  const rows = await sql`
    UPDATE background_jobs
    SET status = 'running', attempts = attempts + 1,
        run_after = NOW() + ${LEASE_SECONDS} * INTERVAL '1 second'
    WHERE id = ${jobId}
      AND (
        (status = 'pending' AND run_after <= NOW()) OR
        (status = 'running' AND run_after <= NOW())
      )
    RETURNING id, kind, payload, attempts
  `;
  if (rows[0]) return { job: rows[0], state: null };
  const [state] = await sql`
    SELECT status, run_after FROM background_jobs WHERE id = ${jobId}
  `;
  return { job: null, state: state ?? null };
}

async function deleteQueueMessage(queue, receiptHandle) {
  if (!sqs) return;
  await sqs.send(
    new DeleteMessageCommand({ QueueUrl: queue, ReceiptHandle: receiptHandle })
  );
}

async function deferQueueMessage(queue, receiptHandle, seconds) {
  if (!sqs) return;
  await sqs.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: queue,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: Math.max(1, Math.min(300, Math.ceil(seconds))),
    })
  );
}

async function processQueueMessage(message) {
  if (!jobQueueUrl || !message.ReceiptHandle || !message.Body) return false;
  let parsed;
  try {
    parsed = parseJobMessage(message.Body);
  } catch (error) {
    // No se confirma: SQS lo conservará y lo moverá a DLQ según su política.
    logError(`mensaje SQS inválido: ${errorText(error)}`);
    return true;
  }

  const { job, state } = await claimQueuedJob(parsed.jobId);
  if (!job) {
    if (!state || state.status === "done" || state.status === "failed") {
      await deleteQueueMessage(jobQueueUrl, message.ReceiptHandle);
      return true;
    }
    const delay = Math.max(1, (new Date(state.run_after).getTime() - Date.now()) / 1000);
    await deferQueueMessage(jobQueueUrl, message.ReceiptHandle, delay);
    return true;
  }

  const startedAt = Date.now();
  try {
    await runJob(job);
    await sql`
      UPDATE background_jobs
      SET status = 'done', completed_at = NOW(), last_error = NULL
      WHERE id = ${job.id} AND status = 'running'
    `;
    await deleteQueueMessage(jobQueueUrl, message.ReceiptHandle);
    log(`trabajo ${job.kind} ${job.id} hecho en ${Date.now() - startedAt} ms`);
  } catch (error) {
    const detail = errorText(error);
    const wait = backoffSeconds(job.attempts);
    await sql`
      UPDATE background_jobs
      SET status = 'pending', last_error = ${detail},
          run_after = NOW() + ${wait} * INTERVAL '1 second'
      WHERE id = ${job.id} AND status = 'running'
    `;
    await deferQueueMessage(jobQueueUrl, message.ReceiptHandle, wait);
    logError(
      `trabajo ${job.kind} ${job.id} falló (intento ${job.attempts}); ` +
        `SQS reintentará o lo moverá a DLQ: ${detail}`
    );
  }
  return true;
}

async function consumeQueuedJobs() {
  if (!sqs || !jobQueueUrl) return 0;
  const response = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: jobQueueUrl,
      AttributeNames: ["ApproximateReceiveCount"],
      MaxNumberOfMessages: 5,
      WaitTimeSeconds: 1,
      VisibilityTimeout: 5,
    })
  );
  const messages = response.Messages ?? [];
  for (const message of messages) await processQueueMessage(message);
  return messages.length;
}

/**
 * La DLQ es evidencia operativa: no se borra aquí. El monitor proyecta la
 * falla definitiva en PostgreSQL y `queue:redrive` mueve explícitamente el
 * mensaje cuando el problema fue corregido.
 */
async function inspectDeadLetterQueue() {
  if (!sqs || !deadLetterQueueUrl) return 0;
  const response = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: deadLetterQueueUrl,
      MaxNumberOfMessages: 5,
      WaitTimeSeconds: 0,
      VisibilityTimeout: 5,
    })
  );
  const messages = response.Messages ?? [];
  for (const message of messages) {
    if (!message.Body) continue;
    try {
      const { jobId } = parseJobMessage(message.Body);
      const rows = await sql`
        UPDATE background_jobs
        SET status = 'failed', completed_at = NOW(),
            last_error = COALESCE(last_error, 'SQS agotó sus reintentos; mensaje en DLQ')
        WHERE id = ${jobId} AND status <> 'done' AND status <> 'failed'
        RETURNING kind
      `;
      if (rows[0]) logError(`trabajo ${rows[0].kind} ${jobId} quedó en DLQ`);
    } catch (error) {
      logError(`mensaje inválido conservado en DLQ: ${errorText(error)}`);
    } finally {
      // Inspeccionar no equivale a consumir. Se libera de inmediato para que
      // la herramienta operativa de redrive (o una auditoría) pueda recibir el
      // mismo mensaje sin competir contra una ventana de invisibilidad.
      if (message.ReceiptHandle) {
        await sqs.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: deadLetterQueueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: 0,
          })
        );
      }
    }
  }
  return messages.length;
}

async function claimDatabaseJob() {
  const rows = await sql`
    UPDATE background_jobs
    SET status = 'running',
        attempts = attempts + 1,
        run_after = NOW() + ${LEASE_SECONDS} * INTERVAL '1 second'
    WHERE id = (
      SELECT id FROM background_jobs
      WHERE status = 'pending' AND run_after <= NOW()
      ORDER BY run_after
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, payload, attempts
  `;
  return rows[0] ?? null;
}

async function runJob(job) {
  if (job.kind === "ai_review") {
    await handleAiReview(job);
    return;
  }
  if (DELEGATED_KINDS.has(job.kind)) {
    await callApplication(job.kind, asObject(job.payload), job.id);
    return;
  }
  throw new Error(`clase de trabajo desconocida: ${job.kind}`);
}

async function processDatabaseJobs() {
  const job = await claimDatabaseJob();
  if (!job) return false;

  const startedAt = Date.now();
  try {
    await runJob(job);
    await sql`
      UPDATE background_jobs
      SET status = 'done', completed_at = NOW(), last_error = NULL
      WHERE id = ${job.id}
    `;
    log(`trabajo ${job.kind} ${job.id} hecho en ${Date.now() - startedAt} ms`);
  } catch (error) {
    const detail = errorText(error);
    const unknownKind = detail.startsWith("clase de trabajo desconocida");
    if (unknownKind || job.attempts >= MAX_JOB_ATTEMPTS) {
      await sql`
        UPDATE background_jobs
        SET status = 'failed', last_error = ${detail}, completed_at = NOW()
        WHERE id = ${job.id}
      `;
      logError(`trabajo ${job.kind} ${job.id} falló definitivamente: ${detail}`);
    } else {
      const wait = backoffSeconds(job.attempts);
      await sql`
        UPDATE background_jobs
        SET status = 'pending', last_error = ${detail},
            run_after = NOW() + ${wait} * INTERVAL '1 second'
        WHERE id = ${job.id}
      `;
      logError(
        `trabajo ${job.kind} ${job.id} falló (intento ${job.attempts}), reintento en ${wait} s: ${detail}`
      );
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Barrido periódico
// ---------------------------------------------------------------------------

async function reclaimStaleJobs() {
  const rows = await sql`
    UPDATE background_jobs
    SET status = 'pending', run_after = NOW()
    WHERE status = 'running' AND run_after <= NOW()
    RETURNING id
  `;
  if (rows.length > 0) {
    log(`${rows.length} trabajo(s) sin dueño devueltos a la cola`);
  }
}

async function sweep() {
  try {
    await reclaimStaleJobs();
  } catch (error) {
    logError(`barrido de trabajos sin dueño: ${errorText(error)}`);
  }

  for (const kind of ["expire_links", "move_to_cold_sweep"]) {
    try {
      await callApplication(kind, {}, null);
    } catch (error) {
      logError(`barrido '${kind}': ${errorText(error)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Arranque y paro
// ---------------------------------------------------------------------------

async function loop() {
  while (running) {
    if (Date.now() - lastSweepAt >= SWEEP_MS) {
      lastSweepAt = Date.now();
      await sweep();
      if (!running) break;
    }

    let didWork;
    try {
      const delivered = await processNotifications();
      if (QUEUE_ENABLED) {
        const dispatched = await dispatchJobsToQueue();
        const consumed = await consumeQueuedJobs();
        let deadLetters = 0;
        if (Date.now() - lastDlqPollAt >= DLQ_POLL_MS) {
          lastDlqPollAt = Date.now();
          deadLetters = await inspectDeadLetterQueue();
        }
        didWork = delivered > 0 || dispatched > 0 || consumed > 0 || deadLetters > 0;
      } else {
        const worked = await processDatabaseJobs();
        didWork = delivered > 0 || worked;
      }
    } catch (error) {
      logError(`ciclo: ${errorText(error)}`);
      await sleep(POLL_MS);
      continue;
    }

    if (!didWork && running) await sleep(POLL_MS);
  }
}

function shutdown(signal) {
  if (!running) return;
  running = false;
  log(`${signal} recibido, terminando el ciclo en curso`);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

if (!WORKER_TOKEN) {
  logError(
    "FIDES_WORKER_TOKEN vacío: los trabajos de custodia y el barrido serán rechazados"
  );
}

log(
  `iniciado · app ${APP_URL} · captura ${SINK_URL} · revisión ${AI_URL} · ` +
    `trabajos ${QUEUE_ENABLED ? "SQS" : "PostgreSQL directo"}`
);

try {
  await initializeQueue();
  await loop();
} catch (error) {
  logError(`error fatal: ${errorText(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
  sqs?.destroy();
  log("detenido");
}
