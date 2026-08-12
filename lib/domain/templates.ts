import "server-only";
import { sql } from "@/lib/db";
import type { Executor } from "@/lib/domain/operations";
import { recordAudit } from "@/lib/domain/operations";
import { ConflictError, NotFoundError } from "@/lib/domain/errors";
import type { ReviewPolicy } from "@/lib/domain/types";
import { sha256Hex } from "@/lib/crypto/tokens";
import { canonicalizeJson } from "@/lib/canonical-json";
import { formatMoney } from "@/lib/format";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type FieldDataType =
  | "text"
  | "longtext"
  | "number"
  | "money"
  | "date"
  | "select"
  /** Texto libre con sugerencias: `options` propone, no restringe. */
  | "suggest";

export interface FieldDefinition {
  id: string;
  key: string;
  label: string;
  helpText: string;
  dataType: FieldDataType;
  required: boolean;
  options: string[];
  searchable: boolean;
  highlighted: boolean;
  position: number;
}

export interface TemplateVersionRecord {
  id: string;
  label: string;
  markdown: string;
  markdownHash: string;
  isCurrent: boolean;
  publishedAt: Date;
  publishedByName: string | null;
}

export interface TemplateRecord {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  summary: string;
  acceptanceLegend: string;
  videoStatementTemplate: string;
  defaults: {
    linkDays: number;
    requiresVideo: boolean;
    requiresIne: boolean;
    reviewPolicy: ReviewPolicy;
  };
  fields: FieldDefinition[];
  currentVersion: TemplateVersionRecord | null;
}

export interface PrivacyNoticeRecord {
  id: string;
  organizationId: string;
  label: string;
  simplifiedMarkdown: string;
  fullMarkdown: string;
  noticeHash: string;
  isCurrent: boolean;
  publishedAt: Date;
}

export interface RenderContext {
  organization: { name: string; legalName: string };
  holder: Record<string, string>;
  signer: Record<string, string>;
  reference: string;
  issuedAt: Date;
}

export const DEFAULT_CURRENCY = "MXN";
export const CURRENCY_FIELD_SUFFIX = "_moneda";

export function currencyValueKey(fieldKey: string): string {
  return `${fieldKey}${CURRENCY_FIELD_SUFFIX}`;
}

export function currencyOptions(field: FieldDefinition): string[] {
  return field.options.length > 0 ? field.options : ["USD", DEFAULT_CURRENCY];
}

export function normalizeCurrency(
  field: FieldDefinition,
  value: string | undefined
): string {
  const options = currencyOptions(field);
  const candidate = (value ?? "").trim().toUpperCase();
  if (candidate && options.includes(candidate)) return candidate;
  return options.includes(DEFAULT_CURRENCY) ? DEFAULT_CURRENCY : options[0];
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

interface TemplateRow {
  id: string;
  organization_id: string;
  organization_name: string;
  name: string;
  summary: string;
  acceptance_legend: string;
  video_statement_template: string;
  default_link_days: number;
  default_requires_video: boolean;
  default_requires_ine: boolean;
  default_review_policy: ReviewPolicy;
}

interface FieldRow {
  id: string;
  template_id: string;
  key: string;
  label: string;
  help_text: string;
  data_type: FieldDataType;
  required: boolean;
  options: unknown;
  searchable: boolean;
  highlighted: boolean;
  position: number;
}

interface VersionRow {
  id: string;
  template_id: string;
  label: string;
  markdown: string;
  markdown_hash: string;
  is_current: boolean;
  published_at: Date;
  published_by_name: string | null;
}

function toOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toField(row: FieldRow): FieldDefinition {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    helpText: row.help_text,
    dataType: row.data_type,
    required: row.required,
    options: toOptions(row.options),
    searchable: row.searchable,
    highlighted: row.highlighted,
    position: row.position,
  };
}

function toVersion(row: VersionRow): TemplateVersionRecord {
  return {
    id: row.id,
    label: row.label,
    markdown: row.markdown,
    markdownHash: row.markdown_hash,
    isCurrent: row.is_current,
    publishedAt: row.published_at,
    publishedByName: row.published_by_name,
  };
}

function toTemplate(
  row: TemplateRow,
  fields: FieldDefinition[],
  currentVersion: TemplateVersionRecord | null
): TemplateRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    name: row.name,
    summary: row.summary,
    acceptanceLegend: row.acceptance_legend,
    videoStatementTemplate: row.video_statement_template,
    defaults: {
      linkDays: row.default_link_days,
      requiresVideo: row.default_requires_video,
      requiresIne: row.default_requires_ine,
      reviewPolicy: row.default_review_policy,
    },
    fields,
    currentVersion,
  };
}

/** Fragmento nuevo en cada llamada: postgres.js no reutiliza fragmentos. */
function templateColumns() {
  return sql`
    t.id, t.organization_id, o.name AS organization_name, t.name, t.summary,
    t.acceptance_legend, t.video_statement_template, t.default_link_days,
    t.default_requires_video, t.default_requires_ine, t.default_review_policy
  `;
}

/**
 * Contratos-plantilla de la Organización; sólo ella los ve, nunca otra.
 * `onlyIds` acota la lectura a las plantillas que el llamador ya sabe que
 * necesita: cada publicación vigente arrastra su Markdown completo, así que
 * traer el catálogo entero para resolver una sola plantilla es caro.
 */
export async function listTemplates(
  organizationId: string,
  executor: Executor = sql,
  onlyIds?: string[]
): Promise<TemplateRecord[]> {
  if (onlyIds && onlyIds.length === 0) return [];
  const rows = await executor<TemplateRow[]>`
    SELECT ${templateColumns()}
    FROM contract_templates t
    JOIN organizations o ON o.id = t.organization_id
    WHERE t.organization_id = ${organizationId}
    ${onlyIds ? sql`AND t.id = ANY(${onlyIds}::uuid[])` : sql``}
    ORDER BY t.name
  `;
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [fields, versions] = await Promise.all([
    executor<FieldRow[]>`
      SELECT id, template_id, key, label, help_text, data_type, required,
             options, searchable, highlighted, position
      FROM contract_field_definitions
      WHERE template_id = ANY(${ids}::uuid[])
      ORDER BY position, label
    `,
    executor<VersionRow[]>`
      SELECT v.id, v.template_id, v.label, v.markdown, v.markdown_hash,
             v.is_current, v.published_at, a.full_name AS published_by_name
      FROM contract_template_versions v
      LEFT JOIN accounts a ON a.id = v.published_by
      WHERE v.template_id = ANY(${ids}::uuid[]) AND v.is_current
    `,
  ]);
  return rows.map((row) =>
    toTemplate(
      row,
      fields.filter((field) => field.template_id === row.id).map(toField),
      versions
        .filter((version) => version.template_id === row.id)
        .map(toVersion)[0] ?? null
    )
  );
}

/**
 * Contratos-plantilla como opciones de filtro. El buscador sólo pinta nombres:
 * traer el catálogo completo arrastraría el Markdown de cada publicación
 * vigente para llenar un desplegable.
 */
export async function listTemplateOptions(
  organizationId: string,
  executor: Executor = sql
): Promise<{ id: string; name: string }[]> {
  return executor<{ id: string; name: string }[]>`
    SELECT id, name FROM contract_templates
    WHERE organization_id = ${organizationId}
    ORDER BY name
  `;
}

export async function getTemplate(
  templateId: string,
  executor: Executor = sql
): Promise<TemplateRecord | null> {
  const [row] = await executor<TemplateRow[]>`
    SELECT ${templateColumns()}
    FROM contract_templates t
    JOIN organizations o ON o.id = t.organization_id
    WHERE t.id = ${templateId}
  `;
  if (!row) return null;
  const [fields, versions] = await Promise.all([
    executor<FieldRow[]>`
      SELECT id, template_id, key, label, help_text, data_type, required,
             options, searchable, highlighted, position
      FROM contract_field_definitions
      WHERE template_id = ${templateId}
      ORDER BY position, label
    `,
    executor<VersionRow[]>`
      SELECT v.id, v.template_id, v.label, v.markdown, v.markdown_hash,
             v.is_current, v.published_at, a.full_name AS published_by_name
      FROM contract_template_versions v
      LEFT JOIN accounts a ON a.id = v.published_by
      WHERE v.template_id = ${templateId} AND v.is_current
    `,
  ]);
  const [version] = versions;
  return toTemplate(row, fields.map(toField), version ? toVersion(version) : null);
}

/** Historial de publicaciones; es información interna de la plataforma. */
export async function listTemplateVersions(
  templateId: string
): Promise<TemplateVersionRecord[]> {
  const rows = await sql<VersionRow[]>`
    SELECT v.id, v.template_id, v.label, v.markdown, v.markdown_hash,
           v.is_current, v.published_at, a.full_name AS published_by_name
    FROM contract_template_versions v
    LEFT JOIN accounts a ON a.id = v.published_by
    WHERE v.template_id = ${templateId}
    ORDER BY v.published_at DESC
  `;
  return rows.map(toVersion);
}

// ---------------------------------------------------------------------------
// Marcadores
// ---------------------------------------------------------------------------

/** Claves de contexto siempre disponibles para el contenido jurídico. */
export const CONTEXT_PLACEHOLDERS: readonly string[] = [
  "organizacion.nombre",
  "organizacion.razon_social",
  "titular.nombre",
  "titular.rfc",
  "titular.domicilio",
  "titular.correo",
  "titular.telefono",
  "firmante.nombre",
  "contrato.referencia",
  "contrato.fecha",
  "contrato.monto_principal",
];

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

export function extractPlaceholders(markdown: string): string[] {
  const found: string[] = [];
  for (const match of markdown.matchAll(PLACEHOLDER_PATTERN)) {
    const key = match[1];
    if (!found.includes(key)) found.push(key);
  }
  return found;
}

export function unknownPlaceholders(
  markdown: string,
  fields: FieldDefinition[]
): string[] {
  const known = new Set<string>(CONTEXT_PLACEHOLDERS);
  for (const field of fields) known.add(field.key);
  return extractPlaceholders(markdown).filter((key) => !known.has(key));
}

// ---------------------------------------------------------------------------
// Presentación de valores
// ---------------------------------------------------------------------------

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const LONG_DATE_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha larga en español sin desplazamiento por zona horaria. */
export function longDate(value: Date): string {
  const [year, month, day] = LONG_DATE_PARTS.format(value).split("-");
  return `${Number(day)} de ${MONTHS[Number(month) - 1]} de ${year}`;
}

/** Valores contractuales guardados como JSONB, siempre leídos como texto. */
export function toStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") result[key] = item;
    else if (typeof item === "number" || typeof item === "boolean") {
      result[key] = String(item);
    }
  }
  return result;
}

export function formatFieldValue(
  field: FieldDefinition,
  value: string,
  values: Record<string, string> = {}
): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  switch (field.dataType) {
    case "money":
      return formatMoney(raw, normalizeCurrency(field, values[currencyValueKey(field.key)]));
    case "number": {
      const parsed = Number(raw);
      return Number.isFinite(parsed)
        ? new Intl.NumberFormat("es-MX").format(parsed)
        : raw;
    }
    case "date": {
      // Un valor `YYYY-MM-DD` es una fecha civil: no se convierte a UTC.
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
      if (!match) return raw;
      return `${Number(match[3])} de ${MONTHS[Number(match[2]) - 1]} de ${match[1]}`;
    }
    default:
      return raw;
  }
}

function resolvePlaceholder(
  key: string,
  fields: FieldDefinition[],
  fieldsByKey: Map<string, FieldDefinition>,
  values: Record<string, string>,
  context: RenderContext
): string | null {
  if (key.startsWith("organizacion.")) {
    const property = key.slice("organizacion.".length);
    if (property === "nombre") return context.organization.name;
    if (property === "razon_social") return context.organization.legalName;
    return null;
  }
  if (key.startsWith("titular.")) {
    return context.holder[key.slice("titular.".length)] ?? "";
  }
  if (key.startsWith("firmante.")) {
    return context.signer[key.slice("firmante.".length)] ?? "";
  }
  if (key === "contrato.referencia") return context.reference;
  if (key === "contrato.fecha") return longDate(context.issuedAt);
  if (key === "contrato.monto_principal") return primaryMoneyValue(fields, values);
  const field = fieldsByKey.get(key);
  if (field) return formatFieldValue(field, values[key] ?? "", values);
  return null;
}

function primaryMoneyValue(
  fields: FieldDefinition[],
  values: Record<string, string>
): string {
  const field =
    fields.find(
      (item) =>
        item.dataType === "money" &&
        item.highlighted &&
        (values[item.key] ?? "").trim()
    ) ??
    fields.find(
      (item) => item.dataType === "money" && (values[item.key] ?? "").trim()
    );
  if (field) return formatFieldValue(field, values[field.key] as string, values);

  const amountField =
    fields.find(
      (item) => item.highlighted && extractAmount(values[item.key] ?? "") !== null
    ) ?? fields.find((item) => extractAmount(values[item.key] ?? "") !== null);
  if (!amountField) return "";
  const amount = extractAmount(values[amountField.key] as string)!;
  return formatMoney(amount.value, amount.currency);
}

function extractAmount(value: string): { value: string; currency: string } | null {
  const match = /\bpor\s+(\d+(?:[.,]\d{1,2})?)\s*(MXN|USD|EUR|CAD)?\b/iu.exec(
    value
  );
  if (!match) return null;
  return {
    value: match[1].replace(",", "."),
    currency: (match[2] ?? DEFAULT_CURRENCY).toUpperCase(),
  };
}

function substitute(
  source: string,
  fields: FieldDefinition[],
  values: Record<string, string>,
  context: RenderContext
): string {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  return source.replace(PLACEHOLDER_PATTERN, (whole, key: string) => {
    const resolved = resolvePlaceholder(key, fields, fieldsByKey, values, context);
    // Un marcador desconocido se deja intacto: nunca se inventa contenido.
    return resolved === null ? whole : resolved;
  });
}

export function renderTemplateMarkdown(
  markdown: string,
  fields: FieldDefinition[],
  values: Record<string, string>,
  context: RenderContext
): string {
  return substitute(markdown, fields, values, context);
}

export function renderVideoStatement(
  template: string,
  fields: FieldDefinition[],
  values: Record<string, string>,
  context: RenderContext
): string {
  return substitute(template, fields, values, context).trim();
}

// ---------------------------------------------------------------------------
// Publicación (Publicador de contenido jurídico)
// ---------------------------------------------------------------------------

export async function publishTemplateVersion(input: {
  templateId: string;
  label: string;
  markdown: string;
  publishedBy: string;
  publishedByName: string;
}): Promise<TemplateVersionRecord> {
  const template = await getTemplate(input.templateId);
  if (!template) throw new NotFoundError("No encontramos el contrato-plantilla.");

  const label = input.label.trim();
  if (!label) throw new ConflictError("La publicación necesita una etiqueta.");
  const markdown = input.markdown.replace(/\r\n/g, "\n").trim();
  if (!markdown) throw new ConflictError("El texto de la plantilla está vacío.");

  // Falla cerrada: se listan todos los marcadores sin campo ni contexto.
  const unknown = unknownPlaceholders(markdown, template.fields);
  if (unknown.length > 0) {
    throw new ConflictError(
      `Hay marcadores sin campo definido: ${unknown.join(", ")}.`
    );
  }

  const markdownHash = sha256Hex(markdown);

  return sql.begin(async (tx) => {
    await tx`
      UPDATE contract_template_versions SET is_current = FALSE
      WHERE template_id = ${input.templateId} AND is_current
    `;
    const [row] = await tx<VersionRow[]>`
      INSERT INTO contract_template_versions (
        template_id, label, markdown, markdown_hash, is_current, published_by
      ) VALUES (
        ${input.templateId}, ${label}, ${markdown}, ${markdownHash},
        TRUE, ${input.publishedBy}
      )
      RETURNING id, template_id, label, markdown, markdown_hash, is_current,
                published_at, ${input.publishedByName}::text AS published_by_name
    `;
    await recordAudit(
      {
        organizationId: template.organizationId,
        accountId: input.publishedBy,
        actorName: input.publishedByName,
        actorKind: "platform",
        action: "plantilla_publicada",
        subjectType: "contract_template",
        subjectId: input.templateId,
        payload: { versionId: row.id, label, markdownHash },
      },
      tx
    );
    return toVersion(row);
  });
}

// ---------------------------------------------------------------------------
// Aviso de Privacidad
// ---------------------------------------------------------------------------

interface PrivacyRow {
  id: string;
  organization_id: string;
  label: string;
  simplified_markdown: string;
  full_markdown: string;
  notice_hash: string;
  is_current: boolean;
  published_at: Date;
}

function toPrivacyNotice(row: PrivacyRow): PrivacyNoticeRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    label: row.label,
    simplifiedMarkdown: row.simplified_markdown,
    fullMarkdown: row.full_markdown,
    noticeHash: row.notice_hash,
    isCurrent: row.is_current,
    publishedAt: row.published_at,
  };
}

export function privacyNoticeHash(
  fullMarkdown: string,
  legacyFullMarkdown?: string
): string {
  return sha256Hex(
    canonicalizeJson({ fullMarkdown: legacyFullMarkdown ?? fullMarkdown })
  );
}

/**
 * Vigente sólo si el Aviso de Privacidad publicado tiene contenido.
 */
export async function getCurrentPrivacyNotice(
  organizationId: string,
  executor: Executor = sql
): Promise<PrivacyNoticeRecord | null> {
  const [row] = await executor<PrivacyRow[]>`
    SELECT id, organization_id, label, simplified_markdown, full_markdown,
           notice_hash, is_current, published_at
    FROM privacy_notice_versions
    WHERE organization_id = ${organizationId}
      AND is_current
      AND btrim(full_markdown) <> ''
  `;
  return row ? toPrivacyNotice(row) : null;
}

export async function listPrivacyNotices(
  organizationId: string
): Promise<PrivacyNoticeRecord[]> {
  const rows = await sql<PrivacyRow[]>`
    SELECT id, organization_id, label, simplified_markdown, full_markdown,
           notice_hash, is_current, published_at
    FROM privacy_notice_versions
    WHERE organization_id = ${organizationId}
    ORDER BY published_at DESC
  `;
  return rows.map(toPrivacyNotice);
}

export async function publishPrivacyNotice(input: {
  organizationId: string;
  label: string;
  simplifiedMarkdown?: string;
  fullMarkdown: string;
  publishedBy: string;
  publishedByName: string;
}): Promise<PrivacyNoticeRecord> {
  const label = input.label.trim();
  const full = input.fullMarkdown.replace(/\r\n/g, "\n").trim();
  const simplified = (
    input.simplifiedMarkdown === undefined
      ? full
      : input.simplifiedMarkdown.replace(/\r\n/g, "\n").trim()
  );
  if (!label) throw new ConflictError("La publicación necesita una etiqueta.");
  if (!full) {
    throw new ConflictError("El Aviso de Privacidad necesita contenido.");
  }
  const noticeHash = privacyNoticeHash(full);

  return sql.begin(async (tx) => {
    await tx`
      UPDATE privacy_notice_versions SET is_current = FALSE
      WHERE organization_id = ${input.organizationId} AND is_current
    `;
    const [row] = await tx<PrivacyRow[]>`
      INSERT INTO privacy_notice_versions (
        organization_id, label, simplified_markdown, full_markdown,
        notice_hash, is_current, published_by
      ) VALUES (
        ${input.organizationId}, ${label}, ${simplified}, ${full},
        ${noticeHash}, TRUE, ${input.publishedBy}
      )
      RETURNING id, organization_id, label, simplified_markdown, full_markdown,
                notice_hash, is_current, published_at
    `;
    await recordAudit(
      {
        organizationId: input.organizationId,
        accountId: input.publishedBy,
        actorName: input.publishedByName,
        actorKind: "platform",
        action: "aviso_privacidad_publicado",
        subjectType: "privacy_notice_version",
        subjectId: row.id,
        payload: { label, noticeHash },
      },
      tx
    );
    return toPrivacyNotice(row);
  });
}
