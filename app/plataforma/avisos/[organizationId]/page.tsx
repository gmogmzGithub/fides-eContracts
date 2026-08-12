import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { loadOrganizationProfile, requirePlatformAdmin } from "@/lib/auth/guards";
import { listPrivacyNotices } from "@/lib/domain/templates";
import { formatDateTime } from "@/lib/format";
import { organizationExists } from "@/app/plataforma/queries";
import { PrivacyNoticeEditor } from "./editor";

interface Props {
  params: Promise<{ organizationId: string }>;
}

export default async function EditorAvisoPage({ params }: Props) {
  const { organizationId } = await params;
  const account = await requirePlatformAdmin();
  if (!(await organizationExists(organizationId))) notFound();

  const [profile, notices] = await Promise.all([
    loadOrganizationProfile(organizationId),
    listPrivacyNotices(organizationId),
  ]);

  const current = notices.find((notice) => notice.isCurrent) ?? null;
  const completeNotice = Boolean(current && current.fullMarkdown.trim());

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Editor de Aviso de Privacidad"
        description={`${profile.name} · ${profile.legalName}`}
        actions={
          <LinkButton
            href={`/plataforma/organizaciones/${profile.id}`}
            variant="secondary"
            size="sm"
          >
            Volver a {profile.name}
          </LinkButton>
        }
      />

      <Alert tone="info" title="Pantalla privada del Proveedor">
        Responsable juridico entrega el contenido del Aviso de Privacidad y Publicador de plataforma es la
        única persona que lo aprueba, lo carga y lo publica. La Organización y
        sus Miembros no lo redactan, editan ni aprueban. La plataforma no
        interpreta la ley, no genera cláusulas y no decide si el texto es
        suficiente: lo conserva, lo versiona y lo muestra.
      </Alert>

      {!completeNotice ? (
        <Alert tone="danger" title="Sin Aviso de Privacidad vigente">
          Mientras falte el Aviso de Privacidad, el recorrido del Firmante falla
          cerrado antes de recopilar evidencia o aceptación y no se pueden emitir
          Contratos nuevos.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Textos y versión"
          description="El Aviso de Privacidad se publica bajo una etiqueta manual, con la misma mecánica de versión del Contrato-plantilla."
        />
        <CardBody>
          <PrivacyNoticeEditor
            organizationId={profile.id}
            currentLabel={current?.label ?? null}
            initialFull={current?.fullMarkdown ?? ""}
            canPublish={account.isLegalPublisher}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Historial privado de publicaciones"
          description="Cada aviso publicado es un registro inmutable; exactamente uno está vigente y los que comparten etiqueta se distinguen por fecha y hora."
        />
        <CardBody>
          {notices.length === 0 ? (
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
                  <Th>Completo</Th>
                  <Th>Huella</Th>
                  <Th>Estado</Th>
                </Tr>
              </THead>
              <TBody>
                {notices.map((notice) => (
                  <Tr key={notice.id}>
                    <Td>
                      <code className="font-mono text-sm text-carbon">
                        {notice.label}
                      </code>
                    </Td>
                    <Td>{formatDateTime(notice.publishedAt)}</Td>
                    <Td>
                      {notice.fullMarkdown.trim() ? "Sí" : "No"}
                    </Td>
                    <Td>
                      <code className="text-xs break-all text-muted">
                        {notice.noticeHash}
                      </code>
                    </Td>
                    <Td>
                      {notice.isCurrent ? (
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
