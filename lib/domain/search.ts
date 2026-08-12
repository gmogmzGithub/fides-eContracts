import "server-only";
import { sql } from "@/lib/db";
import type { OrganizationContext } from "@/lib/auth/guards";
import { requireRole } from "@/lib/auth/guards";
import type {
  Classification,
  ContractStatus,
  ReviewPolicy,
} from "@/lib/domain/types";
import { PAGE_SIZE } from "@/lib/domain/types";
import type { FieldDefinition } from "@/lib/domain/templates";
import { formatFieldValue, toStringMap } from "@/lib/domain/templates";

/** Máximo de Campos contractuales destacados por Contrato-plantilla. */
export const MAX_HIGHLIGHTED_FIELDS = 3;

export interface HighlightedValue {
  label: string;
  value: string;
}

export interface ContractRow {
  id: string;
  reference: string;
  status: ContractStatus;
  templateId: string;
  templateName: string;
  holderName: string;
  signerName: string;
  emitterName: string;
  folderId: string | null;
  folderName: string | null;
  issuedAt: Date;
  updatedAt: Date;
  classification: Classification;
  highlighted: HighlightedValue[];
}

export interface ContractSearchParams {
  query?: string;
  classification: Classification;
  status?: ContractStatus;
  templateId?: string;
  folderId?: string;
  emitterId?: string;
  /** `AAAA-MM-DD`, sobre la fecha de emisión. */
  from?: string;
  to?: string;
  page?: number;
}

export interface ContractSearchResult {
  rows: ContractRow[];
  total: number;
  page: number;
  pages: number;
}

export interface EmitterOption {
  id: string;
  name: string;
}

interface SearchRow {
  id: string;
  reference: string;
  status: ContractStatus;
  template_id: string;
  template_name: string;
  field_values: unknown;
  holder_name: string | null;
  signer_name: string | null;
  emitter_name: string;
  folder_id: string | null;
  folder_name: string | null;
  issued_at: Date;
  updated_at: Date;
  classification: Classification;
  total: string | number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** El buscador general pertenece a quienes administran o emiten Contratos. */
export function assertClassificationAccess(context: OrganizationContext): void {
  requireRole(context, "administrator", "emitter");
}

/**
 * Buscador contractual. Siempre acotado a la Organización activa resuelta en
 * servidor: nunca a un identificador enviado por el navegador.
 */
export async function searchContracts(
  context: OrganizationContext,
  params: ContractSearchParams
): Promise<ContractSearchResult> {
  assertClassificationAccess(context);
  const organizationId = context.organization.id;
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const offset = (page - 1) * PAGE_SIZE;

  const query = (params.query ?? "").trim();
  const pattern = query ? likePattern(query) : null;
  const from = params.from && ISO_DATE.test(params.from) ? params.from : null;
  const to = params.to && ISO_DATE.test(params.to) ? params.to : null;

  const rows = await sql<SearchRow[]>`
    SELECT
      c.id, c.reference, c.status, c.template_id, c.template_name,
      c.field_values, h.name AS holder_name, s.name AS signer_name,
      c.created_by_name AS emitter_name, c.folder_id, f.name AS folder_name,
      c.issued_at, c.updated_at, c.classification,
      COUNT(*) OVER () AS total
    FROM contracts c
    LEFT JOIN contract_folders f ON f.id = c.folder_id
    LEFT JOIN contract_parties h
      ON h.contract_id = c.id AND h.party_role = 'holder'
    LEFT JOIN contract_parties s
      ON s.contract_id = c.id AND s.party_role = 'signer'
    WHERE c.organization_id = ${organizationId}
      AND c.classification = ${params.classification}
      AND (${params.status ?? null}::text IS NULL
           OR c.status = ${params.status ?? null})
      AND (${params.templateId ?? null}::uuid IS NULL
           OR c.template_id = ${params.templateId ?? null})
      AND (${params.folderId ?? null}::uuid IS NULL
           OR c.folder_id = ${params.folderId ?? null})
      AND (${params.emitterId ?? null}::uuid IS NULL
           OR c.created_by = ${params.emitterId ?? null})
      AND (${from}::date IS NULL OR c.issued_at >= ${from}::date)
      AND (${to}::date IS NULL OR c.issued_at < ${to}::date + INTERVAL '1 day')
      AND (${pattern}::text IS NULL
           OR c.reference ILIKE ${pattern}
           OR c.search_text ILIKE ${pattern}
           OR COALESCE(h.name, '') ILIKE ${pattern}
           OR COALESCE(s.name, '') ILIKE ${pattern})
    ORDER BY GREATEST(c.updated_at, c.issued_at) DESC, c.issued_at DESC, c.reference DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `;

  const total = rows.length > 0 ? Number(rows[0].total) : 0;
  const highlighted = await loadHighlightedFields(
    [...new Set(rows.map((row) => row.template_id))]
  );

  return {
    rows: rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      status: row.status,
      templateId: row.template_id,
      templateName: row.template_name,
      holderName: row.holder_name ?? "",
      signerName: row.signer_name ?? "",
      emitterName: row.emitter_name,
      folderId: row.folder_id,
      folderName: row.folder_name,
      issuedAt: row.issued_at,
      updatedAt: row.updated_at,
      classification: row.classification,
      highlighted: buildHighlighted(
        highlighted.get(row.template_id) ?? [],
        toStringMap(row.field_values)
      ),
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

function buildHighlighted(
  fields: FieldDefinition[],
  values: Record<string, string>
): HighlightedValue[] {
  return fields
    .map((field) => ({
      label: field.label,
      value: formatFieldValue(field, values[field.key] ?? "", values),
    }))
    .filter((item) => item.value !== "");
}

/** Un campo destacado jamás proviene de INE, video u otra evidencia. */
async function loadHighlightedFields(
  templateIds: string[]
): Promise<Map<string, FieldDefinition[]>> {
  const result = new Map<string, FieldDefinition[]>();
  if (templateIds.length === 0) return result;
  const rows = await sql<
    {
      id: string;
      template_id: string;
      key: string;
      label: string;
      help_text: string;
      data_type: FieldDefinition["dataType"];
      required: boolean;
      options: unknown;
      searchable: boolean;
      highlighted: boolean;
      position: number;
    }[]
  >`
    SELECT id, template_id, key, label, help_text, data_type, required,
           options, searchable, highlighted, position
    FROM contract_field_definitions
    WHERE template_id = ANY(${templateIds}::uuid[]) AND highlighted
    ORDER BY position, label
  `;
  for (const row of rows) {
    const list = result.get(row.template_id) ?? [];
    if (list.length >= MAX_HIGHLIGHTED_FIELDS) continue;
    list.push({
      id: row.id,
      key: row.key,
      label: row.label,
      helpText: row.help_text,
      dataType: row.data_type,
      required: row.required,
      options: Array.isArray(row.options)
        ? row.options.filter((item): item is string => typeof item === "string")
        : [],
      searchable: row.searchable,
      highlighted: row.highlighted,
      position: row.position,
    });
    result.set(row.template_id, list);
  }
  return result;
}

/** Opciones del filtro `Emisor`, tomadas de los Contratos ya emitidos. */
export async function listEmitters(
  context: OrganizationContext
): Promise<EmitterOption[]> {
  requireRole(context, "administrator", "emitter");
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT DISTINCT c.created_by AS id, c.created_by_name AS name
    FROM contracts c
    WHERE c.organization_id = ${context.organization.id}
      AND c.created_by IS NOT NULL
    ORDER BY name
  `;
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export interface ContractCounts {
  active: number;
  archived: number;
  deleted: number;
  pending: number;
  inReview: number;
}

export async function countContracts(
  context: OrganizationContext
): Promise<ContractCounts> {
  requireRole(context, "administrator", "emitter");
  const [row] = await sql<
    {
      active: string;
      archived: string;
      deleted: string;
      pending: string;
      in_review: string;
    }[]
  >`
    SELECT
      COUNT(*) FILTER (WHERE classification = 'active') AS active,
      COUNT(*) FILTER (WHERE classification = 'archived') AS archived,
      COUNT(*) FILTER (WHERE classification = 'deleted') AS deleted,
      COUNT(*) FILTER (WHERE classification <> 'deleted' AND status = 'pending')
        AS pending,
      COUNT(*) FILTER (WHERE classification <> 'deleted' AND status = 'in_review')
        AS in_review
    FROM contracts
    WHERE organization_id = ${context.organization.id}
  `;
  return {
    // Una agregación sin `GROUP BY` devuelve siempre exactamente una fila y
    // `COUNT(*)` nunca es NULL: `row?.` y `?? 0` son defensas que esta consulta
    // no puede alcanzar, así que sus ramas quedan fuera de la medición.
    /* v8 ignore next 5 -- ramas defensivas inalcanzables desde la consulta real */
    active: Number(row?.active ?? 0),
    archived: Number(row?.archived ?? 0),
    deleted: Number(row?.deleted ?? 0),
    pending: Number(row?.pending ?? 0),
    inReview: Number(row?.in_review ?? 0),
  };
}

export type { Classification, ContractStatus, ReviewPolicy };
