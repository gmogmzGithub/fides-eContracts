import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select, TextInput } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import {
  ATTEMPT_STATUS_LABELS,
  DECISION_LABELS,
} from "@/lib/domain/labels";
import { recordAudit } from "@/lib/domain/operations";
import {
  EVIDENCE_LABELS,
  REPEAT_REASON_LABELS,
  REVIEW_POLICY_LABELS,
  type Classification,
  type RepeatReasonCode,
} from "@/lib/domain/types";
import { formatBytes, formatDateTime } from "@/lib/format";
import {
  getSupportContractDetail,
  listOrganizationOptions,
  searchContractsAcrossOrganizations,
} from "@/app/plataforma/queries";

interface Props {
  searchParams: Promise<{
    q?: string;
    organizacion?: string;
    contrato?: string;
  }>;
}

const CLASSIFICATION_LABELS: Record<Classification, string> = {
  active: "Activo",
  archived: "Archivado",
  deleted: "Eliminado",
};

const ORIGIN_REASON_LABELS: Record<string, string> = {
  duplicate: "Duplicado para corregir",
  successor: "Creado después del vencimiento",
};

function reasonLabel(code: string | null): string {
  if (!code) return "—";
  return REPEAT_REASON_LABELS[code as RepeatReasonCode] ?? code;
}

export default async function SoportePage({ searchParams }: Props) {
  const account = await requirePlatformAdmin();
  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const organizationId = params.organizacion || undefined;
  const contractId = params.contrato || undefined;

  const organizations = await listOrganizationOptions();
  const searched = Boolean(query || organizationId);
  const results = searched
    ? await searchContractsAcrossOrganizations({ query, organizationId })
    : [];

  // El acceso global existe sólo para soporte y bajo auditoría (ADR-0040/0041).
  if (searched) {
    await recordAudit({
      organizationId: organizationId ?? null,
      accountId: account.accountId,
      actorName: account.fullName,
      actorKind: "platform",
      capability: "platform_admin",
      action: "soporte_busqueda_contratos",
      subjectType: "contract_search",
      subjectId: null,
      payload: { referencia: query, resultados: results.length },
    });
  }

  const detail = contractId ? await getSupportContractDetail(contractId) : null;

  if (detail) {
    await recordAudit({
      organizationId: detail.organizationId,
      accountId: account.accountId,
      actorName: account.fullName,
      actorKind: "platform",
      capability: "platform_admin",
      action: "soporte_consulta_contrato",
      subjectType: "contract",
      subjectId: detail.id,
      payload: { referencia: detail.reference, proposito: "soporte" },
    });
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Soporte y diagnóstico de Contratos"
        description="Consulta transversal de cualquier Contrato de cualquier Organización. Cada búsqueda y cada consulta queda registrada en la auditoría con tu identidad real."
      />

      <Card>
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <Field
              label="Referencia contractual"
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
              <LinkButton href="/plataforma/soporte" variant="ghost">
                Limpiar
              </LinkButton>
            ) : null}
          </form>
        </CardBody>
      </Card>

      {searched ? (
        <Card>
          <CardHeader
            title="Resultados"
            description="Se muestran hasta 50 Contratos ordenados por fecha de emisión."
          />
          <CardBody>
            {results.length === 0 ? (
              <EmptyState
                title="Sin coincidencias"
                description="Revisa la Referencia contractual o cambia la Organización."
              />
            ) : (
              <Table className="border-0 shadow-none">
                <THead>
                  <Tr>
                    <Th>Referencia</Th>
                    <Th>Organización</Th>
                    <Th>Estado</Th>
                    <Th>Clasificación</Th>
                    <Th>Contrato-plantilla</Th>
                    <Th>Emitido</Th>
                    <Th>Diagnóstico</Th>
                  </Tr>
                </THead>
                <TBody>
                  {results.map((row) => (
                    <Tr key={row.id}>
                      <Td>
                        <span className="font-mono text-sm text-carbon">
                          {row.reference}
                        </span>
                      </Td>
                      <Td>{row.organizationName}</Td>
                      <Td>
                        <StatusBadge status={row.status} />
                      </Td>
                      <Td>{CLASSIFICATION_LABELS[row.classification]}</Td>
                      <Td>{row.templateName}</Td>
                      <Td>{formatDateTime(row.issuedAt)}</Td>
                      <Td>
                        <Link
                          href={`/plataforma/soporte?q=${encodeURIComponent(query)}&organizacion=${encodeURIComponent(organizationId ?? "")}&contrato=${row.id}`}
                          className="cursor-pointer font-medium text-carbon underline underline-offset-2 transition-colors duration-200 hover:text-accent-strong"
                        >
                          Abrir
                        </Link>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      ) : (
        <EmptyState
          title="Busca un Contrato por su Referencia"
          description="Esta pantalla existe para atender soporte e incidentes; no sustituye el portal de la Organización."
        />
      )}

      {contractId && !detail ? (
        <Alert tone="warn" title="No encontramos ese Contrato">
          El identificador puede ser incorrecto o el registro pudo eliminarse
          conforme a las políticas de conservación.
        </Alert>
      ) : null}

      {detail ? (
        <div className="grid gap-6">
          <Card>
            <CardHeader
              title={detail.reference}
              description={`${detail.organizationName} · ${detail.templateName} · emitido por ${detail.createdByName}`}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={detail.status} />
                  <Badge tone="neutral">
                    {CLASSIFICATION_LABELS[detail.classification]}
                  </Badge>
                  <LinkButton
                    href={`/plataforma/organizaciones/${detail.organizationId}`}
                    variant="secondary"
                    size="sm"
                  >
                    Ver Organización
                  </LinkButton>
                </div>
              }
            />
            <CardBody>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                    Publicación de plantilla usada
                  </dt>
                  <dd className="mt-1 text-sm text-carbon">
                    Versión {detail.templateLabel}
                    <span className="block text-xs text-muted">
                      Publicada{" "}
                      {formatDateTime(detail.templateVersionPublishedAt)}
                    </span>
                    <code className="mt-1 block text-xs break-all text-muted">
                      {detail.templateVersionHash}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                    Publicación de Aviso de Privacidad usada
                  </dt>
                  <dd className="mt-1 text-sm text-carbon">
                    Versión {detail.privacyLabel}
                    <span className="block text-xs text-muted">
                      Publicada {formatDateTime(detail.privacyPublishedAt)}
                    </span>
                    <code className="mt-1 block text-xs break-all text-muted">
                      {detail.privacyHash}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                    Huella documental
                  </dt>
                  <dd className="mt-1">
                    <code className="block text-xs break-all text-muted">
                      {detail.documentHash}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                    Configuración efectiva
                  </dt>
                  <dd className="mt-1 text-sm text-carbon">
                    Vigencia {detail.linkDays} días ·{" "}
                    {REVIEW_POLICY_LABELS[detail.reviewPolicy]}
                    <span className="block text-xs text-muted">
                      Video: {detail.requiresVideo ? "sí" : "no"} · INE:{" "}
                      {detail.requiresIne ? "sí" : "no"} ·{" "}
                      {detail.customized
                        ? "sustituyó los predeterminados"
                        : "usó los predeterminados"}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                    Emisión
                  </dt>
                  <dd className="mt-1 text-sm text-carbon">
                    {formatDateTime(detail.issuedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                    Cierre
                  </dt>
                  <dd className="mt-1 text-sm text-carbon">
                    {detail.acceptedAt
                      ? `Aceptado ${formatDateTime(detail.acceptedAt)}`
                      : detail.cancelledAt
                        ? `Cancelado ${formatDateTime(detail.cancelledAt)}`
                        : detail.expiredAt
                          ? `Vencido ${formatDateTime(detail.expiredAt)}`
                          : "Sin cierre"}
                    {detail.cancelReason ? (
                      <span className="block text-xs text-muted">
                        Motivo: {detail.cancelReason}
                      </span>
                    ) : null}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Relación técnica de origen"
              description="Información interna del Proveedor. La Organización no la ve."
            />
            <CardBody>
              <p className="text-sm text-carbon">
                {detail.origin ? (
                  <>
                    Se originó del Contrato{" "}
                    <Link
                      href={`/plataforma/soporte?contrato=${detail.origin.contractId}`}
                      className="cursor-pointer font-mono underline underline-offset-2 transition-colors duration-200 hover:text-accent-strong"
                    >
                      {detail.origin.reference}
                    </Link>{" "}
                    ({detail.origin.organizationName}) ·{" "}
                    {detail.origin.reason
                      ? (ORIGIN_REASON_LABELS[detail.origin.reason] ??
                        detail.origin.reason)
                      : "sin motivo registrado"}
                    .
                  </>
                ) : (
                  "Sin Contrato de origen: se creó directamente."
                )}
              </p>
              {detail.successors.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                    Contratos originados desde éste
                  </p>
                  <ul className="mt-1 grid gap-1 text-sm">
                    {detail.successors.map((item) => (
                      <li key={item.id}>
                        <Link
                          href={`/plataforma/soporte?contrato=${item.id}`}
                          className="cursor-pointer font-mono underline underline-offset-2 transition-colors duration-200 hover:text-accent-strong"
                        >
                          {item.reference}
                        </Link>
                        <span className="ml-2 text-muted">
                          {item.reason
                            ? (ORIGIN_REASON_LABELS[item.reason] ?? item.reason)
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Partes" />
            <CardBody>
              {detail.parties.length === 0 ? (
                <p className="text-sm text-muted">
                  Sin instantánea de partes.
                </p>
              ) : (
                <Table className="border-0 shadow-none">
                  <THead>
                    <Tr>
                      <Th>Papel</Th>
                      <Th>Nombre</Th>
                      <Th>Tipo</Th>
                      <Th>RFC</Th>
                      <Th>Contacto</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {detail.parties.map((party) => (
                      <Tr key={party.role}>
                        <Td>
                          {party.role === "holder" ? "Titular" : "Firmante"}
                        </Td>
                        <Td>{party.name}</Td>
                        <Td>
                          {party.personKind === "fisica"
                            ? "Persona física"
                            : "Persona moral"}
                        </Td>
                        <Td>{party.rfc ?? "—"}</Td>
                        <Td>
                          {party.email ?? "—"}
                          {party.phone ? (
                            <span className="block text-xs text-muted">
                              {party.phone}
                            </span>
                          ) : null}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Intentos de aceptación" />
            <CardBody>
              {detail.attempts.length === 0 ? (
                <p className="text-sm text-muted">Sin intentos.</p>
              ) : (
                <div className="grid gap-4">
                  {detail.attempts.map((attempt) => (
                    <div
                      key={attempt.id}
                      className="rounded-xl border border-line p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-carbon">
                          Intento {attempt.sequence}
                        </p>
                        <Badge tone="neutral">
                          {ATTEMPT_STATUS_LABELS[attempt.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        Creado {formatDateTime(attempt.createdAt)} · Contrato
                        recorrido {formatDateTime(attempt.walkedAt)} · Enviado{" "}
                        {formatDateTime(attempt.submittedAt)} · Cerrado{" "}
                        {formatDateTime(attempt.closedAt)}
                        {attempt.replacesAttemptId
                          ? " · sucede a un intento anterior"
                          : ""}
                      </p>
                      {attempt.evidence.length > 0 ? (
                        <ul className="mt-2 grid gap-1 text-xs text-carbon-soft">
                          {attempt.evidence.map((item) => (
                            <li key={`${attempt.id}-${item.kind}`}>
                              {EVIDENCE_LABELS[item.kind]} ·{" "}
                              {formatBytes(item.byteSize)} ·{" "}
                              <code className="break-all">{item.sha256}</code>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-muted">
                          Sin evidencia registrada en este intento.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Enlaces"
              description="Se muestra que el enlace existe, su vigencia y su revocación. Nunca se imprime el token del Firmante."
            />
            <CardBody>
              {detail.links.length === 0 ? (
                <p className="text-sm text-muted">Sin enlaces emitidos.</p>
              ) : (
                <Table className="border-0 shadow-none">
                  <THead>
                    <Tr>
                      <Th>Creado</Th>
                      <Th>Vence</Th>
                      <Th>Primera apertura</Th>
                      <Th>Estado</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {detail.links.map((link) => (
                      <Tr key={link.id}>
                        <Td>{formatDateTime(link.createdAt)}</Td>
                        <Td>{formatDateTime(link.expiresAt)}</Td>
                        <Td>{formatDateTime(link.firstOpenedAt)}</Td>
                        <Td>
                          {link.revokedAt
                            ? `Revocado ${formatDateTime(link.revokedAt)}`
                            : link.expired
                              ? "Vencido"
                              : "Vigente"}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Decisiones de revisión"
              description="El agente AI recomienda; una persona con rol Revisor decide."
            />
            <CardBody>
              {detail.decisions.length === 0 ? (
                <p className="text-sm text-muted">
                  Sin decisiones registradas.
                </p>
              ) : (
                <Table className="border-0 shadow-none">
                  <THead>
                    <Tr>
                      <Th>Fecha y hora</Th>
                      <Th>Decisión</Th>
                      <Th>Revisor</Th>
                      <Th>Motivo</Th>
                      <Th>Siguió la recomendación AI</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {detail.decisions.map((decision) => (
                      <Tr key={decision.id}>
                        <Td>{formatDateTime(decision.createdAt)}</Td>
                        <Td>{DECISION_LABELS[decision.decision]}</Td>
                        <Td>{decision.reviewerName}</Td>
                        <Td>
                          {reasonLabel(decision.reasonCode)}
                          {decision.reasonText ? (
                            <span className="block text-xs text-muted">
                              {decision.reasonText}
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          {decision.followedAiRecommendation === null
                            ? "—"
                            : decision.followedAiRecommendation
                              ? "Sí"
                              : "No"}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}

              {detail.aiReports.length > 0 ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                    Reportes del agente AI
                  </p>
                  <ul className="mt-1 grid gap-1 text-sm text-carbon-soft">
                    {detail.aiReports.map((report) => (
                      <li key={report.id}>
                        {formatDateTime(report.createdAt)} · {report.model} ·{" "}
                        {report.status === "completed"
                          ? `recomendación ${report.recommendation ?? "—"}`
                          : "falla del proveedor"}
                        {report.confidence
                          ? ` · confianza ${report.confidence}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Línea de tiempo" />
            <CardBody>
              {detail.events.length === 0 ? (
                <p className="text-sm text-muted">Sin eventos.</p>
              ) : (
                <Table className="border-0 shadow-none">
                  <THead>
                    <Tr>
                      <Th>Fecha y hora</Th>
                      <Th>Evento</Th>
                      <Th>Actor</Th>
                      <Th>Sensible</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {detail.events.map((event) => (
                      <Tr key={event.id}>
                        <Td>{formatDateTime(event.createdAt)}</Td>
                        <Td>
                          <code className="text-xs text-carbon-soft">
                            {event.type}
                          </code>
                        </Td>
                        <Td>
                          {event.actorName || "—"}
                          <span className="block text-xs text-muted">
                            {event.actorKind}
                          </span>
                        </Td>
                        <Td>{event.sensitive ? "Sí" : "No"}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Paquete contractual frío"
              action={
                <LinkButton
                  href={`/plataforma/archivo-muerto?organizacion=${detail.organizationId}&q=${encodeURIComponent(detail.reference)}`}
                  variant="secondary"
                  size="sm"
                >
                  Ver en Archivo Muerto
                </LinkButton>
              }
            />
            <CardBody>
              {detail.coldPackage ? (
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                      Huella del paquete
                    </dt>
                    <dd className="mt-1">
                      <code className="block text-xs break-all text-muted">
                        {detail.coldPackage.sha256}
                      </code>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                      Tamaño
                    </dt>
                    <dd className="mt-1 text-sm text-carbon">
                      {formatBytes(detail.coldPackage.byteSize)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                      Nivel
                    </dt>
                    <dd className="mt-1 text-sm text-carbon">
                      {detail.coldPackage.tier === "cold"
                        ? "Archivo Muerto"
                        : "Acceso inmediato"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                      Fecha de cierre contractual
                    </dt>
                    <dd className="mt-1 text-sm text-carbon">
                      {formatDateTime(detail.coldPackage.closedAt)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-muted">
                  Todavía no se sella un paquete frío para este Contrato.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
