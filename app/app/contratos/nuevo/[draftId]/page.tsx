import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRole, requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { getDraft } from "@/lib/domain/drafts";
import { listFolders } from "@/lib/domain/contracts";
import {
  listCounterparties,
  type Counterparty,
} from "@/lib/domain/counterparties";
import { REVIEW_POLICY_LABELS } from "@/lib/domain/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Field, RadioGroup, Select, TextInput } from "@/components/ui/field";
import { ActionForm } from "@/app/app/_components/action-form";
import { FieldCapture } from "@/app/app/contratos/nuevo/[draftId]/field-capture";
import { EvidenceOptions } from "@/app/app/contratos/nuevo/[draftId]/evidence-options";
import {
  eliminarBorrador,
  guardarCarpeta,
  personalizarContrato,
} from "@/app/app/contratos/nuevo/[draftId]/actions";

function counterpartyLabel(item: Counterparty): string {
  return item.rfc ? `${item.name} · ${item.rfc}` : item.name;
}

function counterpartyOptions(items: Counterparty[]) {
  return items.map((item) => ({
    value: item.id,
    label: counterpartyLabel(item),
  }));
}

/** La captura necesita saber si el Titular es persona para ofrecer el atajo. */
function holderOptions(items: Counterparty[]) {
  return items.map((item) => ({
    value: item.id,
    label: counterpartyLabel(item),
    personKind: item.personKind,
  }));
}

export default async function CaptureDraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const context = await requireOrganizationContext();
  requireRole(context, "administrator", "emitter");
  const { draftId } = await params;

  const draft = await getDraft(context, draftId);
  const canEdit =
    hasRole(context, "emitter") && draft.createdBy === context.account.accountId;
  if (!canEdit) {
    redirect(`/app/contratos/nuevo/${draftId}/revisar`);
  }
  const [counterparties, folders] = await Promise.all([
    listCounterparties(context.organization.id),
    listFolders(context.organization.id),
  ]);
  const technicalBlockers = draft.blockers.filter(
    (blocker) =>
      !blocker.startsWith("Falta elegir") &&
      !blocker.startsWith("Faltan datos obligatorios") &&
      !blocker.includes("desactivado")
  );

  const capabilities = context.organization.capabilities;
  const configuration = draft.configuration;
  const reviewOptions = [
    { value: "none", label: REVIEW_POLICY_LABELS.none },
    { value: "manual", label: REVIEW_POLICY_LABELS.manual },
    ...(capabilities.ai_review
      ? [
          {
            value: "ai",
            label: REVIEW_POLICY_LABELS.ai,
            description:
              "El agente analiza la evidencia y recomienda; una persona con rol Revisor decide.",
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Capturar datos"
        description={`Paso 1 de 2 · ${draft.template.name}`}
        actions={
          <Link
            href="/app/contratos"
            className="cursor-pointer text-sm text-carbon-soft underline-offset-4 transition-colors duration-200 hover:text-carbon hover:underline"
          >
            Volver a Contratos
          </Link>
        }
      />

      {technicalBlockers.length > 0 ? (
        <Alert tone="danger" title="Fides todavía no puede generar este contrato">
          <ul className="list-disc pl-5">
            {technicalBlockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Datos del contrato"
          description="Completa los campos que aparecen aquí. Estos son los únicos datos necesarios para formar este contrato."
        />
        <CardBody>
          <FieldCapture
            draftId={draftId}
            fields={draft.template.fields}
            initialValues={draft.fieldValues}
            holderOptions={holderOptions(counterparties)}
            signerOptions={counterpartyOptions(
              counterparties.filter((item) => item.personKind === "fisica")
            )}
            initialHolderId={draft.holder?.active ? draft.holder.id : ""}
            initialSignerId={draft.signer?.active ? draft.signer.id : ""}
            addSignerHref={`/app/partes/nueva?borrador=${draftId}&parte=signer`}
            nextHref={`/app/contratos/nuevo/${draftId}/revisar`}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Evidencia requerida"
          description="Estas opciones aplican únicamente a este contrato y quedan seleccionadas al guardarse."
        />
        <CardBody>
          <EvidenceOptions
            draftId={draftId}
            initialRequiresIne={configuration.requiresIne}
            initialRequiresVideo={configuration.requiresVideo}
          />
        </CardBody>
      </Card>

      <Card>
        <details>
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 text-sm font-medium text-carbon transition-colors duration-200 hover:bg-[#fcfcfb]">
            <span>Vigencia, revisión y carpeta (opcional)</span>
            {draft.customized ? <Badge tone="info">Personalizado</Badge> : null}
          </summary>
          <CardBody className="border-t border-line">
          <div className="grid gap-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="font-medium text-carbon">Vigencia del enlace:</dt>
                <dd className="text-carbon-soft">{configuration.linkDays} días</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium text-carbon">Revisión:</dt>
                <dd className="text-carbon-soft">
                  {REVIEW_POLICY_LABELS[configuration.reviewPolicy]}
                </dd>
              </div>
            </dl>

            <details className="rounded-lg border border-line bg-[#fcfcfb] px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-carbon">
                Personalizar este contrato
              </summary>
              <div className="pt-4">
                <ActionForm
                  action={personalizarContrato}
                  submitLabel="Guardar configuración"
                  variant="secondary"
                  hidden={{ draftId }}
                >
                  <Field
                    label="Vigencia del enlace (días)"
                    htmlFor="linkDays"
                    hint="De 1 a 30 días completos. No existe un enlace sin vencimiento."
                  >
                    <TextInput
                      id="linkDays"
                      name="linkDays"
                      type="number"
                      min={1}
                      max={30}
                      defaultValue={configuration.linkDays}
                    />
                  </Field>

                  <RadioGroup
                    name="reviewPolicy"
                    legend="Política de revisión"
                    options={reviewOptions}
                    defaultValue={configuration.reviewPolicy}
                  />
                </ActionForm>
              </div>
            </details>

            <ActionForm
              action={guardarCarpeta}
              submitLabel="Guardar carpeta"
              variant="secondary"
              size="sm"
              hidden={{ draftId }}
            >
              <Field
                label="Carpeta operativa"
                htmlFor="folderId"
                hint="Las carpetas sólo organizan expedientes."
              >
                <Select
                  id="folderId"
                  name="folderId"
                  placeholder="Sin carpeta"
                  defaultValue={draft.folderId ?? ""}
                  options={folders.map((folder) => ({
                    value: folder.id,
                    label: folder.name,
                  }))}
                />
              </Field>
            </ActionForm>
          </div>
          </CardBody>
        </details>
      </Card>

      <div className="flex justify-end">
        {hasRole(context, "administrator") ? (
          <details className="rounded-lg border border-line px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-danger">
              Eliminar este Borrador
            </summary>
            <div className="grid gap-3 pt-3">
              <p className="max-w-prose text-sm text-carbon-soft">
                El Borrador dejará de estar disponible y su contenido editable se
                eliminará definitivamente. No podrá restaurarse desde la plataforma.
              </p>
              <ActionForm
                action={eliminarBorrador}
                submitLabel="Eliminar definitivamente"
                variant="danger"
                size="sm"
                hidden={{ draftId }}
              />
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
