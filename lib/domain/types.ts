/** Vocabulario compartido del dominio. Ver `CONTEXT.md`. */

export type OrganizationRole = "administrator" | "emitter" | "reviewer";

export type ReviewPolicy = "none" | "manual" | "ai";

/** Estados visibles del Contrato emitido. `Borrador` vive en `contract_drafts`. */
export type ContractStatus =
  | "pending"
  | "in_review"
  | "accepted"
  | "expired"
  | "cancelled";

export type Classification = "active" | "archived" | "deleted";

export type AttemptStatus =
  | "open"
  | "in_review"
  | "accepted"
  | "repeated"
  | "expired"
  | "cancelled";

export type EvidenceKind = "acceptance" | "ine_front" | "ine_back" | "video";

export type ReviewDecisionKind = "conclude" | "skip" | "repeat";

export type RepeatReasonCode =
  | "video_incompleto"
  | "declaracion_incorrecta"
  | "ine_ilegible"
  | "ine_incompleta"
  | "evidencia_faltante"
  | "otro";

export type Capability =
  | "ai_review"
  | "active_custody"
  | "evidence_video"
  | "evidence_ine";

export interface EffectiveConfiguration {
  linkDays: number;
  requiresVideo: boolean;
  requiresIne: boolean;
  reviewPolicy: ReviewPolicy;
}

export const ROLE_LABELS: Record<OrganizationRole, string> = {
  administrator: "Administrador",
  emitter: "Emisor",
  reviewer: "Revisor",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  pending: "Pendiente de aceptación",
  in_review: "A revisión",
  accepted: "Aceptado",
  expired: "Vencido",
  cancelled: "Cancelado",
};

export const REVIEW_POLICY_LABELS: Record<ReviewPolicy, string> = {
  none: "Sin revisión",
  manual: "Revisión manual",
  ai: "Revisión por AI",
};

export const REPEAT_REASON_LABELS: Record<RepeatReasonCode, string> = {
  video_incompleto: "Video incompleto o sin audio",
  declaracion_incorrecta: "Declaración incorrecta",
  ine_ilegible: "INE ilegible",
  ine_incompleta: "INE incompleta o equivocada",
  evidencia_faltante: "Evidencia requerida faltante",
  otro: "Otro",
};

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  acceptance: "Aceptación electrónica",
  ine_front: "INE (frente)",
  ine_back: "INE (reverso)",
  video: "Video guiado",
};

/** Lo que el Emisor habilitó, en el orden en que lo recorre el Firmante. */
export interface EvidenceProfile {
  requiresIne: boolean;
  requiresVideo: boolean;
}

/**
 * Evidencia adicional a la aceptación. `INE` se nombra sin lado porque el
 * perfil pide frente y reverso: enumerarlos sería ruido en un resumen.
 */
export function additionalEvidence(profile: EvidenceProfile): string[] {
  return [
    profile.requiresIne ? "INE" : null,
    profile.requiresVideo ? EVIDENCE_LABELS.video : null,
  ].filter((item): item is string => item !== null);
}

/** Perfil completo: la aceptación electrónica siempre está. */
export function evidenceSummary(profile: EvidenceProfile): string[] {
  return [EVIDENCE_LABELS.acceptance, ...additionalEvidence(profile)];
}

export const CAPABILITY_LABELS: Record<Capability, string> = {
  ai_review: "Revisión por AI",
  active_custody: "Custodia activa",
  evidence_video: "Evidencia de video",
  evidence_ine: "Evidencia de INE",
};

export const PAGE_SIZE = 20;

/**
 * Lee una Configuración predeterminada guardada como JSONB. Un valor con tipos
 * inservibles cae al respaldo en vez de contaminar la emisión.
 */
export function readConfiguration(
  value: unknown,
  fallback: EffectiveConfiguration
): EffectiveConfiguration {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  const policy = record.reviewPolicy;
  return {
    linkDays:
      typeof record.linkDays === "number" ? record.linkDays : fallback.linkDays,
    requiresVideo:
      typeof record.requiresVideo === "boolean"
        ? record.requiresVideo
        : fallback.requiresVideo,
    requiresIne:
      typeof record.requiresIne === "boolean"
        ? record.requiresIne
        : fallback.requiresIne,
    reviewPolicy:
      policy === "none" || policy === "manual" || policy === "ai"
        ? policy
        : fallback.reviewPolicy,
  };
}
