import "server-only";
import { sql } from "@/lib/db";
import type { Transaction } from "@/lib/db";
import { signerUrl } from "@/lib/app-url";
import type { OrganizationContext } from "@/lib/auth/guards";
import {
  canOpenSensitiveEvidence,
  hasRole,
  requireRole,
  usedCapability,
} from "@/lib/auth/guards";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "@/lib/domain/errors";
import { enqueueJob, recordAudit, recordContractEvent } from "@/lib/domain/operations";
import { ensureContractFreshness } from "@/lib/domain/expiry";
import { readConfiguration } from "@/lib/domain/types";
import type {
  AttemptStatus,
  Classification,
  ContractStatus,
  EffectiveConfiguration,
  EvidenceKind,
  ReviewPolicy,
} from "@/lib/domain/types";
import type { FieldDefinition } from "@/lib/domain/templates";
import { getTemplate, toStringMap } from "@/lib/domain/templates";
import { createDraft } from "@/lib/domain/drafts";
import type { DraftOriginReason } from "@/lib/domain/drafts";

export {
  searchContracts,
  listEmitters,
  countContracts,
  MAX_HIGHLIGHTED_FIELDS,
} from "@/lib/domain/search";
export type {
  ContractRow,
  ContractSearchParams,
  ContractSearchResult,
  ContractCounts,
  EmitterOption,
  HighlightedValue,
} from "@/lib/domain/search";

// ---------------------------------------------------------------------------
// Tipos del expediente
// ---------------------------------------------------------------------------

export interface ContractPartyDetail {
  role: "holder" | "signer";
  sourceCounterpartyId: string | null;
  personKind: "fisica" | "moral";
  name: string;
  rfc: string;
  email: string;
  phone: string;
  address: string;
  position: string;
  capturedAt: Date;
}

export interface EvidenceMetadata {
  id: string;
  kind: EvidenceKind;
  contentType: string;
  byteSize: number;
  sha256: string;
  createdAt: Date;
  /** INE y video sólo los abren Administrador o Revisor. */
  sensitive: boolean;
}

export interface AiReportDetail {
  id: string;
  model: string;
  configurationVersion: string;
  status: "completed" | "failed";
  transcript: string;
  expectedStatement: string;
  findings: unknown[];
  confidence: number | null;
  limitations: string;
  recommendation: "accept" | "repeat" | "inconclusive" | null;
  createdAt: Date;
}

export interface ReviewDecisionDetail {
  id: string;
  taskId: string;
  reviewerName: string;
  decision: "conclude" | "skip" | "repeat";
  reasonCode: string | null;
  reasonText: string | null;
  followedAiRecommendation: boolean | null;
  createdAt: Date;
}

export interface AttemptDetail {
  id: string;
  sequence: number;
  status: AttemptStatus;
  walkedAt: Date | null;
  submittedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  replacesAttemptId: string | null;
  linkExpiresAt: Date | null;
  linkRevokedAt: Date | null;
  linkFirstOpenedAt: Date | null;
  evidence: EvidenceMetadata[];
  aiReport: AiReportDetail | null;
  decision: ReviewDecisionDetail | null;
}

export interface ContractEventDetail {
  id: string;
  attemptId: string | null;
  type: string;
  actorKind: "member" | "signer" | "platform" | "system";
  actorName: string;
  sensitive: boolean;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface ContractLinkDetail {
  token: string;
  url: string;
  expiresAt: Date;
  revoked: boolean;
  firstOpenedAt: Date | null;
}

export interface ContractCustodySummary {
  sealed: boolean;
  tier: "immediate" | "cold" | null;
  packageHash: string | null;
  byteSize: number | null;
  closedAt: Date | null;
  activeCustody: boolean;
}

export interface ContractPermissions {
  canCopyLink: boolean;
  canAcceptReview: boolean;
  canCancel: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  canCreateSuccessor: boolean;
  canMoveFolder: boolean;
  canOpenSensitiveEvidence: boolean;
  canViewDocument: boolean;
}

export interface ContractDetail {
  id: string;
  organizationId: string;
  reference: string;
  status: ContractStatus;
  classification: Classification;
  templateId: string;
  templateName: string;
  /** Etiqueta interna de la publicación; no se muestra a la Organización. */
  templateLabel: string;
  templateVersionId: string;
  privacyNoticeVersionId: string;
  contractMarkdown: string;
  fieldValues: Record<string, string>;
  fields: FieldDefinition[];
  documentHash: string;
  acceptanceLegend: string;
  videoStatement: string;
  configuration: EffectiveConfiguration;
  defaults: EffectiveConfiguration;
  customized: boolean;
  folderId: string | null;
  folderName: string | null;
  emitterId: string | null;
  emitterName: string;
  issuedAt: Date;
  acceptedAt: Date | null;
  expiredAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  closedAt: Date | null;
  archivedAt: Date | null;
  deletedAt: Date | null;
  updatedAt: Date;
  holder: ContractPartyDetail | null;
  signer: ContractPartyDetail | null;
  attempts: AttemptDetail[];
  events: ContractEventDetail[];
  currentLink: ContractLinkDetail | null;
  openReviewTaskId: string | null;
  custody: ContractCustodySummary;
  permissions: ContractPermissions;
  /** Relación técnica de origen: sólo para el Administrador de plataforma. */
  originContractId: string | null;
  originReason: DraftOriginReason | null;
}

export interface FolderSummary {
  id: string;
  name: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Lectura del expediente
// ---------------------------------------------------------------------------

const SENSITIVE_EVIDENCE: EvidenceKind[] = ["ine_front", "ine_back", "video"];

interface ContractRecordRow {
  id: string;
  organization_id: string;
  reference: string;
  status: ContractStatus;
  classification: Classification;
  template_id: string;
  template_name: string;
  template_label: string;
  template_version_id: string;
  privacy_notice_version_id: string;
  contract_markdown: string;
  field_values: unknown;
  document_hash: string;
  acceptance_legend: string;
  video_statement: string;
  link_days: number;
  requires_video: boolean;
  requires_ine: boolean;
  review_policy: ReviewPolicy;
  defaults_snapshot: unknown;
  customized: boolean;
  folder_id: string | null;
  folder_name: string | null;
  created_by: string | null;
  created_by_name: string;
  origin_contract_id: string | null;
  origin_reason: DraftOriginReason | null;
  issued_at: Date;
  accepted_at: Date | null;
  expired_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  closed_at: Date | null;
  archived_at: Date | null;
  deleted_at: Date | null;
  updated_at: Date;
}

function contractColumns() {
  return sql`
    c.id, c.organization_id, c.reference, c.status, c.classification,
    c.template_id, c.template_name, c.template_label, c.template_version_id,
    c.privacy_notice_version_id, c.contract_markdown, c.field_values,
    c.document_hash, c.acceptance_legend, c.video_statement, c.link_days,
    c.requires_video, c.requires_ine, c.review_policy, c.defaults_snapshot,
    c.customized, c.folder_id, f.name AS folder_name, c.created_by,
    c.created_by_name, c.origin_contract_id, c.origin_reason, c.issued_at,
    c.accepted_at, c.expired_at, c.cancelled_at, c.cancel_reason, c.closed_at,
    c.archived_at, c.deleted_at, c.updated_at
  `;
}

async function loadContractRow(
  organizationId: string,
  contractId: string
): Promise<ContractRecordRow> {
  const [row] = await sql<ContractRecordRow[]>`
    SELECT ${contractColumns()}
    FROM contracts c
    LEFT JOIN contract_folders f ON f.id = c.folder_id
    WHERE c.organization_id = ${organizationId} AND c.id = ${contractId}
  `;
  if (!row) throw new NotFoundError("No encontramos ese Contrato.");
  return row;
}


function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isOwnerOrAdmin(
  context: OrganizationContext,
  row: ContractRecordRow
): boolean {
  return (
    hasRole(context, "administrator") ||
    row.created_by === context.account.accountId
  );
}

function buildPermissions(
  context: OrganizationContext,
  row: ContractRecordRow
): ContractPermissions {
  const deleted = row.classification === "deleted";
  const organizes = hasRole(context, "administrator") || hasRole(context, "emitter");
  const open = row.status === "pending" || row.status === "in_review";
  return {
    // El Contrato eliminado no entrega texto, PDF ni enlace.
    canCopyLink: !deleted && organizes && row.status === "pending",
    canAcceptReview:
      !deleted && row.status === "in_review" && hasRole(context, "reviewer"),
    canCancel: !deleted && open && isOwnerOrAdmin(context, row),
    canArchive: !deleted && organizes,
    canDelete: !deleted && hasRole(context, "administrator"),
    canDuplicate:
      !deleted && row.status === "cancelled" && hasRole(context, "emitter"),
    canCreateSuccessor:
      !deleted && row.status === "expired" && hasRole(context, "emitter"),
    canMoveFolder: !deleted && organizes,
    canOpenSensitiveEvidence: !deleted && canOpenSensitiveEvidence(context),
    canViewDocument: !deleted,
  };
}

export async function getContractDetail(
  context: OrganizationContext,
  contractId: string
): Promise<ContractDetail> {
  requireRole(context, "administrator", "emitter", "reviewer");
  const organizationId = context.organization.id;

  // Resolver primero por Organización impide que una lectura ajena provoque
  // el vencimiento u otra mutación perezosa sobre un Contrato que no pertenece
  // al contexto activo.
  let row = await loadContractRow(organizationId, contractId);
  const canOpenContractFile =
    hasRole(context, "administrator") ||
    hasRole(context, "emitter") ||
    (hasRole(context, "reviewer") && row.classification !== "deleted");
  if (!canOpenContractFile) {
    throw new AuthorizationError("No tienes acceso a esta operación.");
  }

  if (row.classification === "deleted") {
    const permissions = buildPermissions(context, row);
    const emptyConfiguration: EffectiveConfiguration = {
      linkDays: 0,
      requiresVideo: false,
      requiresIne: false,
      reviewPolicy: "none",
    };
    return {
      id: row.id,
      organizationId: row.organization_id,
      reference: row.reference,
      status: row.status,
      classification: row.classification,
      templateId: row.template_id,
      templateName: row.template_name,
      templateLabel: "",
      templateVersionId: "",
      privacyNoticeVersionId: "",
      contractMarkdown: "",
      fieldValues: {},
      fields: [],
      documentHash: "",
      acceptanceLegend: "",
      videoStatement: "",
      configuration: emptyConfiguration,
      defaults: emptyConfiguration,
      customized: false,
      folderId: null,
      folderName: null,
      emitterId: null,
      emitterName: row.created_by_name,
      issuedAt: row.issued_at,
      acceptedAt: null,
      expiredAt: null,
      cancelledAt: null,
      cancelReason: null,
      closedAt: row.closed_at,
      archivedAt: null,
      deletedAt: row.deleted_at,
      updatedAt: row.updated_at,
      holder: null,
      signer: null,
      attempts: [],
      events: [],
      currentLink: null,
      openReviewTaskId: null,
      custody: {
        sealed: false,
        tier: null,
        packageHash: null,
        byteSize: null,
        closedAt: null,
        activeCustody: false,
      },
      permissions,
      originContractId: null,
      originReason: null,
    };
  }

  // Lectura perezosa: el expediente muestra `Vencido` en cuanto terminó la
  // Vigencia del enlace, sin esperar al barrido del worker.
  await ensureContractFreshness(contractId);
  row = await loadContractRow(organizationId, contractId);

  const permissions = buildPermissions(context, row);
  const showSensitive = permissions.canOpenSensitiveEvidence;

  const [
    parties,
    attemptRows,
    linkRows,
    evidenceRows,
    aiRows,
    decisionRows,
    openTaskRows,
    eventRows,
    coldRows,
    template,
  ] = await Promise.all([
    sql<
      {
        party_role: "holder" | "signer";
        source_counterparty_id: string | null;
        person_kind: "fisica" | "moral";
        name: string;
        rfc: string | null;
        email: string | null;
        phone: string | null;
        address: string | null;
        position: string | null;
        captured_at: Date;
      }[]
    >`
      SELECT party_role, source_counterparty_id, person_kind, name, rfc, email,
             phone, address, position, captured_at
      FROM contract_parties WHERE contract_id = ${contractId}
    `,
    sql<
      {
        id: string;
        sequence: number;
        status: AttemptStatus;
        walked_at: Date | null;
        submitted_at: Date | null;
        closed_at: Date | null;
        created_at: Date;
        replaces_attempt_id: string | null;
      }[]
    >`
      SELECT id, sequence, status, walked_at, submitted_at, closed_at,
             created_at, replaces_attempt_id
      FROM acceptance_attempts
      WHERE contract_id = ${contractId}
      ORDER BY sequence
    `,
    sql<
      {
        attempt_id: string;
        token: string;
        expires_at: Date;
        revoked_at: Date | null;
        first_opened_at: Date | null;
        created_at: Date;
      }[]
    >`
      SELECT attempt_id, token, expires_at, revoked_at, first_opened_at,
             created_at
      FROM contract_links
      WHERE contract_id = ${contractId}
      ORDER BY created_at DESC
    `,
    sql<
      {
        id: string;
        attempt_id: string;
        kind: EvidenceKind;
        content_type: string;
        byte_size: number;
        sha256: string;
        created_at: Date;
      }[]
    >`
      SELECT id, attempt_id, kind, content_type, byte_size, sha256, created_at
      FROM evidence_items WHERE contract_id = ${contractId}
      ORDER BY created_at
    `,
    sql<
      {
        id: string;
        attempt_id: string;
        model: string;
        configuration_version: string;
        status: "completed" | "failed";
        transcript: string;
        expected_statement: string;
        findings: unknown;
        confidence: string | null;
        limitations: string;
        recommendation: "accept" | "repeat" | "inconclusive" | null;
        created_at: Date;
      }[]
    >`
      SELECT id, attempt_id, model, configuration_version, status, transcript,
             expected_statement, findings, confidence, limitations,
             recommendation, created_at
      FROM ai_review_reports WHERE contract_id = ${contractId}
      ORDER BY created_at
    `,
    sql<
      {
        id: string;
        task_id: string;
        attempt_id: string;
        reviewer_name: string;
        decision: "conclude" | "skip" | "repeat";
        reason_code: string | null;
        reason_text: string | null;
        followed_ai_recommendation: boolean | null;
        created_at: Date;
      }[]
    >`
      SELECT id, task_id, attempt_id, reviewer_name, decision, reason_code,
             reason_text, followed_ai_recommendation, created_at
      FROM review_decisions WHERE contract_id = ${contractId}
      ORDER BY created_at
    `,
    sql<{ id: string }[]>`
      SELECT id
      FROM review_tasks
      WHERE contract_id = ${contractId} AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    sql<
      {
        id: string;
        attempt_id: string | null;
        type: string;
        actor_kind: "member" | "signer" | "platform" | "system";
        actor_name: string;
        sensitive: boolean;
        payload: unknown;
        created_at: Date;
      }[]
    >`
      SELECT id, attempt_id, type, actor_kind, actor_name, sensitive, payload,
             created_at
      FROM contract_events WHERE contract_id = ${contractId}
      ORDER BY created_at
    `,
    sql<
      {
        sha256: string;
        byte_size: number;
        tier: "immediate" | "cold";
        closed_at: Date;
      }[]
    >`
      SELECT sha256, byte_size, tier, closed_at
      FROM cold_contract_packages WHERE contract_id = ${contractId}
    `,
    getTemplate(row.template_id),
  ]);

  const holderRow = parties.find((party) => party.party_role === "holder");
  const signerRow = parties.find((party) => party.party_role === "signer");
  const toParty = (
    party: (typeof parties)[number] | undefined
  ): ContractPartyDetail | null =>
    party
      ? {
          role: party.party_role,
          sourceCounterpartyId: party.source_counterparty_id,
          personKind: party.person_kind,
          name: party.name,
          rfc: party.rfc ?? "",
          email: party.email ?? "",
          phone: party.phone ?? "",
          address: party.address ?? "",
          position: party.position ?? "",
          capturedAt: party.captured_at,
        }
      : null;

  const configuration: EffectiveConfiguration = {
    linkDays: row.link_days,
    requiresVideo: row.requires_video,
    requiresIne: row.requires_ine,
    reviewPolicy: row.review_policy,
  };

  const attempts: AttemptDetail[] = attemptRows.map((attempt) => {
    const link = linkRows.find((item) => item.attempt_id === attempt.id) ?? null;
    const report = aiRows.find((item) => item.attempt_id === attempt.id) ?? null;
    const decision =
      decisionRows.find((item) => item.attempt_id === attempt.id) ?? null;
    return {
      id: attempt.id,
      sequence: attempt.sequence,
      status: attempt.status,
      walkedAt: attempt.walked_at,
      submittedAt: attempt.submitted_at,
      closedAt: attempt.closed_at,
      createdAt: attempt.created_at,
      replacesAttemptId: attempt.replaces_attempt_id,
      linkExpiresAt: link?.expires_at ?? null,
      linkRevokedAt: link?.revoked_at ?? null,
      linkFirstOpenedAt: link?.first_opened_at ?? null,
      evidence: evidenceRows
        .filter((item) => item.attempt_id === attempt.id)
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          contentType: item.content_type,
          byteSize: item.byte_size,
          sha256: item.sha256,
          createdAt: item.created_at,
          sensitive: SENSITIVE_EVIDENCE.includes(item.kind),
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
      decision: decision
        ? {
            id: decision.id,
            taskId: decision.task_id,
            reviewerName: decision.reviewer_name,
            decision: decision.decision,
            reasonCode: decision.reason_code,
            reasonText: decision.reason_text,
            followedAiRecommendation: decision.followed_ai_recommendation,
            createdAt: decision.created_at,
          }
        : null,
    };
  });

  const activeLink =
    linkRows.find(
      (item) =>
        item.revoked_at === null && new Date(item.expires_at).getTime() > Date.now()
    ) ?? null;

  const coldPackage = coldRows[0] ?? null;
  const isPlatformAdmin = context.account.isPlatformAdmin;

  return {
    id: row.id,
    organizationId: row.organization_id,
    reference: row.reference,
    status: row.status,
    classification: row.classification,
    templateId: row.template_id,
    templateName: row.template_name,
    templateLabel: row.template_label,
    templateVersionId: row.template_version_id,
    privacyNoticeVersionId: row.privacy_notice_version_id,
    // `deleted` regresó antes con metadata mínima; todos los demás detalles
    // autorizados entregan el documento a Administrador o Emisor.
    contractMarkdown: row.contract_markdown,
    fieldValues: toStringMap(row.field_values),
    /* v8 ignore next -- `contracts_template_id_fkey` (ON DELETE RESTRICT) impide borrar el Contrato-plantilla de un Contrato emitido, así que `getTemplate` nunca devuelve null aquí */
    fields: template?.fields ?? [],
    documentHash: row.document_hash,
    acceptanceLegend: row.acceptance_legend,
    videoStatement: row.video_statement,
    configuration,
    defaults: readConfiguration(row.defaults_snapshot, configuration),
    customized: row.customized,
    folderId: row.folder_id,
    folderName: row.folder_name,
    emitterId: row.created_by,
    emitterName: row.created_by_name,
    issuedAt: row.issued_at,
    acceptedAt: row.accepted_at,
    expiredAt: row.expired_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    closedAt: row.closed_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
    updatedAt: row.updated_at,
    holder: toParty(holderRow),
    signer: toParty(signerRow),
    attempts,
    events: eventRows
      // Un Emisor consulta el historial no sensible; INE y video no se abren.
      .filter((event) => showSensitive || !event.sensitive)
      .map((event) => ({
        id: event.id,
        attemptId: event.attempt_id,
        type: event.type,
        actorKind: event.actor_kind,
        actorName: event.actor_name,
        sensitive: event.sensitive,
        payload: toRecord(event.payload),
        createdAt: event.created_at,
      })),
    currentLink:
      activeLink &&
      row.classification !== "deleted" &&
      (hasRole(context, "administrator") || hasRole(context, "emitter"))
        ? {
            token: activeLink.token,
            url: signerUrl(activeLink.token),
            expiresAt: activeLink.expires_at,
            revoked: false,
            firstOpenedAt: activeLink.first_opened_at,
          }
        : null,
    openReviewTaskId: openTaskRows[0]?.id ?? null,
    custody: {
      sealed: Boolean(coldPackage),
      tier: coldPackage?.tier ?? null,
      packageHash: coldPackage?.sha256 ?? null,
      byteSize: coldPackage?.byte_size ?? null,
      closedAt: coldPackage?.closed_at ?? null,
      activeCustody: context.organization.capabilities.active_custody,
    },
    permissions,
    // La procedencia no se presenta a la Organización (ADR-0080).
    originContractId: isPlatformAdmin ? row.origin_contract_id : null,
    originReason: isPlatformAdmin ? row.origin_reason : null,
  };
}

// ---------------------------------------------------------------------------
// Cancelar, archivar, eliminar
// ---------------------------------------------------------------------------

/**
 * `Cancelar` está disponible para el Miembro creador y para cualquier
 * Administrador, sólo mientras el Contrato está `Pendiente de aceptación` o
 * `A revisión`. La condición viaja en el `UPDATE`: una resolución de revisión
 * concurrente compite de forma atómica y la primera acción válida gana.
 */
export async function cancelContract(
  context: OrganizationContext,
  contractId: string,
  reason?: string
): Promise<void> {
  requireRole(context, "administrator", "emitter");
  const organizationId = context.organization.id;
  const row = await loadContractRow(organizationId, contractId);
  if (row.classification === "deleted") {
    throw new ConflictError("Este Contrato está en Eliminados.");
  }
  if (!isOwnerOrAdmin(context, row)) {
    throw new AuthorizationError(
      "Sólo el Emisor que creó el Contrato o un Administrador puede cancelarlo."
    );
  }
  const note = (reason ?? "").trim() || null;

  await sql.begin(async (tx) => {
    const result = await tx`
      UPDATE contracts SET
        status = 'cancelled', cancelled_at = NOW(), closed_at = NOW(),
        cancel_reason = ${note}, updated_at = clock_timestamp()
      WHERE id = ${contractId} AND organization_id = ${organizationId}
        AND status IN ('pending', 'in_review')
    `;
    if (result.count === 0) {
      throw new ConflictError(
        "El Contrato ya no está pendiente ni a revisión: no puede cancelarse."
      );
    }
    await revokeLinks(tx, contractId);
    await tx`
      UPDATE acceptance_attempts SET status = 'cancelled', closed_at = NOW()
      WHERE contract_id = ${contractId} AND status IN ('open', 'in_review')
    `;
    await tx`
      UPDATE review_tasks
      SET status = 'closed_without_decision', resolved_at = NOW()
      WHERE contract_id = ${contractId} AND status = 'open'
    `;
    await recordContractEvent(
      {
        contractId,
        organizationId,
        type: "contrato_cancelado",
        actorKind: "member",
        actorId: context.account.accountId,
        actorName: context.account.fullName,
        payload: { reason: note },
      },
      tx
    );
    await recordAudit(
      {
        organizationId,
        accountId: context.account.accountId,
        actorName: context.account.fullName,
        capability: usedCapability(context),
        action: "contrato_cancelado",
        subjectType: "contract",
        subjectId: contractId,
        payload: { reference: row.reference, reason: note },
      },
      tx
    );
    // Todo Contrato cerrado produce su paquete inmutable, se haya aceptado o no.
    await enqueueJob(
      "seal_cold_package",
      { contractId },
      { dedupeKey: `seal_cold_package:${contractId}` },
      tx
    );
  });
}

async function revokeLinks(
  tx: Transaction,
  contractId: string
): Promise<void> {
  await tx`
    UPDATE contract_links SET revoked_at = NOW()
    WHERE contract_id = ${contractId} AND revoked_at IS NULL
  `;
}

/** Archivar es organización reversible: no toca estado, enlace ni custodia. */
export async function setArchived(
  context: OrganizationContext,
  contractId: string,
  archived: boolean
): Promise<void> {
  requireRole(context, "administrator", "emitter");
  const organizationId = context.organization.id;
  const target: Classification = archived ? "archived" : "active";
  const from: Classification = archived ? "active" : "archived";
  const result = await sql`
    UPDATE contracts SET
      classification = ${target},
      archived_at = CASE WHEN ${archived}::boolean THEN NOW() ELSE NULL END,
      updated_at = clock_timestamp()
    WHERE id = ${contractId} AND organization_id = ${organizationId}
      AND classification = ${from}
  `;
  if (result.count === 0) {
    throw new ConflictError(
      archived
        ? "El Contrato no está disponible para archivar."
        : "El Contrato no está archivado."
    );
  }
  await recordAudit({
    organizationId,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    capability: usedCapability(context),
    action: archived ? "contrato_archivado" : "contrato_restaurado",
    subjectType: "contract",
    subjectId: contractId,
  });
}

/**
 * `Eliminar` es sólo del rol Administrador. Cancela atómicamente un Contrato
 * abierto, invalida todos los enlaces y deja la Clasificación `Eliminado`.
 * No hay `Restaurar` dentro de la plataforma.
 */
export async function deleteContract(
  context: OrganizationContext,
  contractId: string
): Promise<void> {
  requireRole(context, "administrator");
  const organizationId = context.organization.id;
  const row = await loadContractRow(organizationId, contractId);
  if (row.classification === "deleted") return;

  await sql.begin(async (tx) => {
    const cancelled = await tx`
      UPDATE contracts SET
        status = 'cancelled', cancelled_at = NOW(), closed_at = NOW(),
        updated_at = clock_timestamp()
      WHERE id = ${contractId} AND organization_id = ${organizationId}
        AND status IN ('pending', 'in_review')
    `;
    if (cancelled.count > 0) {
      await tx`
        UPDATE acceptance_attempts SET status = 'cancelled', closed_at = NOW()
        WHERE contract_id = ${contractId} AND status IN ('open', 'in_review')
      `;
      await tx`
        UPDATE review_tasks
        SET status = 'closed_without_decision', resolved_at = NOW()
        WHERE contract_id = ${contractId} AND status = 'open'
      `;
    }
    const result = await tx`
      UPDATE contracts SET
        classification = 'deleted', deleted_at = NOW(), updated_at = clock_timestamp()
      WHERE id = ${contractId} AND organization_id = ${organizationId}
        AND classification <> 'deleted'
    `;
    if (result.count === 0) {
      throw new ConflictError("El Contrato ya está en Eliminados.");
    }
    await revokeLinks(tx, contractId);
    await recordContractEvent(
      {
        contractId,
        organizationId,
        type: "expediente_eliminado",
        actorKind: "member",
        actorId: context.account.accountId,
        actorName: context.account.fullName,
        payload: { cancelledOnDelete: cancelled.count > 0 },
      },
      tx
    );
    await recordAudit(
      {
        organizationId,
        accountId: context.account.accountId,
        actorName: context.account.fullName,
        capability: usedCapability(context),
        action: "contrato_eliminado",
        subjectType: "contract",
        subjectId: contractId,
        payload: { reference: row.reference },
      },
      tx
    );
    // Con Custodia activa el paquete puede seguir en acceso inmediato: se
    // ordena su traslado verificado al Archivo Muerto.
    if (context.organization.capabilities.active_custody) {
      await enqueueJob(
        "move_to_cold",
        { contractId, organizationId, reason: "deleted" },
        { dedupeKey: `move_to_cold:${contractId}` },
        tx
      );
    }
  });
}

export async function moveToFolder(
  context: OrganizationContext,
  contractId: string,
  folderId: string | null
): Promise<void> {
  requireRole(context, "administrator", "emitter");
  const organizationId = context.organization.id;
  if (folderId) {
    const [folder] = await sql<{ id: string }[]>`
      SELECT id FROM contract_folders
      WHERE organization_id = ${organizationId} AND id = ${folderId}
    `;
    if (!folder) throw new NotFoundError("No encontramos esa Carpeta operativa.");
  }
  const result = await sql`
    UPDATE contracts SET folder_id = ${folderId}, updated_at = clock_timestamp()
    WHERE id = ${contractId} AND organization_id = ${organizationId}
      AND classification <> 'deleted'
  `;
  if (result.count === 0) {
    throw new ConflictError("El Contrato no puede moverse de carpeta.");
  }
  await recordAudit({
    organizationId,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    capability: usedCapability(context),
    action: "contrato_movido_de_carpeta",
    subjectType: "contract",
    subjectId: contractId,
    payload: { folderId },
  });
}

// ---------------------------------------------------------------------------
// Crear un Borrador nuevo a partir de un Contrato anterior
// ---------------------------------------------------------------------------

/**
 * Origina un Borrador nuevo sobre la publicación vigente del mismo
 * Contrato-plantilla. Nunca copia Referencia, Huella documental, Intentos,
 * enlaces o evidencia, y nunca reactiva la publicación histórica.
 */
async function createDerivedDraft(
  context: OrganizationContext,
  contractId: string,
  reason: DraftOriginReason
): Promise<string> {
  requireRole(context, "emitter");
  const organizationId = context.organization.id;
  const row = await loadContractRow(organizationId, contractId);
  if (row.classification === "deleted") {
    throw new ConflictError("Este Contrato está en Eliminados.");
  }
  if (reason === "duplicate" && row.status !== "cancelled") {
    throw new ConflictError(
      "Primero cancela el Contrato para poder duplicarlo y corregirlo."
    );
  }
  if (reason === "successor" && row.status !== "expired") {
    throw new ConflictError("Este Contrato no está vencido.");
  }

  const template = await getTemplate(row.template_id);
  // Guarda inalcanzable desde la base: `contracts_template_id_fkey`
  // (ON DELETE RESTRICT) impide borrar el Contrato-plantilla mientras exista el
  // Contrato, y `contracts_template_organization_fk` impide moverlo a otra
  // Organización. Se conserva por si alguna vez se relaja la integridad.
  /* v8 ignore next 5 -- restricciones contracts_template_id_fkey y contracts_template_organization_fk */
  if (!template || template.organizationId !== organizationId) {
    throw new ConflictError(
      "El contrato-plantilla ya no está disponible para esta Organización."
    );
  }

  // Titular y Firmante salen del Directorio activo actual, nunca de la
  // instantánea histórica (ADR-0071).
  const parties = await sql<
    {
      party_role: "holder" | "signer";
      source_counterparty_id: string | null;
    }[]
  >`
    SELECT party_role, source_counterparty_id
    FROM contract_parties WHERE contract_id = ${contractId}
  `;
  const sourceFor = (role: "holder" | "signer"): string | null =>
    parties.find((party) => party.party_role === role)?.source_counterparty_id ??
    null;

  // La Carpeta operativa se conserva sólo si todavía existe.
  const folderId = row.folder_id;

  const draftId = await createDraft(context, {
    templateId: row.template_id,
    originContractId: row.id,
    originReason: reason,
    prefill: toStringMap(row.field_values),
    holderId: sourceFor("holder"),
    signerId: sourceFor("signer"),
    folderId,
  });

  await recordAudit({
    organizationId,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    capability: usedCapability(context),
    action:
      reason === "duplicate"
        ? "contrato_duplicado_para_corregir"
        : reason === "successor"
          ? "contrato_nuevo_desde_vencido"
          : "contrato_nuevo_desde_recientes",
    subjectType: "contract_draft",
    subjectId: draftId,
    payload: { originContractId: row.id, reference: row.reference },
  });
  return draftId;
}

export function duplicateForCorrection(
  context: OrganizationContext,
  contractId: string
): Promise<string> {
  return createDerivedDraft(context, contractId, "duplicate");
}

export function createFromExpired(
  context: OrganizationContext,
  contractId: string
): Promise<string> {
  return createDerivedDraft(context, contractId, "successor");
}

/**
 * `Recientes` reutiliza solamente datos operativos compatibles y las Partes
 * activas actuales. Nunca copia estado, enlace, evidencia o configuracion
 * efectiva del Contrato anterior.
 */
export function createFromPrevious(
  context: OrganizationContext,
  contractId: string
): Promise<string> {
  return createDerivedDraft(context, contractId, "reuse");
}

// ---------------------------------------------------------------------------
// Carpetas operativas
// ---------------------------------------------------------------------------

export async function listFolders(
  organizationId: string
): Promise<FolderSummary[]> {
  const rows = await sql<{ id: string; name: string; count: string }[]>`
    SELECT f.id, f.name,
           COUNT(c.id) FILTER (WHERE c.classification <> 'deleted') AS count
    FROM contract_folders f
    LEFT JOIN contracts c ON c.folder_id = f.id
    WHERE f.organization_id = ${organizationId}
    GROUP BY f.id, f.name
    ORDER BY lower(f.name)
  `;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    count: Number(row.count),
  }));
}

function folderName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new ConflictError("La carpeta necesita un nombre.");
  if (clean.length > 80) {
    throw new ConflictError("El nombre de la carpeta es demasiado largo.");
  }
  return clean;
}

export async function createFolder(
  context: OrganizationContext,
  name: string
): Promise<void> {
  requireRole(context, "administrator", "emitter");
  const organizationId = context.organization.id;
  const clean = folderName(name);
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM contract_folders
    WHERE organization_id = ${organizationId} AND lower(name) = lower(${clean})
  `;
  if (existing) throw new ConflictError("Ya existe una carpeta con ese nombre.");
  await sql`
    INSERT INTO contract_folders (organization_id, name)
    VALUES (${organizationId}, ${clean})
  `;
  await recordAudit({
    organizationId,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    capability: usedCapability(context),
    action: "carpeta_creada",
    subjectType: "contract_folder",
    payload: { name: clean },
  });
}

export async function renameFolder(
  context: OrganizationContext,
  id: string,
  name: string
): Promise<void> {
  requireRole(context, "administrator", "emitter");
  const organizationId = context.organization.id;
  const clean = folderName(name);
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM contract_folders
    WHERE organization_id = ${organizationId}
      AND lower(name) = lower(${clean}) AND id <> ${id}
  `;
  if (existing) throw new ConflictError("Ya existe una carpeta con ese nombre.");
  const result = await sql`
    UPDATE contract_folders SET name = ${clean}
    WHERE organization_id = ${organizationId} AND id = ${id}
  `;
  if (result.count === 0) {
    throw new NotFoundError("No encontramos esa Carpeta operativa.");
  }
  await recordAudit({
    organizationId,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    capability: usedCapability(context),
    action: "carpeta_renombrada",
    subjectType: "contract_folder",
    subjectId: id,
    payload: { name: clean },
  });
}

/** Eliminar una carpeta deja sus expedientes sin carpeta; nunca los borra. */
export async function deleteFolder(
  context: OrganizationContext,
  id: string
): Promise<void> {
  requireRole(context, "administrator", "emitter");
  const organizationId = context.organization.id;
  const result = await sql`
    DELETE FROM contract_folders
    WHERE organization_id = ${organizationId} AND id = ${id}
  `;
  if (result.count === 0) {
    throw new NotFoundError("No encontramos esa Carpeta operativa.");
  }
  await recordAudit({
    organizationId,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    capability: usedCapability(context),
    action: "carpeta_eliminada",
    subjectType: "contract_folder",
    subjectId: id,
  });
}
