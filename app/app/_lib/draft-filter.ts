import type { DraftDetail } from "@/lib/domain/drafts";
import type { PortalSearchFilters } from "@/app/app/_lib/search-params";

/**
 * Los Borradores no son Contratos emitidos y no pasan por el buscador; aquí se
 * aplican los mismos filtros para que la lista principal sea coherente.
 */
export function filterDrafts(
  drafts: DraftDetail[],
  filters: PortalSearchFilters
): DraftDetail[] {
  const needle = filters.query.trim().toLowerCase();
  return drafts.filter((draft) => {
    if (filters.templateId && draft.templateId !== filters.templateId) return false;
    if (filters.folderId && draft.folderId !== filters.folderId) return false;
    if (!needle) return true;
    const haystack = [
      draft.template.name,
      draft.holder?.name ?? "",
      draft.signer?.name ?? "",
      draft.createdByName,
      ...Object.values(draft.fieldValues),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
