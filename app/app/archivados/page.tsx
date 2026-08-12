import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { loadContractIndex } from "@/app/app/_lib/portal-queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ContractFilters } from "@/app/app/_components/contract-filters";
import { ContractResults } from "@/app/app/_components/contract-results";
import { ActionForm } from "@/app/app/_components/action-form";
import { restaurarExpediente } from "@/app/app/archivados/actions";
import {
  parseSearchFilters,
  toPaginationParams,
  type RawSearchParams,
} from "@/app/app/_lib/search-params";

const BASE_PATH = "/app/archivados";

export default async function ArchivedPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const context = await requireOrganizationContext();
  requireRole(context, "administrator", "emitter");
  const filters = parseSearchFilters(await searchParams);

  const { templates, folders, result } = await loadContractIndex(
    context,
    filters,
    "archived"
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Archivados"
        description="Archivar es reversible: no cambia el Estado contractual, el enlace, la evidencia o la conservación."
      />

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
          emptyTitle="Sin expedientes archivados"
          emptyDescription="Los expedientes que archives aparecerán aquí y seguirán disponibles en el buscador."
          renderAction={(row) => (
            <ActionForm
              action={restaurarExpediente}
              submitLabel="Restaurar"
              variant="secondary"
              className="inline-flex"
              hidden={{ contractId: row.id }}
            />
          )}
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
