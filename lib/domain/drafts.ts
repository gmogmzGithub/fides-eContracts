import "server-only";
import { sql } from "@/lib/db";
import type { Transaction } from "@/lib/db";
import type { OrganizationContext, OrganizationProfile } from "@/lib/auth/guards";
import { hasRole, requireRole, usedCapability } from "@/lib/auth/guards";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "@/lib/domain/errors";
import type { Executor } from "@/lib/domain/operations";
import { recordAudit, recordContractEvent } from "@/lib/domain/operations";
import { readConfiguration } from "@/lib/domain/types";
import type { EffectiveConfiguration, ReviewPolicy } from "@/lib/domain/types";
import type {
  FieldDefinition,
  RenderContext,
  TemplateRecord,
} from "@/lib/domain/templates";
import {
  currencyOptions,
  currencyValueKey,
  getCurrentPrivacyNotice,
  getTemplate,
  listTemplates,
  normalizeCurrency,
  renderTemplateMarkdown,
  renderVideoStatement,
  toStringMap,
} from "@/lib/domain/templates";
import type { Counterparty } from "@/lib/domain/counterparties";
import { listCounterparties } from "@/lib/domain/counterparties";
import { nextReference } from "@/lib/domain/reference";
import { createAttemptWithLink } from "@/lib/domain/attempts";
import { sha256Hex } from "@/lib/crypto/tokens";
import { canonicalizeJson } from "@/lib/canonical-json";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type DraftOriginReason = "duplicate" | "successor" | "reuse";

export interface DraftDetail {
  id: string;
  organizationId: string;
  templateId: string;
  template: TemplateRecord;
  createdBy: string | null;
  createdByName: string;
  holder: Counterparty | null;
  signer: Counterparty | null;
  fieldValues: Record<string, string>;
  folderId: string | null;
  folderName: string | null;
  configuration: EffectiveConfiguration;
  defaults: EffectiveConfiguration;
  customized: boolean;
  originContractId: string | null;
  originReason: DraftOriginReason | null;
  /** Claves obligatorias pendientes de captura. */
  missingFields: string[];
  /** Motivos por los que todavía no puede generarse el Contrato. */
  blockers: string[];
  canIssue: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeletedDraftRow {
  id: string;
  templateName: string;
  createdByName: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface CreateDraftInput {
  templateId: string;
  originContractId?: string;
  originReason?: DraftOriginReason;
  prefill?: Record<string, string>;
  holderId?: string | null;
  signerId?: string | null;
  folderId?: string | null;
}

export interface SaveDraftPatch {
  fieldValues?: Record<string, string>;
  holderId?: string | null;
  signerId?: string | null;
  folderId?: string | null;
  linkDays?: number;
  requiresVideo?: boolean;
  requiresIne?: boolean;
  reviewPolicy?: ReviewPolicy;
}

export interface IssuedContractResult {
  contractId: string;
  reference: string;
  token: string;
  url: string;
}

export interface IssueContractOptions {
  markFavorite?: boolean;
}

interface DraftRow {
  id: string;
  organization_id: string;
  template_id: string;
  created_by: string | null;
  created_by_name: string;
  holder_counterparty_id: string | null;
  signer_counterparty_id: string | null;
  field_values: unknown;
  folder_id: string | null;
  folder_name: string | null;
  link_days: number;
  requires_video: boolean;
  requires_ine: boolean;
  review_policy: ReviewPolicy;
  defaults_snapshot: unknown;
  customized: boolean;
  origin_contract_id: string | null;
  classification: "active" | "deleted";
  issued_contract_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function draftColumns() {
  return sql`
    d.id, d.organization_id, d.template_id, d.created_by, d.created_by_name,
    d.holder_counterparty_id, d.signer_counterparty_id, d.field_values,
    d.folder_id, f.name AS folder_name, d.link_days, d.requires_video,
    d.requires_ine, d.review_policy, d.defaults_snapshot, d.customized,
    d.origin_contract_id, d.classification, d.issued_contract_id,
    d.created_at, d.updated_at
  `;
}

// ---------------------------------------------------------------------------
// Valores y configuración
// ---------------------------------------------------------------------------

export { toStringMap };


function readOriginReason(value: unknown): DraftOriginReason | null {
  if (!value || typeof value !== "object") return null;
  const reason = (value as Record<string, unknown>).originReason;
  return reason === "duplicate" || reason === "successor" || reason === "reuse"
    ? reason
    : null;
}

/**
 * Configuración predeterminada de emisión: parte de la de la Organización y el
 * Contrato-plantilla puede exigir más evidencia o revisión, nunca menos. INE y
 * video están disponibles para todas las Organizaciones; sólo la revisión AI
 * depende de una capacidad contratada (ADR-0070, ADR-0060).
 */
export function resolveDefaultConfiguration(
  organization: OrganizationProfile,
  template: TemplateRecord | null
): EffectiveConfiguration {
  const base = organization.defaults;
  const fromTemplate = template?.defaults;
  const policies: ReviewPolicy[] = ["none", "manual", "ai"];
  const strongest =
    fromTemplate &&
    policies.indexOf(fromTemplate.reviewPolicy) > policies.indexOf(base.reviewPolicy)
      ? fromTemplate.reviewPolicy
      : base.reviewPolicy;
  return clampToCapabilities(organization, {
    // ADR-0070: el Contrato-plantilla propone la vigencia y el Administrador de
    // la Organización puede cambiarla para emisiones futuras, así que su valor
    // manda sobre la propuesta.
    linkDays: base.linkDays,
    requiresVideo: base.requiresVideo || (fromTemplate?.requiresVideo ?? false),
    requiresIne: base.requiresIne || (fromTemplate?.requiresIne ?? false),
    reviewPolicy: strongest,
  });
}

/** INE y video son universales; la revisión AI conserva su frontera comercial. */
export function clampToCapabilities(
  organization: OrganizationProfile,
  configuration: EffectiveConfiguration
): EffectiveConfiguration {
  const capabilities = organization.capabilities;
  return {
    linkDays: Math.min(30, Math.max(1, Math.trunc(configuration.linkDays))),
    requiresVideo: configuration.requiresVideo,
    requiresIne: configuration.requiresIne,
    reviewPolicy:
      configuration.reviewPolicy === "ai" && !capabilities.ai_review
        ? "manual"
        : configuration.reviewPolicy,
  };
}

/** Falla cerrada para AI y límites operativos; INE y video son universales. */
export function assertCapabilities(
  organization: OrganizationProfile,
  configuration: EffectiveConfiguration
): void {
  const capabilities = organization.capabilities;
  if (configuration.reviewPolicy === "ai" && !capabilities.ai_review) {
    throw new ConflictError(
      "La revisión asistida por AI no está habilitada para esta Organización."
    );
  }
  if (
    !Number.isInteger(configuration.linkDays) ||
    configuration.linkDays < 1 ||
    configuration.linkDays > 30
  ) {
    throw new ConflictError("La vigencia del enlace va de 1 a 30 días completos.");
  }
}

function sameConfiguration(
  a: EffectiveConfiguration,
  b: EffectiveConfiguration
): boolean {
  return (
    a.linkDays === b.linkDays &&
    a.requiresVideo === b.requiresVideo &&
    a.requiresIne === b.requiresIne &&
    a.reviewPolicy === b.reviewPolicy
  );
}

export function missingRequiredFields(
  fields: FieldDefinition[],
  values: Record<string, string>
): string[] {
  return fields
    .filter((field) => field.required && !(values[field.key] ?? "").trim())
    .map((field) => field.key);
}

/**
 * Sólo se conservan los valores cuyo campo sigue siendo compatible. Un valor
 * que ya no corresponde al tipo del campo se descarta y vuelve a pedirse, en
 * vez de precargar un Borrador que después no podría emitirse (ADR-0080).
 */
export function compatibleValues(
  fields: FieldDefinition[],
  values: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const value = (values[field.key] ?? "").trim();
    if (!value) continue;
    if (!isCompatibleValue(field, value)) continue;
    result[field.key] = value;
    if (field.dataType === "money") {
      const currencyKey = currencyValueKey(field.key);
      if (values[currencyKey]) {
        result[currencyKey] = normalizeCurrency(field, values[currencyKey]);
      }
    }
  }
  return result;
}

function isCompatibleValue(field: FieldDefinition, value: string): boolean {
  // `suggest` no aparece aquí a propósito: sus `options` sólo proponen, así que
  // cualquier texto es válido. Sólo `select` cierra la entrada a su lista.
  if (field.dataType === "select") return field.options.includes(value);
  if (field.dataType === "number" || field.dataType === "money") {
    return Number.isFinite(Number(value));
  }
  if (field.dataType === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value);
  return true;
}

function validateValues(
  fields: FieldDefinition[],
  values: Record<string, string>
): void {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  for (const [key, raw] of Object.entries(values)) {
    const field = byKey.get(key);
    if (!field) continue;
    const value = raw.trim();
    if (!value) continue;
    // Igual que en `isCompatibleValue`: las sugerencias de `suggest` nunca
    // rechazan un valor capturado a mano.
    if (field.dataType === "select" && !field.options.includes(value)) {
      throw new ConflictError(`«${field.label}» no admite ese valor.`);
    }
    if (field.dataType === "money" && values[currencyValueKey(field.key)]) {
      const rawCurrency = values[currencyValueKey(field.key)].trim().toUpperCase();
      if (rawCurrency && !currencyOptions(field).includes(rawCurrency)) {
        throw new ConflictError(`«${field.label}» no admite esa moneda.`);
      }
    }
    if (
      (field.dataType === "number" || field.dataType === "money") &&
      !Number.isFinite(Number(value))
    ) {
      throw new ConflictError(`«${field.label}» debe ser un número.`);
    }
    if (field.dataType === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ConflictError(`«${field.label}» debe tener el formato AAAA-MM-DD.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Visibilidad
// ---------------------------------------------------------------------------

/** El Borrador sólo lo ven su Emisor creador y los Administradores. */
function assertDraftVisible(context: OrganizationContext, row: DraftRow): void {
  if (hasRole(context, "administrator")) return;
  if (
    hasRole(context, "emitter") &&
    row.created_by === context.account.accountId
  ) {
    return;
  }
  throw new AuthorizationError("Este Borrador pertenece a otro Emisor.");
}

function assertDraftEditable(context: OrganizationContext, row: DraftRow): void {
  requireRole(context, "emitter");
  if (row.created_by !== context.account.accountId) {
    throw new AuthorizationError("Este Borrador pertenece a otro Emisor.");
  }
  if (row.issued_contract_id) {
    throw new ConflictError("Este Borrador ya se emitió como Contrato.");
  }
  if (row.classification === "deleted") {
    throw new ConflictError("Este Borrador está en Eliminados.");
  }
}

// ---------------------------------------------------------------------------
// Construcción del detalle
// ---------------------------------------------------------------------------

interface DetailDeps {
  templates: Map<string, TemplateRecord>;
  counterparties: Map<string, Counterparty>;
  hasPrivacyNotice: boolean;
}

function buildDetail(
  context: OrganizationContext,
  row: DraftRow,
  deps: DetailDeps
): DraftDetail {
  const template = deps.templates.get(row.template_id);
  /* v8 ignore next -- `contract_drafts_template_organization_fk` obliga a que el Contrato-plantilla sea de la misma Organización, y borrarlo arrastra el Borrador en cascada: `deps.templates` siempre lo trae */
  if (!template) throw new NotFoundError("El contrato-plantilla ya no existe.");

  const values = toStringMap(row.field_values);
  const configuration: EffectiveConfiguration = {
    linkDays: row.link_days,
    requiresVideo: row.requires_video,
    requiresIne: row.requires_ine,
    reviewPolicy: row.review_policy,
  };
  const defaults = readConfiguration(
    row.defaults_snapshot,
    resolveDefaultConfiguration(context.organization, template)
  );
  // `contract_drafts_holder_counterparty_id_fkey` y su gemela del Firmante
  // impiden un identificador colgante, y `loadDeps` completa el Directorio con
  // los que no cabían en las primeras 200 filas: el `?? null` nunca se usa.
  const holder = row.holder_counterparty_id
    /* v8 ignore next -- FK contract_drafts_holder_counterparty_id_fkey */
    ? deps.counterparties.get(row.holder_counterparty_id) ?? null
    : null;
  const signer = row.signer_counterparty_id
    /* v8 ignore next -- FK contract_drafts_signer_counterparty_id_fkey */
    ? deps.counterparties.get(row.signer_counterparty_id) ?? null
    : null;

  const missingFields = missingRequiredFields(template.fields, values);
  const blockers: string[] = [];
  if (!template.currentVersion) {
    blockers.push("El contrato-plantilla no tiene una publicación vigente.");
  }
  if (!deps.hasPrivacyNotice) {
    blockers.push("No hay un Aviso de Privacidad vigente completo.");
  }
  if (!holder) blockers.push("Falta elegir el Titular contractual.");
  else if (!holder.active) {
    blockers.push("El Titular contractual está desactivado en el Directorio.");
  }
  if (!signer) blockers.push("Falta elegir el Firmante.");
  else if (!signer.active) {
    blockers.push("El Firmante está desactivado en el Directorio.");
  } else if (signer.personKind !== "fisica") {
    blockers.push("La persona que aceptará debe ser una persona física.");
  }
  if (missingFields.length > 0) {
    const labels = template.fields
      .filter((field) => missingFields.includes(field.key))
      .map((field) => field.label);
    blockers.push(`Faltan datos obligatorios: ${labels.join(", ")}.`);
  }
  try {
    assertCapabilities(context.organization, configuration);
  } catch (error) {
    blockers.push(
      /* v8 ignore next -- `assertCapabilities` sólo lanza ConflictError, que extiende Error */
      error instanceof Error ? error.message : "Configuración no disponible."
    );
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    templateId: row.template_id,
    template,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    holder,
    signer,
    fieldValues: values,
    folderId: row.folder_id,
    folderName: row.folder_name,
    configuration,
    defaults,
    customized: row.customized,
    originContractId: row.origin_contract_id,
    originReason: readOriginReason(row.defaults_snapshot),
    missingFields,
    blockers,
    canIssue: blockers.length === 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadDeps(
  context: OrganizationContext,
  rows: DraftRow[]
): Promise<DetailDeps> {
  const organizationId = context.organization.id;
  // `buildDetail` sólo resuelve la plantilla de cada Borrador: se piden esas y
  // no el catálogo completo, que arrastra el Markdown de cada publicación.
  const templateIds = [...new Set(rows.map((row) => row.template_id))];
  const [templates, counterparties, privacyNotice] = await Promise.all([
    listTemplates(organizationId, sql, templateIds),
    listCounterparties(organizationId, { includeInactive: true }),
    getCurrentPrivacyNotice(organizationId),
  ]);
  const referenced = new Set(
    rows.flatMap((row) =>
      [row.holder_counterparty_id, row.signer_counterparty_id].filter(
        (id): id is string => Boolean(id)
      )
    )
  );
  const byId = new Map(counterparties.map((item) => [item.id, item]));
  // El directorio se acota a 200 registros: se completa lo que falte.
  const missing = [...referenced].filter((id) => !byId.has(id));
  if (missing.length > 0) {
    const extra = await sql<
      {
        id: string;
        organization_id: string;
        person_kind: "fisica" | "moral";
        name: string;
        rfc: string | null;
        email: string | null;
        phone: string | null;
        address: string | null;
        position: string | null;
        active: boolean;
        created_at: Date;
      }[]
    >`
      SELECT id, organization_id, person_kind, name, rfc, email, phone,
             address, position, active, created_at
      FROM counterparties
      WHERE organization_id = ${organizationId} AND id = ANY(${missing}::uuid[])
    `;
    for (const item of extra) {
      byId.set(item.id, {
        id: item.id,
        organizationId: item.organization_id,
        personKind: item.person_kind,
        name: item.name,
        rfc: item.rfc ?? "",
        email: item.email ?? "",
        phone: item.phone ?? "",
        address: item.address ?? "",
        position: item.position ?? "",
        active: item.active,
        createdAt: item.created_at,
      });
    }
  }
  return {
    templates: new Map(templates.map((template) => [template.id, template])),
    counterparties: byId,
    hasPrivacyNotice: Boolean(privacyNotice),
  };
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

export async function createDraft(
  context: OrganizationContext,
  input: CreateDraftInput
): Promise<string> {
  requireRole(context, "emitter");
  const organizationId = context.organization.id;
  const template = await getTemplate(input.templateId);
  if (!template || template.organizationId !== organizationId) {
    throw new NotFoundError("No encontramos ese contrato-plantilla.");
  }

  const defaults = resolveDefaultConfiguration(context.organization, template);
  const values = compatibleValues(template.fields, input.prefill ?? {});

  const holderId = await resolveActiveCounterparty(
    organizationId,
    input.holderId ?? null
  );
  const signerId = await resolveActiveCounterparty(
    organizationId,
    input.signerId ?? null,
    "fisica"
  );
  const folderId = await resolveFolder(organizationId, input.folderId ?? null);

  const snapshot: Record<string, unknown> = {
    ...defaults,
    originReason: input.originReason ?? null,
  };

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO contract_drafts (
      organization_id, template_id, created_by, created_by_name,
      holder_counterparty_id, signer_counterparty_id, field_values, folder_id,
      link_days, requires_video, requires_ine, review_policy,
      defaults_snapshot, customized, origin_contract_id
    ) VALUES (
      ${organizationId}, ${template.id}, ${context.account.accountId},
      ${context.account.fullName}, ${holderId}, ${signerId},
      ${JSON.stringify(values)}::text::jsonb, ${folderId},
      ${defaults.linkDays}, ${defaults.requiresVideo}, ${defaults.requiresIne},
      ${defaults.reviewPolicy}, ${JSON.stringify(snapshot)}::text::jsonb, FALSE,
      ${input.originContractId ?? null}
    )
    RETURNING id
  `;
  await recordAudit({
    organizationId,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    capability: usedCapability(context),
    action: "borrador_creado",
    subjectType: "contract_draft",
    subjectId: row.id,
    payload: {
      templateId: template.id,
      originContractId: input.originContractId ?? null,
      originReason: input.originReason ?? null,
    },
  });
  return row.id;
}

async function resolveActiveCounterparty(
  organizationId: string,
  id: string | null,
  personKind?: "fisica" | "moral"
): Promise<string | null> {
  if (!id) return null;
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM counterparties
    WHERE organization_id = ${organizationId} AND id = ${id} AND active
      AND (${personKind ?? null}::text IS NULL OR person_kind = ${personKind ?? null})
  `;
  return row?.id ?? null;
}

async function resolveFolder(
  organizationId: string,
  id: string | null
): Promise<string | null> {
  if (!id) return null;
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM contract_folders
    WHERE organization_id = ${organizationId} AND id = ${id}
  `;
  return row?.id ?? null;
}

async function loadDraftRow(
  organizationId: string,
  draftId: string,
  executor: Executor = sql
): Promise<DraftRow> {
  const [row] = await executor<DraftRow[]>`
    SELECT ${draftColumns()}
    FROM contract_drafts d
    LEFT JOIN contract_folders f ON f.id = d.folder_id
    WHERE d.organization_id = ${organizationId} AND d.id = ${draftId}
  `;
  if (!row) throw new NotFoundError("No encontramos ese Borrador.");
  return row;
}

export async function getDraft(
  context: OrganizationContext,
  draftId: string
): Promise<DraftDetail> {
  const row = await loadDraftRow(context.organization.id, draftId);
  assertDraftVisible(context, row);
  const deps = await loadDeps(context, [row]);
  return buildDetail(context, row, deps);
}

export async function listDrafts(
  context: OrganizationContext
): Promise<DraftDetail[]> {
  requireRole(context, "administrator", "emitter");
  const organizationId = context.organization.id;
  // Un Administrador ve todos los Borradores; cada Emisor sólo los propios.
  const onlyOwn = !hasRole(context, "administrator");
  const rows = await sql<DraftRow[]>`
    SELECT ${draftColumns()}
    FROM contract_drafts d
    LEFT JOIN contract_folders f ON f.id = d.folder_id
    WHERE d.organization_id = ${organizationId}
      AND d.classification = 'active'
      AND d.issued_contract_id IS NULL
      AND (${!onlyOwn}::boolean OR d.created_by = ${context.account.accountId})
    ORDER BY d.updated_at DESC
    LIMIT 200
  `;
  if (rows.length === 0) return [];
  const deps = await loadDeps(context, rows);
  return rows.map((row) => buildDetail(context, row, deps));
}

/** Borradores en `Eliminados`: sólo metadata mínima. */
export async function listDeletedDrafts(
  context: OrganizationContext
): Promise<DeletedDraftRow[]> {
  requireRole(context, "administrator", "emitter");
  const onlyOwn = !hasRole(context, "administrator");
  const rows = await sql<
    {
      id: string;
      template_name: string;
      created_by_name: string;
      created_at: Date;
      deleted_at: Date | null;
    }[]
  >`
    SELECT d.id, t.name AS template_name, d.created_by_name,
           d.created_at, d.deleted_at
    FROM contract_drafts d
    JOIN contract_templates t ON t.id = d.template_id
    WHERE d.organization_id = ${context.organization.id}
      AND d.classification = 'deleted'
      AND (${!onlyOwn}::boolean OR d.created_by = ${context.account.accountId})
    ORDER BY d.deleted_at DESC NULLS LAST
    LIMIT 200
  `;
  return rows.map((row) => ({
    id: row.id,
    templateName: row.template_name,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  }));
}

export async function saveDraft(
  context: OrganizationContext,
  draftId: string,
  patch: SaveDraftPatch
): Promise<DraftDetail> {
  const organizationId = context.organization.id;
  const row = await loadDraftRow(organizationId, draftId);
  assertDraftEditable(context, row);

  const template = await getTemplate(row.template_id);
  // Inalcanzable desde la base: `contract_drafts_template_organization_fk` ata
  // el Borrador a un Contrato-plantilla de su propia Organización, y borrar el
  // Contrato-plantilla arrastra el Borrador en cascada antes de llegar aquí.
  /* v8 ignore next 3 -- restricción contract_drafts_template_organization_fk */
  if (!template || template.organizationId !== organizationId) {
    throw new NotFoundError("El contrato-plantilla ya no existe.");
  }

  const values = { ...toStringMap(row.field_values) };
  if (patch.fieldValues) {
    const known = new Set(template.fields.map((field) => field.key));
    const currencies = new Map(
      template.fields
        .filter((field) => field.dataType === "money")
        .map((field) => [currencyValueKey(field.key), field])
    );
    for (const [key, value] of Object.entries(patch.fieldValues)) {
      const currencyField = currencies.get(key);
      if (currencyField) {
        const currency = value.trim().toUpperCase();
        if (currency && !currencyOptions(currencyField).includes(currency)) {
          throw new ConflictError(`«${currencyField.label}» no admite esa moneda.`);
        }
        values[key] = normalizeCurrency(currencyField, value);
        continue;
      }
      if (known.has(key)) values[key] = value;
    }
    validateValues(template.fields, values);
  }

  const defaults = readConfiguration(
    row.defaults_snapshot,
    resolveDefaultConfiguration(context.organization, template)
  );
  const configuration: EffectiveConfiguration = {
    linkDays: patch.linkDays ?? row.link_days,
    requiresVideo: patch.requiresVideo ?? row.requires_video,
    requiresIne: patch.requiresIne ?? row.requires_ine,
    reviewPolicy: patch.reviewPolicy ?? row.review_policy,
  };
  assertCapabilities(context.organization, configuration);

  const holderId =
    patch.holderId === undefined
      ? row.holder_counterparty_id
      : await resolveActiveCounterparty(organizationId, patch.holderId);
  const signerId =
    patch.signerId === undefined
      ? row.signer_counterparty_id
      : await resolveActiveCounterparty(organizationId, patch.signerId, "fisica");
  const folderId =
    patch.folderId === undefined
      ? row.folder_id
      : await resolveFolder(organizationId, patch.folderId);

  await sql`
    UPDATE contract_drafts SET
      field_values = ${JSON.stringify(values)}::text::jsonb,
      holder_counterparty_id = ${holderId},
      signer_counterparty_id = ${signerId},
      folder_id = ${folderId},
      link_days = ${configuration.linkDays},
      requires_video = ${configuration.requiresVideo},
      requires_ine = ${configuration.requiresIne},
      review_policy = ${configuration.reviewPolicy},
      customized = ${!sameConfiguration(configuration, defaults)},
      updated_at = NOW()
    WHERE organization_id = ${organizationId} AND id = ${draftId}
      AND issued_contract_id IS NULL AND classification = 'active'
  `;
  return getDraft(context, draftId);
}

/**
 * `Eliminar` un Borrador destruye su contenido editable y conserva en
 * `Eliminados` sólo plantilla, creador y fechas.
 */
export async function deleteDraft(
  context: OrganizationContext,
  draftId: string
): Promise<void> {
  const organizationId = context.organization.id;
  const row = await loadDraftRow(organizationId, draftId);
  requireRole(context, "administrator");
  if (row.issued_contract_id) {
    throw new ConflictError("Este Borrador ya se emitió como Contrato.");
  }
  const result = await sql`
    UPDATE contract_drafts SET
      classification = 'deleted',
      deleted_at = NOW(),
      field_values = '{}'::jsonb,
      defaults_snapshot = '{}'::jsonb,
      holder_counterparty_id = NULL,
      signer_counterparty_id = NULL,
      folder_id = NULL,
      customized = FALSE,
      updated_at = NOW()
    WHERE organization_id = ${organizationId} AND id = ${draftId}
      AND classification = 'active' AND issued_contract_id IS NULL
  `;
  if (result.count === 0) {
    throw new ConflictError("El Borrador ya no puede eliminarse.");
  }
  await recordAudit({
    organizationId,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    capability: usedCapability(context),
    action: "borrador_eliminado",
    subjectType: "contract_draft",
    subjectId: draftId,
  });
}

// ---------------------------------------------------------------------------
// Emisión
// ---------------------------------------------------------------------------

interface PartySnapshot {
  role: "holder" | "signer";
  sourceId: string | null;
  personKind: "fisica" | "moral";
  name: string;
  rfc: string;
  email: string;
  phone: string;
  address: string;
  position: string;
}

/** Campos de una parte tal como los ve la plantilla, sin importar su origen. */
export interface PartyPlaceholders {
  personKind: "fisica" | "moral";
  name: string;
  rfc: string;
  email: string;
  phone: string;
  address: string;
  position: string;
}

/**
 * Valores de `{{titular.*}}` y `{{firmante.*}}`. La vista previa y el
 * Contrato emitido comparten esta tabla: si divergieran, el Emitente revisaría
 * un texto distinto del que queda congelado en el asunto.
 */
export function partyContext(party: PartyPlaceholders): Record<string, string> {
  return {
    nombre: party.name,
    rfc: party.rfc,
    domicilio: party.address,
    correo: party.email,
    telefono: party.phone,
    cargo: party.position,
    tipo: party.personKind === "moral" ? "persona moral" : "persona física",
  };
}

function buildSearchText(input: {
  reference: string;
  templateName: string;
  holderName: string;
  signerName: string;
  emitterName: string;
  fields: FieldDefinition[];
  values: Record<string, string>;
}): string {
  // El índice general nunca incluye cláusulas, Markdown ni evidencia sensible.
  const searchable = input.fields
    .filter((field) => field.searchable)
    .map((field) => `${field.label} ${input.values[field.key] ?? ""}`);
  return [
    input.reference,
    input.templateName,
    input.holderName,
    input.signerName,
    input.emitterName,
    ...searchable,
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadPartyForIssue(
  tx: Transaction,
  organizationId: string,
  id: string | null,
  role: "holder" | "signer"
): Promise<PartySnapshot> {
  const label = role === "holder" ? "Titular contractual" : "Firmante";
  if (!id) throw new ConflictError(`Falta elegir el ${label}.`);
  const [row] = await tx<
    {
      id: string;
      person_kind: "fisica" | "moral";
      name: string;
      rfc: string | null;
      email: string | null;
      phone: string | null;
      address: string | null;
      position: string | null;
      active: boolean;
    }[]
  >`
    SELECT id, person_kind, name, rfc, email, phone, address, position, active
    FROM counterparties
    WHERE organization_id = ${organizationId} AND id = ${id}
  `;
  // `contract_drafts_holder_counterparty_id_fkey` (y la del Firmante) es
  // ON DELETE SET NULL: si la Contraparte desaparece del Directorio, el
  // Borrador queda con `null` y la guarda de arriba es la que responde.
  /* v8 ignore next -- FK contract_drafts_holder_counterparty_id_fkey */
  if (!row) throw new ConflictError(`No encontramos el ${label} elegido.`);
  if (!row.active) {
    throw new ConflictError(
      `El ${label} está desactivado en el Directorio: elige o crea uno activo.`
    );
  }
  if (role === "signer" && row.person_kind !== "fisica") {
    throw new ConflictError("La persona que aceptará debe ser una persona física.");
  }
  return {
    role,
    sourceId: row.id,
    personKind: row.person_kind,
    name: row.name,
    rfc: row.rfc ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    address: row.address ?? "",
    position: row.position ?? "",
  };
}

/**
 * `Generar Contrato`: una sola transacción crea el Contrato inmutable, su
 * Referencia, la instantánea de partes, la configuración efectiva, los hashes,
 * el primer Intento con su enlace opaco y el evento de emisión.
 */
export async function issueContract(
  context: OrganizationContext,
  draftId: string,
  options: IssueContractOptions = {}
): Promise<IssuedContractResult> {
  requireRole(context, "emitter");
  const organizationId = context.organization.id;
  const account = context.account;

  return sql.begin(async (tx) => {
    const [draft] = await tx<DraftRow[]>`
      SELECT ${draftColumns()}
      FROM contract_drafts d
      LEFT JOIN contract_folders f ON f.id = d.folder_id
      WHERE d.organization_id = ${organizationId} AND d.id = ${draftId}
      FOR UPDATE OF d
    `;
    if (!draft) throw new NotFoundError("No encontramos ese Borrador.");
    if (draft.created_by !== account.accountId) {
      throw new AuthorizationError("Este Borrador pertenece a otro Emisor.");
    }
    if (draft.classification !== "active") {
      throw new ConflictError("Este Borrador está en Eliminados.");
    }
    if (draft.issued_contract_id) {
      throw new ConflictError("Este Borrador ya se emitió como Contrato.");
    }

    const template = await getTemplate(draft.template_id, tx);
    // Misma guarda inalcanzable que en `saveDraft`:
    // `contract_drafts_template_organization_fk` no admite un Borrador cuyo
    // Contrato-plantilla sea de otra Organización o ya no exista.
    /* v8 ignore next 3 -- restricción contract_drafts_template_organization_fk */
    if (!template || template.organizationId !== organizationId) {
      throw new NotFoundError("El contrato-plantilla ya no existe.");
    }
    const version = template.currentVersion;
    if (!version) {
      throw new ConflictError(
        "El contrato-plantilla no tiene una publicación vigente."
      );
    }
    const privacyNotice = await getCurrentPrivacyNotice(organizationId, tx);
    if (!privacyNotice) {
      throw new ConflictError(
        "No hay un Aviso de Privacidad vigente completo para esta Organización."
      );
    }

    const values = toStringMap(draft.field_values);
    for (const field of template.fields) {
      if (field.dataType !== "money") continue;
      const currencyKey = currencyValueKey(field.key);
      if (values[currencyKey]) {
        values[currencyKey] = normalizeCurrency(field, values[currencyKey]);
      }
    }
    const missing = missingRequiredFields(template.fields, values);
    if (missing.length > 0) {
      const labels = template.fields
        .filter((field) => missing.includes(field.key))
        .map((field) => field.label);
      throw new ConflictError(`Faltan datos obligatorios: ${labels.join(", ")}.`);
    }
    validateValues(template.fields, values);

    const configuration: EffectiveConfiguration = {
      linkDays: draft.link_days,
      requiresVideo: draft.requires_video,
      requiresIne: draft.requires_ine,
      reviewPolicy: draft.review_policy,
    };
    assertCapabilities(context.organization, configuration);

    const holder = await loadPartyForIssue(
      tx,
      organizationId,
      draft.holder_counterparty_id,
      "holder"
    );
    const signer = await loadPartyForIssue(
      tx,
      organizationId,
      draft.signer_counterparty_id,
      "signer"
    );

    const reference = await nextReference(tx, organizationId);
    const issuedAt = new Date();
    const renderContext: RenderContext = {
      organization: {
        name: context.organization.name,
        legalName: context.organization.legalName,
      },
      holder: partyContext(holder),
      signer: partyContext(signer),
      reference,
      issuedAt,
    };

    const contractMarkdown = renderTemplateMarkdown(
      version.markdown,
      template.fields,
      values,
      renderContext
    );
    const videoStatement = configuration.requiresVideo
      ? renderVideoStatement(
          template.videoStatementTemplate,
          template.fields,
          values,
          renderContext
        )
      : "";

    // Huella documental: JSON canónico del texto, valores, partes y
    // configuración efectiva congelados en este instante.
    const documentHash = sha256Hex(
      canonicalizeJson({
        markdown: contractMarkdown,
        values,
        parties: [holder, signer].map((party) => ({
          role: party.role,
          personKind: party.personKind,
          name: party.name,
          rfc: party.rfc,
          email: party.email,
          phone: party.phone,
          address: party.address,
          position: party.position,
        })),
        configuration,
        reference,
        templateVersionId: version.id,
        privacyNoticeVersionId: privacyNotice.id,
      })
    );

    const defaults = readConfiguration(
      draft.defaults_snapshot,
      resolveDefaultConfiguration(context.organization, template)
    );
    const originReason = readOriginReason(draft.defaults_snapshot);

    const searchText = buildSearchText({
      reference,
      templateName: template.name,
      holderName: holder.name,
      signerName: signer.name,
      emitterName: draft.created_by_name,
      fields: template.fields,
      values,
    });

    const [contract] = await tx<{ id: string }[]>`
      INSERT INTO contracts (
        organization_id, reference, template_id, template_version_id,
        template_name, template_label, privacy_notice_version_id,
        privacy_notice_label, privacy_notice_simplified_markdown,
        privacy_notice_full_markdown, privacy_notice_hash,
        privacy_notice_published_at, status,
        contract_markdown, field_values, document_hash, acceptance_legend,
        video_statement, link_days, requires_video, requires_ine,
        review_policy, defaults_snapshot, customized, folder_id,
        classification, created_by, created_by_name, origin_contract_id,
        origin_reason, issued_at, search_text, updated_at
      ) VALUES (
        ${organizationId}, ${reference}, ${template.id}, ${version.id},
        ${template.name}, ${version.label}, ${privacyNotice.id},
        ${privacyNotice.label}, ${privacyNotice.simplifiedMarkdown},
        ${privacyNotice.fullMarkdown}, ${privacyNotice.noticeHash},
        ${privacyNotice.publishedAt}, 'pending',
        ${contractMarkdown}, ${JSON.stringify(values)}::text::jsonb, ${documentHash},
        ${template.acceptanceLegend}, ${videoStatement},
        ${configuration.linkDays}, ${configuration.requiresVideo},
        ${configuration.requiresIne}, ${configuration.reviewPolicy},
        ${JSON.stringify(defaults)}::text::jsonb,
        ${!sameConfiguration(configuration, defaults)}, ${draft.folder_id},
        'active', ${account.accountId}, ${draft.created_by_name},
        ${draft.origin_contract_id}, ${originReason}, ${issuedAt},
        ${searchText}, ${issuedAt}
      )
      RETURNING id
    `;
    const contractId = contract.id;

    for (const party of [holder, signer]) {
      await tx`
        INSERT INTO contract_parties (
          contract_id, party_role, source_counterparty_id, person_kind, name,
          rfc, email, phone, address, position, snapshot, captured_at
        ) VALUES (
          ${contractId}, ${party.role}, ${party.sourceId}, ${party.personKind},
          ${party.name}, ${party.rfc || null}, ${party.email || null},
          ${party.phone || null}, ${party.address || null},
          ${party.position || null},
          ${JSON.stringify(partyContext(party))}::text::jsonb, ${issuedAt}
        )
      `;
    }

    const link = await createAttemptWithLink(tx, {
      contractId,
      organizationId,
      linkDays: configuration.linkDays,
      replacesAttemptId: null,
    });

    await tx`
      UPDATE contract_drafts
      SET issued_contract_id = ${contractId}, updated_at = NOW()
      WHERE id = ${draftId}
    `;

    await recordContractEvent(
      {
        contractId,
        organizationId,
        attemptId: link.attemptId,
        type: "contrato_emitido",
        actorKind: "member",
        actorId: account.accountId,
        actorName: account.fullName,
        payload: {
          reference,
          templateName: template.name,
          templateLabel: version.label,
          documentHash,
          configuration,
          customized: !sameConfiguration(configuration, defaults),
          expiresAt: link.expiresAt,
        },
      },
      tx
    );
    await recordAudit(
      {
        organizationId,
        accountId: account.accountId,
        actorName: account.fullName,
        capability: usedCapability(context),
        action: "contrato_emitido",
        subjectType: "contract",
        subjectId: contractId,
        payload: { reference, draftId, documentHash },
      },
      tx
    );

    if (options.markFavorite) {
      await tx`
        INSERT INTO contract_favorites (organization_id, contract_id, account_id)
        VALUES (${organizationId}, ${contractId}, ${account.accountId})
        ON CONFLICT (contract_id, account_id) DO NOTHING
      `;
      await recordAudit(
        {
          organizationId,
          accountId: account.accountId,
          actorName: account.fullName,
          capability: usedCapability(context),
          action: "contrato_marcado_favorito",
          subjectType: "contract",
          subjectId: contractId,
        },
        tx
      );
    }

    return {
      contractId,
      reference,
      token: link.token,
      url: link.url,
    };
  });
}
