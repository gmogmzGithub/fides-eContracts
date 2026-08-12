import "server-only";
import crypto from "crypto";
import { sql } from "@/lib/db";
import {
  hasRole,
  usedCapability,
  type OrganizationContext,
} from "@/lib/auth/guards";
import { canonicalizeJson } from "@/lib/canonical-json";
import { sha256Hex } from "@/lib/crypto/tokens";
import { formatDate } from "@/lib/format";
import { getObjectStorage } from "@/lib/storage";
import { extensionFor } from "@/lib/domain/content-types";
import { evidencePackageHash } from "@/lib/domain/documents";
import { createZip } from "@/lib/zip";
import {
  AuthorizationError,
  DomainError,
  NotFoundError,
} from "@/lib/domain/errors";
import {
  enqueueJob,
  enqueueNotification,
  recordAudit,
  recordContractEvent,
} from "@/lib/domain/operations";
import { PAGE_SIZE, type EvidenceKind } from "@/lib/domain/types";

export type CustodyTier = "immediate" | "cold";

export interface CustodyState {
  sealed: boolean;
  tier: CustodyTier | null;
  packageHash: string | null;
  byteSize: number | null;
  closedAt: Date | null;
  temporaryCopy: { objectKey: string; availableUntil: Date } | null;
  recovery: { id: string; status: string; availableUntil: Date | null } | null;
  export: { id: string; status: string; availableUntil: Date | null } | null;
  activeCustody: boolean;
  canRequest: boolean;
  canDownload: boolean;
  canDownloadExport: boolean;
  message: string;
}

export interface CustodyDownload {
  body: Buffer;
  fileName: string;
}

export interface ColdArchiveRow {
  contractId: string;
  reference: string;
  organizationId: string;
  organizationName: string;
  tier: CustodyTier;
  byteSize: number;
  sha256: string;
  objectKey: string;
  closedAt: Date;
  movedToColdAt: Date | null;
}

/** Tres días completos para cualquier copia temporal (ADR-0081). */
const TEMPORARY_DAYS = 3;
const TEMPORARY_MS = TEMPORARY_DAYS * 24 * 3600 * 1000;
const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;

const EVIDENCE_FILE_NAMES: Record<EvidenceKind, string> = {
  acceptance: "evidencia/aceptacion",
  ine_front: "evidencia/ine-frente",
  ine_back: "evidencia/ine-reverso",
  video: "evidencia/video",
};

function safeReference(reference: string): string {
  return reference.replace(/[^A-Za-z0-9._-]/g, "-");
}

interface ContractRow {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_legal_name: string;
  reference: string;
  status: string;
  classification: string;
  template_name: string;
  template_label: string;
  contract_markdown: string;
  document_hash: string;
  acceptance_legend: string;
  video_statement: string;
  field_values: Record<string, string>;
  review_policy: string;
  requires_ine: boolean;
  requires_video: boolean;
  link_days: number;
  privacy_notice_version_id: string;
  privacy_notice_label: string;
  privacy_notice_simplified_markdown: string;
  privacy_notice_full_markdown: string;
  privacy_notice_hash: string;
  privacy_notice_published_at: Date;
  issued_at: Date;
  accepted_at: Date | null;
  closed_at: Date | null;
  created_by_name: string;
}

async function loadContractForPackage(
  contractId: string
): Promise<ContractRow | undefined> {
  const [row] = await sql<ContractRow[]>`
    SELECT c.id, c.organization_id, o.name AS organization_name,
           o.legal_name AS organization_legal_name, c.reference, c.status,
           c.classification, c.template_name, c.template_label,
           c.contract_markdown, c.document_hash, c.acceptance_legend,
           c.video_statement, c.field_values, c.review_policy, c.requires_ine,
           c.requires_video, c.link_days, c.privacy_notice_version_id,
           c.privacy_notice_label, c.privacy_notice_simplified_markdown,
           c.privacy_notice_full_markdown, c.privacy_notice_hash,
           c.privacy_notice_published_at,
           c.issued_at, c.accepted_at, c.closed_at, c.created_by_name
    FROM contracts c
    JOIN organizations o ON o.id = c.organization_id
    WHERE c.id = ${contractId}
  `;
  return row;
}

async function hasActiveCustody(organizationId: string): Promise<boolean> {
  const [row] = await sql<{ enabled: boolean }[]>`
    SELECT enabled FROM commercial_entitlements
    WHERE organization_id = ${organizationId} AND capability = 'active_custody'
  `;
  return row?.enabled === true;
}

/**
 * Sella el Paquete contractual frío: un único ZIP inmutable por Contrato.
 * Nunca incorpora artefactos de intentos mandados a repetir; el historial
 * conserva únicamente que existieron.
 */
export async function sealColdPackage(contractId: string): Promise<void> {
  const contract = await loadContractForPackage(contractId);
  if (!contract) throw new NotFoundError("No encontramos este contrato.");
  if (!contract.closed_at) return;

  const [already] = await sql<{ id: string }[]>`
    SELECT id FROM cold_contract_packages WHERE contract_id = ${contractId}
  `;
  if (already) return;

  const parties = await sql<
    {
      party_role: string;
      person_kind: string;
      name: string;
      rfc: string | null;
      email: string | null;
      phone: string | null;
      address: string | null;
      position: string | null;
    }[]
  >`
    SELECT party_role, person_kind, name, rfc, email, phone, address, position
    FROM contract_parties WHERE contract_id = ${contractId}
    ORDER BY party_role ASC
  `;

  const attempts = await sql<
    {
      id: string;
      sequence: number;
      status: string;
      walked_at: Date | null;
      submitted_at: Date | null;
      closed_at: Date | null;
      replaces_attempt_id: string | null;
    }[]
  >`
    SELECT id, sequence, status, walked_at, submitted_at, closed_at,
           replaces_attempt_id
    FROM acceptance_attempts WHERE contract_id = ${contractId}
    ORDER BY sequence ASC
  `;
  const concluding = attempts.find((item) => item.status === "accepted") ?? null;

  const evidence = concluding
    ? await sql<
        {
          kind: EvidenceKind;
          object_key: string | null;
          content_type: string;
          byte_size: number;
          sha256: string;
          metadata: Record<string, unknown>;
          created_at: Date;
        }[]
      >`
        SELECT kind, object_key, content_type, byte_size, sha256, metadata,
               created_at
        FROM evidence_items WHERE attempt_id = ${concluding.id}
        ORDER BY kind ASC
      `
    : [];

  const decisions = await sql<
    {
      attempt_id: string;
      reviewer_name: string;
      decision: string;
      reason_code: string | null;
      reason_text: string | null;
      followed_ai_recommendation: boolean | null;
      successor_attempt_id: string | null;
      created_at: Date;
    }[]
  >`
    SELECT attempt_id, reviewer_name, decision, reason_code, reason_text,
           followed_ai_recommendation, successor_attempt_id, created_at
    FROM review_decisions WHERE contract_id = ${contractId}
    ORDER BY created_at ASC
  `;

  const aiReports = concluding
    ? await sql<
        {
          model: string;
          configuration_version: string;
          status: string;
          recommendation: string | null;
          confidence: string | null;
          created_at: Date;
        }[]
      >`
        SELECT model, configuration_version, status, recommendation,
               confidence, created_at
        FROM ai_review_reports WHERE attempt_id = ${concluding.id}
        ORDER BY created_at ASC
      `
    : [];

  const events = await sql<
    {
      type: string;
      actor_kind: string;
      actor_name: string;
      sensitive: boolean;
      payload: Record<string, unknown>;
      created_at: Date;
    }[]
  >`
    SELECT type, actor_kind, actor_name, sensitive, payload, created_at
    FROM contract_events WHERE contract_id = ${contractId}
    ORDER BY created_at ASC, id ASC
  `;

  const storage = getObjectStorage();
  const evidenceHash = evidencePackageHash(evidence);

  const entries: { name: string; data: Buffer }[] = [
    { name: "contrato.md", data: Buffer.from(contract.contract_markdown, "utf8") },
    {
      name: "aviso-privacidad.md",
      data: Buffer.from(contract.privacy_notice_full_markdown, "utf8"),
    },
  ];

  // ADR-0059: aceptar o cerrar nunca renderiza un PDF. El paquete sólo incluye
  // la Copia contractual aceptada si una persona ya la pidió mediante Ver PDF.
  const [acceptedPdf] = await sql<
    { object_key: string; sha256: string; byte_size: number }[]
  >`
    SELECT object_key, sha256, byte_size FROM contract_objects
    WHERE contract_id = ${contractId} AND kind = 'accepted_pdf'
    ORDER BY created_at ASC LIMIT 1
  `;
  if (acceptedPdf) {
    const stored = await storage.get(acceptedPdf.object_key);
    if (
      stored.body.byteLength !== acceptedPdf.byte_size ||
      sha256Hex(stored.body) !== acceptedPdf.sha256
    ) {
      throw new DomainError(
        "La copia contractual aceptada no coincide con su inventario."
      );
    }
    entries.push({ name: "contrato.pdf", data: stored.body });
  }

  for (const item of evidence) {
    if (item.kind === "acceptance") {
      entries.push({
        name: "evidencia/aceptacion.json",
        data: Buffer.from(canonicalizeJson(item.metadata), "utf8"),
      });
      continue;
    }
    if (!item.object_key) continue;
    const stored = await storage.get(item.object_key);
    entries.push({
      name: `${EVIDENCE_FILE_NAMES[item.kind]}${extensionFor(item.content_type)}`,
      data: stored.body,
    });
  }

  const components = entries.map((entry) => ({
    nombre: entry.name,
    bytes: entry.data.byteLength,
    sha256: sha256Hex(entry.data),
  }));

  const manifest = {
    version: 1,
    generado_en: new Date().toISOString(),
    organizacion: {
      id: contract.organization_id,
      nombre: contract.organization_name,
      razon_social: contract.organization_legal_name,
    },
    contrato: {
      id: contract.id,
      referencia: contract.reference,
      estado: contract.status,
      plantilla: contract.template_name,
      publicacion: contract.template_label,
      hash_documento: contract.document_hash,
      politica_revision: contract.review_policy,
      perfil_evidencia: {
        aceptacion: true,
        ine: contract.requires_ine,
        video: contract.requires_video,
      },
      valores: contract.field_values,
      emitido_en: contract.issued_at.toISOString(),
      aceptado_en: contract.accepted_at?.toISOString() ?? null,
      cerrado_en: contract.closed_at.toISOString(),
      emitido_por: contract.created_by_name,
    },
    aviso_privacidad: {
      publicacion_id: contract.privacy_notice_version_id,
      etiqueta: contract.privacy_notice_label,
      markdown: contract.privacy_notice_full_markdown,
      hash: contract.privacy_notice_hash,
      publicado_en: contract.privacy_notice_published_at.toISOString(),
    },
    partes: parties.map((party) => ({
      rol: party.party_role,
      tipo_persona: party.person_kind,
      nombre: party.name,
      rfc: party.rfc,
      correo: party.email,
      telefono: party.phone,
      domicilio: party.address,
      cargo: party.position,
    })),
    intento_concluyente: concluding
      ? {
          id: concluding.id,
          secuencia: concluding.sequence,
          enviado_en: concluding.submitted_at?.toISOString() ?? null,
          cerrado_en: concluding.closed_at?.toISOString() ?? null,
        }
      : null,
    // El historial registra que hubo intentos repetidos; sus archivos no viajan.
    intentos: attempts.map((attempt) => ({
      id: attempt.id,
      secuencia: attempt.sequence,
      estado: attempt.status,
      recorrido_en: attempt.walked_at?.toISOString() ?? null,
      enviado_en: attempt.submitted_at?.toISOString() ?? null,
      cerrado_en: attempt.closed_at?.toISOString() ?? null,
      reemplaza: attempt.replaces_attempt_id,
      archivos_incluidos: concluding?.id === attempt.id,
    })),
    decisiones: decisions.map((decision) => ({
      intento: decision.attempt_id,
      revisor: decision.reviewer_name,
      decision: decision.decision,
      motivo: decision.reason_code,
      nota: decision.reason_text,
      siguio_recomendacion_ai: decision.followed_ai_recommendation,
      intento_sucesor: decision.successor_attempt_id,
      fecha: decision.created_at.toISOString(),
    })),
    reportes_ai: aiReports.map((report) => ({
      modelo: report.model,
      version_configuracion: report.configuration_version,
      estado: report.status,
      recomendacion: report.recommendation,
      confianza: report.confidence === null ? null : Number(report.confidence),
      fecha: report.created_at.toISOString(),
    })),
    linea_de_tiempo: events.map((event) => ({
      tipo: event.type,
      actor: event.actor_kind,
      nombre_actor: event.actor_name,
      fecha: event.created_at.toISOString(),
      datos: event.sensitive ? null : event.payload,
    })),
    evidencia: evidence.map((item) => ({
      categoria: item.kind,
      tipo: item.content_type,
      bytes: item.byte_size,
      sha256: item.sha256,
      recibida_en: item.created_at.toISOString(),
    })),
    hash_evidencia: evidenceHash,
    componentes: components,
  };

  // El manifiesto es el JSON más grande del sistema: se canonicaliza una vez y
  // el mismo texto va al ZIP y a la columna `manifest`.
  const canonicalManifest = canonicalizeJson(manifest);

  entries.push({
    name: "manifiesto.json",
    data: Buffer.from(canonicalManifest, "utf8"),
  });

  const archive = createZip(entries);
  const packageHash = sha256Hex(archive);
  const objectKey = `organizations/${contract.organization_id}/cold/${contract.id}/paquete-${safeReference(contract.reference)}.zip`;
  await storage.put({
    key: objectKey,
    body: archive,
    contentType: "application/zip",
    metadata: {
      organizationId: contract.organization_id,
      contractId: contract.id,
      reference: contract.reference,
    },
  });

  const activeCustody = await hasActiveCustody(contract.organization_id);
  const tier: CustodyTier = activeCustody ? "immediate" : "cold";
  const closedAt = contract.closed_at;

  const inserted = await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      INSERT INTO cold_contract_packages (
        contract_id, organization_id, object_key, sha256, byte_size, manifest,
        tier, closed_at, moved_to_cold_at
      ) VALUES (
        ${contract.id}, ${contract.organization_id}, ${objectKey},
        ${packageHash}, ${archive.byteLength},
        ${canonicalManifest}::text::jsonb, ${tier}, ${closedAt},
        ${activeCustody ? null : new Date()}
      )
      ON CONFLICT (contract_id) DO NOTHING
      RETURNING id
    `;
    if (rows.length === 0) return false;

    await tx`
      INSERT INTO contract_objects (
        contract_id, organization_id, kind, object_key, content_type,
        byte_size, sha256, tier
      ) VALUES (
        ${contract.id}, ${contract.organization_id}, 'cold_package',
        ${objectKey}, 'application/zip', ${archive.byteLength},
        ${packageHash}, ${tier}
      )
    `;

    await recordContractEvent(
      {
        contractId: contract.id,
        organizationId: contract.organization_id,
        type: "paquete_frio_sellado",
        actorKind: "system",
        actorName: "Sistema",
        payload: {
          sha256: packageHash,
          bytes: archive.byteLength,
          resguardo: tier,
          componentes: components.length + 1,
        },
      },
      tx
    );

    if (activeCustody) {
      // Con Custodia activa el paquete permanece accesible el primer año.
      await enqueueJob(
        "move_to_cold",
        { contractId: contract.id },
        {
          dedupeKey: `move_to_cold:${contract.id}`,
          runAfter: new Date(closedAt.getTime() + ONE_YEAR_MS),
        },
        tx
      );
    }
    return true;
  });

  if (!inserted) {
    // Clave determinista: si el paquete registrado es este mismo archivo, el
    // ganador ya lo conserva y borrarlo dejaría la custodia sin contenido.
    const [registered] = await sql<{ object_key: string }[]>`
      SELECT object_key FROM cold_contract_packages WHERE contract_id = ${contractId}
    `;
    if (registered && registered.object_key !== objectKey) {
      await storage.delete(objectKey);
    }
  }
}

/** Al cumplir un año desde el cierre todo pasa a Archivo Muerto. */
export async function moveExpiredPackagesToCold(): Promise<number> {
  const moved = await sql<
    { contract_id: string; organization_id: string }[]
  >`
    UPDATE cold_contract_packages
    SET tier = 'cold', moved_to_cold_at = NOW()
    WHERE tier = 'immediate' AND closed_at <= NOW() - INTERVAL '1 year'
    RETURNING contract_id, organization_id
  `;
  for (const row of moved) {
    await sql`
      UPDATE contract_objects SET tier = 'cold'
      WHERE contract_id = ${row.contract_id} AND kind = 'cold_package'
    `;
    await recordContractEvent({
      contractId: row.contract_id,
      organizationId: row.organization_id,
      type: "paquete_movido_a_frio",
      actorKind: "system",
      actorName: "Sistema",
    });
  }
  return moved.length;
}

async function loadTemporaryCopy(
  contractId: string
): Promise<{ objectKey: string; availableUntil: Date } | null> {
  const [row] = await sql<{ object_key: string; expires_at: Date | null }[]>`
    SELECT object_key, expires_at FROM contract_objects
    WHERE contract_id = ${contractId} AND kind = 'temporary_copy'
      AND expires_at IS NOT NULL AND expires_at > NOW()
    ORDER BY created_at DESC LIMIT 1
  `;
  if (!row || !row.expires_at) return null;
  return { objectKey: row.object_key, availableUntil: row.expires_at };
}

export async function getCustodyState(
  context: OrganizationContext,
  contractId: string
): Promise<CustodyState> {
  const [contract] = await sql<
    { id: string; closed_at: Date | null; classification: string }[]
  >`
    SELECT id, closed_at, classification FROM contracts
    WHERE id = ${contractId} AND organization_id = ${context.organization.id}
  `;
  if (!contract) throw new NotFoundError("No encontramos este contrato.");

  // Un asunto `Eliminado` deja de ofrecer consulta documental, descarga y
  // exportación dentro del portal (ADR-0018 y ADR-0036).
  const deleted = contract.classification === "deleted";
  const activeCustody = context.organization.capabilities.active_custody;
  const isAdministrator = hasRole(context, "administrator");

  // Paquete, copia temporal, recuperación y exportación son independientes
  // entre sí: se piden en una sola ronda.
  const [packageRows, temporaryCopy, jobRows, exportRows] = await Promise.all([
    sql<
      {
        sha256: string;
        byte_size: number;
        tier: CustodyTier;
        closed_at: Date;
      }[]
    >`
      SELECT sha256, byte_size, tier, closed_at FROM cold_contract_packages
      WHERE contract_id = ${contractId}
    `,
    loadTemporaryCopy(contractId),
    sql<{ id: string; status: string; available_until: Date | null }[]>`
      SELECT id, status, available_until FROM recovery_jobs
      WHERE contract_id = ${contractId}
      ORDER BY created_at DESC LIMIT 1
    `,
    sql<{ id: string; status: string; available_until: Date | null }[]>`
      SELECT id, status, available_until FROM export_jobs
      WHERE organization_id = ${context.organization.id}
        AND requested_by = ${context.account.accountId}
        AND contract_ids = ${[contractId]}::uuid[]
      ORDER BY created_at DESC LIMIT 1
    `,
  ]);

  const [pkg] = packageRows;
  const [job] = jobRows;
  const [exportJob] = exportRows;

  const recovery = job
    ? { id: job.id, status: job.status, availableUntil: job.available_until }
    : null;

  const exportState = exportJob
    ? {
        id: exportJob.id,
        status: exportJob.status,
        availableUntil: exportJob.available_until,
      }
    : null;

  const canDownload =
    !deleted &&
    isAdministrator &&
    (temporaryCopy !== null ||
      (activeCustody &&
        pkg?.tier === "immediate" &&
        pkg.closed_at.getTime() > Date.now() - ONE_YEAR_MS));
  const canRequest =
    !deleted && isAdministrator && activeCustody && Boolean(pkg);
  const canDownloadExport =
    !deleted &&
    isAdministrator &&
    activeCustody &&
    exportJob?.status === "available" &&
    exportJob.available_until !== null &&
    exportJob.available_until.getTime() > Date.now();

  let message: string;
  if (deleted) {
    message =
      "El asunto está en `Eliminados`: el portal ya no ofrece su consulta documental, descarga o exportación.";
  } else if (!pkg) {
    message = contract.closed_at
      ? "Estamos preparando el paquete de este contrato."
      : "El paquete se prepara cuando el contrato queda cerrado.";
  } else if (temporaryCopy) {
    message = `El archivo está disponible en este expediente hasta el ${formatDate(temporaryCopy.availableUntil)}.`;
  } else if (job && (job.status === "queued" || job.status === "running")) {
    message =
      "Estamos preparando tu archivo. Estará disponible en un máximo de 48 horas.";
  } else if (job && job.status === "failed") {
    message = "No se pudo preparar el archivo. Puedes intentarlo otra vez.";
  } else if (!activeCustody) {
    message =
      "El contrato está resguardado. Para recibir una copia, un Administrador debe solicitarla por el canal externo acordado con el Proveedor.";
  } else if (
    pkg.tier === "immediate" &&
    pkg.closed_at.getTime() > Date.now() - ONE_YEAR_MS
  ) {
    message =
      "Los archivos de este contrato están disponibles durante el primer año desde su cierre.";
  } else {
    message =
      "El archivo está resguardado. `Descargar ZIP` inicia la preparación y estará disponible en un máximo de 48 horas.";
  }

  return {
    sealed: Boolean(pkg),
    tier: pkg?.tier ?? null,
    packageHash: pkg?.sha256 ?? null,
    byteSize: pkg?.byte_size ?? null,
    closedAt: pkg?.closed_at ?? contract.closed_at,
    temporaryCopy,
    recovery,
    export: exportState,
    activeCustody,
    canRequest,
    canDownload,
    canDownloadExport,
    message,
  };
}

function requireActiveCustodyAdministrator(context: OrganizationContext): void {
  if (!hasRole(context, "administrator")) throw new AuthorizationError();
  if (!context.organization.capabilities.active_custody) {
    throw new AuthorizationError(
      "Sin Custodia activa, la solicitud se atiende por el canal externo acordado con el Proveedor."
    );
  }
}

export async function requestHistoricalArchive(
  context: OrganizationContext,
  contractId: string
): Promise<void> {
  requireActiveCustodyAdministrator(context);

  // Un asunto `Eliminado` no participa en descargas ni exportaciones.
  const [pkg] = await sql<{ id: string }[]>`
    SELECT p.id FROM cold_contract_packages p
    JOIN contracts c ON c.id = p.contract_id
    WHERE p.contract_id = ${contractId}
      AND c.organization_id = ${context.organization.id}
      AND c.classification <> 'deleted'
  `;
  if (!pkg) throw new NotFoundError("Este contrato todavía no tiene paquete.");

  // Reutiliza cualquier trabajo vigente del mismo paquete.
  const [running] = await sql<{ id: string }[]>`
    SELECT id FROM recovery_jobs
    WHERE contract_id = ${contractId}
      AND (
        status IN ('queued', 'running')
        OR (status = 'available' AND available_until > NOW())
      )
    ORDER BY created_at DESC LIMIT 1
  `;
  if (running) return;

  const jobId = await sql.begin(async (tx) => {
    const [job] = await tx<{ id: string }[]>`
      INSERT INTO recovery_jobs (
        organization_id, contract_id, requested_by, requested_by_name,
        retrieval_tier, origin, status
      ) VALUES (
        ${context.organization.id}, ${contractId},
        ${context.account.accountId}, ${context.account.fullName},
        'standard', 'portal', 'queued'
      )
      RETURNING id
    `;
    await enqueueJob("recovery", { jobId: job.id }, {}, tx);
    await recordContractEvent(
      {
        contractId,
        organizationId: context.organization.id,
        type: "archivo_historico_solicitado",
        actorKind: "member",
        actorId: context.account.accountId,
        actorName: context.account.fullName,
        payload: { trabajo: job.id },
      },
      tx
    );
    await recordAudit(
      {
        organizationId: context.organization.id,
        accountId: context.account.accountId,
        actorName: context.account.fullName,
        capability: usedCapability(context),
        action: "custody.request_archive",
        subjectType: "contract",
        subjectId: contractId,
      },
      tx
    );
    return job.id;
  });
  /* v8 ignore next -- el INSERT ... RETURNING id de la transacción siempre entrega un identificador o falla, así que `jobId` nunca es vacío */
  if (!jobId) throw new DomainError("No pudimos registrar la solicitud.");
}

export async function requestBulkExport(
  context: OrganizationContext,
  contractIds: string[]
): Promise<string> {
  requireActiveCustodyAdministrator(context);
  if (contractIds.length === 0) {
    throw new DomainError("Selecciona al menos un contrato.");
  }

  // Nunca se incorpora un asunto `Eliminado` a una exportación (ADR-0018).
  const owned = await sql<{ id: string }[]>`
    SELECT id FROM contracts
    WHERE organization_id = ${context.organization.id}
      AND id = ANY (${contractIds}::uuid[])
      AND classification <> 'deleted'
  `;
  if (owned.length !== contractIds.length) {
    throw new AuthorizationError();
  }

  // Sólo se exporta lo que ya está cerrado y sellado: prometer una exportación
  // de un Contrato abierto la haría fallar después, sin avisar en el portal.
  const [pending] = await sql<{ total: number }[]>`
    SELECT COUNT(*)::int AS total
    FROM contracts c
    LEFT JOIN cold_contract_packages p ON p.contract_id = c.id
    WHERE c.id = ANY (${contractIds}::uuid[]) AND p.id IS NULL
  `;
  /* v8 ignore next 1 -- `COUNT(*)` sin `GROUP BY` siempre devuelve una fila, así que el respaldo a cero no es alcanzable */
  if ((pending?.total ?? 0) > 0) {
    throw new DomainError(
      "Sólo pueden exportarse contratos cerrados con su paquete resguardado."
    );
  }

  return sql.begin(async (tx) => {
    const [job] = await tx<{ id: string }[]>`
      INSERT INTO export_jobs (
        organization_id, requested_by, requested_by_name, contract_ids, status
      ) VALUES (
        ${context.organization.id}, ${context.account.accountId},
        ${context.account.fullName}, ${contractIds}::uuid[], 'queued'
      )
      RETURNING id
    `;
    await enqueueJob("export", { jobId: job.id }, {}, tx);
    await recordAudit(
      {
        organizationId: context.organization.id,
        accountId: context.account.accountId,
        actorName: context.account.fullName,
        capability: usedCapability(context),
        action: "custody.request_export",
        subjectType: "export_job",
        subjectId: job.id,
        payload: { contratos: contractIds.length },
      },
      tx
    );
    return job.id;
  });
}

function isMissingObject(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function readAvailableObject(
  objectKey: string,
  missingMessage: string
): Promise<Buffer> {
  return getObjectStorage()
    .get(objectKey)
    .then((stored) => stored.body)
    .catch((error: unknown) => {
      if (isMissingObject(error)) throw new DomainError(missingMessage);
      throw error;
    });
}

/**
 * Entrega el ZIP individual, pero sólo después de revalidar en servidor la
 * Organización activa, rol, producto, clasificación y ventana de acceso.
 */
export async function readContractArchive(
  context: OrganizationContext,
  contractId: string
): Promise<CustodyDownload> {
  requireActiveCustodyAdministrator(context);

  const [contract] = await sql<
    { reference: string; classification: string }[]
  >`
    SELECT reference, classification FROM contracts
    WHERE id = ${contractId} AND organization_id = ${context.organization.id}
  `;
  if (!contract) throw new NotFoundError("No encontramos este contrato.");
  if (contract.classification === "deleted") {
    throw new NotFoundError("El expediente ya no está disponible en el portal.");
  }

  const [available] = await sql<
    { object_key: string; sha256: string; byte_size: number }[]
  >`
    SELECT object_key, sha256, byte_size
    FROM (
      SELECT p.object_key, p.sha256, p.byte_size, 1 AS priority
      FROM cold_contract_packages p
      WHERE p.contract_id = ${contractId}
        AND p.organization_id = ${context.organization.id}
        AND p.tier = 'immediate'
        AND p.closed_at > NOW() - INTERVAL '1 year'
      UNION ALL
      SELECT o.object_key, o.sha256, o.byte_size, 2 AS priority
      FROM contract_objects o
      JOIN recovery_jobs j
        ON j.contract_id = o.contract_id AND j.object_key = o.object_key
      WHERE o.contract_id = ${contractId}
        AND o.organization_id = ${context.organization.id}
        AND j.organization_id = ${context.organization.id}
        AND o.kind = 'temporary_copy'
        AND o.expires_at > NOW()
        AND j.status = 'available'
        AND j.available_until > NOW()
    ) candidates
    ORDER BY priority ASC
    LIMIT 1
  `;
  if (!available) {
    throw new NotFoundError("El archivo no está disponible para descargar.");
  }

  const body = await readAvailableObject(
    available.object_key,
    "No pudimos leer el archivo disponible."
  );
  if (
    body.byteLength !== available.byte_size ||
    sha256Hex(body) !== available.sha256
  ) {
    throw new DomainError("El archivo disponible no coincide con su hash.");
  }
  return { body, fileName: `${safeReference(contract.reference)}.zip` };
}

/** Entrega un lote temporal sólo a la cuenta Administradora que lo solicitó. */
export async function readExportArtifact(
  context: OrganizationContext,
  jobId: string
): Promise<CustodyDownload> {
  requireActiveCustodyAdministrator(context);

  const [job] = await sql<{ object_key: string }[]>`
    SELECT e.object_key
    FROM export_jobs e
    WHERE e.id = ${jobId}
      AND e.organization_id = ${context.organization.id}
      AND e.requested_by = ${context.account.accountId}
      AND e.status = 'available'
      AND e.object_key IS NOT NULL
      AND e.available_until > NOW()
      AND NOT EXISTS (
        SELECT 1 FROM contracts c
        WHERE c.id = ANY(e.contract_ids) AND (
          c.organization_id <> ${context.organization.id}
          OR c.classification = 'deleted'
        )
      )
  `;
  if (!job) {
    throw new NotFoundError("La exportación no está disponible.");
  }

  const body = await readAvailableObject(
    job.object_key,
    "No pudimos leer la exportación disponible."
  );
  return { body, fileName: `exportacion-${jobId}.zip` };
}

async function claimJob(
  table: "recovery_jobs" | "export_jobs",
  jobId: string
): Promise<boolean> {
  const rows =
    table === "recovery_jobs"
      ? await sql<{ id: string }[]>`
          UPDATE recovery_jobs SET status = 'running'
          WHERE id = ${jobId} AND status = 'queued' RETURNING id
        `
      : await sql<{ id: string }[]>`
          UPDATE export_jobs SET status = 'running'
          WHERE id = ${jobId} AND status = 'queued' RETURNING id
        `;
  return rows.length > 0;
}

async function publishTemporaryCopy(input: {
  contractId: string;
  organizationId: string;
  body: Buffer;
  sha256: string;
  reference: string;
}): Promise<{ objectKey: string; availableUntil: Date }> {
  const storage = getObjectStorage();
  const objectKey = `organizations/${input.organizationId}/contracts/${input.contractId}/temporary/${crypto.randomUUID()}-${safeReference(input.reference)}.zip`;
  await storage.put({
    key: objectKey,
    body: input.body,
    contentType: "application/zip",
    metadata: { contractId: input.contractId, temporary: "true" },
  });
  const availableUntil = new Date(Date.now() + TEMPORARY_MS);
  await sql`
    INSERT INTO contract_objects (
      contract_id, organization_id, kind, object_key, content_type,
      byte_size, sha256, tier, expires_at
    ) VALUES (
      ${input.contractId}, ${input.organizationId}, 'temporary_copy',
      ${objectKey}, 'application/zip', ${input.body.byteLength},
      ${input.sha256}, 'temporary', ${availableUntil}
    )
  `;
  return { objectKey, availableUntil };
}

async function readColdPackage(contractId: string): Promise<{
  body: Buffer;
  sha256: string;
  reference: string;
  organizationId: string;
}> {
  const [row] = await sql<
    {
      object_key: string;
      sha256: string;
      organization_id: string;
      reference: string;
    }[]
  >`
    SELECT p.object_key, p.sha256, p.organization_id, c.reference
    FROM cold_contract_packages p
    JOIN contracts c ON c.id = p.contract_id
    WHERE p.contract_id = ${contractId}
  `;
  if (!row) throw new NotFoundError("Este contrato no tiene paquete frío.");
  // Un objeto ausente se reporta como falla del paquete, no como error técnico.
  const stored = await getObjectStorage()
    .get(row.object_key)
    .catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        throw new DomainError("No pudimos leer el paquete resguardado.");
      }
      throw error;
    });
  if (sha256Hex(stored.body) !== row.sha256) {
    throw new DomainError("El paquete recuperado no coincide con su hash.");
  }
  return {
    body: stored.body,
    sha256: row.sha256,
    reference: row.reference,
    organizationId: row.organization_id,
  };
}

export async function runRecoveryJob(jobId: string): Promise<void> {
  const [job] = await sql<
    {
      id: string;
      organization_id: string;
      contract_id: string;
      requested_by: string | null;
      requested_by_name: string;
      status: string;
      email: string | null;
    }[]
  >`
    SELECT j.id, j.organization_id, j.contract_id, j.requested_by,
           j.requested_by_name, j.status, a.email
    FROM recovery_jobs j
    LEFT JOIN accounts a ON a.id = j.requested_by
    WHERE j.id = ${jobId}
  `;
  if (!job) throw new NotFoundError("No encontramos la recuperación.");
  if (!(await claimJob("recovery_jobs", jobId))) return;

  try {
    const pkg = await readColdPackage(job.contract_id);
    const copy = await publishTemporaryCopy({
      contractId: job.contract_id,
      organizationId: job.organization_id,
      body: pkg.body,
      sha256: pkg.sha256,
      reference: pkg.reference,
    });

    await sql`
      UPDATE recovery_jobs
      SET status = 'available', object_key = ${copy.objectKey},
          available_until = ${copy.availableUntil}, completed_at = NOW()
      WHERE id = ${jobId}
    `;
    await recordContractEvent({
      contractId: job.contract_id,
      organizationId: job.organization_id,
      type: "copia_temporal_publicada",
      actorKind: "system",
      actorName: "Sistema",
      payload: { disponible_hasta: copy.availableUntil.toISOString() },
    });
    if (job.email) {
      await enqueueNotification({
        organizationId: job.organization_id,
        channel: "email",
        recipient: job.email,
        template: "archivo_historico_listo",
        payload: {
          referencia: pkg.reference,
          disponible_hasta: formatDate(copy.availableUntil),
        },
        dedupeKey: `recovery_ready:${jobId}`,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    await sql`
      UPDATE recovery_jobs
      SET status = 'failed', error = ${message}, completed_at = NOW()
      WHERE id = ${jobId}
    `;
    if (job.email) {
      await enqueueNotification({
        organizationId: job.organization_id,
        channel: "email",
        recipient: job.email,
        template: "archivo_historico_fallido",
        payload: { detalle: "No se pudo preparar el archivo." },
        dedupeKey: `recovery_failed:${jobId}`,
      });
    }
    throw error;
  }
}

export async function runExportJob(jobId: string): Promise<void> {
  const [job] = await sql<
    {
      id: string;
      organization_id: string;
      contract_ids: string[];
      requested_by_name: string;
      email: string | null;
    }[]
  >`
    SELECT j.id, j.organization_id, j.contract_ids, j.requested_by_name, a.email
    FROM export_jobs j
    LEFT JOIN accounts a ON a.id = j.requested_by
    WHERE j.id = ${jobId}
  `;
  if (!job) throw new NotFoundError("No encontramos la exportación.");
  if (!(await claimJob("export_jobs", jobId))) return;

  try {
    const entries: { name: string; data: Buffer }[] = [];
    for (const contractId of job.contract_ids) {
      // La exportación es completa o no se entrega.
      let pkg = await sql<{ contract_id: string }[]>`
        SELECT contract_id FROM cold_contract_packages
        WHERE contract_id = ${contractId}
      `;
      if (pkg.length === 0) {
        await sealColdPackage(contractId);
        pkg = await sql<{ contract_id: string }[]>`
          SELECT contract_id FROM cold_contract_packages
          WHERE contract_id = ${contractId}
        `;
      }
      /* v8 ignore next 3 -- `requestBulkExport` sólo acepta contratos ya sellados y el resellado anterior repone el paquete, así que aquí siempre existe */
      if (pkg.length === 0) {
        throw new DomainError("Un contrato del lote todavía no tiene paquete.");
      }
      const content = await readColdPackage(contractId);
      entries.push({
        name: `${safeReference(content.reference)}.zip`,
        data: content.body,
      });
    }

    const container = createZip(entries);
    const objectKey = `organizations/${job.organization_id}/exports/${jobId}.zip`;
    await getObjectStorage().put({
      key: objectKey,
      body: container,
      contentType: "application/zip",
      metadata: { organizationId: job.organization_id, exportJobId: jobId },
    });
    const availableUntil = new Date(Date.now() + TEMPORARY_MS);
    await sql`
      UPDATE export_jobs
      SET status = 'available', object_key = ${objectKey},
          available_until = ${availableUntil}, completed_at = NOW()
      WHERE id = ${jobId}
    `;
    if (job.email) {
      await enqueueNotification({
        organizationId: job.organization_id,
        channel: "email",
        recipient: job.email,
        template: "exportacion_lista",
        payload: {
          contratos: entries.length,
          disponible_hasta: formatDate(availableUntil),
        },
        dedupeKey: `export_ready:${jobId}`,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    await sql`
      UPDATE export_jobs
      SET status = 'failed', error = ${message}, completed_at = NOW()
      WHERE id = ${jobId}
    `;
    if (job.email) {
      await enqueueNotification({
        organizationId: job.organization_id,
        channel: "email",
        recipient: job.email,
        template: "exportacion_fallida",
        payload: { detalle: "No se pudo completar la exportación." },
        dedupeKey: `export_failed:${jobId}`,
      });
    }
    throw error;
  }
}

/**
 * Herramienta interna del Administrador de plataforma. Sólo publica dentro
 * del expediente cuando atiende una solicitud externa validada.
 */
export async function platformRecoverPackage(
  accountId: string,
  contractId: string,
  publishToOrganization: boolean
): Promise<void> {
  const [account] = await sql<
    { id: string; full_name: string; is_platform_admin: boolean }[]
  >`
    SELECT id, full_name, is_platform_admin FROM accounts WHERE id = ${accountId}
  `;
  if (!account?.is_platform_admin) throw new AuthorizationError();

  const pkg = await readColdPackage(contractId);

  if (publishToOrganization) {
    const copy = await publishTemporaryCopy({
      contractId,
      organizationId: pkg.organizationId,
      body: pkg.body,
      sha256: pkg.sha256,
      reference: pkg.reference,
    });
    await recordContractEvent({
      contractId,
      organizationId: pkg.organizationId,
      type: "copia_temporal_publicada",
      actorKind: "platform",
      actorId: account.id,
      actorName: account.full_name,
      payload: { disponible_hasta: copy.availableUntil.toISOString() },
    });
    await recordAudit({
      organizationId: pkg.organizationId,
      accountId: account.id,
      actorName: account.full_name,
      actorKind: "platform",
      action: "custody.platform_publish",
      subjectType: "contract",
      subjectId: contractId,
      payload: { disponible_hasta: copy.availableUntil.toISOString() },
    });
    return;
  }

  await recordAudit({
    organizationId: pkg.organizationId,
    accountId: account.id,
    actorName: account.full_name,
    actorKind: "platform",
    action: "custody.platform_inspect",
    subjectType: "contract",
    subjectId: contractId,
    payload: { sha256: pkg.sha256, bytes: pkg.body.byteLength },
  });
}

export async function searchColdArchive(params: {
  organizationId?: string;
  query?: string;
  page?: number;
}): Promise<{
  rows: ColdArchiveRow[];
  total: number;
  page: number;
  pages: number;
}> {
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const offset = (page - 1) * PAGE_SIZE;
  const organizationId = params.organizationId ?? null;
  const query = params.query?.trim() ? `%${params.query.trim()}%` : null;

  const [count] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total
    FROM cold_contract_packages p
    JOIN contracts c ON c.id = p.contract_id
    JOIN organizations o ON o.id = p.organization_id
    WHERE (${organizationId}::uuid IS NULL OR p.organization_id = ${organizationId}::uuid)
      AND (
        ${query}::text IS NULL
        OR c.reference ILIKE ${query}
        OR c.template_name ILIKE ${query}
        OR o.name ILIKE ${query}
      )
  `;
  /* v8 ignore next -- un SELECT COUNT(*) sin GROUP BY siempre devuelve una fila, así que `count` nunca es undefined */
  const total = Number(count?.total ?? 0);

  const rows = await sql<
    {
      contract_id: string;
      reference: string;
      organization_id: string;
      organization_name: string;
      tier: CustodyTier;
      byte_size: number;
      sha256: string;
      object_key: string;
      closed_at: Date;
      moved_to_cold_at: Date | null;
    }[]
  >`
    SELECT p.contract_id, c.reference, p.organization_id,
           o.name AS organization_name, p.tier, p.byte_size, p.sha256,
           p.object_key, p.closed_at, p.moved_to_cold_at
    FROM cold_contract_packages p
    JOIN contracts c ON c.id = p.contract_id
    JOIN organizations o ON o.id = p.organization_id
    WHERE (${organizationId}::uuid IS NULL OR p.organization_id = ${organizationId}::uuid)
      AND (
        ${query}::text IS NULL
        OR c.reference ILIKE ${query}
        OR c.template_name ILIKE ${query}
        OR o.name ILIKE ${query}
      )
    ORDER BY p.closed_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `;

  return {
    rows: rows.map((row) => ({
      contractId: row.contract_id,
      reference: row.reference,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      tier: row.tier,
      byteSize: row.byte_size,
      sha256: row.sha256,
      objectKey: row.object_key,
      closedAt: row.closed_at,
      movedToColdAt: row.moved_to_cold_at,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}
