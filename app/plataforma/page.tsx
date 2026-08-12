import Link from "next/link";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { CAPABILITY_LABELS } from "@/lib/domain/types";
import { formatDate } from "@/lib/format";
import { CAPABILITY_ORDER, listOrganizationsOverview } from "./queries";

export const metadata: Metadata = {
  title: "Organizaciones · Administración de plataforma",
};

export default async function OrganizacionesPage() {
  const organizations = await listOrganizationsOverview();
  const sinAviso = organizations.filter((item) => !item.privacy?.complete);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Organizaciones"
        description="Capacidades contratadas, Asientos activos y estado de publicación del contenido jurídico de cada Organización."
      />

      {sinAviso.length > 0 ? (
        <Alert
          tone="danger"
          title="Hay Organizaciones sin Aviso de Privacidad vigente"
        >
          <p>
            Sin un Aviso de Privacidad vigente, el recorrido del Firmante falla
            cerrado antes de recopilar evidencia o aceptación y no se puede
            emitir un Contrato nuevo.
          </p>
          <ul className="mt-2 grid gap-1">
            {sinAviso.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/plataforma/avisos/${item.id}`}
                  className="cursor-pointer font-medium underline underline-offset-2 transition-colors duration-200 hover:text-carbon"
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {organizations.length === 0 ? (
        <EmptyState
          title="Todavía no hay Organizaciones"
          description="El alta de una Organización ocurre en la implementación contractual inicial, fuera de la aplicación."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {organizations.map((organization) => {
            const seatsFull = organization.activeSeats >= organization.seatLimit;
            const privacyOk = organization.privacy?.complete === true;
            const templatesPending =
              organization.templateCount > organization.publishedTemplateCount;
            return (
              <Card key={organization.id}>
                <CardHeader
                  title={
                    <Link
                      href={`/plataforma/organizaciones/${organization.id}`}
                      className="cursor-pointer transition-colors duration-200 hover:text-accent-strong"
                    >
                      {organization.name}
                    </Link>
                  }
                  description={`${organization.legalName} · ${organization.contractCount} Contratos emitidos`}
                  action={<Badge tone="neutral">{organization.slug}</Badge>}
                />
                <CardBody>
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                        Capacidades contratadas
                      </dt>
                      <dd className="mt-2 flex flex-wrap gap-1.5">
                        {CAPABILITY_ORDER.map((capability) => (
                          <Badge
                            key={capability}
                            tone={
                              organization.capabilities[capability]
                                ? "success"
                                : "neutral"
                            }
                          >
                            {CAPABILITY_LABELS[capability]}
                            {organization.capabilities[capability]
                              ? ""
                              : " · no"}
                          </Badge>
                        ))}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                        Asientos activos
                      </dt>
                      <dd
                        className={
                          seatsFull
                            ? "mt-2 text-sm font-medium text-warn"
                            : "mt-2 text-sm font-medium text-carbon"
                        }
                      >
                        {organization.activeSeats} de {organization.seatLimit}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                        Contratos-plantilla publicados
                      </dt>
                      <dd className="mt-2 text-sm text-carbon">
                        {organization.publishedTemplateCount} de{" "}
                        {organization.templateCount}
                        {templatesPending ? (
                          <span className="block text-xs text-warn">
                            Hay plantillas sin publicación vigente.
                          </span>
                        ) : null}
                      </dd>
                    </div>

                    <div className="sm:col-span-2">
                      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                        Aviso de Privacidad vigente
                      </dt>
                      <dd className="mt-2 text-sm">
                        {privacyOk && organization.privacy ? (
                          <span className="text-carbon">
                            Versión {organization.privacy.label} ·{" "}
                            {formatDate(organization.privacy.publishedAt)}
                          </span>
                        ) : (
                          <span className="font-medium text-danger">
                            Sin Aviso de Privacidad vigente: el recorrido del
                            Firmante falla cerrado.
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <LinkButton
                      href={`/plataforma/organizaciones/${organization.id}`}
                      size="sm"
                    >
                      Abrir Organización
                    </LinkButton>
                    <LinkButton
                      href={`/plataforma/avisos/${organization.id}`}
                      variant="secondary"
                      size="sm"
                    >
                      Editor de Aviso de Privacidad
                    </LinkButton>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted">
        Esta superficie no muestra planes, precios, contratación o facturación.
        Las capacidades se habilitan manualmente por acuerdo comercial externo.
      </p>
    </div>
  );
}
