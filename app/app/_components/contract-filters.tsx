import { CONTRACT_STATUS_LABELS } from "@/lib/domain/types";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Button, LinkButton } from "@/components/ui/button";
import type { PortalSearchFilters } from "@/app/app/_lib/search-params";
import { hasActiveFilters } from "@/app/app/_lib/search-params";

export interface FilterOption {
  id: string;
  name: string;
}

function toOptions(items: FilterOption[]) {
  return items.map((item) => ({ value: item.id, label: item.name }));
}

/**
 * Buscador contractual. Es un formulario `GET`: los filtros y la página viven
 * en la URL y la búsqueda siempre queda limitada a la Organización activa.
 */
export function ContractFilters({
  basePath,
  filters,
  templates,
  folders,
  showStatus = true,
  showAdvanced = false,
}: {
  basePath: string;
  filters: PortalSearchFilters;
  templates: FilterOption[];
  folders: FilterOption[];
  showStatus?: boolean;
  showAdvanced?: boolean;
}) {
  const activeFolder = folders.find((folder) => folder.id === filters.folderId);
  return (
    <form
      method="get"
      action={basePath}
      className="space-y-4 rounded-xl border border-line bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="grid gap-1">
        <h2 className="font-display text-lg font-semibold text-carbon">
          Buscador de Contratos
        </h2>
        <p className="text-xs leading-relaxed text-muted">
          Busca por referencia, empresa, persona o cualquier dato marcado como
          buscable en el Contrato.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Buscar" htmlFor="q" className="grow">
          <TextInput
            id="q"
            name="q"
            type="search"
            defaultValue={filters.query}
            placeholder="AC-20260801-0001, empresa, placas, folio…"
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit">Buscar</Button>
          {hasActiveFilters(filters) ? (
            <LinkButton href={basePath} variant="ghost">
              Limpiar
            </LinkButton>
          ) : null}
        </div>
      </div>

      {activeFolder && !showAdvanced ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-carbon-soft">
          <span>
            Carpeta: <strong className="text-carbon">{activeFolder.name}</strong>
          </span>
          <LinkButton href={basePath} variant="ghost" size="sm">
            Ver todos
          </LinkButton>
        </div>
      ) : null}

      {showAdvanced ? (
        <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Contrato-plantilla" htmlFor="plantilla">
          <Select
            id="plantilla"
            name="plantilla"
            placeholder="Todos"
            options={toOptions(templates)}
            defaultValue={filters.templateId ?? ""}
          />
        </Field>

        {showStatus ? (
          <Field label="Estatus" htmlFor="estado">
            <Select
              id="estado"
              name="estado"
              placeholder="Todos"
              options={Object.entries(CONTRACT_STATUS_LABELS).map(
                ([value, label]) => ({ value, label })
              )}
              defaultValue={filters.status ?? ""}
            />
          </Field>
        ) : null}

        <Field label="Carpeta" htmlFor="carpeta">
          <Select
            id="carpeta"
            name="carpeta"
            placeholder="Todas"
            options={toOptions(folders)}
            defaultValue={filters.folderId ?? ""}
          />
        </Field>

        <Field label="Desde" htmlFor="desde">
          <TextInput id="desde" name="desde" type="date" defaultValue={filters.from ?? ""} />
        </Field>

        <Field label="Hasta" htmlFor="hasta">
          <TextInput id="hasta" name="hasta" type="date" defaultValue={filters.to ?? ""} />
        </Field>
        </div>
      ) : null}
    </form>
  );
}
