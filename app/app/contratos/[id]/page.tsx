import { notFound } from "next/navigation";
import { requireOrganizationContext } from "@/lib/auth/guards";
import {
  getContractDetail,
  listFolders,
  type AttemptDetail,
  type ContractPartyDetail,
} from "@/lib/domain/contracts";
import { getCustodyState } from "@/lib/domain/custody";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import { formatFieldValue } from "@/lib/domain/templates";
import {
  EVIDENCE_LABELS,
  REPEAT_REASON_LABELS,
  REVIEW_POLICY_LABELS,
  evidenceSummary,
  type RepeatReasonCode,
} from "@/lib/domain/types";
import { NotFoundError } from "@/lib/domain/errors";
import { isUuid } from "@/lib/uuid";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { MarkdownView } from "@/components/ui/markdown-view";
import { ActionForm } from "@/app/app/_components/action-form";
import { CustodyPanel } from "@/app/app/contratos/[id]/custody-panel";
import {
  archivarExpediente,
  aceptarContratoEnRevision,
  cancelarContrato,
  crearNuevoDesdeVencido,
  duplicarParaCorregir,
  eliminarExpediente,
  moverACarpeta,
} from "@/app/app/contratos/[id]/actions";
import {
  AI_RECOMMENDATION_LABELS,
  ATTEMPT_STATUS_LABELS,
  DECISION_LABELS,
  actorLabel,
  eventLabel,
} from "@/app/app/_lib/labels";

const SENSITIVE_KINDS = new Set(["ine_front", "ine_back", "video"]);

function PartyBlock({
  title,
  party,
}: {
  title: string;
  party: ContractPartyDetail | null;
}) {
  if (!party) {
    return (
      <div className="rounded-lg border border-line px-4 py-3">
        <p className="text-xs tracking-wide text-muted uppercase">{title}</p>
        <p className="text-sm text-carbon-soft">Sin registro</p>
      </div>
    );
  }
  const rows: [string, string][] = [
    ["Tipo de persona", party.personKind === "moral" ? "Persona moral" : "Persona física"],
    ["RFC", party.rfc],
    ["Domicilio", party.address],
    ["Correo", party.email],
    ["Teléfono", party.phone],
    ["Cargo o facultades", party.position],
  ];
  return (
    <div className="rounded-lg border border-line px-4 py-3">
      <p className="text-xs tracking-wide text-muted uppercase">{title}</p>
      <p className="font-medium text-carbon">{party.name}</p>
      <dl className="mt-2 grid gap-1 text-sm text-carbon-soft">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="font-medium">{label}:</dt>
              <dd>{value}</dd>
            </div>
          ))}
        <div className="flex gap-2">
          <dt className="font-medium">Instantánea:</dt>
          <dd>{formatDateTime(party.capturedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

function AttemptBlock({
  attempt,
  canOpenSensitive,
}: {
  attempt: AttemptDetail;
  canOpenSensitive: boolean;
}) {
  return (
    <li className="rounded-lg border border-line px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-carbon">Intento {attempt.sequence}</p>
        <Badge tone={attempt.status === "accepted" ? "success" : "neutral"}>
          {ATTEMPT_STATUS_LABELS[attempt.status]}
        </Badge>
      </div>

      <dl className="mt-2 grid gap-1 text-sm text-carbon-soft sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="font-medium">Creado:</dt>
          <dd>{formatDateTime(attempt.createdAt)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Contrato recorrido:</dt>
          <dd>{attempt.walkedAt ? formatDateTime(attempt.walkedAt) : "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Enviado:</dt>
          <dd>{attempt.submittedAt ? formatDateTime(attempt.submittedAt) : "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Vigencia del enlace:</dt>
          <dd>
            {attempt.linkExpiresAt ? formatDateTime(attempt.linkExpiresAt) : "—"}
            {attempt.linkRevokedAt ? " · revocado" : ""}
          </dd>
        </div>
      </dl>

      <div className="mt-3">
        <p className="text-xs tracking-wide text-muted uppercase">Evidencia</p>
        {attempt.evidence.length === 0 ? (
          <p className="text-sm text-carbon-soft">Sin evidencia registrada.</p>
        ) : (
          <ul className="mt-1 grid gap-1 text-sm text-carbon-soft">
            {attempt.evidence.map((item) => {
              const sensitive = SENSITIVE_KINDS.has(item.kind);
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-carbon">
                    {EVIDENCE_LABELS[item.kind]}
                  </span>
                  <span>
                    {formatBytes(item.byteSize)} · {formatDateTime(item.createdAt)}
                  </span>
                  {sensitive ? (
                    canOpenSensitive ? (
                      <>
                        <span className="font-mono text-xs break-all">
                          {item.sha256}
                        </span>
                        <a
                          href={`/app/evidencia/${item.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-accent-strong underline underline-offset-4"
                        >
                          Abrir archivo
                        </a>
                      </>
                    ) : (
                      <Badge tone="neutral">
                        Sólo Administradores y Revisores abren este archivo
                      </Badge>
                    )
                  ) : (
                    <span className="font-mono text-xs break-all">{item.sha256}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {attempt.aiReport ? (
        <div className="mt-3 rounded-lg bg-[#fcfcfb] px-3 py-2">
          <p className="text-xs tracking-wide text-muted uppercase">
            Reporte de revisión por AI
          </p>
          <p className="text-sm text-carbon">
            {attempt.aiReport.recommendation
              ? AI_RECOMMENDATION_LABELS[attempt.aiReport.recommendation]
              : "Sin recomendación"}{" "}
            · {formatDateTime(attempt.aiReport.createdAt)}
          </p>
          <p className="mt-1 text-xs text-carbon-soft">
            El agente sólo recomienda; la decisión la toma una persona con rol Revisor.
          </p>
          {attempt.aiReport.limitations ? (
            <p className="mt-1 text-xs text-carbon-soft">
              Limitaciones: {attempt.aiReport.limitations}
            </p>
          ) : null}
        </div>
      ) : null}

      {attempt.decision ? (
        <div className="mt-3 rounded-lg bg-[#fcfcfb] px-3 py-2">
          <p className="text-xs tracking-wide text-muted uppercase">Decisión</p>
          <p className="text-sm text-carbon">
            {DECISION_LABELS[attempt.decision.decision]} ·{" "}
            {attempt.decision.reviewerName} ·{" "}
            {formatDateTime(attempt.decision.createdAt)}
          </p>
          {attempt.decision.reasonCode ? (
            <p className="text-sm text-carbon-soft">
              Motivo:{" "}
              {REPEAT_REASON_LABELS[
                attempt.decision.reasonCode as RepeatReasonCode
              ] ?? attempt.decision.reasonCode}
              {attempt.decision.reasonText ? ` — ${attempt.decision.reasonText}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default async function ContractFilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireOrganizationContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  let contract;
  try {
    contract = await getContractDetail(context, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  if (contract.classification === "deleted") {
    return (
      <div className="space-y-6">
        <PageHeader
          title={contract.reference}
          description={`${contract.templateName} · Emitido por ${contract.emitterName} el ${formatDate(contract.issuedAt)}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={contract.status} />
              <Badge tone="neutral">Eliminado</Badge>
            </div>
          }
        />
        <Alert tone="warn" title="Consulta limitada">
          Este asunto está en `Eliminados`. Sólo se conserva aquí su referencia,
          estado y fechas operativas; el documento, las partes, la evidencia, los
          eventos y la custodia no pueden consultarse desde esta dirección.
        </Alert>
        <Card>
          <CardHeader title="Metadata conservada" />
          <CardBody>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="font-medium text-carbon">Emitido:</dt>
                <dd className="text-carbon-soft">{formatDateTime(contract.issuedAt)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium text-carbon">Eliminado:</dt>
                <dd className="text-carbon-soft">{formatDateTime(contract.deletedAt)}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </div>
    );
  }

  const [folders, custody] = await Promise.all([
    listFolders(context.organization.id),
    getCustodyState(context, id),
  ]);

  const permissions = contract.permissions;
  const link = contract.currentLink;
  const showLink =
    permissions.canCopyLink && link !== null && !link.revoked;

  const capturedFields = contract.fields
    .map((field) => ({
      label: field.label,
      value: formatFieldValue(field, contract.fieldValues[field.key] ?? "", contract.fieldValues),
    }))
    .filter((item) => item.value !== "");

  return (
    <div className="space-y-6">
      <PageHeader
        title={contract.reference}
        description={`${contract.templateName} · Emitido por ${contract.emitterName} el ${formatDate(contract.issuedAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={contract.status} />
            {contract.classification === "archived" ? (
              <Badge tone="neutral">Archivado</Badge>
            ) : null}
            {showLink ? (
              <CopyButton
                value={link.url}
                label="Copiar enlace"
                copiedLabel="Enlace copiado"
              />
            ) : null}
            {permissions.canViewDocument ? (
              <LinkButton
                href={`/app/contratos/${contract.id}/pdf`}
                variant="secondary"
                size="sm"
                target="_blank"
                rel="noopener"
              >
                Ver PDF
              </LinkButton>
            ) : null}
          </div>
        }
      />

      {contract.permissions.canAcceptReview && contract.openReviewTaskId ? (
        <Card>
          <CardHeader
            title="Acciones sobre el Contrato"
            description="La evidencia ya fue enviada a revisión. Puedes aceptar el Contrato con la evidencia disponible."
          />
          <CardBody>
            <ActionForm
              action={aceptarContratoEnRevision}
              submitLabel="Aceptar contrato"
              variant="success"
              hidden={{
                contractId: contract.id,
                taskId: contract.openReviewTaskId,
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      {contract.status === "cancelled" ? (
        <Alert tone="warn" title="Contrato cancelado">
          Se canceló el {formatDateTime(contract.cancelledAt)}. El enlace dejó de
          funcionar.
          {contract.cancelReason ? ` Motivo: ${contract.cancelReason}` : ""}
        </Alert>
      ) : null}

      {contract.status === "expired" ? (
        <Alert tone="info" title="Contrato vencido">
          El enlace terminó su vigencia sin que se enviara un intento. No se genera
          otro enlace para este Contrato.
        </Alert>
      ) : null}

      {showLink ? (
        <Alert tone="info">
          El enlace está disponible hasta el {formatDateTime(link.expiresAt)}. Compártelo
          por el medio que ya usas con la persona que aceptará.
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Partes" description="Instantánea congelada al emitir." />
        <CardBody>
          <div className="grid gap-4 md:grid-cols-2">
            <PartyBlock title="Titular contractual" party={contract.holder} />
            <PartyBlock title="Firmante" party={contract.signer} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Configuración efectiva"
          action={contract.customized ? <Badge tone="info">Personalizado</Badge> : null}
        />
        <CardBody>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="font-medium text-carbon">Vigencia del enlace:</dt>
              <dd className="text-carbon-soft">{contract.configuration.linkDays} días</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-carbon">Política de revisión:</dt>
              <dd className="text-carbon-soft">
                {REVIEW_POLICY_LABELS[contract.configuration.reviewPolicy]}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-carbon">Evidencia:</dt>
              <dd className="text-carbon-soft">
                {evidenceSummary(contract.configuration).join(", ")}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-carbon">Huella documental:</dt>
              <dd className="font-mono text-xs break-all text-carbon-soft">
                {contract.documentHash}
              </dd>
            </div>
          </dl>

          {capturedFields.length > 0 ? (
            <dl className="mt-4 grid gap-2 border-t border-line pt-4 text-sm sm:grid-cols-2">
              {capturedFields.map((item) => (
                <div key={item.label} className="flex gap-2">
                  <dt className="font-medium text-carbon">{item.label}:</dt>
                  <dd className="text-carbon-soft">{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </CardBody>
      </Card>

      {permissions.canViewDocument ? (
        <Card>
          <CardHeader title="Contrato" description="El texto digital es el documento primario." />
          <CardBody>
            <MarkdownView markdown={contract.contractMarkdown} />
          </CardBody>
        </Card>
      ) : (
        <Alert tone="warn">
          Este asunto está en `Eliminados`: su consulta documental y su descarga
          están bloqueadas en el portal.
        </Alert>
      )}

      <Card>
        <CardHeader title="Evidencia a revisar" />
        <CardBody>
          {contract.attempts.length === 0 ? (
            <p className="text-sm text-carbon-soft">Todavía no hay intentos.</p>
          ) : (
            <ul className="grid gap-3">
              {contract.attempts.map((attempt) => (
                <AttemptBlock
                  key={attempt.id}
                  attempt={attempt}
                  canOpenSensitive={permissions.canOpenSensitiveEvidence}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Línea de tiempo" />
        <CardBody>
          {contract.events.length === 0 ? (
            <p className="text-sm text-carbon-soft">Sin eventos registrados.</p>
          ) : (
            <ol className="grid gap-2">
              {contract.events.map((event) => (
                <li key={event.id} className="flex flex-wrap gap-x-3 text-sm">
                  <span className="text-carbon-soft">
                    {formatDateTime(event.createdAt)}
                  </span>
                  <span className="font-medium text-carbon">
                    {eventLabel(event.type)}
                  </span>
                  <span className="text-carbon-soft">
                    {actorLabel(event.actorKind, event.actorName)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Organización del expediente"
          description="Carpeta y archivo sólo organizan: no cambian el Contrato, su enlace o su custodia."
        />
        <CardBody>
          <div className="grid gap-4 md:grid-cols-2">
            {permissions.canMoveFolder ? (
              <ActionForm
                action={moverACarpeta}
                submitLabel="Mover a carpeta"
                variant="secondary"
                size="sm"
                hidden={{ contractId: contract.id }}
              >
                <Field label="Carpeta operativa" htmlFor="folderId">
                  <Select
                    id="folderId"
                    name="folderId"
                    placeholder="Sin carpeta"
                    defaultValue={contract.folderId ?? ""}
                    options={folders.map((folder) => ({
                      value: folder.id,
                      label: folder.name,
                    }))}
                  />
                </Field>
              </ActionForm>
            ) : null}

            {permissions.canArchive ? (
              <div className="self-end">
                <ActionForm
                  action={archivarExpediente}
                  submitLabel={
                    contract.classification === "archived" ? "Restaurar" : "Archivar"
                  }
                  variant="secondary"
                  size="sm"
                  hidden={{
                    contractId: contract.id,
                    archived: contract.classification !== "archived",
                  }}
                />
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {permissions.canCancel ||
      permissions.canDuplicate ||
      permissions.canCreateSuccessor ||
      permissions.canDelete ? (
        <Card>
          <CardHeader title="Administración del expediente" />
          <CardBody>
            <div className="grid gap-4">
              {permissions.canCancel ? (
                <details className="rounded-lg border border-line px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium text-carbon">
                    Cancelar contrato
                  </summary>
                  <div className="grid gap-3 pt-3">
                    <p className="max-w-prose text-sm text-carbon-soft">
                      Al cancelar, el enlace dejará de funcionar de inmediato y, si
                      hay una revisión abierta, se cerrará sin decisión. El Contrato,
                      sus intentos y su evidencia se conservan.
                    </p>
                    <ActionForm
                      action={cancelarContrato}
                      submitLabel="Confirmar cancelación"
                      variant="danger"
                      size="sm"
                      hidden={{ contractId: contract.id }}
                    >
                      <Field
                        label="Motivo (opcional)"
                        htmlFor="reason"
                        hint="Queda en la auditoría junto con el actor y la fecha."
                      >
                        <TextInput id="reason" name="reason" />
                      </Field>
                    </ActionForm>
                  </div>
                </details>
              ) : null}

              {permissions.canDuplicate ? (
                <div className="grid gap-2">
                  <p className="max-w-prose text-sm text-carbon-soft">
                    `Duplicar para corregir` crea un Borrador nuevo con los datos
                    compatibles. No edita ni versiona este Contrato.
                  </p>
                  <ActionForm
                    action={duplicarParaCorregir}
                    submitLabel="Duplicar para corregir"
                    variant="secondary"
                    size="sm"
                    hidden={{ contractId: contract.id }}
                  />
                </div>
              ) : null}

              {permissions.canCreateSuccessor ? (
                <div className="grid gap-2">
                  <p className="max-w-prose text-sm text-carbon-soft">
                    `Crear nuevo a partir de este` origina un Borrador sobre el
                    contenido vigente del Contrato-plantilla y precarga sólo los campos
                    compatibles.
                  </p>
                  <ActionForm
                    action={crearNuevoDesdeVencido}
                    submitLabel="Crear nuevo a partir de este"
                    variant="secondary"
                    size="sm"
                    hidden={{ contractId: contract.id }}
                  />
                </div>
              ) : null}

              {permissions.canDelete ? (
                <details className="rounded-lg border border-line px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium text-danger">
                    Eliminar expediente
                  </summary>
                  <div className="grid gap-3 pt-3">
                    <p className="max-w-prose text-sm text-carbon-soft">
                      El asunto dejará de estar disponible en `Contratos` y
                      `Archivados` y no podrá restaurarse desde la plataforma. Si está
                      pendiente o a revisión, quedará `Cancelado` y sus enlaces se
                      invalidarán.
                    </p>
                    <ActionForm
                      action={eliminarExpediente}
                      submitLabel="Eliminar definitivamente"
                      variant="danger"
                      size="sm"
                      hidden={{ contractId: contract.id }}
                    />
                  </div>
                </details>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}

      <CustodyPanel contractId={contract.id} custody={custody} />
    </div>
  );
}
