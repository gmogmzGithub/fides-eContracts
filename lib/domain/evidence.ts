import "server-only";
import { sql } from "@/lib/db";
import {
  canOpenSensitiveEvidence,
  hasRole,
  requireRole,
  usedCapability,
  type OrganizationContext,
} from "@/lib/auth/guards";
import { extensionFor } from "@/lib/domain/content-types";
import { AuthorizationError, NotFoundError } from "@/lib/domain/errors";
import { recordAudit } from "@/lib/domain/operations";
import { getObjectStorage } from "@/lib/storage";
import type { EvidenceKind } from "@/lib/domain/types";

export interface EvidenceFile {
  kind: EvidenceKind;
  contentType: string;
  body: Buffer;
  fileName: string;
  sha256: string;
}

/**
 * Entrega un archivo de evidencia a quien puede abrirlo. INE y video sólo los
 * ven Administradores y Revisores de la Organización dueña del Contrato, nunca
 * por una URL pública o permanente (ADR-0061, ADR-0062, ADR-0064).
 */
export async function readEvidenceFile(
  context: OrganizationContext,
  evidenceId: string
): Promise<EvidenceFile> {
  requireRole(context, "administrator", "emitter", "reviewer");

  const [item] = await sql<
    {
      kind: EvidenceKind;
      object_key: string | null;
      content_type: string;
      sha256: string;
      reference: string;
      classification: string;
      review_scoped: boolean;
    }[]
  >`
    SELECT e.kind, e.object_key, e.content_type, e.sha256,
           c.reference, c.classification,
           EXISTS (
             SELECT 1 FROM review_tasks t
             WHERE t.attempt_id = e.attempt_id
               AND t.contract_id = e.contract_id
               AND t.organization_id = e.organization_id
           ) AS review_scoped
    FROM evidence_items e
    JOIN contracts c ON c.id = e.contract_id
    WHERE e.id = ${evidenceId} AND e.organization_id = ${context.organization.id}
  `;
  if (!item || !item.object_key) {
    throw new NotFoundError("No encontramos esa evidencia.");
  }
  if (item.classification === "deleted") {
    throw new NotFoundError("El expediente ya no está disponible en el portal.");
  }
  if (!canOpenSensitiveEvidence(context)) {
    throw new AuthorizationError(
      "Sólo un Administrador o un Revisor puede abrir esta evidencia."
    );
  }
  if (!hasRole(context, "administrator") && !item.review_scoped) {
    throw new AuthorizationError(
      "El rol Revisor sólo abre evidencia asociada a una tarea de revisión."
    );
  }

  const stored = await getObjectStorage().get(item.object_key);
  await recordAudit({
    organizationId: context.organization.id,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    capability: usedCapability(context),
    action: "evidencia_consultada",
    subjectType: "evidence",
    subjectId: evidenceId,
    payload: { referencia: item.reference, tipo: item.kind },
  });

  return {
    kind: item.kind,
    contentType: item.content_type,
    body: stored.body,
    sha256: item.sha256,
    fileName: `${item.reference}-${item.kind}${extensionFor(item.content_type)}`,
  };
}
