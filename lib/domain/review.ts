import "server-only";
import { sql, type Transaction } from "@/lib/db";
import { appUrl } from "@/lib/app-url";
import {
  canOpenSensitiveEvidence,
  hasRole,
  requireRole,
  usedCapability,
  type OrganizationContext,
} from "@/lib/auth/guards";
import { formatDate, formatDateTime } from "@/lib/format";
import { DECISION_LABELS } from "@/lib/domain/labels";
import { ConflictError, NotFoundError } from "@/lib/domain/errors";
import {
  createAttemptWithLink,
  revokeAttemptLinks,
} from "@/lib/domain/attempts";
import {
  enqueueJob,
  enqueueNotification,
  recordAudit,
  recordContractEvent,
} from "@/lib/domain/operations";
import {
  PAGE_SIZE,
  REPEAT_REASON_LABELS,
  type EvidenceKind,
  type RepeatReasonCode,
  type ReviewDecisionKind,
  type ReviewPolicy,
} from "@/lib/domain/types";

export type AiRecommendation = "accept" | "repeat" | "inconclusive";

export interface ReviewTaskRow {
  taskId: string;
  contractId: string;
  reference: string;
  attemptId: string;
  sequence: number;
  templateName: string;
  holderName: string;
  signerName: string;
  submittedAt: Date;
  aiRecommendation: string | null;
}

export interface ReviewEvidenceItem {
  id: string;
  kind: EvidenceKind;
  contentType: string;
  byteSize: number;
  sha256: string;
  createdAt: Date;
  /** Sólo Administradores y Revisores reciben el localizador privado. */
  objectKey: string | null;
  metadata: Record<string, unknown>;
}

export interface AiReportView {
  id: string;
  model: string;
  configurationVersion: string;
  status: "completed" | "failed";
  transcript: string;
  expectedStatement: string;
  findings: unknown[];
  confidence: number | null;
  limitations: string;
  recommendation: AiRecommendation | null;
  createdAt: Date;
}

export interface RecordedDecision {
  taskId: string;
  attemptId: string;
  decision: ReviewDecisionKind;
  reviewerName: string;
  reasonCode: RepeatReasonCode | null;
  reasonText: string | null;
  followedAiRecommendation: boolean | null;
  successorAttemptId: string | null;
  createdAt: Date;
}

export interface ReviewTaskDetail {
  taskId: string;
  status: "open" | "resolved" | "closed_without_decision";
  contractId: string;
  reference: string;
  organizationName: string;
  attemptId: string;
  sequence: number;
  templateName: string;
  holderName: string;
  signerName: string;
  contractMarkdown: string;
  acceptanceLegend: string;
  videoStatement: string;
  reviewPolicy: ReviewPolicy;
  requiresIne: boolean;
  requiresVideo: boolean;
  submittedAt: Date | null;
  evidence: ReviewEvidenceItem[];
  aiReport: AiReportView | null;
  history: RecordedDecision[];
  decision: RecordedDecision | null;
  canDecide: boolean;
  canOpenEvidence: boolean;
}

export interface SaveAiReportInput {
  contractId: string;
  attemptId: string;
  model: string;
  configurationVersion: string;
  status: "completed" | "failed";
  transcript?: string;
  expectedStatement?: string;
  findings?: unknown[];
  confidence?: number | null;
  limitations?: string;
  recommendation?: AiRecommendation | null;
}

/** La bandeja la leen Revisores y Administradores; sólo el Revisor decide. */
function requireReviewAccess(context: OrganizationContext): void {
  requireRole(context, "reviewer", "administrator");
}

export async function listReviewTasks(
  context: OrganizationContext,
  page = 1
): Promise<{
  rows: ReviewTaskRow[];
  total: number;
  page: number;
  pages: number;
}> {
  requireReviewAccess(context);
  const current = Math.max(1, Math.trunc(page));
  const offset = (current - 1) * PAGE_SIZE;

  const [count] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total
    FROM review_tasks t
    JOIN contracts c ON c.id = t.contract_id
    WHERE t.organization_id = ${context.organization.id}
      AND t.status = 'open'
      AND c.classification <> 'deleted'
  `;
  /* v8 ignore next 1 -- `COUNT(*)` sin `GROUP BY` siempre devuelve exactamente una fila, así que el respaldo a cero no es alcanzable. */
  const total = Number(count?.total ?? 0);

  const rows = await sql<
    {
      task_id: string;
      contract_id: string;
      reference: string;
      attempt_id: string;
      sequence: number;
      template_name: string;
      holder_name: string | null;
      signer_name: string | null;
      submitted_at: Date | null;
      ai_recommendation: string | null;
    }[]
  >`
    SELECT t.id AS task_id, t.contract_id, c.reference, t.attempt_id,
           a.sequence, c.template_name,
           hp.name AS holder_name, sp.name AS signer_name,
           a.submitted_at, r.recommendation AS ai_recommendation
    FROM review_tasks t
    JOIN contracts c ON c.id = t.contract_id
    JOIN acceptance_attempts a ON a.id = t.attempt_id
    LEFT JOIN contract_parties hp
      ON hp.contract_id = c.id AND hp.party_role = 'holder'
    LEFT JOIN contract_parties sp
      ON sp.contract_id = c.id AND sp.party_role = 'signer'
    LEFT JOIN LATERAL (
      SELECT recommendation FROM ai_review_reports
      WHERE attempt_id = t.attempt_id
      ORDER BY created_at DESC LIMIT 1
    ) r ON TRUE
    WHERE t.organization_id = ${context.organization.id}
      AND t.status = 'open'
      AND c.classification <> 'deleted'
    ORDER BY a.submitted_at ASC NULLS LAST, c.reference ASC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `;

  return {
    rows: rows.map((row) => ({
      taskId: row.task_id,
      contractId: row.contract_id,
      reference: row.reference,
      attemptId: row.attempt_id,
      sequence: row.sequence,
      templateName: row.template_name,
      holderName: row.holder_name ?? "",
      signerName: row.signer_name ?? "",
      submittedAt: row.submitted_at ?? new Date(0),
      aiRecommendation: row.ai_recommendation,
    })),
    total,
    page: current,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

async function loadDecisions(
  contractId: string
): Promise<RecordedDecision[]> {
  const rows = await sql<
    {
      task_id: string;
      attempt_id: string;
      decision: ReviewDecisionKind;
      reviewer_name: string;
      reason_code: RepeatReasonCode | null;
      reason_text: string | null;
      followed_ai_recommendation: boolean | null;
      successor_attempt_id: string | null;
      created_at: Date;
    }[]
  >`
    SELECT task_id, attempt_id, decision, reviewer_name, reason_code,
           reason_text, followed_ai_recommendation, successor_attempt_id,
           created_at
    FROM review_decisions
    WHERE contract_id = ${contractId}
    ORDER BY created_at ASC
  `;
  return rows.map((row) => ({
    taskId: row.task_id,
    attemptId: row.attempt_id,
    decision: row.decision,
    reviewerName: row.reviewer_name,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    followedAiRecommendation: row.followed_ai_recommendation,
    successorAttemptId: row.successor_attempt_id,
    createdAt: row.created_at,
  }));
}

export async function getReviewTask(
  context: OrganizationContext,
  taskId: string
): Promise<ReviewTaskDetail> {
  requireReviewAccess(context);

  const [row] = await sql<
    {
      task_id: string;
      task_status: "open" | "resolved" | "closed_without_decision";
      contract_id: string;
      reference: string;
      organization_name: string;
      attempt_id: string;
      sequence: number;
      template_name: string;
      holder_name: string | null;
      signer_name: string | null;
      contract_markdown: string;
      acceptance_legend: string;
      video_statement: string;
      review_policy: ReviewPolicy;
      requires_ine: boolean;
      requires_video: boolean;
      submitted_at: Date | null;
    }[]
  >`
    SELECT t.id AS task_id, t.status AS task_status, t.contract_id,
           c.reference, o.name AS organization_name, t.attempt_id, a.sequence,
           c.template_name, hp.name AS holder_name, sp.name AS signer_name,
           c.contract_markdown, c.acceptance_legend, c.video_statement,
           c.review_policy, c.requires_ine, c.requires_video, a.submitted_at
    FROM review_tasks t
    JOIN contracts c ON c.id = t.contract_id
    JOIN organizations o ON o.id = c.organization_id
    JOIN acceptance_attempts a ON a.id = t.attempt_id
    LEFT JOIN contract_parties hp
      ON hp.contract_id = c.id AND hp.party_role = 'holder'
    LEFT JOIN contract_parties sp
      ON sp.contract_id = c.id AND sp.party_role = 'signer'
    WHERE t.id = ${taskId} AND t.organization_id = ${context.organization.id}
  `;
  if (!row) throw new NotFoundError("No encontramos esta revisión.");

  const canOpenEvidence = canOpenSensitiveEvidence(context);
  // Las tres lecturas dependen sólo del intento y del contrato ya resueltos.
  const [evidenceRows, reportRows, decisions] = await Promise.all([
    sql<
      {
        id: string;
        kind: EvidenceKind;
        content_type: string;
        byte_size: number;
        sha256: string;
        created_at: Date;
        object_key: string | null;
        metadata: Record<string, unknown>;
      }[]
    >`
      SELECT id, kind, content_type, byte_size, sha256, created_at,
             object_key, metadata
      FROM evidence_items
      WHERE attempt_id = ${row.attempt_id}
      ORDER BY kind ASC
    `,
    sql<
      {
        id: string;
        model: string;
        configuration_version: string;
        status: "completed" | "failed";
        transcript: string;
        expected_statement: string;
        findings: unknown[];
        confidence: string | null;
        limitations: string;
        recommendation: AiRecommendation | null;
        created_at: Date;
      }[]
    >`
      SELECT id, model, configuration_version, status, transcript,
             expected_statement, findings, confidence, limitations,
             recommendation, created_at
      FROM ai_review_reports
      WHERE attempt_id = ${row.attempt_id}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    loadDecisions(row.contract_id),
  ]);
  const [report] = reportRows;
  const decision =
    decisions.find((item) => item.taskId === row.task_id) ?? null;

  return {
    taskId: row.task_id,
    status: row.task_status,
    contractId: row.contract_id,
    reference: row.reference,
    organizationName: row.organization_name,
    attemptId: row.attempt_id,
    sequence: row.sequence,
    templateName: row.template_name,
    holderName: row.holder_name ?? "",
    signerName: row.signer_name ?? "",
    contractMarkdown: row.contract_markdown,
    acceptanceLegend: row.acceptance_legend,
    videoStatement: row.video_statement,
    reviewPolicy: row.review_policy,
    requiresIne: row.requires_ine,
    requiresVideo: row.requires_video,
    submittedAt: row.submitted_at,
    evidence: evidenceRows.map((item) => ({
      id: item.id,
      kind: item.kind,
      contentType: item.content_type,
      byteSize: item.byte_size,
      sha256: item.sha256,
      createdAt: item.created_at,
      /* v8 ignore next 1 -- `requireReviewAccess` ya exigió Revisor o Administrador, exactamente los mismos roles que `canOpenSensitiveEvidence`: aquí la rama nula no es alcanzable. */
      objectKey: canOpenEvidence ? item.object_key : null,
      metadata: item.metadata,
    })),
    aiReport: report
      ? {
          id: report.id,
          model: report.model,
          configurationVersion: report.configuration_version,
          status: report.status,
          transcript: report.transcript,
          expectedStatement: report.expected_statement,
          findings: Array.isArray(report.findings) ? report.findings : [],
          confidence:
            report.confidence === null ? null : Number(report.confidence),
          limitations: report.limitations,
          recommendation: report.recommendation,
          createdAt: report.created_at,
        }
      : null,
    history: decisions.filter((item) => item.taskId !== row.task_id),
    decision,
    canDecide: row.task_status === "open" && hasRole(context, "reviewer"),
    canOpenEvidence,
  };
}

interface LockedTask {
  taskId: string;
  contractId: string;
  organizationId: string;
  attemptId: string;
  sequence: number;
  reference: string;
  organizationName: string;
  linkDays: number;
  aiRecommendation: AiRecommendation | null;
}

/**
 * Resolución atómica: la primera decisión válida gana. Una decisión
 * concurrente posterior recibe la ya registrada sin producir otro efecto.
 */
async function lockOpenTask(
  tx: Transaction,
  context: OrganizationContext,
  taskId: string
): Promise<LockedTask> {
  const [row] = await tx<
    {
      task_id: string;
      task_status: string;
      contract_id: string;
      organization_id: string;
      attempt_id: string;
      sequence: number;
      reference: string;
      organization_name: string;
      link_days: number;
      contract_status: string;
      attempt_status: string;
    }[]
  >`
    SELECT t.id AS task_id, t.status AS task_status, t.contract_id,
           t.organization_id, t.attempt_id, a.sequence, c.reference,
           o.name AS organization_name, c.link_days,
           c.status AS contract_status, a.status AS attempt_status
    FROM review_tasks t
    JOIN contracts c ON c.id = t.contract_id
    JOIN organizations o ON o.id = c.organization_id
    JOIN acceptance_attempts a ON a.id = t.attempt_id
    WHERE t.id = ${taskId} AND t.organization_id = ${context.organization.id}
    FOR UPDATE OF t, c, a
  `;
  if (!row) throw new NotFoundError("No encontramos esta revisión.");

  if (row.task_status !== "open") {
    const [recorded] = await tx<
      {
        decision: ReviewDecisionKind;
        reviewer_name: string;
        created_at: Date;
      }[]
    >`
      SELECT decision, reviewer_name, created_at
      FROM review_decisions
      WHERE task_id = ${taskId}
      ORDER BY created_at ASC LIMIT 1
    `;
    if (recorded) {
      throw new ConflictError(
        `Esta revisión ya fue resuelta por ${recorded.reviewer_name} el ${formatDateTime(recorded.created_at)}: ${DECISION_LABELS[recorded.decision]}.`
      );
    }
    throw new ConflictError(
      "Esta revisión se cerró sin decisión porque el contrato cambió."
    );
  }

  if (row.contract_status !== "in_review" || row.attempt_status !== "in_review") {
    throw new ConflictError(
      "El contrato ya no está a revisión; alguien más lo resolvió o lo canceló."
    );
  }

  const [report] = await tx<{ recommendation: AiRecommendation | null }[]>`
    SELECT recommendation FROM ai_review_reports
    WHERE attempt_id = ${row.attempt_id}
    ORDER BY created_at DESC LIMIT 1
  `;

  const closed = await tx<{ id: string }[]>`
    UPDATE review_tasks
    SET status = 'resolved', resolved_at = NOW()
    WHERE id = ${taskId} AND status = 'open'
    RETURNING id
  `;
  /* v8 ignore next 3 -- la fila ya se retuvo con `FOR UPDATE OF t` y se comprobó `status = 'open'`; ninguna transacción concurrente puede cambiarla antes de este UPDATE, así que el conteo cero no es alcanzable. */
  if (closed.length === 0) {
    throw new ConflictError("Esta revisión ya fue resuelta.");
  }

  return {
    taskId: row.task_id,
    contractId: row.contract_id,
    organizationId: row.organization_id,
    attemptId: row.attempt_id,
    sequence: row.sequence,
    reference: row.reference,
    organizationName: row.organization_name,
    linkDays: row.link_days,
    aiRecommendation: report?.recommendation ?? null,
  };
}

async function insertDecision(
  tx: Transaction,
  context: OrganizationContext,
  task: LockedTask,
  decision: ReviewDecisionKind,
  extra: {
    reasonCode?: RepeatReasonCode | null;
    reasonText?: string | null;
    successorAttemptId?: string | null;
  } = {}
): Promise<void> {
  const followed =
    task.aiRecommendation === null
      ? null
      : decision === "repeat"
        ? task.aiRecommendation === "repeat"
        : task.aiRecommendation === "accept";

  await tx`
    INSERT INTO review_decisions (
      task_id, attempt_id, contract_id, organization_id, reviewer_account_id,
      reviewer_name, decision, reason_code, reason_text,
      followed_ai_recommendation, successor_attempt_id
    ) VALUES (
      ${task.taskId}, ${task.attemptId}, ${task.contractId},
      ${task.organizationId}, ${context.account.accountId},
      ${context.account.fullName}, ${decision},
      ${extra.reasonCode ?? null}, ${extra.reasonText ?? null},
      ${followed}, ${extra.successorAttemptId ?? null}
    )
  `;
}

async function acceptAfterReview(
  tx: Transaction,
  context: OrganizationContext,
  task: LockedTask,
  decision: "conclude" | "skip",
  note?: string
): Promise<void> {
  await insertDecision(tx, context, task, decision, {
    reasonText: decision === "skip" ? (note?.trim() || null) : null,
  });

  await tx`
    UPDATE acceptance_attempts
    SET status = 'accepted', closed_at = NOW()
    WHERE id = ${task.attemptId}
  `;
  await tx`
    UPDATE contracts
    SET status = 'accepted', accepted_at = NOW(), closed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${task.contractId}
  `;

  await recordContractEvent(
    {
      contractId: task.contractId,
      organizationId: task.organizationId,
      attemptId: task.attemptId,
      type: decision === "skip" ? "revision_omitida" : "revision_concluida",
      actorKind: "member",
      actorId: context.account.accountId,
      actorName: context.account.fullName,
      payload: {
        secuencia: task.sequence,
        recomendacion_ai: task.aiRecommendation,
      },
    },
    tx
  );

  await enqueueJob(
    "seal_cold_package",
    { contractId: task.contractId },
    { dedupeKey: `seal_cold_package:${task.contractId}` },
    tx
  );

  await recordAudit(
    {
      organizationId: task.organizationId,
      accountId: context.account.accountId,
      actorName: context.account.fullName,
      capability: usedCapability(context),
      action: decision === "skip" ? "review.skip" : "review.conclude",
      subjectType: "contract",
      subjectId: task.contractId,
      payload: { referencia: task.reference },
    },
    tx
  );
}

export async function concludeAndAccept(
  context: OrganizationContext,
  taskId: string
): Promise<void> {
  requireRole(context, "reviewer");
  await sql.begin(async (tx) => {
    const task = await lockOpenTask(tx, context, taskId);
    await acceptAfterReview(tx, context, task, "conclude");
    return true;
  });
}

/** `Omitir revisión y aceptar` no exige casilla, motivo o confirmación. */
export async function skipAndAccept(
  context: OrganizationContext,
  taskId: string,
  note?: string
): Promise<void> {
  requireRole(context, "reviewer");
  await sql.begin(async (tx) => {
    const task = await lockOpenTask(tx, context, taskId);
    await acceptAfterReview(tx, context, task, "skip", note);
    return true;
  });
}

function suggestedRepeatMessage(input: {
  organizationName: string;
  reference: string;
  reasonLabel: string;
  url: string;
  expiresAt: Date;
}): string {
  return [
    `Hola. Sobre el contrato ${input.reference} de ${input.organizationName}:`,
    `necesitamos que realices otra vez el proceso de aceptación porque la evidencia recibida quedó incompleta (${input.reasonLabel.toLowerCase()}).`,
    `Puedes hacerlo aquí: ${input.url}`,
    `El enlace estará disponible hasta el ${formatDate(input.expiresAt)}.`,
  ].join(" ");
}

export async function repeatProcess(
  context: OrganizationContext,
  taskId: string,
  reasonCode: RepeatReasonCode,
  reasonText?: string
): Promise<{ token: string; url: string; suggestedMessage: string }> {
  requireRole(context, "reviewer");
  // `hasOwn` y no `in`: la lista es cerrada y no incluye el prototipo.
  if (!Object.hasOwn(REPEAT_REASON_LABELS, reasonCode)) {
    throw new ConflictError("Elige un motivo de la lista.");
  }
  const text = reasonText?.trim() ?? "";
  // Sólo `Otro` exige explicación escrita.
  if (reasonCode === "otro" && text.length === 0) {
    throw new ConflictError("Describe el motivo cuando elijas `Otro`.");
  }

  return sql.begin(async (tx) => {
    const task = await lockOpenTask(tx, context, taskId);

    await tx`
      UPDATE acceptance_attempts
      SET status = 'repeated', closed_at = NOW()
      WHERE id = ${task.attemptId}
    `;
    await revokeAttemptLinks(tx, task.attemptId);

    const successor = await createAttemptWithLink(tx, {
      contractId: task.contractId,
      organizationId: task.organizationId,
      linkDays: task.linkDays,
      replacesAttemptId: task.attemptId,
    });

    await tx`
      UPDATE contracts
      SET status = 'pending', updated_at = NOW()
      WHERE id = ${task.contractId}
    `;

    await insertDecision(tx, context, task, "repeat", {
      reasonCode,
      reasonText: text || null,
      successorAttemptId: successor.attemptId,
    });

    await recordContractEvent(
      {
        contractId: task.contractId,
        organizationId: task.organizationId,
        attemptId: task.attemptId,
        type: "proceso_repetido",
        actorKind: "member",
        actorId: context.account.accountId,
        actorName: context.account.fullName,
        payload: {
          secuencia: task.sequence,
          motivo: reasonCode,
          intento_sucesor: successor.attemptId,
        },
      },
      tx
    );
    await recordContractEvent(
      {
        contractId: task.contractId,
        organizationId: task.organizationId,
        attemptId: successor.attemptId,
        type: "intento_sucesor_creado",
        actorKind: "member",
        actorId: context.account.accountId,
        actorName: context.account.fullName,
        payload: { reemplaza: task.attemptId },
      },
      tx
    );

    await recordAudit(
      {
        organizationId: task.organizationId,
        accountId: context.account.accountId,
        actorName: context.account.fullName,
        capability: usedCapability(context),
        action: "review.repeat",
        subjectType: "contract",
        subjectId: task.contractId,
        payload: { referencia: task.reference, motivo: reasonCode },
      },
      tx
    );

    // La plataforma nunca contacta al Firmante: entrega texto para copiar.
    return {
      token: successor.token,
      url: successor.url,
      suggestedMessage: suggestedRepeatMessage({
        organizationName: task.organizationName,
        reference: task.reference,
        reasonLabel: REPEAT_REASON_LABELS[reasonCode],
        url: successor.url,
        expiresAt: successor.expiresAt,
      }),
    };
  });
}

/** Registro posterior de un contacto externo; no es prueba de entrega. */
export async function recordExternalContact(
  context: OrganizationContext,
  contractId: string,
  channel: string,
  note?: string
): Promise<void> {
  requireReviewAccess(context);
  const cleanChannel = channel.trim();
  if (!cleanChannel) throw new ConflictError("Indica el canal utilizado.");

  const [contract] = await sql<{ id: string; reference: string }[]>`
    SELECT id, reference FROM contracts
    WHERE id = ${contractId} AND organization_id = ${context.organization.id}
  `;
  if (!contract) throw new NotFoundError("No encontramos este contrato.");

  const [attempt] = await sql<{ id: string }[]>`
    SELECT id FROM acceptance_attempts
    WHERE contract_id = ${contractId}
    ORDER BY sequence DESC LIMIT 1
  `;

  await sql`
    INSERT INTO external_contact_records (
      contract_id, attempt_id, organization_id, channel, note,
      recorded_by, recorded_by_name
    ) VALUES (
      ${contractId}, ${attempt?.id ?? null}, ${context.organization.id},
      ${cleanChannel}, ${note?.trim() || null},
      ${context.account.accountId}, ${context.account.fullName}
    )
  `;

  await recordContractEvent({
    contractId,
    organizationId: context.organization.id,
    attemptId: attempt?.id ?? null,
    type: "contacto_externo_registrado",
    actorKind: "member",
    actorId: context.account.accountId,
    actorName: context.account.fullName,
    payload: { canal: cleanChannel },
  });
}

/**
 * El worker ejecuta el análisis y llama aquí para conservarlo. El agente
 * recomienda: nunca acepta, cancela o crea otro Intento por sí solo.
 */
export async function saveAiReport(input: SaveAiReportInput): Promise<void> {
  const [contract] = await sql<
    { organization_id: string; reference: string }[]
  >`
    SELECT organization_id, reference FROM contracts WHERE id = ${input.contractId}
  `;
  if (!contract) throw new NotFoundError("No encontramos este contrato.");

  const recommendation =
    input.status === "failed" ? null : (input.recommendation ?? null);

  await sql.begin(async (tx) => {
    const [report] = await tx<{ id: string }[]>`
      INSERT INTO ai_review_reports (
        attempt_id, contract_id, organization_id, model, configuration_version,
        status, transcript, expected_statement, findings, confidence,
        limitations, recommendation
      ) VALUES (
        ${input.attemptId}, ${input.contractId}, ${contract.organization_id},
        ${input.model}, ${input.configurationVersion}, ${input.status},
        ${input.transcript ?? ""}, ${input.expectedStatement ?? ""},
        ${JSON.stringify(input.findings ?? [])}::text::jsonb,
        ${input.confidence ?? null}, ${input.limitations ?? ""},
        ${recommendation}
      )
      RETURNING id
    `;

    await recordContractEvent(
      {
        contractId: input.contractId,
        organizationId: contract.organization_id,
        attemptId: input.attemptId,
        type: "reporte_ai_registrado",
        actorKind: "system",
        actorName: "Agente AI",
        payload: {
          reporte: report.id,
          estado: input.status,
          recomendacion: recommendation,
        },
      },
      tx
    );

    // Una falla o resultado no concluyente deja el Intento `A revisión`.
    if (recommendation !== "repeat") return true;

    const [task] = await tx<{ id: string }[]>`
      SELECT id FROM review_tasks WHERE attempt_id = ${input.attemptId}
    `;
    const portalUrl = task
      ? `${appUrl()}/app/revision/${task.id}`
      : `${appUrl()}/app/revision`;

    const reviewers = await tx<
      { account_id: string; full_name: string; email: string }[]
    >`
      SELECT m.account_id, a.full_name, a.email
      FROM organization_members m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.organization_id = ${contract.organization_id}
        AND 'reviewer' = ANY (m.roles)
    `;

    for (const reviewer of reviewers) {
      // Información mínima: nunca contrato, evidencia, transcripción o enlace
      // del Firmante.
      await enqueueNotification(
        {
          organizationId: contract.organization_id,
          channel: "whatsapp",
          recipient: reviewer.email,
          template: "alerta_revision_ai",
          payload: {
            revisor: reviewer.full_name,
            referencia: contract.reference,
            portal: portalUrl,
          },
          dedupeKey: `ai_repeat:${input.attemptId}:${reviewer.account_id}`,
        },
        tx
      );
    }
    return true;
  });
}
