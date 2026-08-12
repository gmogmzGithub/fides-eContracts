import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { loadOrganizationProfile } from "@/lib/auth/guards";
import { getCurrentPrivacyNotice, listTemplates } from "@/lib/domain/templates";
import { REVIEW_POLICY_LABELS, ROLE_LABELS } from "@/lib/domain/types";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  CAPABILITY_ORDER,
  getOrganizationCounters,
  listOrganizationMembers,
  organizationExists,
} from "@/app/plataforma/queries";
import { CapabilitiesForm } from "./capabilities-form";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function OrganizacionDetallePage({ params }: Props) {
  const { id } = await params;
  if (!(await organizationExists(id))) notFound();

  const [profile, templates, privacy, members, counters] = await Promise.all([
    loadOrganizationProfile(id),
    listTemplates(id),
    getCurrentPrivacyNotice(id),
    listOrganizationMembers(id),
    getOrganizationCounters(id),
  ]);

  const conflicts: string[] = [];
  if (profile.defaults.reviewPolicy === "ai" && !profile.capabilities.ai_review) {
    conflicts.push(
      "El valor predeterminado usa Revisión por AI, pero la capacidad está deshabilitada."
    );
  }

  const counters4 = [
    { label: "Asientos activos", value: `${members.length} de ${profile.seatLimit}` },
    { label: "Contratos emitidos", value: String(counters.contracts) },
    { label: "A revisión", value: String(counters.inReview) },
    { label: "Paquetes fríos", value: String(counters.coldPackages) },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title={profile.name}
        description={`${profile.legalName} · ${profile.slug}`}
        actions={
          <LinkButton href="/plataforma" variant="secondary" size="sm">
            Volver a Organizaciones
          </LinkButton>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {counters4.map((item) => (
          <Card key={item.label}>
            <CardBody>
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                {item.label}
              </p>
              <p className="mt-1 font-display text-2xl font-semibold text-carbon">
                {item.value}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Capacidades adicionales"
          description="El Proveedor las habilita manualmente por acuerdo comercial externo. Aquí no hay planes, precios, contratación ni facturación."
        />
        <CardBody>
          <CapabilitiesForm
            organizationId={profile.id}
            capabilities={profile.capabilities}
            order={CAPABILITY_ORDER}
          />
        </CardBody>
      </Card>

      {conflicts.length > 0 ? (
        <Alert tone="warn" title="Revisa los valores predeterminados">
          <ul className="grid gap-1">
            {conflicts.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Valores predeterminados de la Organización"
          description="Espejo de sólo lectura. Los controla el Administrador de la Organización desde su portal, dentro de lo habilitado."
        />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Vigencia del enlace
              </dt>
              <dd className="mt-1 text-sm text-carbon">
                {profile.defaults.linkDays} días
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Video guiado
              </dt>
              <dd className="mt-1 text-sm text-carbon">
                {profile.defaults.requiresVideo ? "Sí" : "No"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Captura de INE
              </dt>
              <dd className="mt-1 text-sm text-carbon">
                {profile.defaults.requiresIne ? "Sí" : "No"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Política de revisión
              </dt>
              <dd className="mt-1 text-sm text-carbon">
                {REVIEW_POLICY_LABELS[profile.defaults.reviewPolicy]}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            Versión operativa {profile.defaults.operationalVersion}.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Contratos-plantilla"
          description="Responsable juridico entrega el contenido jurídico y Publicador de plataforma lo programa, aprueba y publica. La Organización no los edita."
        />
        <CardBody>
          {templates.length === 0 ? (
            <EmptyState
              title="Esta Organización no tiene Contratos-plantilla"
              description="Se integran durante la implementación contractual inicial."
            />
          ) : (
            <Table className="border-0 shadow-none">
              <THead>
                <Tr>
                  <Th>Contrato-plantilla</Th>
                  <Th>Versión vigente</Th>
                  <Th>Publicada</Th>
                  <Th>Campos</Th>
                  <Th>Editor</Th>
                </Tr>
              </THead>
              <TBody>
                {templates.map((template) => (
                  <Tr key={template.id}>
                    <Td>
                      <span className="font-medium text-carbon">
                        {template.name}
                      </span>
                      {template.summary ? (
                        <span className="block text-xs text-muted">
                          {template.summary}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      {template.currentVersion ? (
                        <Badge tone="success">
                          {template.currentVersion.label}
                        </Badge>
                      ) : (
                        <Badge tone="danger">Sin publicación vigente</Badge>
                      )}
                    </Td>
                    <Td>
                      {template.currentVersion
                        ? formatDateTime(template.currentVersion.publishedAt)
                        : "—"}
                    </Td>
                    <Td>{template.fields.length}</Td>
                    <Td>
                      <Link
                        href={`/plataforma/plantillas/${template.id}`}
                        className="cursor-pointer font-medium text-carbon underline underline-offset-2 transition-colors duration-200 hover:text-accent-strong"
                      >
                        Abrir editor
                      </Link>
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
          title="Aviso de Privacidad"
          description="Responsable juridico entrega el contenido y sólo Publicador de plataforma lo publica."
          action={
            <LinkButton href={`/plataforma/avisos/${profile.id}`} size="sm">
              Abrir editor
            </LinkButton>
          }
        />
        <CardBody>
          {privacy ? (
            <p className="text-sm text-carbon">
              Vigente la versión <strong>{privacy.label}</strong>, publicada el{" "}
              {formatDateTime(privacy.publishedAt)}. Huella{" "}
              <code className="text-xs break-all text-muted">
                {privacy.noticeHash}
              </code>
              .
            </p>
          ) : (
            <Alert tone="danger" title="Sin Aviso de Privacidad vigente">
              El recorrido del Firmante falla cerrado antes de recopilar
              evidencia o aceptación mientras falte el Aviso de Privacidad.
            </Alert>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Miembros y roles"
          description="Sólo lectura. Las invitaciones y los roles los administra la propia Organización desde su portal."
        />
        <CardBody>
          {members.length === 0 ? (
            <EmptyState
              title="Sin Miembros activos"
              description="Todavía nadie ha activado un Acceso de Organización."
            />
          ) : (
            <Table className="border-0 shadow-none">
              <THead>
                <Tr>
                  <Th>Nombre</Th>
                  <Th>Correo</Th>
                  <Th>Roles</Th>
                  <Th>Alta</Th>
                </Tr>
              </THead>
              <TBody>
                {members.map((member) => (
                  <Tr key={member.memberId}>
                    <Td>
                      <span className="font-medium text-carbon">
                        {member.fullName}
                      </span>
                      {member.isPrimaryAdmin ? (
                        <Badge tone="info" className="ml-2">
                          Administrador principal
                        </Badge>
                      ) : null}
                    </Td>
                    <Td>{member.email}</Td>
                    <Td>
                      {member.roles.map((role) => ROLE_LABELS[role]).join(", ")}
                    </Td>
                    <Td>{formatDate(member.createdAt)}</Td>
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
