import Link from "next/link";
import { hasRole, requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { getDraft, partyContext } from "@/lib/domain/drafts";
import {
  formatFieldValue,
  renderTemplateMarkdown,
  type RenderContext,
} from "@/lib/domain/templates";
import type { Counterparty } from "@/lib/domain/counterparties";
import { REVIEW_POLICY_LABELS, evidenceSummary } from "@/lib/domain/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { MarkdownView } from "@/components/ui/markdown-view";
import { GenerateLink } from "@/app/app/contratos/nuevo/[draftId]/revisar/generate-link";

const PENDING_REFERENCE = "(se asigna al generar el contrato)";

/** La vista previa aún puede no tener parte elegida; el asunto emitido siempre. */
function partyPlaceholders(party: Counterparty | null): Record<string, string> {
  return party ? partyContext(party) : {};
}

function PartyCard({
  title,
  party,
}: {
  title: string;
  party: Counterparty | null;
}) {
  if (!party) {
    return (
      <div className="rounded-lg border border-line px-4 py-3">
        <p className="text-sm font-medium text-carbon">{title}</p>
        <p className="text-sm text-carbon-soft">Sin seleccionar</p>
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
      </dl>
    </div>
  );
}

export default async function ReviewDraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const context = await requireOrganizationContext();
  requireRole(context, "administrator", "emitter");
  const { draftId } = await params;
  const draft = await getDraft(context, draftId);
  const canIssue =
    hasRole(context, "emitter") && draft.createdBy === context.account.accountId;

  const version = draft.template.currentVersion;
  const renderContext: RenderContext = {
    organization: {
      name: context.organization.name,
      legalName: context.organization.legalName,
    },
    holder: partyPlaceholders(draft.holder),
    signer: partyPlaceholders(draft.signer),
    reference: PENDING_REFERENCE,
    issuedAt: new Date(),
  };

  const contractMarkdown = version
    ? renderTemplateMarkdown(
        version.markdown,
        draft.template.fields,
        draft.fieldValues,
        renderContext
      )
    : "";

  const capturedFields = draft.template.fields
    .map((field) => ({
      label: field.label,
      value: formatFieldValue(field, draft.fieldValues[field.key] ?? "", draft.fieldValues),
    }))
    .filter((item) => item.value !== "");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revisar y generar"
        description={`Paso 2 de 2 · ${draft.template.name}`}
        actions={
          canIssue ? (
            <Link
              href={`/app/contratos/nuevo/${draftId}`}
              className="cursor-pointer text-sm text-carbon-soft underline-offset-4 transition-colors duration-200 hover:text-carbon hover:underline"
            >
              Editar y volver a Capturar datos
            </Link>
          ) : null
        }
      />

      {draft.blockers.length > 0 ? (
        <Alert tone="warn" title="Todavía no puedes generar el contrato">
          <ul className="list-disc pl-5">
            {draft.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Contrato completo"
          description="Éste es el texto que verá el Firmante. La Referencia contractual se asigna al generar el contrato."
        />
        <CardBody>
          {contractMarkdown ? (
            <MarkdownView markdown={contractMarkdown} />
          ) : (
            <p className="text-sm text-carbon-soft">
              Este Contrato-plantilla todavía no tiene contenido publicado.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Nombres en el Contrato" />
        <CardBody>
          <div className="grid gap-4 md:grid-cols-2">
            <PartyCard title="Titular contractual" party={draft.holder} />
            <PartyCard title="Firmante" party={draft.signer} />
          </div>
        </CardBody>
      </Card>

      {capturedFields.length > 0 ? (
        <Card>
          <CardHeader title="Datos capturados" />
          <CardBody>
            <dl className="grid gap-2 sm:grid-cols-2">
              {capturedFields.map((item) => (
                <div key={item.label} className="flex gap-2 text-sm">
                  <dt className="font-medium text-carbon">{item.label}:</dt>
                  <dd className="text-carbon-soft">{item.value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Configuración efectiva" />
        <CardBody>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div className="flex gap-2 text-sm">
              <dt className="font-medium text-carbon">Vigencia del enlace:</dt>
              <dd className="text-carbon-soft">{draft.configuration.linkDays} días</dd>
            </div>
            <div className="flex gap-2 text-sm">
              <dt className="font-medium text-carbon">Política de revisión:</dt>
              <dd className="text-carbon-soft">
                {REVIEW_POLICY_LABELS[draft.configuration.reviewPolicy]}
              </dd>
            </div>
            <div className="flex gap-2 text-sm">
              <dt className="font-medium text-carbon">Evidencia:</dt>
              <dd className="text-carbon-soft">
                {evidenceSummary(draft.configuration).join(", ")}
              </dd>
            </div>
            <div className="flex gap-2 text-sm">
              <dt className="font-medium text-carbon">Carpeta:</dt>
              <dd className="text-carbon-soft">{draft.folderName ?? "Sin carpeta"}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      {canIssue ? (
        <GenerateLink draftId={draftId} disabled={!draft.canIssue} />
      ) : (
        <Alert tone="info" title="Vista de consulta">
          Sólo el Emisor que creó este Borrador puede editarlo o generar el contrato.
        </Alert>
      )}
    </div>
  );
}
