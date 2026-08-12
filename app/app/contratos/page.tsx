import { hasRole, requireOrganizationContext } from "@/lib/auth/guards";
import { listDrafts } from "@/lib/domain/drafts";
import { listRecentContractAlerts } from "@/lib/domain/contract-alerts";
import { getContractAlertPreferences } from "@/lib/domain/settings";
import { loadContractIndex } from "@/app/app/_lib/portal-queries";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { ContractFilters } from "@/app/app/_components/contract-filters";
import { ContractResults } from "@/app/app/_components/contract-results";
import { DraftList } from "@/app/app/_components/draft-list";
import { ContractAlerts } from "@/app/app/_components/contract-alerts";
import {
  parseSearchFilters,
  toPaginationParams,
  type RawSearchParams,
} from "@/app/app/_lib/search-params";
import { filterDrafts } from "@/app/app/_lib/draft-filter";

const BASE_PATH = "/app/contratos";

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const context = await requireOrganizationContext();
  const filters = parseSearchFilters(await searchParams);

  const { templates, folders, result } = await loadContractIndex(
    context,
    filters,
    "active"
  );

  const seesDrafts =
    hasRole(context, "emitter") || hasRole(context, "administrator");
  const drafts =
    seesDrafts && filters.page === 1 && !filters.status
      ? filterDrafts(await listDrafts(context), filters)
      : [];
  const [alerts, alertPreferences] = await Promise.all([
    listRecentContractAlerts(context),
    getContractAlertPreferences(context.organization.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contratos"
        description="Expedientes de la Organización activa, con la actividad más reciente primero."
        actions={
          hasRole(context, "emitter") ? (
            <LinkButton href="/app/contratos/nuevo">Crear contrato</LinkButton>
          ) : null
        }
      />

      <ContractFilters
        basePath={BASE_PATH}
        filters={filters}
        templates={templates}
        folders={folders}
        showAdvanced={Boolean(filters.query && result.total > 0)}
      />

      <DraftList drafts={drafts} />

      <ContractAlerts
        alerts={alerts}
        preferences={alertPreferences}
        canConfigure={hasRole(context, "administrator")}
      />

      <section className="space-y-4">
        <ContractResults
          rows={result.rows}
          emptyTitle="Sin resultados"
          emptyDescription="Ajusta la búsqueda o los filtros para encontrar un expediente."
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
