import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import {
  listAccess,
  type AccessInvitation,
  type AccessMember,
} from "@/lib/domain/access";
import { ROLE_LABELS, type OrganizationRole } from "@/lib/domain/types";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, Field, TextInput } from "@/components/ui/field";
import { ActionForm } from "@/app/app/_components/action-form";
import {
  cambiarRolesMiembro,
  editarRolesInvitacion,
  eliminarAcceso,
  eliminarInvitacion,
  enviarInvitacion,
  prepararInvitacion,
  revocarInvitacion,
  transferirAdministradorPrincipal,
} from "@/app/app/accesos/actions";

const ROLES: OrganizationRole[] = ["administrator", "emitter", "reviewer"];

const INVITATION_TONES: Record<AccessInvitation["status"], BadgeTone> = {
  prepared: "neutral",
  invited: "info",
  expired: "warn",
  revoked: "danger",
  active: "success",
};

function RoleChoices({ selected }: { selected?: OrganizationRole[] }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium text-carbon">Roles</legend>
      {ROLES.map((role) => (
        <Checkbox
          key={role}
          name="roles"
          value={role}
          defaultChecked={selected?.includes(role)}
          label={ROLE_LABELS[role]}
        />
      ))}
    </fieldset>
  );
}

function InvitationCard({ invitation }: { invitation: AccessInvitation }) {
  return (
    <Card>
      <CardBody className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <p className="font-medium break-all text-carbon">{invitation.email}</p>
            <p className="text-xs text-muted">{invitation.roleLabels}</p>
          </div>
          <Badge tone={INVITATION_TONES[invitation.status]}>
            {invitation.statusLabel}
          </Badge>
        </div>

        <dl className="grid gap-1 text-xs text-carbon-soft">
          {invitation.sentAt ? (
            <div className="flex gap-1">
              <dt>Enviada:</dt>
              <dd>{formatDate(invitation.sentAt)}</dd>
            </div>
          ) : null}
          {invitation.expiresAt ? (
            <div className="flex gap-1">
              <dt>Vigente hasta:</dt>
              <dd>{formatDate(invitation.expiresAt)}</dd>
            </div>
          ) : null}
        </dl>

        {invitation.pending ? (
          <div className="grid gap-3">
            <ActionForm
              action={enviarInvitacion}
              submitLabel={
                invitation.status === "prepared"
                  ? "Enviar invitación"
                  : "Reenviar invitación"
              }
              className="grid gap-2"
              hidden={{ invitationId: invitation.id }}
            />

            <details>
              <summary className="cursor-pointer text-sm text-carbon-soft transition-colors duration-200 hover:text-carbon">
                Editar roles
              </summary>
              <div className="pt-3">
                <ActionForm
                  action={editarRolesInvitacion}
                  submitLabel="Guardar roles"
                  variant="secondary"
                  hidden={{ invitationId: invitation.id }}
                >
                  <RoleChoices selected={invitation.roles} />
                  <p className="text-xs text-muted">
                    El enlace enviado sigue siendo válido: la activación asignará
                    los roles vigentes en ese momento.
                  </p>
                </ActionForm>
              </div>
            </details>

            <ActionForm
              action={revocarInvitacion}
              submitLabel="Revocar invitación"
              variant="secondary"
              className="grid gap-2"
              hidden={{ invitationId: invitation.id }}
            />

            <details>
              <summary className="cursor-pointer text-sm text-carbon-soft transition-colors duration-200 hover:text-carbon">
                El correo es incorrecto
              </summary>
              <div className="grid gap-3 pt-3">
                <p className="text-sm leading-relaxed text-carbon-soft">
                  El correo nunca se edita. `Eliminar` borra este registro sin
                  conservar historial e invalida cualquier enlace ya enviado;
                  después deberás crear otra invitación con la dirección
                  correcta.
                </p>
                <ActionForm
                  action={eliminarInvitacion}
                  submitLabel="Eliminar invitación"
                  variant="danger"
                  hidden={{ invitationId: invitation.id }}
                />
              </div>
            </details>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function MemberCard({
  member,
  canTransfer,
}: {
  member: AccessMember;
  canTransfer: boolean;
}) {
  return (
    <Card>
      <CardBody className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <p className="font-medium text-carbon">
              {member.fullName}
              {member.isSelf ? (
                <span className="ml-2 text-xs text-muted">(tú)</span>
              ) : null}
            </p>
            <p className="text-xs break-all text-muted">{member.email}</p>
            <p className="text-xs text-carbon-soft">{member.roleLabels}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">Activa</Badge>
            {member.isPrimaryAdmin ? (
              <Badge tone="info">Administrador principal</Badge>
            ) : null}
          </div>
        </div>

        <details>
          <summary className="cursor-pointer text-sm text-carbon-soft transition-colors duration-200 hover:text-carbon">
            Cambiar roles
          </summary>
          <div className="pt-3">
            <ActionForm
              action={cambiarRolesMiembro}
              submitLabel="Guardar roles"
              variant="secondary"
              hidden={{ memberId: member.memberId }}
            >
              <RoleChoices selected={member.roles} />
              <p className="text-xs text-muted">
                El cambio aplica a las autorizaciones posteriores y no altera la
                autoría o el historial de sus acciones anteriores.
              </p>
            </ActionForm>
          </div>
        </details>

        {canTransfer && !member.isPrimaryAdmin ? (
          <details>
            <summary className="cursor-pointer text-sm text-carbon-soft transition-colors duration-200 hover:text-carbon">
              Transferir Administrador principal
            </summary>
            <div className="grid gap-3 pt-3">
              <p className="text-sm leading-relaxed text-carbon-soft">
                Sólo puede recibirla un Miembro activo que ya tenga el rol
                Administrador. Al completarse, esta persona queda protegida
                contra `Eliminar acceso` y tú conservas tus roles actuales.
              </p>
              <ActionForm
                action={transferirAdministradorPrincipal}
                submitLabel="Transferir condición"
                variant="secondary"
                hidden={{ memberId: member.memberId }}
              />
            </div>
          </details>
        ) : null}

        {member.isPrimaryAdmin ? (
          <p className="text-xs text-muted">
            El Administrador principal sólo puede eliminarse después de
            transferir esa condición a otro Administrador activo.
          </p>
        ) : (
          <ActionForm
            action={eliminarAcceso}
            submitLabel="Eliminar acceso"
            variant="danger"
            className="grid gap-2"
            hidden={{ memberId: member.memberId }}
          />
        )}
      </CardBody>
    </Card>
  );
}

export default async function AccessPage() {
  const context = await requireOrganizationContext();
  requireRole(context, "administrator");

  const access = await listAccess(context);
  const seatsFull = access.activeSeats >= access.seatLimit;
  const canTransfer = context.membership.isPrimaryAdmin;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accesos"
        description="Invitaciones y membresías de la Organización activa en una sola pantalla."
        actions={
          <Badge tone={seatsFull ? "warn" : "neutral"}>
            {access.activeSeats} de {access.seatLimit} accesos activos
          </Badge>
        }
      />

      {seatsFull ? (
        <Alert tone="warn" title="No hay Asientos disponibles">
          Las nuevas activaciones deberán esperar a que se libere un Asiento.
          Puedes seguir preparando y enviando invitaciones: no reservan lugar y
          se activarán por orden efectivo cuando exista capacidad.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Preparar invitación"
          description="Captura sólo el correo y los roles. Registrar la dirección no envía nada todavía."
        />
        <CardBody>
          <ActionForm action={prepararInvitacion} submitLabel="Preparar invitación">
            <Field
              label="Correo"
              required
              hint="El correo nunca se edita después: si te equivocas, elimina el registro y crea otro."
            >
              <TextInput
                name="email"
                type="email"
                required
                autoComplete="off"
                placeholder="persona@organizacion.com"
              />
            </Field>
            <RoleChoices />
            <p className="text-xs text-muted">
              Cada rol es un paquete fijo de permisos y pueden acumularse. La
              persona establecerá su propia contraseña desde el enlace; ninguna
              contraseña es visible o elegible por un Administrador.
            </p>
          </ActionForm>
        </CardBody>
      </Card>

      <section className="grid gap-3">
        <h2 className="font-display text-lg text-carbon">Invitaciones</h2>
        {access.invitations.length === 0 ? (
          <EmptyState
            title="Sin invitaciones"
            description="Prepara una invitación para incorporar a alguien más a esta Organización."
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {access.invitations.map((invitation) => (
              <li key={invitation.id}>
                <InvitationCard invitation={invitation} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="font-display text-lg text-carbon">Membresías activas</h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {access.members.map((member) => (
            <li key={member.memberId}>
              <MemberCard member={member} canTransfer={canTransfer} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

