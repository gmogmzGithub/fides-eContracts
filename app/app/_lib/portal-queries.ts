import "server-only";

import type { OrganizationContext } from "@/lib/auth/guards";
import { listFolders } from "@/lib/domain/contracts";
import {
  searchContracts,
  type ContractSearchResult,
} from "@/lib/domain/search";
import { listTemplateOptions } from "@/lib/domain/templates";
import type { FilterOption } from "@/app/app/_components/contract-filters";
import type { PortalSearchFilters } from "@/app/app/_lib/search-params";
import type { Classification } from "@/lib/domain/types";

/**
 * El portal consume las mismas funciones de dominio que el resto del producto.
 * Este módulo sólo reexporta lo que sus pantallas necesitan.
 */

export {
  buildContractPdf,
  buildContractPdfForToken,
  type ContractPdfResult,
} from "@/lib/domain/documents";
export {
  updateOrganizationDefaults,
  type OrganizationDefaultsPatch,
} from "@/lib/domain/settings";

export interface ContractIndex {
  templates: FilterOption[];
  folders: FilterOption[];
  result: ContractSearchResult;
}

/**
 * Carga compartida de `Contratos`, `Archivados` y `Eliminados`: las tres
 * pantallas son el mismo índice sobre una clasificación distinta, así que
 * agregar una dimensión de filtro se hace en un solo lugar.
 */
export async function loadContractIndex(
  context: OrganizationContext,
  filters: PortalSearchFilters,
  classification: Classification
): Promise<ContractIndex> {
  const [templates, folders, result] = await Promise.all([
    listTemplateOptions(context.organization.id),
    listFolders(context.organization.id),
    searchContracts(context, { ...filters, classification }),
  ]);

  return {
    templates,
    folders: folders.map((folder) => ({ id: folder.id, name: folder.name })),
    result,
  };
}
