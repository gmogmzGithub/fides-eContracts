import Link from "next/link";
import { Star } from "lucide-react";
import {
  hasRole,
  requireOrganizationContext,
  requireRole,
} from "@/lib/auth/guards";
import { listRecentContracts } from "@/lib/domain/recent-contracts";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, TextInput } from "@/components/ui/field";
import { ActionForm } from "@/app/app/_components/action-form";
import type { RawSearchParams } from "@/app/app/_lib/search-params";
import { single } from "@/app/app/_lib/search-params";
import { crearDesdeContrato } from "@/app/app/_actions/contracts";
import { alternarFavorito } from "./actions";

const BASE_PATH = "/app/recientes";

export default async function RecentContractsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const context = await requireOrganizationContext();
  requireRole(context, "administrator", "emitter");
  const query = single(await searchParams, "q");
  const contracts = await listRecentContracts(context, query);
  const canCreate = hasRole(context, "emitter");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recientes"
        description="Crea un contrato nuevo a partir de datos que ya usaste. Fides nunca copia enlaces, evidencia o estados anteriores."
      />

      <form
        method="get"
        action={BASE_PATH}
        className="rounded-xl border border-line bg-white p-4 shadow-sm sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Buscador de contratos recientes" className="grow">
            <TextInput
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Referencia, empresa, persona o dato del contrato…"
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit">Buscar</Button>
            {query ? (
              <LinkButton href={BASE_PATH} variant="ghost">
                Limpiar
              </LinkButton>
            ) : null}
          </div>
        </div>
      </form>

      {contracts.length === 0 ? (
        <EmptyState
          title={query ? "Sin coincidencias" : "Todavía no hay contratos recientes"}
          description={
            query
              ? "Limpia el buscador o prueba con otra referencia, empresa o persona."
              : "Cuando emitas el primer contrato podrás reutilizar sus datos desde aquí."
          }
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {contracts.map((contract) => (
            <li key={contract.id}>
              <Card className="h-full">
                <CardBody className="flex h-full flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/app/contratos/${contract.id}`}
                        className="cursor-pointer font-display text-lg font-semibold text-carbon underline-offset-4 transition-colors duration-200 hover:text-accent-strong hover:underline"
                      >
                        {contract.templateName}
                      </Link>
                      <p className="mt-1 text-xs text-muted">
                        {contract.reference} · {formatDate(contract.issuedAt)}
                      </p>
                    </div>
                    <form action={alternarFavorito}>
                      <input type="hidden" name="contractId" value={contract.id} />
                      <input
                        type="hidden"
                        name="favorite"
                        value={contract.favorite ? "0" : "1"}
                      />
                      <button
                        type="submit"
                        aria-label={
                          contract.favorite
                            ? `Quitar ${contract.reference} de Favoritos`
                            : `Agregar ${contract.reference} a Favoritos`
                        }
                        title={contract.favorite ? "Quitar de Favoritos" : "Agregar a Favoritos"}
                        className="cursor-pointer rounded-lg p-2 text-muted transition-colors duration-200 hover:bg-accent-soft hover:text-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <Star
                          aria-hidden
                          className="size-5"
                          fill={contract.favorite ? "currentColor" : "none"}
                        />
                      </button>
                    </form>
                  </div>

                  <div className="grid gap-1 text-sm text-carbon-soft">
                    <p className="font-medium text-carbon">{contract.holderName}</p>
                    <p>Persona que aceptó: {contract.signerName}</p>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <StatusBadge status={contract.status} />
                    {contract.favorite ? (
                      <span className="text-xs font-medium text-accent-strong">Favorito</span>
                    ) : null}
                  </div>

                  {canCreate ? (
                    <ActionForm
                      action={crearDesdeContrato}
                      submitLabel="Crear otro con estos datos"
                      className="mt-auto"
                      hidden={{ contractId: contract.id }}
                    />
                  ) : null}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
