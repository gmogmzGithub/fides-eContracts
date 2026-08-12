import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select, TextInput } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { searchColdArchive, type ColdArchiveRow } from "@/lib/domain/custody";
import { recordAudit } from "@/lib/domain/operations";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import {
  COLD_PACKAGE_STATE_LABELS,
  listColdRecoveryStates,
  listOrganizationOptions,
  type ColdPackageState,
  type ColdRecoveryState,
} from "@/app/plataforma/queries";
import { RecoverForm } from "./recover-form";

interface Props {
  searchParams: Promise<{
    q?: string;
    organizacion?: string;
    page?: string;
  }>;
}

const STATE_TONES: Record<ColdPackageState, BadgeTone> = {
  archived: "neutral",
  in_progress: "info",
  available: "success",
  failed: "danger",
};

export default async function ArchivoMuertoPage({ searchParams }: Props) {
  const account = await requirePlatformAdmin();
  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const organizationId = params.organizacion || undefined;
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const [organizations, archive] = await Promise.all([
    listOrganizationOptions(),
    searchColdArchive({ organizationId, query, page }),
  ]);

  const states = await listColdRecoveryStates(
    archive.rows.map((row) => row.contractId)
  );

  // La inspección del inventario también es acceso global y queda auditada.
  await recordAudit({
    organizationId: organizationId ?? null,
    accountId: account.accountId,
    actorName: account.fullName,
    actorKind: "platform",
    capability: "platform_admin",
    action: "archivo_muerto_consulta_inventario",
    subjectType: "cold_archive",
    subjectId: null,
    payload: { busqueda: query, pagina: page, resultados: archive.total },
  });

  const groups = new Map<
    string,
    { organizationName: string; rows: ColdArchiveRow[] }
  >();
  for (const row of archive.rows) {
    const group = groups.get(row.organizationId);
    if (group) group.rows.push(row);
    else
      groups.set(row.organizationId, {
        organizationName: row.organizationName,
        rows: [row],
      });
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Archivo Muerto"
        description="Inventario interno de Paquetes contractuales fríos, agrupado y buscable por Organización. Esta herramienta no existe para la Organización y no recibe ni da seguimiento a solicitudes externas."
      />

      <Alert tone="info" title="Estados internos del Proveedor">
        `Archivado`, `Recuperación en curso`, `Disponible hasta &lt;fecha&gt;` y
        `Recuperación fallida` son exclusivos de esta pantalla. El nivel de
        recuperación no se elige: `standard` con Custodia activa y `bulk` sin
        ella. Una operación en curso o una copia vigente impiden iniciar otra
        recuperación del mismo paquete.
      </Alert>

      <Card>
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <Field
              label="Referencia, plantilla u Organización"
              htmlFor="q"
              className="min-w-64 flex-1"
            >
              <TextInput
                id="q"
                name="q"
                defaultValue={query}
                placeholder="AC-20260801-0001"
                autoComplete="off"
              />
            </Field>
            <Field label="Organización" htmlFor="organizacion">
              <Select
                id="organizacion"
                name="organizacion"
                defaultValue={organizationId ?? ""}
                placeholder="Todas"
                options={organizations.map((organization) => ({
                  value: organization.id,
                  label: organization.name,
                }))}
              />
            </Field>
            <Button type="submit">Buscar</Button>
            {query || organizationId ? (
              <LinkButton href="/plataforma/archivo-muerto" variant="ghost">
                Limpiar
              </LinkButton>
            ) : null}
          </form>
        </CardBody>
      </Card>

      {archive.rows.length === 0 ? (
        <EmptyState
          title="Sin paquetes en el inventario"
          description="Un Paquete contractual frío existe después de que el Contrato cierra y el trabajo de sellado termina."
        />
      ) : (
        <div className="grid gap-6">
          {[...groups.entries()].map(([groupId, group]) => (
            <Card key={groupId}>
              <CardHeader
                title={group.organizationName}
                description={`${group.rows.length} paquete(s) en esta página`}
              />
              <CardBody>
                <div className="grid gap-4">
                  {group.rows.map((row) => {
                    const state: ColdRecoveryState | undefined = states.get(
                      row.contractId
                    );
                    const packageState: ColdPackageState =
                      state?.state ?? "archived";
                    const activeCustody = state?.activeCustody ?? false;
                    const blocked =
                      packageState === "in_progress" ||
                      packageState === "available";
                    const stateLabel =
                      packageState === "available" && state?.availableUntil
                        ? `Disponible hasta ${formatDate(state.availableUntil)}`
                        : COLD_PACKAGE_STATE_LABELS[packageState];

                    return (
                      <div
                        key={row.contractId}
                        className="rounded-xl border border-line p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-sm font-medium text-carbon">
                              {row.reference}
                            </p>
                            <p className="mt-1 text-xs text-muted">
                              Cierre contractual {formatDateTime(row.closedAt)}
                              {row.movedToColdAt
                                ? ` · pasó a Archivo Muerto ${formatDate(row.movedToColdAt)}`
                                : ""}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={STATE_TONES[packageState]}>
                              {stateLabel}
                            </Badge>
                            <Badge tone="neutral">
                              {row.tier === "cold"
                                ? "Archivo Muerto"
                                : "Acceso inmediato"}
                            </Badge>
                            <Badge tone={activeCustody ? "success" : "neutral"}>
                              {activeCustody
                                ? "Custodia activa"
                                : "Custodia fría base"}
                            </Badge>
                          </div>
                        </div>

                        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                          <div>
                            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                              Huella del paquete
                            </dt>
                            <dd className="mt-1">
                              <code className="block text-xs break-all text-muted">
                                {row.sha256}
                              </code>
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                              Tamaño
                            </dt>
                            <dd className="mt-1 text-sm text-carbon">
                              {formatBytes(row.byteSize)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                              Última recuperación
                            </dt>
                            <dd className="mt-1 text-sm text-carbon">
                              {state?.lastRecoveryAt
                                ? `${formatDateTime(state.lastRecoveryAt)} · ${state.lastRecoveryTier ?? "—"}`
                                : "Sin recuperaciones"}
                              {state?.lastRecoveryError ? (
                                <span className="block text-xs text-danger">
                                  {state.lastRecoveryError}
                                </span>
                              ) : null}
                            </dd>
                          </div>
                        </dl>

                        <div className="mt-4 border-t border-line pt-4">
                          <RecoverForm
                            contractId={row.contractId}
                            reference={row.reference}
                            retrievalTier={activeCustody ? "standard" : "bulk"}
                            blocked={blocked}
                            blockedReason={
                              packageState === "in_progress"
                                ? "hay una recuperación en curso"
                                : packageState === "available"
                                  ? "todavía hay una copia disponible"
                                  : undefined
                            }
                            failed={packageState === "failed"}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          ))}

          <Pagination
            page={archive.page}
            pages={archive.pages}
            total={archive.total}
            basePath="/plataforma/archivo-muerto"
            params={{ q: query, organizacion: organizationId }}
          />
        </div>
      )}
    </div>
  );
}
