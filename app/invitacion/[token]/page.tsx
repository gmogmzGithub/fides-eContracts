import type { Metadata } from "next";
import { InvitacionForm } from "@/app/invitacion/[token]/invitacion-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { invitationBlockMessage, loadInvitation } from "@/lib/domain/access";
import { ROLE_LABELS } from "@/lib/domain/types";

export const metadata: Metadata = { title: "Invitación" };

export default async function InvitacionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await loadInvitation(token);

  if (!invitation) {
    return (
      <div className="grid gap-6">
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-carbon">
          Este enlace no es válido
        </h1>
        <Alert tone="danger">
          El enlace no existe o fue sustituido por uno más reciente. Pide a tu
          Administrador que te envíe una invitación nueva.
        </Alert>
        <LinkButton href="/acceso" variant="secondary">
          Ir a iniciar sesión
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <header className="grid gap-3">
        <p className="text-xs font-medium tracking-[0.22em] text-accent-strong uppercase">
          Invitación de Miembro
        </p>
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-carbon">
          {invitation.organizationName}
        </h1>
        <p className="text-sm leading-relaxed text-carbon-soft">
          Esta invitación es para <strong>{invitation.email}</strong>. El correo
          no puede cambiarse.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Tu acceso"
          description="Cada rol concede un paquete fijo de permisos y pueden acumularse."
        />
        <CardBody className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {invitation.roles.map((role) => (
              <Badge key={role} tone="neutral">
                {ROLE_LABELS[role]}
              </Badge>
            ))}
          </div>
          {invitation.expiresAt && invitation.usable ? (
            <p className="text-xs text-muted">
              El enlace es de un solo uso y vence el{" "}
              {formatDate(invitation.expiresAt)}.
            </p>
          ) : null}
        </CardBody>
      </Card>

      {invitation.usable ? (
        <InvitacionForm
          token={token}
          isNewAccount={!invitation.accountExists}
          accountName={invitation.accountName}
        />
      ) : (
        <>
          <Alert
            tone={invitation.reason === "no_seat" ? "warn" : "danger"}
            title="No podemos activar este acceso"
          >
            {invitationBlockMessage(invitation.reason)}
          </Alert>
          {invitation.reason === "no_seat" ? (
            <p className="text-xs text-muted">
              La Organización usa {invitation.activeSeats} de{" "}
              {invitation.seatLimit} accesos activos. Tu invitación sigue vigente:
              podrás reintentar cuando se libere un lugar.
            </p>
          ) : null}
          <LinkButton href="/acceso" variant="secondary">
            Ir a iniciar sesión
          </LinkButton>
        </>
      )}
    </div>
  );
}
