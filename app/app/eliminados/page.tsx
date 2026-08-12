import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { loadContractIndex } from "@/app/app/_lib/portal-queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Alert } from "@/components/ui/alert";
import { ContractFilters } from "@/app/app/_components/contract-filters";
import { ContractResults } from "@/app/app/_components/contract-results";
import {
  parseSearchFilters,
  toPaginationParams,
  type RawSearchParams,
} from "@/app/app/_lib/search-params";

const BASE_PATH = "/app/eliminados";

export default async function DeletedPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const context = await requireOrganizationContext();
  // El rol Revisor por sí solo no abre esta sección.
  requireRole(context, "administrator", "emitter");
  const filters = parseSearchFilters(await searchParams);

  const { templates, folders, result } = await loadContractIndex(
    context,
    filters,
    "deleted"
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Eliminados"
        description="Índice de metadatos mínimos de los asuntos retirados del portal."
      />

      <Alert tone="info">
        Estos asuntos ya no se consultan, descargan o exportan desde la
        plataforma y no pueden restaurarse aquí. Cualquier necesidad posterior se
        solicita y valida fuera del portal por el canal externo acordado.
      </Alert>

      <ContractFilters
        basePath={BASE_PATH}
        filters={filters}
        templates={templates}
        folders={folders}
        showAdvanced={Boolean(filters.query && result.total > 0)}
      />

      <section className="space-y-4">
        <ContractResults
          rows={result.rows}
          linkToFile={false}
          emptyTitle="Sin asuntos eliminados"
          emptyDescription="Aquí aparecerán los asuntos que un Administrador elimine."
        />
        <Pagination
          page={result.page}
          pages={result.pages}
          total={result.total}
          basePath={BASE_PATH}
          params={toPaginationParams(filters)}
        />
      </section>
    </div>
  );
}
