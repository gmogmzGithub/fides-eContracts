import type { OrganizationProfile } from "@/lib/auth/guards";
import type { FieldDefinition, TemplateRecord } from "@/lib/domain/templates";
import type {
  Capability,
  OrganizationRole,
  ReviewPolicy,
} from "@/lib/domain/types";
import { createDraft, saveDraft } from "@/lib/domain/drafts";
import {
  createIssuableOrganization,
  type FieldSeed,
} from "@/tests/helpers/database";

/**
 * Constructores sintéticos para las funciones puras de `lib/domain/drafts.ts`.
 * Evitan tocar la base cuando la regla bajo prueba no depende de ella.
 */

export interface ConfiguracionSeed {
  linkDays?: number;
  requiresVideo?: boolean;
  requiresIne?: boolean;
  reviewPolicy?: ReviewPolicy;
}

export function perfilOrganizacion(
  options: {
    capabilities?: Partial<Record<Capability, boolean>>;
    defaults?: ConfiguracionSeed;
  } = {}
): OrganizationProfile {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Organización sintética",
    slug: "organizacion-sintetica",
    legalName: "Organización sintética, S.A. de C.V.",
    seatLimit: 5,
    capabilities: {
      ai_review: false,
      active_custody: false,
      evidence_video: false,
      evidence_ine: false,
      ...options.capabilities,
    },
    defaults: {
      operationalVersion: 1,
      linkDays: options.defaults?.linkDays ?? 7,
      requiresVideo: options.defaults?.requiresVideo ?? false,
      requiresIne: options.defaults?.requiresIne ?? false,
      reviewPolicy: options.defaults?.reviewPolicy ?? "none",
    },
  };
}

export function campo(
  overrides: Partial<FieldDefinition> & { key: string; label: string }
): FieldDefinition {
  return {
    id: `campo-${overrides.key}`,
    helpText: "",
    dataType: "text",
    required: true,
    options: [],
    searchable: false,
    highlighted: false,
    position: 1,
    ...overrides,
  };
}

export function plantillaSintetica(
  overrides: Partial<TemplateRecord> = {}
): TemplateRecord {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    organizationId: "11111111-1111-4111-8111-111111111111",
    organizationName: "Organización sintética",
    name: "Contrato-plantilla sintético",
    summary: "Contenido sintético.",
    acceptanceLegend: "Manifiesto mi aceptación.",
    videoStatementTemplate: "Soy {{firmante.nombre}}.",
    defaults: {
      linkDays: 7,
      requiresVideo: false,
      requiresIne: false,
      reviewPolicy: "none",
    },
    fields: [],
    currentVersion: null,
    ...overrides,
  };
}

/** Campos con todos los `dataType` que el dominio valida. */
export const CAMPOS_VARIADOS: FieldSeed[] = [
  { key: "objeto", label: "Objeto", searchable: true, highlighted: true },
  { key: "monto", label: "Monto", dataType: "money" },
  { key: "piezas", label: "Piezas", dataType: "number", required: false },
  { key: "inicio", label: "Inicio", dataType: "date", required: false },
  {
    key: "modalidad",
    label: "Modalidad",
    dataType: "select",
    required: false,
    options: ["mensual", "anual"],
  },
  { key: "nota", label: "Nota", dataType: "longtext", required: false },
];

export const VALORES_COMPLETOS: Record<string, string> = {
  objeto: "Servicio de mantenimiento",
  monto: "1500.50",
};

export interface BorradorListoOptions {
  name?: string;
  slug?: string;
  legalName?: string;
  capabilities?: Partial<Record<Capability, boolean>>;
  defaults?: ConfiguracionSeed;
  templateDefaults?: ConfiguracionSeed;
  roles?: OrganizationRole[];
  fields?: FieldSeed[];
  /** Valores capturados; `null` deja el Borrador sin datos obligatorios. */
  valores?: Record<string, string> | null;
  conTitular?: boolean;
  conFirmante?: boolean;
}

/**
 * Organización emisora con un Borrador ya capturado y listo para
 * `Generar enlace`, salvo que la prueba pida omitir partes o datos.
 */
export async function borradorListo(options: BorradorListoOptions = {}) {
  const fixture = await createIssuableOrganization({
    name: options.name,
    slug: options.slug,
    legalName: options.legalName,
    capabilities: options.capabilities,
    defaults: options.defaults,
    templateDefaults: options.templateDefaults,
    roles: options.roles,
    fields: options.fields,
  });
  const draftId = await createDraft(fixture.context, {
    templateId: fixture.template.id,
    holderId: options.conTitular === false ? null : fixture.holder.id,
    signerId: options.conFirmante === false ? null : fixture.signer.id,
  });
  const valores =
    options.valores === undefined ? VALORES_COMPLETOS : options.valores;
  if (valores) {
    await saveDraft(fixture.context, draftId, { fieldValues: valores });
  }
  return { ...fixture, draftId };
}
