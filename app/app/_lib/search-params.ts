import { CONTRACT_STATUS_LABELS, type ContractStatus } from "@/lib/domain/types";
import { asUuid } from "@/lib/uuid";

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface PortalSearchFilters {
  query: string;
  status?: ContractStatus;
  templateId?: string;
  folderId?: string;
  emitterId?: string;
  from?: string;
  to?: string;
  page: number;
}

export function single(params: RawSearchParams, key: string): string {
  const value = params[key];
  if (Array.isArray(value)) return (value[0] ?? "").trim();
  return (value ?? "").trim();
}

export function optional(params: RawSearchParams, key: string): string | undefined {
  const value = single(params, key);
  return value === "" ? undefined : value;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Los filtros y la página viven en la URL: la vista siempre es compartible. */
export function parseSearchFilters(params: RawSearchParams): PortalSearchFilters {
  const status = single(params, "estado");
  const from = single(params, "desde");
  const to = single(params, "hasta");
  const page = Number.parseInt(single(params, "page"), 10);
  return {
    query: single(params, "q"),
    status:
      status in CONTRACT_STATUS_LABELS ? (status as ContractStatus) : undefined,
    // Un identificador mal formado se descarta: la lista responde sin filtro.
    templateId: asUuid(optional(params, "plantilla")),
    folderId: asUuid(optional(params, "carpeta")),
    emitterId: asUuid(optional(params, "emisor")),
    from: ISO_DATE.test(from) ? from : undefined,
    to: ISO_DATE.test(to) ? to : undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Filtros vigentes en el formato que espera `Pagination`. */
export function toPaginationParams(
  filters: PortalSearchFilters
): Record<string, string | undefined> {
  return {
    q: filters.query || undefined,
    estado: filters.status,
    plantilla: filters.templateId,
    carpeta: filters.folderId,
    emisor: filters.emitterId,
    desde: filters.from,
    hasta: filters.to,
  };
}

export function hasActiveFilters(filters: PortalSearchFilters): boolean {
  return Boolean(
    filters.query ||
      filters.status ||
      filters.templateId ||
      filters.folderId ||
      filters.emitterId ||
      filters.from ||
      filters.to
  );
}
