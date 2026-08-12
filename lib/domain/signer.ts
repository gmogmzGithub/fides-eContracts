import "server-only";
import crypto from "crypto";
import { sql, type Transaction } from "@/lib/db";
import { canonicalizeJson } from "@/lib/canonical-json";
import { hashToken, sha256Hex } from "@/lib/crypto/tokens";
import { DomainError } from "@/lib/domain/errors";
import { ensureContractFreshness } from "@/lib/domain/expiry";
import { getObjectStorage } from "@/lib/storage";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "@/lib/evidence-limits";
import {
  enqueueJob,
  recordContractEvent,
  type Executor,
} from "@/lib/domain/operations";
import type {
  ContractStatus,
  EffectiveConfiguration,
  EvidenceKind,
  ReviewPolicy,
} from "@/lib/domain/types";

export type SignerStage = "contract" | "evidence" | "accept" | "done";

export interface SignerView {
  ok: true;
  token: string;
  organizationName: string;
  reference: string;
  contractMarkdown: string;
  acceptanceLegend: string;
  videoStatement: string;
  privacy: { markdown: string; fullMarkdown: string; simplifiedMarkdown: string };
  requiresVideo: boolean;
  requiresIne: boolean;
  reviewPolicy: ReviewPolicy;
  walked: boolean;
  evidence: Record<EvidenceKind, boolean>;
  expiresAt: Date;
  stage: SignerStage;
  contractId: string;
  attemptId: string;
  result?: "accepted" | "in_review";
}

export type SignerLoadFailure = {
  ok: false;
  reason:
    | "not_found"
    | "expired"
    | "revoked"
    | "cancelled"
    | "closed"
    | "no_privacy_notice";
};

export type SignerLoad = SignerView | SignerLoadFailure;

export interface StoreEvidenceOptions {
  /** El video debe nacer dentro de la sesión contractual (ADR-0062). */
  recordedInSession?: boolean;
  /** Texto exactamente como se mostró al Firmante. */
  shownStatement?: string;
}


const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
]);

const VIDEO_TYPES = new Set([
  "video/webm",
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
]);

interface LinkRow {
  link_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  first_opened_at: Date | null;
  attempt_id: string;
  attempt_status: string;
  sequence: number;
  walked_at: Date | null;
  submitted_at: Date | null;
  contract_id: string;
  organization_id: string;
  organization_name: string;
  reference: string;
  contract_status: ContractStatus;
  classification: string;
  contract_markdown: string;
  document_hash: string;
  acceptance_legend: string;
  video_statement: string;
  requires_video: boolean;
  requires_ine: boolean;
  review_policy: ReviewPolicy;
  notice_id: string | null;
  notice_hash: string | null;
  simplified_markdown: string | null;
  full_markdown: string | null;
  signer_name: string | null;
}

async function loadLink(
  token: string,
  executor: Executor = sql,
  lock = false
): Promise<LinkRow | undefined> {
  if (!token) return undefined;
  const tokenHash = hashToken(token);
  const rows = await executor<LinkRow[]>`
    SELECT
      l.id AS link_id, l.expires_at, l.revoked_at, l.first_opened_at,
      a.id AS attempt_id, a.status AS attempt_status, a.sequence,
      a.walked_at, a.submitted_at,
      c.id AS contract_id, c.organization_id, o.name AS organization_name,
      c.reference, c.status AS contract_status, c.classification,
      c.contract_markdown, c.document_hash, c.acceptance_legend,
      c.video_statement, c.requires_video, c.requires_ine, c.review_policy,
      p.id AS notice_id, p.notice_hash, p.simplified_markdown, p.full_markdown,
      sp.name AS signer_name
    FROM contract_links l
    JOIN acceptance_attempts a ON a.id = l.attempt_id
    JOIN contracts c ON c.id = l.contract_id
    JOIN organizations o ON o.id = c.organization_id
    LEFT JOIN privacy_notice_versions p ON p.id = c.privacy_notice_version_id
    LEFT JOIN contract_parties sp
      ON sp.contract_id = c.id AND sp.party_role = 'signer'
    WHERE l.token_hash = ${tokenHash}
    ${lock ? sql`FOR UPDATE OF c, a` : sql``}
  `;
  return rows[0];
}

export function requiredEvidenceKinds(
  configuration: Pick<EffectiveConfiguration, "requiresIne" | "requiresVideo">
): EvidenceKind[] {
  const kinds: EvidenceKind[] = [];
  if (configuration.requiresIne) kinds.push("ine_front", "ine_back");
  if (configuration.requiresVideo) kinds.push("video");
  return kinds;
}

async function loadEvidenceKinds(
  attemptId: string,
  executor: Executor = sql
): Promise<Set<EvidenceKind>> {
  const rows = await executor<{ kind: EvidenceKind }[]>`
    SELECT kind FROM evidence_items WHERE attempt_id = ${attemptId}
  `;
  return new Set(rows.map((row) => row.kind));
}

function evidenceMap(present: Set<EvidenceKind>): Record<EvidenceKind, boolean> {
  return {
    acceptance: present.has("acceptance"),
    ine_front: present.has("ine_front"),
    ine_back: present.has("ine_back"),
    video: present.has("video"),
  };
}

function resolveStage(
  row: LinkRow,
  present: Set<EvidenceKind>
): SignerStage {
  if (!row.walked_at) return "contract";
  const missing = requiredEvidenceKinds({
    requiresIne: row.requires_ine,
    requiresVideo: row.requires_video,
  }).filter((kind) => !present.has(kind));
  return missing.length > 0 ? "evidence" : "accept";
}

function toView(
  row: LinkRow,
  present: Set<EvidenceKind>,
  stage: SignerStage,
  token: string,
  result?: "accepted" | "in_review"
): SignerView {
  return {
    ok: true,
    token,
    organizationName: row.organization_name,
    reference: row.reference,
    contractMarkdown: row.contract_markdown,
    acceptanceLegend: row.acceptance_legend,
    videoStatement: row.video_statement,
    privacy: {
      /* v8 ignore next 1 -- `contracts.privacy_notice_version_id` es NOT NULL con borrado RESTRICT y `full_markdown` también es NOT NULL: el LEFT JOIN siempre encuentra la fila. */
      markdown: row.full_markdown ?? "",
      /* v8 ignore next 1 -- `contracts.privacy_notice_version_id` es NOT NULL con borrado RESTRICT y `simplified_markdown` también es NOT NULL: el LEFT JOIN siempre encuentra la fila. */
      simplifiedMarkdown: row.simplified_markdown ?? "",
      /* v8 ignore next 1 -- `contracts.privacy_notice_version_id` es NOT NULL con borrado RESTRICT y `full_markdown` también es NOT NULL: el LEFT JOIN siempre encuentra la fila. */
      fullMarkdown: row.full_markdown ?? "",
    },
    requiresVideo: row.requires_video,
    requiresIne: row.requires_ine,
    reviewPolicy: row.review_policy,
    walked: row.walked_at !== null,
    evidence: evidenceMap(present),
    expiresAt: row.expires_at,
    stage,
    contractId: row.contract_id,
    attemptId: row.attempt_id,
    ...(result ? { result } : {}),
  };
}

function hasCompleteNotice(row: LinkRow): boolean {
  return Boolean(
      row.notice_id &&
      row.notice_hash &&
      row.full_markdown &&
      row.full_markdown.trim()
  );
}

/**
 * Carga el recorrido del Firmante. Falla cerrada ante enlace inexistente,
 * revocado o vencido, Contrato cancelado o eliminado, Intento cerrado y
 * Aviso de Privacidad incompleto.
 */
export async function loadSignerView(token: string): Promise<SignerLoad> {
  let row = await loadLink(token);
  if (!row) return { ok: false, reason: "not_found" };

  if (row.classification === "deleted" || row.contract_status === "cancelled") {
    return { ok: false, reason: "cancelled" };
  }
  if (row.revoked_at) return { ok: false, reason: "revoked" };

  // El token es una capacidad temporal, no una URL permanente al Contrato.
  // Su vigencia se aplica también después de enviar o aceptar el Intento: al
  // terminar ya no entrega el resultado, el texto ni el PDF.
  if (row.expires_at.getTime() <= Date.now()) {
    await ensureContractFreshness(row.contract_id);
    return { ok: false, reason: "expired" };
  }

  // Un intento ya enviado muestra sólo el resultado mínimo.
  if (row.attempt_status === "accepted" || row.attempt_status === "in_review") {
    const present = await loadEvidenceKinds(row.attempt_id);
    return toView(
      row,
      present,
      "done",
      token,
      row.attempt_status === "accepted" ? "accepted" : "in_review"
    );
  }
  if (row.attempt_status !== "open") return { ok: false, reason: "closed" };

  if (row.contract_status === "expired") return { ok: false, reason: "expired" };
  if (row.contract_status !== "pending") return { ok: false, reason: "closed" };

  if (!hasCompleteNotice(row)) return { ok: false, reason: "no_privacy_notice" };

  if (!row.first_opened_at) {
    const opened = await sql<{ id: string }[]>`
      UPDATE contract_links
      SET first_opened_at = NOW()
      WHERE id = ${row.link_id} AND first_opened_at IS NULL
      RETURNING id
    `;
    if (opened.length > 0) {
      // Presentación del Contrato, jamás lectura, identidad o aceptación.
      await recordContractEvent({
        contractId: row.contract_id,
        organizationId: row.organization_id,
        attemptId: row.attempt_id,
        type: "enlace_abierto",
        actorKind: "signer",
        actorName: row.signer_name ?? "",
        payload: { secuencia: row.sequence },
      });
      row = { ...row, first_opened_at: new Date() };
    }
  }

  const present = await loadEvidenceKinds(row.attempt_id);
  return toView(row, present, resolveStage(row, present), token);
}

function assertUsableLink(row: LinkRow | undefined): asserts row is LinkRow {
  if (!row) throw new DomainError("El enlace no está disponible.");
  if (row.classification === "deleted" || row.contract_status === "cancelled") {
    throw new DomainError("Este contrato ya no admite acciones.");
  }
  if (row.revoked_at) throw new DomainError("Este enlace ya no está activo.");
  if (row.attempt_status !== "open") {
    throw new DomainError("Este proceso ya fue enviado.");
  }
  if (row.contract_status !== "pending") {
    throw new DomainError("Este contrato ya no admite acciones.");
  }
  if (row.expires_at.getTime() <= Date.now()) {
    throw new DomainError("La vigencia del enlace terminó.");
  }
}

/**
 * Evento técnico `Contrato recorrido`: documenta que la interfaz llegó al
 * final del texto. Nunca es prueba de lectura, comprensión o conformidad.
 */
export async function markContractWalked(token: string): Promise<void> {
  const row = await loadLink(token);
  assertUsableLink(row);
  if (row.walked_at) return;

  const updated = await sql<{ id: string }[]>`
    UPDATE acceptance_attempts
    SET walked_at = NOW()
    WHERE id = ${row.attempt_id} AND status = 'open' AND walked_at IS NULL
    RETURNING id
  `;
  if (updated.length === 0) return;

  await recordContractEvent({
    contractId: row.contract_id,
    organizationId: row.organization_id,
    attemptId: row.attempt_id,
    type: "contrato_recorrido",
    actorKind: "signer",
    actorName: row.signer_name ?? "",
    payload: { secuencia: row.sequence },
  });
}

function assertEvidenceAllowed(row: LinkRow, kind: EvidenceKind): void {
  if (kind === "acceptance") {
    throw new DomainError("La aceptación se registra al aceptar el contrato.");
  }
  if ((kind === "ine_front" || kind === "ine_back") && !row.requires_ine) {
    throw new DomainError("Este contrato no solicita INE.");
  }
  if (kind === "video" && !row.requires_video) {
    throw new DomainError("Este contrato no solicita video.");
  }
  if (!row.walked_at) {
    throw new DomainError("Primero recorre el contrato completo.");
  }
}

function assertFileShape(
  kind: EvidenceKind,
  file: { buffer: Buffer; contentType: string },
  options: StoreEvidenceOptions
): void {
  if (!file.buffer || file.buffer.byteLength === 0) {
    throw new DomainError("El archivo llegó vacío.");
  }
  const contentType = file.contentType.split(";")[0].trim().toLowerCase();
  if (kind === "video") {
    if (!VIDEO_TYPES.has(contentType)) {
      throw new DomainError("El formato del video no es compatible.");
    }
    if (file.buffer.byteLength > MAX_VIDEO_BYTES) {
      throw new DomainError("El video excede el tamaño permitido.");
    }
    // Sólo se conserva grabación nacida dentro del recorrido contractual.
    if (options.recordedInSession === false) {
      throw new DomainError(
        "El video debe grabarse dentro de este recorrido; no se aceptan archivos previos."
      );
    }
    return;
  }
  if (!IMAGE_TYPES.has(contentType)) {
    throw new DomainError("El formato de la imagen no es compatible.");
  }
  if (file.buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new DomainError("La imagen excede el tamaño permitido.");
  }
}

/**
 * Guarda la evidencia como objeto privado. Nunca produce una URL pública o
 * permanente y no afirma verificación de identidad.
 */
export async function storeEvidence(
  token: string,
  kind: EvidenceKind,
  file: { buffer: Buffer; contentType: string; fileName: string },
  options: StoreEvidenceOptions = {}
): Promise<void> {
  const row = await loadLink(token);
  assertUsableLink(row);
  assertEvidenceAllowed(row, kind);
  assertFileShape(kind, file, options);

  const contentType = file.contentType.split(";")[0].trim().toLowerCase();
  const objectKey = `organizations/${row.organization_id}/contracts/${row.contract_id}/attempts/${row.attempt_id}/${kind}-${crypto.randomUUID()}`;
  const sha256 = sha256Hex(file.buffer);

  const [previous] = await sql<{ object_key: string | null }[]>`
    SELECT object_key FROM evidence_items
    WHERE attempt_id = ${row.attempt_id} AND kind = ${kind}
  `;

  const storage = getObjectStorage();
  await storage.put({
    key: objectKey,
    body: file.buffer,
    contentType,
    metadata: {
      organizationId: row.organization_id,
      contractId: row.contract_id,
      attemptId: row.attempt_id,
      kind,
    },
  });

  const metadata = {
    fileName: file.fileName,
    recordedInSession: kind === "video" ? options.recordedInSession !== false : null,
    shownStatement: kind === "video" ? (options.shownStatement ?? row.video_statement) : null,
    attemptSequence: row.sequence,
    documentHash: row.document_hash,
    receivedAt: new Date().toISOString(),
  };

  await sql`
    INSERT INTO evidence_items (
      attempt_id, contract_id, organization_id, kind, object_key,
      content_type, byte_size, sha256, metadata
    ) VALUES (
      ${row.attempt_id}, ${row.contract_id}, ${row.organization_id}, ${kind},
      ${objectKey}, ${contentType}, ${file.buffer.byteLength}, ${sha256},
      ${JSON.stringify(metadata)}::text::jsonb
    )
    ON CONFLICT (attempt_id, kind) DO UPDATE SET
      object_key = EXCLUDED.object_key,
      content_type = EXCLUDED.content_type,
      byte_size = EXCLUDED.byte_size,
      sha256 = EXCLUDED.sha256,
      metadata = EXCLUDED.metadata,
      created_at = NOW()
  `;

  if (previous?.object_key && previous.object_key !== objectKey) {
    await storage.delete(previous.object_key);
  }

  // El evento no describe contenido personal: sólo categoría, tamaño y hash.
  await recordContractEvent({
    contractId: row.contract_id,
    organizationId: row.organization_id,
    attemptId: row.attempt_id,
    type: "evidencia_recibida",
    actorKind: "signer",
    actorName: row.signer_name ?? "",
    payload: {
      categoria: kind,
      bytes: file.buffer.byteLength,
      tipo: contentType,
      sha256,
    },
  });
}

interface AcceptanceRecordInput {
  row: LinkRow;
  declaredName: string;
  userAgent: string;
  evidence: { kind: EvidenceKind; sha256: string }[];
  acceptedAt: string;
}

function buildAcceptanceRecord(
  input: AcceptanceRecordInput
): Record<string, unknown> {
  const { row } = input;
  return {
    tipo: "aceptacion_electronica",
    version: 1,
    contrato: {
      id: row.contract_id,
      referencia: row.reference,
      hash_documento: row.document_hash,
    },
    organizacion: { id: row.organization_id, nombre: row.organization_name },
    intento: { id: row.attempt_id, secuencia: row.sequence },
    aviso_privacidad: { id: row.notice_id, hash: row.notice_hash },
    leyenda: row.acceptance_legend,
    leyenda_aceptada: true,
    /* v8 ignore next 1 -- `acceptContract` ya rechazó el Intento sin `walked_at` antes de armar el registro, así que aquí la rama nula no es alcanzable. */
    contrato_recorrido_en: row.walked_at ? row.walked_at.toISOString() : null,
    nombre_declarado: input.declaredName,
    agente_usuario: input.userAgent,
    evidencia: input.evidence
      .map((item) => ({ categoria: item.kind, sha256: item.sha256 }))
      .sort((a, b) => a.categoria.localeCompare(b.categoria)),
    aceptado_en: input.acceptedAt,
  };
}

async function insertAcceptanceEvidence(
  tx: Transaction,
  row: LinkRow,
  record: Record<string, unknown>
): Promise<string> {
  const canonical = canonicalizeJson(record);
  const sha256 = sha256Hex(canonical);
  // `::text::jsonb` evita que el controlador vuelva a serializar la cadena.
  await tx`
    INSERT INTO evidence_items (
      attempt_id, contract_id, organization_id, kind, object_key,
      content_type, byte_size, sha256, metadata
    ) VALUES (
      ${row.attempt_id}, ${row.contract_id}, ${row.organization_id},
      'acceptance', NULL, 'application/json',
      ${Buffer.byteLength(canonical, "utf8")}, ${sha256},
      ${canonical}::text::jsonb
    )
    ON CONFLICT (attempt_id, kind) DO NOTHING
  `;
  return sha256;
}

/**
 * `Aceptar contrato`. Idempotente: revalida enlace, vigencia, Contrato e
 * Intento dentro de una sola transacción.
 */
export async function acceptContract(
  token: string,
  input: { legendAccepted: boolean; declaredName?: string; userAgent?: string }
): Promise<{ result: "accepted" | "in_review"; reference: string }> {
  const existing = await loadLink(token);
  if (!existing) throw new DomainError("El enlace no está disponible.");
  if (existing.attempt_status === "accepted") {
    return { result: "accepted", reference: existing.reference };
  }
  if (existing.attempt_status === "in_review") {
    return { result: "in_review", reference: existing.reference };
  }
  if (!input.legendAccepted) {
    throw new DomainError("Marca la casilla de la leyenda para continuar.");
  }

  return sql.begin(async (tx) => {
    const row = await loadLink(token, tx, true);
    if (row?.attempt_status === "accepted") {
      return { result: "accepted" as const, reference: row.reference };
    }
    if (row?.attempt_status === "in_review") {
      return { result: "in_review" as const, reference: row.reference };
    }
    assertUsableLink(row);
    if (!hasCompleteNotice(row)) {
      throw new DomainError("El aviso de privacidad no está disponible.");
    }
    if (!row.walked_at) {
      throw new DomainError("Primero recorre el contrato completo.");
    }

    const stored = await tx<{ kind: EvidenceKind; sha256: string }[]>`
      SELECT kind, sha256 FROM evidence_items
      WHERE attempt_id = ${row.attempt_id}
    `;
    const present = new Set(stored.map((item) => item.kind));
    const missing = requiredEvidenceKinds({
      requiresIne: row.requires_ine,
      requiresVideo: row.requires_video,
    }).filter((kind) => !present.has(kind));
    if (missing.length > 0) {
      throw new DomainError("Falta evidencia del perfil de este contrato.");
    }

    const acceptedAt = new Date();
    const record = buildAcceptanceRecord({
      row,
      declaredName: (input.declaredName ?? row.signer_name ?? "").trim(),
      userAgent: (input.userAgent ?? "").slice(0, 300),
      evidence: stored,
      acceptedAt: acceptedAt.toISOString(),
    });
    const acceptanceHash = await insertAcceptanceEvidence(tx, row, record);

    const inReview = row.review_policy !== "none";
    if (inReview) {
      await tx`
        UPDATE acceptance_attempts
        SET status = 'in_review', submitted_at = NOW()
        WHERE id = ${row.attempt_id}
      `;
      await tx`
        UPDATE contracts
        SET status = 'in_review', updated_at = NOW()
        WHERE id = ${row.contract_id}
      `;
    } else {
      await tx`
        UPDATE acceptance_attempts
        SET status = 'accepted', submitted_at = NOW(), closed_at = NOW()
        WHERE id = ${row.attempt_id}
      `;
      await tx`
        UPDATE contracts
        SET status = 'accepted', accepted_at = ${acceptedAt},
            closed_at = ${acceptedAt}, updated_at = NOW()
        WHERE id = ${row.contract_id}
      `;
    }

    await recordContractEvent(
      {
        contractId: row.contract_id,
        organizationId: row.organization_id,
        attemptId: row.attempt_id,
        type: inReview ? "intento_enviado_a_revision" : "contrato_aceptado",
        actorKind: "signer",
        actorName: row.signer_name ?? "",
        payload: {
          secuencia: row.sequence,
          politica: row.review_policy,
          hash_aceptacion: acceptanceHash,
        },
      },
      tx
    );

    if (inReview) {
      await tx`
        INSERT INTO review_tasks (attempt_id, contract_id, organization_id, status)
        VALUES (${row.attempt_id}, ${row.contract_id}, ${row.organization_id}, 'open')
        ON CONFLICT (attempt_id) DO NOTHING
      `;
      // La revisión manual nunca dispara WhatsApp: sólo la recomendación AI.
      if (row.review_policy === "ai") {
        await enqueueJob(
          "ai_review",
          { contractId: row.contract_id, attemptId: row.attempt_id },
          { dedupeKey: `ai_review:${row.attempt_id}` },
          tx
        );
      }
      return { result: "in_review" as const, reference: row.reference };
    }

    await enqueueJob(
      "seal_cold_package",
      { contractId: row.contract_id },
      { dedupeKey: `seal_cold_package:${row.contract_id}` },
      tx
    );
    return { result: "accepted" as const, reference: row.reference };
  });
}
