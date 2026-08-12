import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import {
  CONTEXT_PLACEHOLDERS,
  getTemplate,
  listTemplateVersions,
} from "@/lib/domain/templates";
import { REVIEW_POLICY_LABELS } from "@/lib/domain/types";
import { formatDateTime } from "@/lib/format";
import { TemplateEditor } from "./editor";

interface Props {
  params: Promise<{ templateId: string }>;
}

const DATA_TYPE_LABELS: Record<string, string> = {
  text: "Texto",
  longtext: "Texto largo",
  number: "Número",
  money: "Importe",
  date: "Fecha",
  select: "Selección",
  suggest: "Texto con sugerencias",
};

/** Una lista de sugerencias trae cientos de entradas: se resume, no se vuelca. */
const OPTIONS_SHOWN = 6;

function optionsSummary(options: string[]): string {
  const shown = options.slice(0, OPTIONS_SHOWN).join(", ");
  const rest = options.length - OPTIONS_SHOWN;
  return rest > 0 ? `${shown} y ${rest} más` : shown;
}

export default async function EditorPlantillaPage({ params }: Props) {
  const { templateId } = await params;
  const account = await requirePlatformAdmin();
  const template = await getTemplate(templateId);
  if (!template) notFound();

  const versions = await listTemplateVersions(templateId);
  const knownKeys = [
    ...CONTEXT_PLACEHOLDERS,
    ...template.fields.map((field) => field.key),
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Editor de Contrato-plantilla"
        description={`${template.name} · ${template.organizationName}`}
        actions={
          <LinkButton
            href={`/plataforma/organizaciones/${template.organizationId}`}
            variant="secondary"
            size="sm"
          >
            Volver a {template.organizationName}
          </LinkButton>
        }
      />

      <Alert tone="info" title="Pantalla privada del Proveedor">
        Responsable juridico entrega el contenido jurídico y Publicador de plataforma es la única persona
        que lo aprueba y lo publica. La Organización, sus Miembros y el Firmante
        nunca ven este editor, las etiquetas de versión ni el historial.
      </Alert>

      <Card>
        <CardHeader
          title="Texto y versión"
          description="Editor de texto simple. Sólo cambia el Markdown y el identificador de versión."
        />
        <CardBody>
          <TemplateEditor
            templateId={template.id}
            currentLabel={template.currentVersion?.label ?? null}
            initialMarkdown={template.currentVersion?.markdown ?? ""}
            knownKeys={knownKeys}
            canPublish={account.isLegalPublisher}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Esquema programado de campos"
          description="Sólo lectura. Esta pantalla no es un diseñador de formularios: agregar, quitar o cambiar un campo es trabajo de programación y despliegue previo a publicar el Markdown que lo usa."
        />
        <CardBody>
          {template.fields.length === 0 ? (
            <EmptyState
              title="Este Contrato-plantilla no tiene campos programados"
              description="Sólo puede usar los marcadores de contexto."
            />
          ) : (
            <Table className="border-0 shadow-none">
              <THead>
                <Tr>
                  <Th>Marcador</Th>
                  <Th>Etiqueta</Th>
                  <Th>Tipo</Th>
                  <Th>Obligatorio</Th>
                  <Th>Buscable</Th>
                  <Th>Destacado</Th>
                </Tr>
              </THead>
              <TBody>
                {template.fields.map((field) => (
                  <Tr key={field.id}>
                    <Td>
                      <code className="rounded bg-[#f5f5f4] px-2 py-1 text-xs text-carbon-soft">
                        {`{{${field.key}}}`}
                      </code>
                    </Td>
                    <Td>
                      <span className="font-medium text-carbon">
                        {field.label}
                      </span>
                      {field.helpText ? (
                        <span className="block text-xs text-muted">
                          {field.helpText}
                        </span>
                      ) : null}
                      {field.options.length > 0 ? (
                        <span className="block text-xs text-muted">
                          Opciones: {optionsSummary(field.options)}
                        </span>
                      ) : null}
                    </Td>
                    <Td>{DATA_TYPE_LABELS[field.dataType] ?? field.dataType}</Td>
                    <Td>{field.required ? "Sí" : "No"}</Td>
                    <Td>{field.searchable ? "Sí" : "No"}</Td>
                    <Td>{field.highlighted ? "Sí" : "No"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}

          <div className="mt-4">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">
              Marcadores de contexto siempre disponibles
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CONTEXT_PLACEHOLDERS.map((key) => (
                <code
                  key={key}
                  className="rounded bg-[#f5f5f4] px-2 py-1 text-xs text-carbon-soft"
                >
                  {`{{${key}}}`}
                </code>
              ))}
            </div>
          </div>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Vigencia predeterminada
              </dt>
              <dd className="mt-1 text-sm text-carbon">
                {template.defaults.linkDays} días
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Video guiado
              </dt>
              <dd className="mt-1 text-sm text-carbon">
                {template.defaults.requiresVideo ? "Sí" : "No"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Captura de INE
              </dt>
              <dd className="mt-1 text-sm text-carbon">
                {template.defaults.requiresIne ? "Sí" : "No"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Política de revisión
              </dt>
              <dd className="mt-1 text-sm text-carbon">
                {REVIEW_POLICY_LABELS[template.defaults.reviewPolicy]}
              </dd>
            </div>
          </dl>

          {template.acceptanceLegend ? (
            <div className="mt-6">
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                Leyenda de aceptación
              </p>
              <p className="mt-1 text-sm text-carbon">
                {template.acceptanceLegend}
              </p>
            </div>
          ) : null}

          {template.videoStatementTemplate ? (
            <div className="mt-4">
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                Declaración del video guiado
              </p>
              <p className="mt-1 text-sm text-carbon">
                {template.videoStatementTemplate}
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Historial privado de publicaciones"
          description="Cada publicación es un registro inmutable. Dos publicaciones pueden compartir etiqueta y se distinguen por su fecha y hora; exactamente una está vigente."
        />
        <CardBody>
          {versions.length === 0 ? (
            <EmptyState
              title="Todavía no hay publicaciones"
              description="La primera publicación será la versión 1.0."
            />
          ) : (
            <Table className="border-0 shadow-none">
              <THead>
                <Tr>
                  <Th>Versión</Th>
                  <Th>Fecha y hora</Th>
                  <Th>Publicó</Th>
                  <Th>Huella del texto</Th>
                  <Th>Estado</Th>
                </Tr>
              </THead>
              <TBody>
                {versions.map((version) => (
                  <Tr key={version.id}>
                    <Td>
                      <code className="font-mono text-sm text-carbon">
                        {version.label}
                      </code>
                    </Td>
                    <Td>{formatDateTime(version.publishedAt)}</Td>
                    <Td>{version.publishedByName ?? "—"}</Td>
                    <Td>
                      <code className="text-xs break-all text-muted">
                        {version.markdownHash}
                      </code>
                    </Td>
                    <Td>
                      {version.isCurrent ? (
                        <Badge tone="success">Vigente</Badge>
                      ) : (
                        <Badge tone="neutral">Histórica</Badge>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
