import "server-only";
import { sql } from "@/lib/db";
import type { Transaction } from "@/lib/db";
import { appUrl } from "@/lib/app-url";
import { hashPassword, verifyPassword } from "@/lib/crypto/password";
import { createOpaqueToken, hashToken } from "@/lib/crypto/tokens";
import { verifyTotp } from "@/lib/crypto/totp";
import { requireRole, usedCapability, type OrganizationContext } from "@/lib/auth/guards";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/domain/errors";
import {
  enqueueNotification,
  recordAudit,
  type Executor,
} from "@/lib/domain/operations";
import { ROLE_LABELS, type OrganizationRole } from "@/lib/domain/types";

/** Vigencia de la Invitación de Miembro (ADR-0025). */
const INVITATION_DAYS = 30;
/** Vigencia del enlace de Recuperación de Cuenta (ADR-0025). */
const RESET_HOURS = 1;
const MIN_PASSWORD = 8;
const MIN_NAME = 3;

export const NO_SEATS_MESSAGE =
  "No hay accesos disponibles en este momento. Contacta al Administrador de tu Organización.";

export type InvitationStatus =
  | "prepared"
  | "invited"
  | "expired"
  | "revoked"
  | "active";

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  prepared: "Preparada",
  invited: "Invitada",
  expired: "Vencida",
  revoked: "Revocada",
  active: "Activa",
};

const PENDING_STATUSES: InvitationStatus[] = ["prepared", "invited", "expired"];

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function normalizeRoles(roles: OrganizationRole[]): OrganizationRole[] {
  const allowed: OrganizationRole[] = ["administrator", "emitter", "reviewer"];
  const unique = allowed.filter((role) => roles.includes(role));
  if (unique.length === 0) {
    throw new ConflictError("Elige al menos un rol para este acceso.");
  }
  return unique;
}

export function describeRoles(roles: OrganizationRole[]): string {
  return roles.map((role) => ROLE_LABELS[role]).join(" · ");
}

function assertAdministrator(context: OrganizationContext): void {
  requireRole(context, "administrator");
}

async function countActiveMembers(
  executor: Executor,
  organizationId: string
): Promise<number> {
  const [row] = await executor<{ total: number }[]>`
    SELECT COUNT(*)::int AS total FROM organization_members
    WHERE organization_id = ${organizationId}
  `;
  /* v8 ignore next 1 -- `COUNT(*)` sin `GROUP BY` siempre devuelve exactamente una fila, así que el respaldo a cero no es alcanzable. */
  return row?.total ?? 0;
}

async function countAdministrators(
  executor: Executor,
  organizationId: string,
  excludeMemberId?: string
): Promise<number> {
  /* v8 ignore next 6 -- los dos únicos llamadores (`updateMemberRoles` y `removeMember`) siempre pasan `excludeMemberId`, así que el respaldo a NULL no es alcanzable. */
  const [row] = await executor<{ total: number }[]>`
    SELECT COUNT(*)::int AS total FROM organization_members
    WHERE organization_id = ${organizationId}
      AND 'administrator' = ANY(roles)
      AND (${excludeMemberId ?? null}::uuid IS NULL OR id <> ${excludeMemberId ?? null}::uuid)
  `;
  /* v8 ignore next 1 -- `COUNT(*)` sin `GROUP BY` siempre devuelve exactamente una fila, así que el respaldo a cero no es alcanzable. */
  return row?.total ?? 0;
}

/** Marca como `Vencida` cualquier invitación enviada cuyo enlace ya expiró. */
async function refreshExpiredInvitations(
  executor: Executor,
  organizationId?: string
): Promise<void> {
  await executor`
    UPDATE member_invitations
    SET status = 'expired'
    WHERE status = 'invited'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
      AND (${organizationId ?? null}::uuid IS NULL OR organization_id = ${organizationId ?? null}::uuid)
  `;
}

// ---------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------

export async function authenticate(
  email: string,
  password: string
): Promise<{ ok: true; accountId: string; needsTotp: boolean } | { ok: false }> {
  const normalized = normalizeEmail(email);
  if (!normalized || !password) return { ok: false };

  const [account] = await sql<
    {
      id: string;
      password_hash: string;
      is_platform_admin: boolean;
      totp_secret: string | null;
    }[]
  >`
    SELECT id, password_hash, is_platform_admin, totp_secret
    FROM accounts WHERE lower(email) = ${normalized}
  `;
  if (!account) return { ok: false };
  if (!verifyPassword(password, account.password_hash)) {
    await recordAudit({
      accountId: account.id,
      actorKind: account.is_platform_admin ? "platform" : "member",
      action: "sesion_fallida",
      subjectType: "cuenta",
      subjectId: account.id,
    });
    return { ok: false };
  }

  const needsTotp = account.is_platform_admin && Boolean(account.totp_secret);
  await recordAudit({
    accountId: account.id,
    actorKind: account.is_platform_admin ? "platform" : "member",
    action: "sesion_iniciada",
    subjectType: "cuenta",
    subjectId: account.id,
    payload: { segundo_factor: needsTotp },
  });
  return { ok: true, accountId: account.id, needsTotp };
}

/** Segundo paso TOTP de las cuentas globales (ADR-0082). */
export async function verifyAccountTotp(
  accountId: string,
  code: string
): Promise<boolean> {
  const [row] = await sql<{ totp_secret: string | null }[]>`
    SELECT totp_secret FROM accounts WHERE id = ${accountId}
  `;
  if (!row?.totp_secret) return false;
  const ok = verifyTotp(row.totp_secret, code);
  await recordAudit({
    accountId,
    actorKind: "platform",
    action: ok ? "segundo_factor_verificado" : "segundo_factor_invalido",
    subjectType: "cuenta",
    subjectId: accountId,
  });
  return ok;
}

// ---------------------------------------------------------------------------
// Recuperación de Cuenta
// ---------------------------------------------------------------------------

/**
 * Nunca revela si el correo existe: la respuesta visible es siempre la misma.
 * El enlace viaja por el outbox de correo, jamás se muestra en pantalla.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized || !isEmail(normalized)) return;

  const [account] = await sql<{ id: string; full_name: string }[]>`
    SELECT id, full_name FROM accounts WHERE lower(email) = ${normalized}
  `;
  if (!account) return;

  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + RESET_HOURS * 3600 * 1000);

  await sql.begin(async (tx) => {
    await tx`
      UPDATE password_resets SET used_at = NOW()
      WHERE account_id = ${account.id} AND used_at IS NULL
    `;
    await tx`
      INSERT INTO password_resets (account_id, token_hash, expires_at)
      VALUES (${account.id}, ${hashToken(token)}, ${expiresAt})
    `;
    await enqueueNotification(
      {
        channel: "email",
        recipient: normalized,
        template: "recuperacion_de_cuenta",
        payload: {
          nombre: account.full_name,
          url: `${appUrl()}/acceso/nueva-contrasena/${token}`,
          vigencia_horas: RESET_HOURS,
        },
      },
      tx
    );
    await recordAudit(
      {
        accountId: account.id,
        actorKind: "system",
        action: "recuperacion_solicitada",
        subjectType: "cuenta",
        subjectId: account.id,
      },
      tx
    );
  });
}

export async function completePasswordReset(
  token: string,
  password: string
): Promise<boolean> {
  if (!token || password.length < MIN_PASSWORD) return false;

  return sql.begin(async (tx) => {
    const [reset] = await tx<{ id: string; account_id: string }[]>`
      SELECT id, account_id FROM password_resets
      WHERE token_hash = ${hashToken(token)}
        AND used_at IS NULL
        AND expires_at > NOW()
      FOR UPDATE
    `;
    if (!reset) return false;

    await tx`UPDATE password_resets SET used_at = NOW() WHERE id = ${reset.id}`;
    await tx`
      UPDATE accounts SET password_hash = ${hashPassword(password)}, updated_at = NOW()
      WHERE id = ${reset.account_id}
    `;
    await tx`
      UPDATE sessions SET revoked_at = NOW()
      WHERE account_id = ${reset.account_id} AND revoked_at IS NULL
    `;
    await recordAudit(
      {
        accountId: reset.account_id,
        actorKind: "system",
        action: "contrasena_restablecida",
        subjectType: "cuenta",
        subjectId: reset.account_id,
      },
      tx
    );
    return true;
  });
}

// ---------------------------------------------------------------------------
// Invitación de Miembro: activación
// ---------------------------------------------------------------------------

export type InvitationBlock =
  | "ok"
  | "not_sent"
  | "expired"
  | "revoked"
  | "consumed"
  | "already_member"
  | "no_seat";

export interface InvitationView {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  roles: OrganizationRole[];
  roleLabels: string;
  status: InvitationStatus;
  expiresAt: Date | null;
  /** El correo ya identifica una Cuenta individual. */
  accountExists: boolean;
  accountName: string | null;
  activeSeats: number;
  seatLimit: number;
  usable: boolean;
  reason: InvitationBlock;
}

export async function loadInvitation(token: string): Promise<InvitationView | null> {
  if (!token) return null;
  await refreshExpiredInvitations(sql);

  const [invitation] = await sql<
    {
      id: string;
      organization_id: string;
      organization_name: string;
      seat_limit: number;
      email: string;
      roles: OrganizationRole[];
      status: InvitationStatus;
      expires_at: Date | null;
    }[]
  >`
    SELECT i.id, i.organization_id, o.name AS organization_name, o.seat_limit,
           i.email, i.roles, i.status, i.expires_at
    FROM member_invitations i
    JOIN organizations o ON o.id = i.organization_id
    WHERE i.token_hash = ${hashToken(token)}
  `;
  if (!invitation) return null;

  const email = normalizeEmail(invitation.email);
  const [account] = await sql<{ id: string; full_name: string }[]>`
    SELECT id, full_name FROM accounts WHERE lower(email) = ${email}
  `;
  const activeSeats = await countActiveMembers(sql, invitation.organization_id);

  let alreadyMember = false;
  if (account) {
    const [membership] = await sql<{ id: string }[]>`
      SELECT id FROM organization_members
      WHERE organization_id = ${invitation.organization_id} AND account_id = ${account.id}
    `;
    alreadyMember = Boolean(membership);
  }

  let reason: InvitationBlock = "ok";
  if (invitation.status === "revoked") reason = "revoked";
  else if (invitation.status === "active") reason = "consumed";
  else if (invitation.status === "prepared") reason = "not_sent";
  else if (invitation.status === "expired") reason = "expired";
  else if (alreadyMember) reason = "already_member";
  else if (activeSeats >= invitation.seat_limit) reason = "no_seat";

  return {
    id: invitation.id,
    organizationId: invitation.organization_id,
    organizationName: invitation.organization_name,
    email,
    roles: invitation.roles,
    roleLabels: describeRoles(invitation.roles),
    status: invitation.status,
    expiresAt: invitation.expires_at,
    accountExists: Boolean(account),
    accountName: account?.full_name ?? null,
    activeSeats,
    seatLimit: invitation.seat_limit,
    usable: reason === "ok",
    reason,
  };
}

const BLOCK_MESSAGES: Record<Exclude<InvitationBlock, "ok">, string> = {
  not_sent: "Esta invitación todavía no se envía. Pide a tu Administrador que la envíe.",
  expired:
    "Esta invitación venció. Pide a tu Administrador que te envíe una nueva.",
  revoked: "Esta invitación fue revocada. Contacta al Administrador de tu Organización.",
  consumed: "Esta invitación ya se utilizó. Inicia sesión con tu correo y contraseña.",
  already_member: "Ya tienes acceso a esta Organización. Inicia sesión.",
  no_seat: NO_SEATS_MESSAGE,
};

export function invitationBlockMessage(reason: InvitationBlock): string {
  return reason === "ok" ? "" : BLOCK_MESSAGES[reason];
}

/**
 * Activación de un solo uso. El límite de Asientos se comprueba de forma
 * atómica con la Organización bloqueada; un rechazo por falta de lugar no
 * consume la invitación y podrá reintentarse mientras el enlace siga vigente.
 * Los roles se leen del registro vigente, no de una copia fijada al enviar.
 */
export async function activateInvitation(
  token: string,
  input: { fullName?: string; password?: string }
): Promise<
  | { ok: true; accountId: string; needsTotp: boolean }
  | { ok: false; error: string }
> {
  if (!token) return { ok: false, error: "El enlace no es válido." };
  await refreshExpiredInvitations(sql);

  return sql.begin(async (tx) => {
    const [invitation] = await tx<
      {
        id: string;
        organization_id: string;
        email: string;
        roles: OrganizationRole[];
        status: InvitationStatus;
        expires_at: Date | null;
      }[]
    >`
      SELECT id, organization_id, email, roles, status, expires_at
      FROM member_invitations
      WHERE token_hash = ${hashToken(token)}
      FOR UPDATE
    `;
    if (!invitation) return { ok: false as const, error: "El enlace no es válido." };

    if (invitation.status === "revoked") {
      return { ok: false as const, error: BLOCK_MESSAGES.revoked };
    }
    if (invitation.status === "active") {
      return { ok: false as const, error: BLOCK_MESSAGES.consumed };
    }
    if (invitation.status === "prepared") {
      return { ok: false as const, error: BLOCK_MESSAGES.not_sent };
    }
    if (
      invitation.status === "expired" ||
      !invitation.expires_at ||
      invitation.expires_at.getTime() <= Date.now()
    ) {
      await tx`UPDATE member_invitations SET status = 'expired' WHERE id = ${invitation.id}`;
      return { ok: false as const, error: BLOCK_MESSAGES.expired };
    }

    // Bloquea la Organización para serializar activaciones simultáneas.
    const [organization] = await tx<{ id: string; name: string; seat_limit: number }[]>`
      SELECT id, name, seat_limit FROM organizations
      WHERE id = ${invitation.organization_id}
      FOR UPDATE
    `;
    /* v8 ignore next 1 -- `member_invitations.organization_id` es NOT NULL con llave foránea a `organizations`, así que la Organización de una invitación existente nunca falta. */
    if (!organization) return { ok: false as const, error: "El enlace no es válido." };

    const email = normalizeEmail(invitation.email);
    const [existing] = await tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM accounts WHERE lower(email) = ${email}
    `;

    if (existing) {
      const [membership] = await tx<{ id: string }[]>`
        SELECT id FROM organization_members
        WHERE organization_id = ${organization.id} AND account_id = ${existing.id}
      `;
      if (membership) {
        return { ok: false as const, error: BLOCK_MESSAGES.already_member };
      }
    }

    const activeSeats = await countActiveMembers(tx, organization.id);
    if (activeSeats >= organization.seat_limit) {
      return { ok: false as const, error: NO_SEATS_MESSAGE };
    }

    const password = input.password ?? "";
    let accountId: string;
    let accountName: string;

    if (existing) {
      // Una Cuenta existente reutiliza su nombre y su contraseña actual.
      if (!verifyPassword(password, await passwordHashOf(tx, existing.id))) {
        return {
          ok: false as const,
          error: "La contraseña no coincide con la de tu cuenta.",
        };
      }
      accountId = existing.id;
      accountName = existing.full_name;
    } else {
      const fullName = (input.fullName ?? "").trim().replace(/\s+/g, " ");
      if (fullName.length < MIN_NAME) {
        return { ok: false as const, error: "Captura tu nombre completo." };
      }
      if (password.length < MIN_PASSWORD) {
        return {
          ok: false as const,
          error: `Tu contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`,
        };
      }
      const [created] = await tx<{ id: string }[]>`
        INSERT INTO accounts (email, full_name, password_hash)
        VALUES (${email}, ${fullName}, ${hashPassword(password)})
        RETURNING id
      `;
      accountId = created.id;
      accountName = fullName;
    }

    await tx`
      INSERT INTO organization_members (organization_id, account_id, roles)
      VALUES (${organization.id}, ${accountId}, ${invitation.roles}::text[])
    `;
    await tx`
      UPDATE member_invitations
      -- Se conserva el hash: el enlace ya no sirve por su estado y así el
      -- mensaje puede decir que la invitación ya fue utilizada.
      SET status = 'active', activated_at = NOW()
      WHERE id = ${invitation.id}
    `;
    await recordAudit(
      {
        organizationId: organization.id,
        accountId,
        actorName: accountName,
        actorKind: "member",
        action: "acceso_activado",
        subjectType: "invitacion",
        subjectId: invitation.id,
        payload: { roles: invitation.roles, cuenta_nueva: !existing },
      },
      tx
    );

    // El segundo factor de una cuenta global se resuelve en su propio paso:
    // activar una invitación nunca lo da por cumplido (ADR-0082).
    const [account] = await tx<
      { is_platform_admin: boolean; totp_secret: string | null }[]
    >`
      SELECT is_platform_admin, totp_secret FROM accounts WHERE id = ${accountId}
    `;
    const needsTotp = Boolean(
      account?.is_platform_admin && account?.totp_secret
    );

    return { ok: true as const, accountId, needsTotp };
  });
}

async function passwordHashOf(tx: Transaction, accountId: string): Promise<string> {
  const [row] = await tx<{ password_hash: string }[]>`
    SELECT password_hash FROM accounts WHERE id = ${accountId}
  `;
  /* v8 ignore next 1 -- el único llamador pasa el `id` leído en la misma transacción, así que la Cuenta siempre existe y el respaldo vacío no es alcanzable. */
  return row?.password_hash ?? "";
}

// ---------------------------------------------------------------------------
// Pantalla `Accesos`
// ---------------------------------------------------------------------------

export interface AccessMember {
  memberId: string;
  accountId: string;
  email: string;
  fullName: string;
  roles: OrganizationRole[];
  roleLabels: string;
  isPrimaryAdmin: boolean;
  isSelf: boolean;
  createdAt: Date;
}

export interface AccessInvitation {
  id: string;
  email: string;
  roles: OrganizationRole[];
  roleLabels: string;
  status: InvitationStatus;
  statusLabel: string;
  pending: boolean;
  sentAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface AccessOverview {
  members: AccessMember[];
  invitations: AccessInvitation[];
  activeSeats: number;
  seatLimit: number;
  seatsAvailable: number;
  canInvite: boolean;
}

export async function listAccess(
  context: OrganizationContext
): Promise<AccessOverview> {
  assertAdministrator(context);
  const organizationId = context.organization.id;
  await refreshExpiredInvitations(sql, organizationId);

  const [memberRows, invitationRows] = await Promise.all([
    sql<
      {
        id: string;
        account_id: string;
        email: string;
        full_name: string;
        roles: OrganizationRole[];
        is_primary_admin: boolean;
        created_at: Date;
      }[]
    >`
      SELECT m.id, m.account_id, a.email, a.full_name, m.roles, m.is_primary_admin,
             m.created_at
      FROM organization_members m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.organization_id = ${organizationId}
      ORDER BY m.is_primary_admin DESC, a.full_name
    `,
    sql<
      {
        id: string;
        email: string;
        roles: OrganizationRole[];
        status: InvitationStatus;
        sent_at: Date | null;
        expires_at: Date | null;
        created_at: Date;
      }[]
    >`
      SELECT id, email, roles, status, sent_at, expires_at, created_at
      FROM member_invitations
      WHERE organization_id = ${organizationId} AND status <> 'active'
      ORDER BY created_at DESC
    `,
  ]);

  const members: AccessMember[] = memberRows.map((row) => ({
    memberId: row.id,
    accountId: row.account_id,
    email: row.email,
    fullName: row.full_name,
    roles: row.roles,
    roleLabels: describeRoles(row.roles),
    isPrimaryAdmin: row.is_primary_admin,
    isSelf: row.account_id === context.account.accountId,
    createdAt: row.created_at,
  }));

  const invitations: AccessInvitation[] = invitationRows.map((row) => ({
    id: row.id,
    email: row.email,
    roles: row.roles,
    roleLabels: describeRoles(row.roles),
    status: row.status,
    statusLabel: INVITATION_STATUS_LABELS[row.status],
    pending: PENDING_STATUSES.includes(row.status),
    sentAt: row.sent_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));

  const seatLimit = context.organization.seatLimit;
  const activeSeats = members.length;
  return {
    members,
    invitations,
    activeSeats,
    seatLimit,
    seatsAvailable: Math.max(0, seatLimit - activeSeats),
    canInvite: true,
  };
}

// ---------------------------------------------------------------------------
// Invitaciones: ciclo de vida
// ---------------------------------------------------------------------------

export async function prepareInvitation(
  context: OrganizationContext,
  email: string,
  roles: OrganizationRole[]
): Promise<void> {
  assertAdministrator(context);
  const normalized = normalizeEmail(email);
  if (!isEmail(normalized)) {
    throw new ConflictError("Captura un correo electrónico válido.");
  }
  const chosen = normalizeRoles(roles);
  const organizationId = context.organization.id;
  await refreshExpiredInvitations(sql, organizationId);

  const [member] = await sql<{ id: string }[]>`
    SELECT m.id FROM organization_members m
    JOIN accounts a ON a.id = m.account_id
    WHERE m.organization_id = ${organizationId} AND lower(a.email) = ${normalized}
  `;
  if (member) {
    throw new ConflictError("Ese correo ya es un Miembro activo de la Organización.");
  }

  const [pending] = await sql<{ id: string }[]>`
    SELECT id FROM member_invitations
    WHERE organization_id = ${organizationId}
      AND lower(email) = ${normalized}
      AND status IN ('prepared', 'invited', 'expired')
  `;
  if (pending) {
    throw new ConflictError(
      "Ya existe una invitación pendiente para ese correo. Edita sus roles o reenvíala."
    );
  }

  const [created] = await sql<{ id: string }[]>`
    INSERT INTO member_invitations (organization_id, email, roles, status, created_by)
    VALUES (${organizationId}, ${normalized}, ${chosen}::text[], 'prepared',
            ${context.account.accountId})
    RETURNING id
  `;

  await recordAudit({
    organizationId,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    actorKind: "member",
    capability: usedCapability(context),
    action: "invitacion_preparada",
    subjectType: "invitacion",
    subjectId: created.id,
    payload: { correo: normalized, roles: chosen },
  });
}

/** Envía o reenvía: siempre genera un enlace nuevo e invalida el anterior. */
export async function sendInvitation(
  context: OrganizationContext,
  invitationId: string
): Promise<void> {
  assertAdministrator(context);
  const organizationId = context.organization.id;

  const [invitation] = await sql<
    { id: string; email: string; roles: OrganizationRole[]; status: InvitationStatus }[]
  >`
    SELECT id, email, roles, status FROM member_invitations
    WHERE id = ${invitationId} AND organization_id = ${organizationId}
  `;
  if (!invitation) throw new NotFoundError("No encontramos esa invitación.");
  if (!PENDING_STATUSES.includes(invitation.status)) {
    throw new ConflictError("Esta invitación ya no puede enviarse.");
  }

  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000);

  await sql.begin(async (tx) => {
    await tx`
      UPDATE member_invitations
      SET status = 'invited', token_hash = ${hashToken(token)},
          sent_at = NOW(), expires_at = ${expiresAt}, revoked_at = NULL
      WHERE id = ${invitation.id}
    `;
    await enqueueNotification(
      {
        organizationId,
        channel: "email",
        recipient: invitation.email,
        template: "invitacion_de_miembro",
        payload: {
          organizacion: context.organization.name,
          roles: invitation.roles.map((role) => ROLE_LABELS[role]),
          url: `${appUrl()}/invitacion/${token}`,
          vigencia_dias: INVITATION_DAYS,
        },
      },
      tx
    );
    await recordAudit(
      {
        organizationId,
        accountId: context.account.accountId,
        actorName: context.account.fullName,
        actorKind: "member",
        capability: usedCapability(context),
        action: "invitacion_enviada",
        subjectType: "invitacion",
        subjectId: invitation.id,
        payload: { correo: invitation.email, vigencia_dias: INVITATION_DAYS },
      },
      tx
    );
  });
}

export async function updateInvitationRoles(
  context: OrganizationContext,
  invitationId: string,
  roles: OrganizationRole[]
): Promise<void> {
  assertAdministrator(context);
  const chosen = normalizeRoles(roles);
  const organizationId = context.organization.id;

  const [invitation] = await sql<{ id: string; status: InvitationStatus }[]>`
    SELECT id, status FROM member_invitations
    WHERE id = ${invitationId} AND organization_id = ${organizationId}
  `;
  if (!invitation) throw new NotFoundError("No encontramos esa invitación.");
  if (!PENDING_STATUSES.includes(invitation.status)) {
    throw new ConflictError("Sólo puedes editar los roles de una invitación pendiente.");
  }

  await sql`
    UPDATE member_invitations SET roles = ${chosen}::text[] WHERE id = ${invitation.id}
  `;
  await recordAudit({
    organizationId,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    actorKind: "member",
    capability: usedCapability(context),
    action: "invitacion_roles_actualizados",
    subjectType: "invitacion",
    subjectId: invitation.id,
    payload: { roles: chosen },
  });
}

/** Conserva el registro histórico e invalida el enlace de inmediato. */
export async function revokeInvitation(
  context: OrganizationContext,
  invitationId: string
): Promise<void> {
  assertAdministrator(context);
  const organizationId = context.organization.id;

  const [invitation] = await sql<
    { id: string; email: string; status: InvitationStatus }[]
  >`
    SELECT id, email, status FROM member_invitations
    WHERE id = ${invitationId} AND organization_id = ${organizationId}
  `;
  if (!invitation) throw new NotFoundError("No encontramos esa invitación.");
  if (!PENDING_STATUSES.includes(invitation.status)) {
    throw new ConflictError("Sólo puedes revocar una invitación pendiente.");
  }

  await sql`
    UPDATE member_invitations
    -- Se conserva el hash para poder explicar que la invitación fue revocada.
    SET status = 'revoked', revoked_at = NOW()
    WHERE id = ${invitation.id}
  `;
  await recordAudit({
    organizationId,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    actorKind: "member",
    capability: usedCapability(context),
    action: "invitacion_revocada",
    subjectType: "invitacion",
    subjectId: invitation.id,
    payload: { correo: invitation.email },
  });
}

/**
 * Corrección de un correo equivocado: borra el registro y su historial e
 * invalida cualquier enlace ya enviado. Distinta de `Revocar invitación`.
 */
export async function deleteInvitation(
  context: OrganizationContext,
  invitationId: string
): Promise<void> {
  assertAdministrator(context);
  const organizationId = context.organization.id;

  const [invitation] = await sql<{ id: string; status: InvitationStatus }[]>`
    SELECT id, status FROM member_invitations
    WHERE id = ${invitationId} AND organization_id = ${organizationId}
  `;
  if (!invitation) throw new NotFoundError("No encontramos esa invitación.");
  if (invitation.status === "active") {
    throw new ConflictError(
      "Esta invitación ya se activó. Administra el acceso desde la lista de Miembros."
    );
  }

  await sql.begin(async (tx) => {
    await tx`
      DELETE FROM audit_entries
      WHERE organization_id = ${organizationId}
        AND subject_type = 'invitacion'
        AND subject_id = ${invitation.id}
    `;
    await tx`DELETE FROM member_invitations WHERE id = ${invitation.id}`;
    await recordAudit(
      {
        organizationId,
        accountId: context.account.accountId,
        actorName: context.account.fullName,
        actorKind: "member",
        capability: usedCapability(context),
        action: "invitacion_eliminada",
        subjectType: "invitacion",
        payload: {},
      },
      tx
    );
  });
}

// ---------------------------------------------------------------------------
// Membresías
// ---------------------------------------------------------------------------

export async function updateMemberRoles(
  context: OrganizationContext,
  memberId: string,
  roles: OrganizationRole[]
): Promise<void> {
  assertAdministrator(context);
  const chosen = normalizeRoles(roles);
  const organizationId = context.organization.id;

  await sql.begin(async (tx) => {
    const [member] = await tx<
      {
        id: string;
        account_id: string;
        roles: OrganizationRole[];
        is_primary_admin: boolean;
        full_name: string;
      }[]
    >`
      SELECT m.id, m.account_id, m.roles, m.is_primary_admin, a.full_name
      FROM organization_members m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.id = ${memberId} AND m.organization_id = ${organizationId}
      FOR UPDATE OF m
    `;
    if (!member) throw new NotFoundError("No encontramos ese acceso.");

    const losesAdmin =
      member.roles.includes("administrator") && !chosen.includes("administrator");

    if (member.is_primary_admin && losesAdmin) {
      throw new ConflictError(
        "El Administrador principal debe conservar el rol Administrador."
      );
    }
    if (losesAdmin && (await countAdministrators(tx, organizationId, member.id)) === 0) {
      throw new ConflictError(
        "La Organización debe conservar al menos un Administrador activo."
      );
    }

    await tx`
      UPDATE organization_members SET roles = ${chosen}::text[] WHERE id = ${member.id}
    `;
    await recordAudit(
      {
        organizationId,
        accountId: context.account.accountId,
        actorName: context.account.fullName,
        actorKind: "member",
        capability: usedCapability(context),
        action: "membresia_roles_actualizados",
        subjectType: "membresia",
        subjectId: member.id,
        payload: { nombre: member.full_name, roles: chosen },
      },
      tx
    );
  });
}

/**
 * `Eliminar acceso` es inmediato: revoca sesiones, libera el Asiento y borra la
 * membresía y su historial de administración de acceso. Los Contratos ya
 * emitidos conservan el nombre histórico del Miembro.
 */
export async function removeMember(
  context: OrganizationContext,
  memberId: string
): Promise<void> {
  assertAdministrator(context);
  const organizationId = context.organization.id;

  await sql.begin(async (tx) => {
    const [member] = await tx<
      {
        id: string;
        account_id: string;
        roles: OrganizationRole[];
        is_primary_admin: boolean;
        full_name: string;
        email: string;
      }[]
    >`
      SELECT m.id, m.account_id, m.roles, m.is_primary_admin, a.full_name, a.email
      FROM organization_members m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.id = ${memberId} AND m.organization_id = ${organizationId}
      FOR UPDATE OF m
    `;
    if (!member) throw new NotFoundError("No encontramos ese acceso.");
    if (member.is_primary_admin) {
      throw new ConflictError(
        "Transfiere primero la condición de Administrador principal a otro Administrador activo."
      );
    }
    if (
      member.roles.includes("administrator") &&
      (await countAdministrators(tx, organizationId, member.id)) === 0
    ) {
      throw new ConflictError(
        "La Organización debe conservar al menos un Administrador activo."
      );
    }

    // Sesiones de esa Organización y de contexto sin resolver.
    await tx`
      UPDATE sessions SET revoked_at = NOW()
      WHERE account_id = ${member.account_id}
        AND revoked_at IS NULL
        AND (active_organization_id = ${organizationId} OR active_organization_id IS NULL)
    `;
    // Historial de administración de acceso del Miembro eliminado.
    await tx`
      DELETE FROM audit_entries
      WHERE organization_id = ${organizationId}
        AND subject_type IN ('membresia', 'invitacion', 'cuenta')
        AND (subject_id = ${member.id} OR account_id = ${member.account_id})
    `;
    await tx`
      DELETE FROM member_invitations
      WHERE organization_id = ${organizationId} AND lower(email) = ${normalizeEmail(member.email)}
    `;
    await tx`DELETE FROM organization_members WHERE id = ${member.id}`;

    // Sólo conserva el nombre como referencia histórica de la acción.
    await recordAudit(
      {
        organizationId,
        accountId: context.account.accountId,
        actorName: context.account.fullName,
        actorKind: "member",
        capability: usedCapability(context),
        action: "acceso_eliminado",
        subjectType: "acceso",
        payload: { nombre: member.full_name },
      },
      tx
    );
  });
}

export async function transferPrimaryAdmin(
  context: OrganizationContext,
  memberId: string
): Promise<void> {
  assertAdministrator(context);
  if (!context.membership.isPrimaryAdmin) {
    throw new AuthorizationError(
      "Sólo el Administrador principal puede transferir esa condición."
    );
  }
  const organizationId = context.organization.id;

  await sql.begin(async (tx) => {
    const [target] = await tx<
      { id: string; roles: OrganizationRole[]; full_name: string }[]
    >`
      SELECT m.id, m.roles, a.full_name
      FROM organization_members m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.id = ${memberId} AND m.organization_id = ${organizationId}
      FOR UPDATE OF m
    `;
    if (!target) throw new NotFoundError("No encontramos ese acceso.");
    if (!target.roles.includes("administrator")) {
      throw new ConflictError(
        "La condición sólo puede transferirse a un Miembro activo con rol Administrador."
      );
    }

    await tx`
      UPDATE organization_members SET is_primary_admin = FALSE
      WHERE organization_id = ${organizationId} AND is_primary_admin
    `;
    await tx`
      UPDATE organization_members SET is_primary_admin = TRUE WHERE id = ${target.id}
    `;
    await recordAudit(
      {
        organizationId,
        accountId: context.account.accountId,
        actorName: context.account.fullName,
        actorKind: "member",
        capability: usedCapability(context),
        action: "administrador_principal_transferido",
        subjectType: "membresia",
        subjectId: target.id,
        payload: { nombre: target.full_name },
      },
      tx
    );
  });
}

/**
 * `Mi perfil`. El nombre nuevo se usa en acciones futuras; los Contratos y
 * eventos anteriores conservan el nombre vigente cuando ocurrieron.
 */
export async function updateProfileName(
  accountId: string,
  fullName: string
): Promise<void> {
  const normalized = fullName.trim().replace(/\s+/g, " ");
  if (normalized.length < MIN_NAME) {
    throw new ConflictError("Captura tu nombre completo.");
  }
  await sql`
    UPDATE accounts SET full_name = ${normalized}, updated_at = NOW()
    WHERE id = ${accountId}
  `;
  await recordAudit({
    accountId,
    actorName: normalized,
    actorKind: "member",
    action: "nombre_actualizado",
    subjectType: "cuenta",
    subjectId: accountId,
  });
}
