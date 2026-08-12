import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto/password";
import { createTotpSecret, totpCode } from "@/lib/crypto/totp";
import type { OrganizationContext } from "@/lib/auth/guards";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "@/lib/domain/errors";
import {
  activateInvitation,
  authenticate,
  completePasswordReset,
  deleteInvitation,
  describeRoles,
  INVITATION_STATUS_LABELS,
  invitationBlockMessage,
  listAccess,
  loadInvitation,
  NO_SEATS_MESSAGE,
  prepareInvitation,
  removeMember,
  requestPasswordReset,
  revokeInvitation,
  sendInvitation,
  transferPrimaryAdmin,
  updateInvitationRoles,
  updateMemberRoles,
  updateProfileName,
  verifyAccountTotp,
} from "@/lib/domain/access";
import type { OrganizationRole } from "@/lib/domain/types";
import {
  addMembership,
  buildContext,
  createAccount,
  createOrganization,
  type AccountFixture,
  type OrganizationFixture,
} from "@/tests/helpers/database";

const PASSWORD = "Contrasena.De.Prueba.1";
const DAY_MS = 86_400_000;

interface OutboxPayload {
  url?: string;
  nombre?: string;
  organizacion?: string;
  roles?: string[];
  vigencia_dias?: number;
  vigencia_horas?: number;
}

interface AdminFixture {
  organization: OrganizationFixture;
  account: AccountFixture;
  memberId: string;
  context: OrganizationContext;
}

/** Organización con un único Miembro: su Administrador principal. */
async function createAdministeredOrganization(
  seatLimit?: number
): Promise<AdminFixture> {
  const organization = await createOrganization();
  if (seatLimit !== undefined) {
    await sql`
      UPDATE organizations SET seat_limit = ${seatLimit} WHERE id = ${organization.id}
    `;
  }
  const account = await createAccount();
  const memberId = await addMembership(
    organization.id,
    account.id,
    ["administrator"],
    true
  );
  const context = await buildContext(organization.id, account, ["administrator"], {
    isPrimaryAdmin: true,
  });
  return { organization, account, memberId, context };
}

async function invitationRow(email: string): Promise<{
  id: string;
  status: string;
  token_hash: string | null;
  expires_at: Date | null;
  sent_at: Date | null;
  revoked_at: Date | null;
  activated_at: Date | null;
  roles: OrganizationRole[];
}> {
  const [row] = await sql<
    {
      id: string;
      status: string;
      token_hash: string | null;
      expires_at: Date | null;
      sent_at: Date | null;
      revoked_at: Date | null;
      activated_at: Date | null;
      roles: OrganizationRole[];
    }[]
  >`
    SELECT id, status, token_hash, expires_at, sent_at, revoked_at, activated_at, roles
    FROM member_invitations
    WHERE lower(email) = ${email.toLowerCase()}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `;
  return row;
}

async function outbox(template: string): Promise<
  { recipient: string; organization_id: string | null; payload: OutboxPayload }[]
> {
  return sql<
    { recipient: string; organization_id: string | null; payload: OutboxPayload }[]
  >`
    SELECT recipient, organization_id, payload FROM notification_outbox
    WHERE template = ${template}
    ORDER BY created_at ASC, id ASC
  `;
}

function lastSegment(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

/** Extrae del outbox el enlace más reciente enviado a una dirección. */
async function tokenSentTo(template: string, recipient: string): Promise<string> {
  const [row] = await sql<{ payload: OutboxPayload }[]>`
    SELECT payload FROM notification_outbox
    WHERE template = ${template} AND recipient = ${recipient}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `;
  return lastSegment(row?.payload.url ?? "");
}

/** Prepara, envía y devuelve el enlace vigente de una invitación. */
async function inviteAndSend(
  context: OrganizationContext,
  email: string,
  roles: OrganizationRole[] = ["emitter"]
): Promise<{ id: string; token: string }> {
  await prepareInvitation(context, email, roles);
  const prepared = await invitationRow(email);
  await sendInvitation(context, prepared.id);
  return { id: prepared.id, token: await tokenSentTo("invitacion_de_miembro", email) };
}

async function auditActions(): Promise<string[]> {
  const rows = await sql<{ action: string }[]>`
    SELECT action FROM audit_entries ORDER BY created_at ASC, id ASC
  `;
  return rows.map((row) => row.action);
}

async function memberCount(organizationId: string): Promise<number> {
  const [row] = await sql<{ total: number }[]>`
    SELECT COUNT(*)::int AS total FROM organization_members
    WHERE organization_id = ${organizationId}
  `;
  return row.total;
}

// ---------------------------------------------------------------------------

describe("describeRoles e INVITATION_STATUS_LABELS", () => {
  it("une las etiquetas de los roles con un separador legible", () => {
    expect(describeRoles(["administrator", "emitter", "reviewer"])).toBe(
      "Administrador · Emisor · Revisor"
    );
  });

  it("devuelve cadena vacía cuando no hay roles", () => {
    expect(describeRoles([])).toBe("");
  });

  it("nombra los cinco estados operativos visibles de ADR-0025", () => {
    expect(INVITATION_STATUS_LABELS).toEqual({
      prepared: "Preparada",
      invited: "Invitada",
      expired: "Vencida",
      revoked: "Revocada",
      active: "Activa",
    });
  });
});

describe("invitationBlockMessage", () => {
  it("no muestra mensaje cuando la invitación puede usarse", () => {
    expect(invitationBlockMessage("ok")).toBe("");
  });

  it("usa el mensaje canónico de falta de Asientos", () => {
    expect(invitationBlockMessage("no_seat")).toBe(NO_SEATS_MESSAGE);
    expect(NO_SEATS_MESSAGE).toBe(
      "No hay accesos disponibles en este momento. Contacta al Administrador de tu Organización."
    );
  });

  it("explica cada motivo de bloqueo", () => {
    expect(invitationBlockMessage("not_sent")).toContain("todavía no se envía");
    expect(invitationBlockMessage("expired")).toContain("venció");
    expect(invitationBlockMessage("revoked")).toContain("revocada");
    expect(invitationBlockMessage("consumed")).toContain("ya se utilizó");
    expect(invitationBlockMessage("already_member")).toContain("Ya tienes acceso");
  });
});

describe("authenticate", () => {
  it("acepta la contraseña correcta y no exige segundo factor a un Miembro", async () => {
    const account = await createAccount({ password: PASSWORD });
    const result = await authenticate(account.email, PASSWORD);
    expect(result).toEqual({ ok: true, accountId: account.id, needsTotp: false });
    expect(await auditActions()).toEqual(["sesion_iniciada"]);
  });

  it("normaliza espacios y mayúsculas del correo", async () => {
    const account = await createAccount({
      email: "persona.mixta@example.invalid",
      password: PASSWORD,
    });
    const result = await authenticate("  Persona.Mixta@Example.INVALID  ", PASSWORD);
    expect(result).toEqual({ ok: true, accountId: account.id, needsTotp: false });
  });

  it("rechaza la contraseña equivocada y registra el intento fallido", async () => {
    const account = await createAccount({ password: PASSWORD });
    expect(await authenticate(account.email, "otra-contrasena")).toEqual({
      ok: false,
    });
    const [entry] = await sql<{ action: string; account_id: string }[]>`
      SELECT action, account_id FROM audit_entries
    `;
    expect(entry.action).toBe("sesion_fallida");
    expect(entry.account_id).toBe(account.id);
  });

  it("audita como actor de plataforma el intento fallido de una Cuenta global", async () => {
    const platform = await createAccount({
      password: PASSWORD,
      isPlatformAdmin: true,
      totpSecret: createTotpSecret(),
    });
    expect(await authenticate(platform.email, "otra-contrasena")).toEqual({
      ok: false,
    });

    const [entry] = await sql<
      { action: string; actor_kind: string; account_id: string }[]
    >`SELECT action, actor_kind, account_id FROM audit_entries`;
    expect(entry.action).toBe("sesion_fallida");
    expect(entry.actor_kind).toBe("platform");
    expect(entry.account_id).toBe(platform.id);
  });

  it("nunca revela si el correo existe: la respuesta es idéntica y sin auditoría", async () => {
    const account = await createAccount({ password: PASSWORD });
    const desconocido = await authenticate("nadie@example.invalid", PASSWORD);
    expect(desconocido).toEqual({ ok: false });
    expect(await auditActions()).toEqual([]);

    const equivocada = await authenticate(account.email, "otra-contrasena");
    expect(equivocada).toEqual(desconocido);
  });

  it("rechaza correo o contraseña vacíos sin consultar la Cuenta", async () => {
    await createAccount({ email: "vacio@example.invalid", password: PASSWORD });
    expect(await authenticate("   ", PASSWORD)).toEqual({ ok: false });
    expect(await authenticate("vacio@example.invalid", "")).toEqual({ ok: false });
    expect(await auditActions()).toEqual([]);
  });

  it("exige segundo factor sólo a un Administrador de plataforma con secreto", async () => {
    const platform = await createAccount({
      password: PASSWORD,
      isPlatformAdmin: true,
      totpSecret: createTotpSecret(),
    });
    const result = await authenticate(platform.email, PASSWORD);
    expect(result).toEqual({ ok: true, accountId: platform.id, needsTotp: true });

    const [entry] = await sql<
      { actor_kind: string; payload: { segundo_factor?: boolean } }[]
    >`SELECT actor_kind, payload FROM audit_entries`;
    expect(entry.actor_kind).toBe("platform");
    expect(entry.payload.segundo_factor).toBe(true);
  });

  it("no exige segundo factor a un Administrador de plataforma sin secreto", async () => {
    const platform = await createAccount({
      password: PASSWORD,
      isPlatformAdmin: true,
    });
    expect(await authenticate(platform.email, PASSWORD)).toEqual({
      ok: true,
      accountId: platform.id,
      needsTotp: false,
    });
  });

  it("no exige segundo factor a una Cuenta de Miembro aunque tenga secreto", async () => {
    const member = await createAccount({
      password: PASSWORD,
      totpSecret: createTotpSecret(),
    });
    expect(await authenticate(member.email, PASSWORD)).toEqual({
      ok: true,
      accountId: member.id,
      needsTotp: false,
    });
  });
});

describe("verifyAccountTotp", () => {
  it("acepta el código vigente y lo audita", async () => {
    const secret = createTotpSecret();
    const platform = await createAccount({ isPlatformAdmin: true, totpSecret: secret });
    expect(await verifyAccountTotp(platform.id, totpCode(secret))).toBe(true);
    expect(await auditActions()).toEqual(["segundo_factor_verificado"]);
  });

  it("rechaza un código incorrecto y lo audita", async () => {
    const secret = createTotpSecret();
    const platform = await createAccount({ isPlatformAdmin: true, totpSecret: secret });
    expect(await verifyAccountTotp(platform.id, "000000")).toBe(false);
    expect(await auditActions()).toEqual(["segundo_factor_invalido"]);
  });

  it("rechaza a una Cuenta sin secreto y a una Cuenta inexistente", async () => {
    const account = await createAccount();
    expect(await verifyAccountTotp(account.id, "123456")).toBe(false);
    expect(await verifyAccountTotp(randomUUID(), "123456")).toBe(false);
    expect(await auditActions()).toEqual([]);
  });
});

describe("requestPasswordReset", () => {
  it("encola el enlace por correo y nunca lo devuelve a quien lo solicita", async () => {
    const account = await createAccount({ password: PASSWORD });
    await expect(requestPasswordReset(account.email)).resolves.toBeUndefined();

    const rows = await outbox("recuperacion_de_cuenta");
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient).toBe(account.email);
    expect(rows[0].payload.nombre).toBe(account.fullName);
    expect(rows[0].payload.vigencia_horas).toBe(1);
    expect(rows[0].payload.url).toContain("/acceso/nueva-contrasena/");
    expect(lastSegment(rows[0].payload.url ?? "")).not.toBe("");
  });

  it("guarda sólo el hash del enlace y una vigencia de una hora", async () => {
    const account = await createAccount();
    await requestPasswordReset(account.email);
    const token = await tokenSentTo("recuperacion_de_cuenta", account.email);

    const [reset] = await sql<
      { token_hash: string; expires_at: Date; used_at: Date | null }[]
    >`SELECT token_hash, expires_at, used_at FROM password_resets`;
    expect(reset.token_hash).not.toBe(token);
    expect(reset.used_at).toBeNull();
    expect(
      Math.abs(reset.expires_at.getTime() - (Date.now() + 3_600_000))
    ).toBeLessThan(60_000);
    expect(await auditActions()).toEqual(["recuperacion_solicitada"]);
  });

  it("no revela nada ni encola correo para una dirección desconocida", async () => {
    await requestPasswordReset("nadie@example.invalid");
    expect(await outbox("recuperacion_de_cuenta")).toHaveLength(0);
    const [{ total }] = await sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM password_resets
    `;
    expect(total).toBe(0);
  });

  it("ignora una dirección vacía o con formato inválido", async () => {
    await requestPasswordReset("   ");
    await requestPasswordReset("sin-arroba");
    expect(await outbox("recuperacion_de_cuenta")).toHaveLength(0);
  });

  it("invalida el enlace anterior cuando se solicita otra recuperación", async () => {
    const account = await createAccount({ password: PASSWORD });
    await requestPasswordReset(account.email);
    const primero = await tokenSentTo("recuperacion_de_cuenta", account.email);
    await requestPasswordReset(account.email);
    const segundo = await tokenSentTo("recuperacion_de_cuenta", account.email);

    expect(segundo).not.toBe(primero);
    expect(await completePasswordReset(primero, "Contrasena.Nueva.1")).toBe(false);
    expect(await completePasswordReset(segundo, "Contrasena.Nueva.1")).toBe(true);
  });
});

describe("completePasswordReset", () => {
  it("establece la contraseña nueva, invalida la anterior y revoca sesiones", async () => {
    const account = await createAccount({ password: PASSWORD });
    await sql`
      INSERT INTO sessions (account_id, token_hash, expires_at)
      VALUES (${account.id}, ${randomUUID()}, NOW() + INTERVAL '12 hours')
    `;
    await requestPasswordReset(account.email);
    const token = await tokenSentTo("recuperacion_de_cuenta", account.email);

    expect(await completePasswordReset(token, "Contrasena.Nueva.1")).toBe(true);
    expect(await authenticate(account.email, "Contrasena.Nueva.1")).toMatchObject({
      ok: true,
    });
    expect(await authenticate(account.email, PASSWORD)).toEqual({ ok: false });

    const [session] = await sql<{ revoked_at: Date | null }[]>`
      SELECT revoked_at FROM sessions
    `;
    expect(session.revoked_at).not.toBeNull();
    expect(await auditActions()).toContain("contrasena_restablecida");
  });

  it("es de un solo uso", async () => {
    const account = await createAccount({ password: PASSWORD });
    await requestPasswordReset(account.email);
    const token = await tokenSentTo("recuperacion_de_cuenta", account.email);

    expect(await completePasswordReset(token, "Contrasena.Nueva.1")).toBe(true);
    expect(await completePasswordReset(token, "Contrasena.Tercera.1")).toBe(false);
    expect(await authenticate(account.email, "Contrasena.Tercera.1")).toEqual({
      ok: false,
    });
  });

  it("rechaza un enlace desconocido", async () => {
    expect(await completePasswordReset("enlace-inventado", "Contrasena.Nueva.1")).toBe(
      false
    );
  });

  it("rechaza un enlace vencido", async () => {
    const account = await createAccount({ password: PASSWORD });
    await requestPasswordReset(account.email);
    const token = await tokenSentTo("recuperacion_de_cuenta", account.email);
    await sql`UPDATE password_resets SET expires_at = NOW() - INTERVAL '1 minute'`;

    expect(await completePasswordReset(token, "Contrasena.Nueva.1")).toBe(false);
    expect(await authenticate(account.email, PASSWORD)).toMatchObject({ ok: true });
  });

  it("rechaza un enlace vacío o una contraseña demasiado corta", async () => {
    const account = await createAccount({ password: PASSWORD });
    await requestPasswordReset(account.email);
    const token = await tokenSentTo("recuperacion_de_cuenta", account.email);

    expect(await completePasswordReset("", "Contrasena.Nueva.1")).toBe(false);
    expect(await completePasswordReset(token, "corta12")).toBe(false);
    const [reset] = await sql<{ used_at: Date | null }[]>`
      SELECT used_at FROM password_resets
    `;
    expect(reset.used_at).toBeNull();
  });
});

describe("prepareInvitation", () => {
  it("crea la invitación en estado Preparada, sin enlace y sin correo", async () => {
    const { organization, context } = await createAdministeredOrganization();
    await prepareInvitation(context, "  Nueva.Persona@Example.Invalid ", [
      "reviewer",
      "administrator",
    ]);

    const invitation = await invitationRow("nueva.persona@example.invalid");
    expect(invitation.status).toBe("prepared");
    // Todavía no se envía el enlace: la invitación no tiene token.
    expect(invitation.token_hash).toBeNull();
    expect(invitation.sent_at).toBeNull();
    // Los roles se guardan en el orden canónico Administrador · Emisor · Revisor.
    expect(invitation.roles).toEqual(["administrator", "reviewer"]);
    expect(await outbox("invitacion_de_miembro")).toHaveLength(0);

    const [entry] = await sql<
      { action: string; organization_id: string; payload: { correo?: string } }[]
    >`SELECT action, organization_id, payload FROM audit_entries`;
    expect(entry.action).toBe("invitacion_preparada");
    expect(entry.organization_id).toBe(organization.id);
    expect(entry.payload.correo).toBe("nueva.persona@example.invalid");
  });

  it("rechaza un correo con formato inválido", async () => {
    const { context } = await createAdministeredOrganization();
    await expect(prepareInvitation(context, "sin-arroba", ["emitter"])).rejects.toThrow(
      ConflictError
    );
  });

  it("exige al menos un rol", async () => {
    const { context } = await createAdministeredOrganization();
    await expect(
      prepareInvitation(context, "persona@example.invalid", [])
    ).rejects.toThrow("Elige al menos un rol para este acceso.");
  });

  it("rechaza un correo que ya es Miembro activo de la Organización", async () => {
    const { context, account } = await createAdministeredOrganization();
    await expect(
      prepareInvitation(context, account.email.toUpperCase(), ["emitter"])
    ).rejects.toThrow("Ese correo ya es un Miembro activo de la Organización.");
  });

  it("admite una sola invitación pendiente por correo en la Organización", async () => {
    const { context } = await createAdministeredOrganization();
    await prepareInvitation(context, "duplicada@example.invalid", ["emitter"]);
    await expect(
      prepareInvitation(context, "duplicada@example.invalid", ["reviewer"])
    ).rejects.toThrow("Ya existe una invitación pendiente para ese correo.");
  });

  it("considera pendiente también una invitación enviada o vencida", async () => {
    const { context } = await createAdministeredOrganization();
    const { id } = await inviteAndSend(context, "pendiente@example.invalid");
    await expect(
      prepareInvitation(context, "pendiente@example.invalid", ["emitter"])
    ).rejects.toThrow(ConflictError);

    await sql`
      UPDATE member_invitations SET expires_at = NOW() - INTERVAL '1 day' WHERE id = ${id}
    `;
    await expect(
      prepareInvitation(context, "pendiente@example.invalid", ["emitter"])
    ).rejects.toThrow(ConflictError);
  });

  it("permite invitar el mismo correo en otra Organización", async () => {
    const primera = await createAdministeredOrganization();
    const segunda = await createAdministeredOrganization();
    await prepareInvitation(primera.context, "compartida@example.invalid", ["emitter"]);
    await expect(
      prepareInvitation(segunda.context, "compartida@example.invalid", ["reviewer"])
    ).resolves.toBeUndefined();
  });

  it("permite volver a invitar un correo después de revocarlo", async () => {
    const { context } = await createAdministeredOrganization();
    const { id } = await inviteAndSend(context, "reintento@example.invalid");
    await revokeInvitation(context, id);
    await expect(
      prepareInvitation(context, "reintento@example.invalid", ["reviewer"])
    ).resolves.toBeUndefined();

    const [{ total }] = await sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM member_invitations
    `;
    expect(total).toBe(2);
  });
});

describe("sendInvitation", () => {
  it("envía un enlace de un solo uso vigente treinta días", async () => {
    const { organization, context } = await createAdministeredOrganization();
    const { token } = await inviteAndSend(context, "envio@example.invalid", [
      "emitter",
      "reviewer",
    ]);

    const invitation = await invitationRow("envio@example.invalid");
    expect(invitation.status).toBe("invited");
    expect(invitation.token_hash).not.toBeNull();
    expect(invitation.sent_at).not.toBeNull();
    expect(
      Math.abs((invitation.expires_at?.getTime() ?? 0) - (Date.now() + 30 * DAY_MS))
    ).toBeLessThan(60_000);

    const [mensaje] = await outbox("invitacion_de_miembro");
    expect(mensaje.recipient).toBe("envio@example.invalid");
    expect(mensaje.organization_id).toBe(organization.id);
    expect(mensaje.payload.organizacion).toBe(organization.name);
    expect(mensaje.payload.roles).toEqual(["Emisor", "Revisor"]);
    expect(mensaje.payload.vigencia_dias).toBe(30);
    expect(mensaje.payload.url).toBe(`http://localhost:3002/invitacion/${token}`);
    expect(await auditActions()).toEqual([
      "invitacion_preparada",
      "invitacion_enviada",
    ]);
  });

  it("guarda sólo el hash del enlace", async () => {
    const { context } = await createAdministeredOrganization();
    const { token } = await inviteAndSend(context, "hash@example.invalid");
    const invitation = await invitationRow("hash@example.invalid");
    expect(invitation.token_hash).not.toBe(token);
  });

  it("reenviar genera un enlace nuevo e invalida el anterior", async () => {
    const { context } = await createAdministeredOrganization();
    const { id, token: primero } = await inviteAndSend(
      context,
      "reenvio@example.invalid"
    );
    await sendInvitation(context, id);
    const segundo = await tokenSentTo("invitacion_de_miembro", "reenvio@example.invalid");

    expect(segundo).not.toBe(primero);
    expect(await loadInvitation(primero)).toBeNull();
    expect(await loadInvitation(segundo)).toMatchObject({ usable: true });
    expect(await outbox("invitacion_de_miembro")).toHaveLength(2);
  });

  it("puede reenviarse una invitación vencida con otros treinta días", async () => {
    const { context } = await createAdministeredOrganization();
    const { id } = await inviteAndSend(context, "vencida@example.invalid");
    await sql`
      UPDATE member_invitations
      SET status = 'expired', expires_at = NOW() - INTERVAL '1 day' WHERE id = ${id}
    `;

    await sendInvitation(context, id);
    const invitation = await invitationRow("vencida@example.invalid");
    expect(invitation.status).toBe("invited");
    expect(
      Math.abs((invitation.expires_at?.getTime() ?? 0) - (Date.now() + 30 * DAY_MS))
    ).toBeLessThan(60_000);
  });

  it("no encuentra una invitación de otra Organización", async () => {
    const primera = await createAdministeredOrganization();
    const segunda = await createAdministeredOrganization();
    const { id } = await inviteAndSend(primera.context, "ajena@example.invalid");
    await expect(sendInvitation(segunda.context, id)).rejects.toThrow(NotFoundError);
    await expect(sendInvitation(primera.context, randomUUID())).rejects.toThrow(
      NotFoundError
    );
  });

  it("no reenvía una invitación revocada o ya activada", async () => {
    const { context } = await createAdministeredOrganization();
    const { id } = await inviteAndSend(context, "cerrada@example.invalid");
    await revokeInvitation(context, id);
    await expect(sendInvitation(context, id)).rejects.toThrow(
      "Esta invitación ya no puede enviarse."
    );
  });
});

describe("updateInvitationRoles", () => {
  it("cambia los roles sin reenviar el enlace y la activación usa los vigentes", async () => {
    const { organization, context } = await createAdministeredOrganization();
    const { id, token } = await inviteAndSend(context, "roles@example.invalid", [
      "emitter",
    ]);

    await updateInvitationRoles(context, id, ["reviewer", "administrator"]);
    expect(await outbox("invitacion_de_miembro")).toHaveLength(1);
    expect(await loadInvitation(token)).toMatchObject({
      roles: ["administrator", "reviewer"],
      roleLabels: "Administrador · Revisor",
    });

    const result = await activateInvitation(token, {
      fullName: "Persona Con Roles Nuevos",
      password: "Contrasena.Nueva.1",
    });
    expect(result.ok).toBe(true);
    const [member] = await sql<{ roles: OrganizationRole[] }[]>`
      SELECT roles FROM organization_members
      WHERE organization_id = ${organization.id}
        AND account_id <> ${context.account.accountId}
    `;
    expect(member.roles).toEqual(["administrator", "reviewer"]);
  });

  it("exige al menos un rol y una invitación existente", async () => {
    const { context } = await createAdministeredOrganization();
    const { id } = await inviteAndSend(context, "roles2@example.invalid");
    await expect(updateInvitationRoles(context, id, [])).rejects.toThrow(ConflictError);
    await expect(
      updateInvitationRoles(context, randomUUID(), ["emitter"])
    ).rejects.toThrow(NotFoundError);
  });

  it("sólo edita invitaciones pendientes", async () => {
    const { context } = await createAdministeredOrganization();
    const { id } = await inviteAndSend(context, "roles3@example.invalid");
    await revokeInvitation(context, id);
    await expect(updateInvitationRoles(context, id, ["emitter"])).rejects.toThrow(
      "Sólo puedes editar los roles de una invitación pendiente."
    );
  });
});

describe("revokeInvitation", () => {
  it("invalida el enlace de inmediato y conserva el registro y su historial", async () => {
    const { context } = await createAdministeredOrganization();
    const { id, token } = await inviteAndSend(context, "revocada@example.invalid");

    await revokeInvitation(context, id);
    const invitation = await invitationRow("revocada@example.invalid");
    expect(invitation.status).toBe("revoked");
    expect(invitation.revoked_at).not.toBeNull();
    // El hash se conserva para poder explicar el estado del enlace.
    expect(invitation.token_hash).not.toBeNull();

    const resultado = await activateInvitation(token, {
      fullName: "Persona Revocada",
      password: "Contrasena.Nueva.1",
    });
    expect(resultado.ok).toBe(false);
    expect(await memberCount(context.organization.id)).toBe(1);
    expect(await auditActions()).toEqual([
      "invitacion_preparada",
      "invitacion_enviada",
      "invitacion_revocada",
    ]);
  });

  it("no revoca dos veces ni una invitación inexistente", async () => {
    const { context } = await createAdministeredOrganization();
    const { id } = await inviteAndSend(context, "revocada2@example.invalid");
    await revokeInvitation(context, id);
    await expect(revokeInvitation(context, id)).rejects.toThrow(
      "Sólo puedes revocar una invitación pendiente."
    );
    await expect(revokeInvitation(context, randomUUID())).rejects.toThrow(NotFoundError);
  });
});

describe("deleteInvitation", () => {
  it("borra el registro y su historial sin dejar la dirección equivocada", async () => {
    const { organization, context } = await createAdministeredOrganization();
    const { id, token } = await inviteAndSend(context, "equivocada@example.invalid");

    await deleteInvitation(context, id);

    const [{ total }] = await sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM member_invitations
      WHERE organization_id = ${organization.id}
    `;
    expect(total).toBe(0);
    expect(await loadInvitation(token)).toBeNull();

    const entries = await sql<{ action: string; payload: { correo?: string } }[]>`
      SELECT action, payload FROM audit_entries ORDER BY created_at ASC, id ASC
    `;
    expect(entries.map((entry) => entry.action)).toEqual(["invitacion_eliminada"]);
    expect(JSON.stringify(entries)).not.toContain("equivocada@example.invalid");
  });

  it("puede borrar una invitación preparada o revocada, pero no una activada", async () => {
    const { context } = await createAdministeredOrganization();
    await prepareInvitation(context, "preparada@example.invalid", ["emitter"]);
    const preparada = await invitationRow("preparada@example.invalid");
    await expect(deleteInvitation(context, preparada.id)).resolves.toBeUndefined();

    const { id } = await inviteAndSend(context, "revocada3@example.invalid");
    await revokeInvitation(context, id);
    await expect(deleteInvitation(context, id)).resolves.toBeUndefined();

    await expect(deleteInvitation(context, randomUUID())).rejects.toThrow(NotFoundError);
  });

  it("no borra una invitación ya activada", async () => {
    const { context } = await createAdministeredOrganization();
    const { id, token } = await inviteAndSend(context, "activada@example.invalid");
    await activateInvitation(token, {
      fullName: "Persona Activada",
      password: "Contrasena.Nueva.1",
    });
    await expect(deleteInvitation(context, id)).rejects.toThrow(
      "Esta invitación ya se activó."
    );
  });
});

describe("loadInvitation", () => {
  it("describe una invitación vigente para una persona nueva", async () => {
    const { organization, context } = await createAdministeredOrganization();
    const { id, token } = await inviteAndSend(context, "vista@example.invalid", [
      "emitter",
    ]);

    const view = await loadInvitation(token);
    expect(view).toMatchObject({
      id,
      organizationId: organization.id,
      organizationName: organization.name,
      email: "vista@example.invalid",
      roles: ["emitter"],
      roleLabels: "Emisor",
      status: "invited",
      accountExists: false,
      accountName: null,
      activeSeats: 1,
      seatLimit: 10,
      usable: true,
      reason: "ok",
    });
    expect(view?.expiresAt).toBeInstanceOf(Date);
  });

  it("reconoce que el correo ya identifica una Cuenta individual", async () => {
    const { context } = await createAdministeredOrganization();
    const existente = await createAccount({
      email: "existente@example.invalid",
      fullName: "Persona Existente",
      password: PASSWORD,
    });
    const { token } = await inviteAndSend(context, existente.email);

    expect(await loadInvitation(token)).toMatchObject({
      accountExists: true,
      accountName: "Persona Existente",
      usable: true,
    });
  });

  it("devuelve null para un enlace vacío o desconocido", async () => {
    expect(await loadInvitation("")).toBeNull();
    expect(await loadInvitation("enlace-inventado")).toBeNull();
  });

  it("marca como Vencida la invitación cuyo enlace expiró", async () => {
    const { context } = await createAdministeredOrganization();
    const { token } = await inviteAndSend(context, "expira@example.invalid");
    await sql`UPDATE member_invitations SET expires_at = NOW() - INTERVAL '1 minute'`;

    expect(await loadInvitation(token)).toMatchObject({
      status: "expired",
      usable: false,
      reason: "expired",
    });
    expect((await invitationRow("expira@example.invalid")).status).toBe("expired");
  });

  it("avisa cuando la persona ya es Miembro de la Organización", async () => {
    const { organization, context } = await createAdministeredOrganization();
    const { token } = await inviteAndSend(context, "yamiembro@example.invalid");
    const cuenta = await createAccount({ email: "yamiembro@example.invalid" });
    await addMembership(organization.id, cuenta.id, ["emitter"]);

    expect(await loadInvitation(token)).toMatchObject({
      usable: false,
      reason: "already_member",
      accountExists: true,
    });
  });

  it("avisa cuando la Organización no tiene Asientos disponibles", async () => {
    const { context } = await createAdministeredOrganization(1);
    const { token } = await inviteAndSend(context, "sinasiento@example.invalid");

    const view = await loadInvitation(token);
    expect(view).toMatchObject({
      usable: false,
      reason: "no_seat",
      activeSeats: 1,
      seatLimit: 1,
    });
    expect(invitationBlockMessage(view?.reason ?? "ok")).toBe(NO_SEATS_MESSAGE);
  });

  it("trata como no enviada una invitación Preparada con enlace (estado sólo alcanzable por reparación manual)", async () => {
    const { context } = await createAdministeredOrganization();
    const { id, token } = await inviteAndSend(context, "preparada2@example.invalid");
    await sql`UPDATE member_invitations SET status = 'prepared' WHERE id = ${id}`;

    expect(await loadInvitation(token)).toMatchObject({
      usable: false,
      reason: "not_sent",
    });
  });

  // ADR-0025 exige explicar `Esta invitación fue revocada` a quien abre el enlace
  // revocado. `revokeInvitation` borra `token_hash`, así que el enlace deja de
  // encontrarse y la persona ve `Este enlace no es válido`.
  it("explica que la invitación fue revocada al abrir el enlace", async () => {
    const { context } = await createAdministeredOrganization();
    const { id, token } = await inviteAndSend(context, "revocada4@example.invalid");
    await revokeInvitation(context, id);

    expect(await loadInvitation(token)).toMatchObject({
      status: "revoked",
      usable: false,
      reason: "revoked",
    });
  });

  // ADR-0025 exige explicar `Esta invitación ya se utilizó. Inicia sesión` al
  // reabrir un enlace consumido. `activateInvitation` borra `token_hash`.
  it("explica que la invitación ya se utilizó al reabrir el enlace", async () => {
    const { context } = await createAdministeredOrganization();
    const { token } = await inviteAndSend(context, "consumida@example.invalid");
    await activateInvitation(token, {
      fullName: "Persona Consumida",
      password: "Contrasena.Nueva.1",
    });

    expect(await loadInvitation(token)).toMatchObject({
      status: "active",
      usable: false,
      reason: "consumed",
    });
  });
});

describe("activateInvitation con una persona nueva", () => {
  it("crea la Cuenta con nombre y contraseña propios y ocupa un Asiento", async () => {
    const { organization, context } = await createAdministeredOrganization();
    const { id, token } = await inviteAndSend(context, "nueva@example.invalid", [
      "emitter",
      "reviewer",
    ]);

    const result = await activateInvitation(token, {
      fullName: "  Persona   Nueva  ",
      password: "Contrasena.Nueva.1",
    });
    expect(result.ok).toBe(true);

    const [account] = await sql<{ id: string; email: string; full_name: string }[]>`
      SELECT id, email, full_name FROM accounts WHERE email = 'nueva@example.invalid'
    `;
    expect(account.full_name).toBe("Persona Nueva");
    expect(result).toEqual({ ok: true, accountId: account.id, needsTotp: false });
    expect(await authenticate("nueva@example.invalid", "Contrasena.Nueva.1")).toEqual({
      ok: true,
      accountId: account.id,
      needsTotp: false,
    });

    const [member] = await sql<{ roles: OrganizationRole[]; is_primary_admin: boolean }[]>`
      SELECT roles, is_primary_admin FROM organization_members
      WHERE organization_id = ${organization.id} AND account_id = ${account.id}
    `;
    expect(member.roles).toEqual(["emitter", "reviewer"]);
    expect(member.is_primary_admin).toBe(false);

    const invitation = await invitationRow("nueva@example.invalid");
    expect(invitation.id).toBe(id);
    expect(invitation.status).toBe("active");
    expect(invitation.activated_at).not.toBeNull();
    // El hash se conserva para poder explicar el estado del enlace.
    expect(invitation.token_hash).not.toBeNull();

    const [entry] = await sql<
      { action: string; payload: { cuenta_nueva?: boolean; roles?: string[] } }[]
    >`SELECT action, payload FROM audit_entries WHERE action = 'acceso_activado'`;
    expect(entry.payload.cuenta_nueva).toBe(true);
    expect(entry.payload.roles).toEqual(["emitter", "reviewer"]);
  });

  it("exige nombre completo y contraseña mínima", async () => {
    const { context } = await createAdministeredOrganization();
    const { token } = await inviteAndSend(context, "incompleta@example.invalid");

    expect(await activateInvitation(token, { password: "Contrasena.Nueva.1" })).toEqual({
      ok: false,
      error: "Captura tu nombre completo.",
    });
    expect(
      await activateInvitation(token, { fullName: "Ok", password: "Contrasena.Nueva.1" })
    ).toEqual({ ok: false, error: "Captura tu nombre completo." });
    expect(
      await activateInvitation(token, { fullName: "Persona Nueva", password: "corta12" })
    ).toEqual({
      ok: false,
      error: "Tu contraseña debe tener al menos 8 caracteres.",
    });
    expect(await memberCount(context.organization.id)).toBe(1);
    expect((await invitationRow("incompleta@example.invalid")).status).toBe("invited");
  });

  it("trata una contraseña ausente como vacía y no crea la Cuenta", async () => {
    const { context } = await createAdministeredOrganization();
    const { token } = await inviteAndSend(context, "sin-clave@example.invalid");

    // El formulario puede no enviar el campo: `undefined` no es una contraseña
    // válida y debe recibir el mismo mensaje que una demasiado corta.
    expect(await activateInvitation(token, { fullName: "Persona Nueva" })).toEqual({
      ok: false,
      error: "Tu contraseña debe tener al menos 8 caracteres.",
    });
    expect(await memberCount(context.organization.id)).toBe(1);
    expect((await invitationRow("sin-clave@example.invalid")).status).toBe("invited");

    const [cuenta] = await sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM accounts
      WHERE lower(email) = 'sin-clave@example.invalid'
    `;
    expect(cuenta.total).toBe(0);
  });

  it("rechaza un enlace vacío, desconocido, vencido o sin vigencia", async () => {
    const { context } = await createAdministeredOrganization();
    expect(await activateInvitation("", {})).toEqual({
      ok: false,
      error: "El enlace no es válido.",
    });
    expect(await activateInvitation("inventado", {})).toEqual({
      ok: false,
      error: "El enlace no es válido.",
    });

    const { id, token } = await inviteAndSend(context, "caducada@example.invalid");
    await sql`
      UPDATE member_invitations SET expires_at = NOW() - INTERVAL '1 day' WHERE id = ${id}
    `;
    const vencida = await activateInvitation(token, {
      fullName: "Persona Vencida",
      password: "Contrasena.Nueva.1",
    });
    expect(vencida).toEqual({
      ok: false,
      error: "Esta invitación venció. Pide a tu Administrador que te envíe una nueva.",
    });

    // Estado defensivo: enviada pero sin vigencia registrada.
    await sql`
      UPDATE member_invitations
      SET status = 'invited', expires_at = NULL WHERE id = ${id}
    `;
    const sinVigencia = await activateInvitation(token, {
      fullName: "Persona Vencida",
      password: "Contrasena.Nueva.1",
    });
    expect(sinVigencia).toMatchObject({ ok: false });
    expect((await invitationRow("caducada@example.invalid")).status).toBe("expired");
  });

  it("no activa una invitación Preparada (estado sólo alcanzable por reparación manual)", async () => {
    const { context } = await createAdministeredOrganization();
    const { id, token } = await inviteAndSend(context, "preparada3@example.invalid");
    await sql`UPDATE member_invitations SET status = 'prepared' WHERE id = ${id}`;

    expect(
      await activateInvitation(token, {
        fullName: "Persona Preparada",
        password: "Contrasena.Nueva.1",
      })
    ).toEqual({
      ok: false,
      error: "Esta invitación todavía no se envía. Pide a tu Administrador que la envíe.",
    });
  });

  it("no consume el enlace cuando la Organización quedó sin Asientos", async () => {
    const { context } = await createAdministeredOrganization(1);
    const { token } = await inviteAndSend(context, "sinlugar@example.invalid");

    expect(
      await activateInvitation(token, {
        fullName: "Persona Sin Lugar",
        password: "Contrasena.Nueva.1",
      })
    ).toEqual({ ok: false, error: NO_SEATS_MESSAGE });
    expect((await invitationRow("sinlugar@example.invalid")).status).toBe("invited");
  });

  it("rechaza a quien ya es Miembro de la Organización", async () => {
    const { organization, context } = await createAdministeredOrganization();
    const { token } = await inviteAndSend(context, "repetida@example.invalid");
    const cuenta = await createAccount({
      email: "repetida@example.invalid",
      password: PASSWORD,
    });
    await addMembership(organization.id, cuenta.id, ["emitter"]);

    expect(await activateInvitation(token, { password: PASSWORD })).toEqual({
      ok: false,
      error: "Ya tienes acceso a esta Organización. Inicia sesión.",
    });
  });

  it("rechaza un enlace ya utilizado", async () => {
    const { context } = await createAdministeredOrganization();
    const { token } = await inviteAndSend(context, "unsolouso@example.invalid");
    expect(
      await activateInvitation(token, {
        fullName: "Persona Única",
        password: "Contrasena.Nueva.1",
      })
    ).toMatchObject({ ok: true });

    expect(
      await activateInvitation(token, {
        fullName: "Persona Única",
        password: "Contrasena.Nueva.1",
      })
    ).toMatchObject({ ok: false });
    expect(await memberCount(context.organization.id)).toBe(2);
  });

  // ADR-0025: el enlace consumido debe explicar que ya se utilizó e invitar a
  // iniciar sesión, no presentarse como inválido.
  it("explica que el enlace ya se utilizó al reintentar la activación", async () => {
    const { context } = await createAdministeredOrganization();
    const { token } = await inviteAndSend(context, "unsolouso2@example.invalid");
    await activateInvitation(token, {
      fullName: "Persona Única",
      password: "Contrasena.Nueva.1",
    });

    expect(
      await activateInvitation(token, {
        fullName: "Persona Única",
        password: "Contrasena.Nueva.1",
      })
    ).toEqual({
      ok: false,
      error: "Esta invitación ya se utilizó. Inicia sesión con tu correo y contraseña.",
    });
  });

  // El segundo factor de una cuenta global se resuelve en su propio paso.
  it("deja pendiente el segundo factor de una Cuenta global", async () => {
    const { context } = await createAdministeredOrganization();
    const global = await createAccount({
      isPlatformAdmin: true,
      totpSecret: "JBSWY3DPEHPK3PXP",
    });
    const { token } = await inviteAndSend(context, global.email);

    const result = await activateInvitation(token, {
      password: PASSWORD,
    });

    expect(result).toEqual({
      ok: true,
      accountId: global.id,
      needsTotp: true,
    });
  });

  it("explica que la invitación fue revocada al intentar activarla", async () => {
    const { context } = await createAdministeredOrganization();
    const { id, token } = await inviteAndSend(context, "revocada5@example.invalid");
    await revokeInvitation(context, id);

    expect(
      await activateInvitation(token, {
        fullName: "Persona Revocada",
        password: "Contrasena.Nueva.1",
      })
    ).toEqual({
      ok: false,
      error: "Esta invitación fue revocada. Contacta al Administrador de tu Organización.",
    });
  });
});

describe("activateInvitation con una Cuenta existente", () => {
  it("acepta la membresía sin crear otra contraseña y reutiliza su nombre", async () => {
    const { organization, context } = await createAdministeredOrganization();
    const existente = await createAccount({
      email: "veterana@example.invalid",
      fullName: "Persona Veterana",
      password: PASSWORD,
    });
    const [{ password_hash: original }] = await sql<{ password_hash: string }[]>`
      SELECT password_hash FROM accounts WHERE id = ${existente.id}
    `;
    const { token } = await inviteAndSend(context, existente.email, ["reviewer"]);

    // No captura nombre ni establece una contraseña nueva: usa la que ya tiene.
    const result = await activateInvitation(token, { password: PASSWORD });
    expect(result).toEqual({ ok: true, accountId: existente.id, needsTotp: false });

    const [{ total }] = await sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM accounts
    `;
    expect(total).toBe(2);
    const [account] = await sql<{ full_name: string; password_hash: string }[]>`
      SELECT full_name, password_hash FROM accounts WHERE id = ${existente.id}
    `;
    expect(account.full_name).toBe("Persona Veterana");
    expect(account.password_hash).toBe(original);
    expect(verifyPassword(PASSWORD, account.password_hash)).toBe(true);

    const [member] = await sql<{ roles: OrganizationRole[] }[]>`
      SELECT roles FROM organization_members
      WHERE organization_id = ${organization.id} AND account_id = ${existente.id}
    `;
    expect(member.roles).toEqual(["reviewer"]);

    const [entry] = await sql<
      { actor_name: string; payload: { cuenta_nueva?: boolean } }[]
    >`SELECT actor_name, payload FROM audit_entries WHERE action = 'acceso_activado'`;
    expect(entry.actor_name).toBe("Persona Veterana");
    expect(entry.payload.cuenta_nueva).toBe(false);
  });

  it("conserva las membresías de esa Cuenta en otras Organizaciones", async () => {
    const primera = await createAdministeredOrganization();
    const segunda = await createAdministeredOrganization();
    const persona = await createAccount({ password: PASSWORD });
    await addMembership(primera.organization.id, persona.id, ["emitter"]);

    const { token } = await inviteAndSend(segunda.context, persona.email, [
      "administrator",
    ]);
    expect(await activateInvitation(token, { password: PASSWORD })).toMatchObject({
      ok: true,
    });

    const rows = await sql<{ organization_id: string; roles: OrganizationRole[] }[]>`
      SELECT organization_id, roles FROM organization_members
      WHERE account_id = ${persona.id} ORDER BY organization_id
    `;
    expect(rows).toHaveLength(2);
  });

  it("rechaza una contraseña que no coincide con la de la Cuenta", async () => {
    const { context } = await createAdministeredOrganization();
    const existente = await createAccount({
      email: "otra@example.invalid",
      password: PASSWORD,
    });
    const { token } = await inviteAndSend(context, existente.email);

    expect(await activateInvitation(token, { password: "no-es-la-mia" })).toEqual({
      ok: false,
      error: "La contraseña no coincide con la de tu cuenta.",
    });
    expect(await memberCount(context.organization.id)).toBe(1);
    expect((await invitationRow(existente.email)).status).toBe("invited");
  });
});

describe("activateInvitation y el límite de diez Asientos", () => {
  it("una invitación pendiente no reserva Asiento", async () => {
    const { organization, context } = await createAdministeredOrganization();
    await inviteAndSend(context, "reserva1@example.invalid");
    await inviteAndSend(context, "reserva2@example.invalid");
    await inviteAndSend(context, "reserva3@example.invalid");

    const overview = await listAccess(context);
    expect(overview.activeSeats).toBe(1);
    expect(overview.seatsAvailable).toBe(9);
    expect(overview.invitations).toHaveLength(3);
    expect(await memberCount(organization.id)).toBe(1);
  });

  it("concede un solo Asiento cuando dos activaciones simultáneas compiten por el último", async () => {
    const { organization, context } = await createAdministeredOrganization();
    for (let index = 0; index < 8; index += 1) {
      const relleno = await createAccount();
      await addMembership(organization.id, relleno.id, ["emitter"]);
    }
    expect(await memberCount(organization.id)).toBe(9);

    const primera = await inviteAndSend(context, "carrera1@example.invalid");
    const segunda = await inviteAndSend(context, "carrera2@example.invalid");

    const results = await Promise.all([
      activateInvitation(primera.token, {
        fullName: "Persona Carrera Uno",
        password: "Contrasena.Nueva.1",
      }),
      activateInvitation(segunda.token, {
        fullName: "Persona Carrera Dos",
        password: "Contrasena.Nueva.1",
      }),
    ]);

    const ganadores = results.filter((result) => result.ok);
    const perdedores = results.filter((result) => !result.ok);
    expect(ganadores).toHaveLength(1);
    expect(perdedores).toHaveLength(1);
    expect(perdedores[0]).toEqual({ ok: false, error: NO_SEATS_MESSAGE });
    expect(await memberCount(organization.id)).toBe(10);

    // El perdedor conserva una invitación utilizable en cuanto se libere un lugar.
    const perdedorEsPrimera = !results[0].ok;
    const perdedor = perdedorEsPrimera ? primera : segunda;
    const invitacion = await loadInvitation(perdedor.token);
    expect(invitacion).toMatchObject({
      status: "invited",
      usable: false,
      reason: "no_seat",
      activeSeats: 10,
      seatLimit: 10,
    });

    const [liberado] = await sql<{ id: string }[]>`
      SELECT m.id FROM organization_members m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.organization_id = ${organization.id} AND NOT m.is_primary_admin
      ORDER BY a.created_at ASC LIMIT 1
    `;
    await removeMember(context, liberado.id);

    expect(await loadInvitation(perdedor.token)).toMatchObject({ usable: true });
    expect(
      await activateInvitation(perdedor.token, {
        fullName: perdedorEsPrimera ? "Persona Carrera Uno" : "Persona Carrera Dos",
        password: "Contrasena.Nueva.1",
      })
    ).toMatchObject({ ok: true });
    expect(await memberCount(organization.id)).toBe(10);
  });
});

describe("listAccess", () => {
  it("sólo la ve un Administrador", async () => {
    const { organization, account } = await createAdministeredOrganization();
    const emisor = await buildContext(organization.id, account, ["emitter"]);
    await expect(listAccess(emisor)).rejects.toThrow(AuthorizationError);
  });

  it("devuelve Miembros, invitaciones, Asientos activos y límite", async () => {
    const { organization, context, account } = await createAdministeredOrganization();
    const companera = await createAccount({ fullName: "Aaa Companera" });
    await addMembership(organization.id, companera.id, ["reviewer", "emitter"]);
    await inviteAndSend(context, "listada@example.invalid", ["administrator"]);
    await prepareInvitation(context, "solo-preparada@example.invalid", ["emitter"]);

    const overview = await listAccess(context);
    expect(overview.activeSeats).toBe(2);
    expect(overview.seatLimit).toBe(10);
    expect(overview.seatsAvailable).toBe(8);
    expect(overview.canInvite).toBe(true);

    // El Administrador principal encabeza la lista.
    expect(overview.members[0]).toMatchObject({
      accountId: account.id,
      email: account.email,
      isPrimaryAdmin: true,
      isSelf: true,
      roleLabels: "Administrador",
    });
    expect(overview.members[1]).toMatchObject({
      accountId: companera.id,
      isPrimaryAdmin: false,
      isSelf: false,
      roles: ["reviewer", "emitter"],
    });
    expect(overview.members[1].createdAt).toBeInstanceOf(Date);

    const invitada = overview.invitations.find(
      (item) => item.email === "listada@example.invalid"
    );
    expect(invitada).toMatchObject({
      status: "invited",
      statusLabel: "Invitada",
      pending: true,
      roleLabels: "Administrador",
    });
    expect(invitada?.sentAt).toBeInstanceOf(Date);
    expect(invitada?.expiresAt).toBeInstanceOf(Date);

    const preparada = overview.invitations.find(
      (item) => item.email === "solo-preparada@example.invalid"
    );
    expect(preparada).toMatchObject({
      status: "prepared",
      statusLabel: "Preparada",
      pending: true,
      sentAt: null,
      expiresAt: null,
    });
  });

  it("muestra Vencida y Revocada, y oculta las invitaciones ya activadas", async () => {
    const { context } = await createAdministeredOrganization();
    const vencida = await inviteAndSend(context, "vence@example.invalid");
    const revocada = await inviteAndSend(context, "revoca@example.invalid");
    const activada = await inviteAndSend(context, "activa@example.invalid");
    await sql`
      UPDATE member_invitations SET expires_at = NOW() - INTERVAL '1 day'
      WHERE id = ${vencida.id}
    `;
    await revokeInvitation(context, revocada.id);
    await activateInvitation(activada.token, {
      fullName: "Persona Activada",
      password: "Contrasena.Nueva.1",
    });

    const overview = await listAccess(context);
    const estados = Object.fromEntries(
      overview.invitations.map((item) => [item.email, item.statusLabel])
    );
    expect(estados).toEqual({
      "vence@example.invalid": "Vencida",
      "revoca@example.invalid": "Revocada",
    });
    expect(
      overview.invitations.find((item) => item.email === "vence@example.invalid")?.pending
    ).toBe(true);
    expect(
      overview.invitations.find((item) => item.email === "revoca@example.invalid")?.pending
    ).toBe(false);
    expect(overview.activeSeats).toBe(2);
  });

  it("no mezcla datos de otra Organización", async () => {
    const primera = await createAdministeredOrganization();
    const segunda = await createAdministeredOrganization();
    await inviteAndSend(segunda.context, "ajena2@example.invalid");

    const overview = await listAccess(primera.context);
    expect(overview.members).toHaveLength(1);
    expect(overview.invitations).toHaveLength(0);
  });

  it("respeta un límite de Asientos distinto de diez", async () => {
    const { context } = await createAdministeredOrganization(3);
    const overview = await listAccess(context);
    expect(overview.seatLimit).toBe(3);
    expect(overview.seatsAvailable).toBe(2);
  });
});

describe("updateMemberRoles", () => {
  it("cambia los roles de un Miembro y lo audita", async () => {
    const { organization, context } = await createAdministeredOrganization();
    const persona = await createAccount({ fullName: "Persona Cambiante" });
    const memberId = await addMembership(organization.id, persona.id, ["emitter"]);

    await updateMemberRoles(context, memberId, ["reviewer", "emitter"]);
    const [member] = await sql<{ roles: OrganizationRole[] }[]>`
      SELECT roles FROM organization_members WHERE id = ${memberId}
    `;
    expect(member.roles).toEqual(["emitter", "reviewer"]);

    const [entry] = await sql<
      { capability: string | null; payload: { nombre?: string; roles?: string[] } }[]
    >`
      SELECT capability, payload FROM audit_entries
      WHERE action = 'membresia_roles_actualizados'
    `;
    expect(entry.capability).toBe("administrator");
    expect(entry.payload.nombre).toBe("Persona Cambiante");
    expect(entry.payload.roles).toEqual(["emitter", "reviewer"]);
  });

  it("exige al menos un rol y un acceso existente de la misma Organización", async () => {
    const primera = await createAdministeredOrganization();
    const segunda = await createAdministeredOrganization();
    await expect(
      updateMemberRoles(primera.context, primera.memberId, [])
    ).rejects.toThrow(ConflictError);
    await expect(
      updateMemberRoles(primera.context, segunda.memberId, ["emitter"])
    ).rejects.toThrow(NotFoundError);
  });

  it("impide que el Administrador principal pierda el rol Administrador", async () => {
    const { context, memberId } = await createAdministeredOrganization();
    await expect(updateMemberRoles(context, memberId, ["emitter"])).rejects.toThrow(
      "El Administrador principal debe conservar el rol Administrador."
    );
  });

  it("impide dejar la Organización sin un Administrador activo", async () => {
    const organization = await createOrganization();
    const account = await createAccount();
    const memberId = await addMembership(organization.id, account.id, ["administrator"]);
    const context = await buildContext(organization.id, account, ["administrator"]);

    await expect(updateMemberRoles(context, memberId, ["emitter"])).rejects.toThrow(
      "La Organización debe conservar al menos un Administrador activo."
    );
    const [member] = await sql<{ roles: OrganizationRole[] }[]>`
      SELECT roles FROM organization_members WHERE id = ${memberId}
    `;
    expect(member.roles).toEqual(["administrator"]);
  });

  it("permite retirar el rol Administrador cuando queda otro Administrador", async () => {
    const { organization, context } = await createAdministeredOrganization();
    const segunda = await createAccount();
    const memberId = await addMembership(organization.id, segunda.id, [
      "administrator",
      "emitter",
    ]);

    await expect(
      updateMemberRoles(context, memberId, ["emitter"])
    ).resolves.toBeUndefined();
  });

  it("permite añadir roles al Administrador principal", async () => {
    const { context, memberId } = await createAdministeredOrganization();
    await updateMemberRoles(context, memberId, ["administrator", "emitter"]);
    const [member] = await sql<{ roles: OrganizationRole[] }[]>`
      SELECT roles FROM organization_members WHERE id = ${memberId}
    `;
    expect(member.roles).toEqual(["administrator", "emitter"]);
  });
});

describe("removeMember", () => {
  it("revoca sesiones, libera el Asiento y borra el historial de acceso", async () => {
    const { organization, context } = await createAdministeredOrganization();
    const persona = await createAccount({ fullName: "Persona Saliente" });
    const memberId = await addMembership(organization.id, persona.id, ["emitter"]);
    await inviteAndSend(context, "pendiente-suya@example.invalid");
    await sql`
      UPDATE member_invitations SET email = ${persona.email}
      WHERE lower(email) = 'pendiente-suya@example.invalid'
    `;

    await sql`
      INSERT INTO sessions (account_id, token_hash, expires_at, active_organization_id)
      VALUES (${persona.id}, ${randomUUID()}, NOW() + INTERVAL '12 hours', ${organization.id})
    `;
    await sql`
      INSERT INTO sessions (account_id, token_hash, expires_at, active_organization_id)
      VALUES (${persona.id}, ${randomUUID()}, NOW() + INTERVAL '12 hours', NULL)
    `;
    await sql`
      INSERT INTO audit_entries (organization_id, account_id, actor_name, action, subject_type, subject_id)
      VALUES (${organization.id}, ${persona.id}, 'Persona Saliente', 'membresia_roles_actualizados', 'membresia', ${memberId})
    `;
    await sql`
      INSERT INTO audit_entries (organization_id, account_id, actor_name, action, subject_type, subject_id)
      VALUES (${organization.id}, ${persona.id}, 'Persona Saliente', 'contrato_emitido', 'contrato', ${randomUUID()})
    `;

    await removeMember(context, memberId);

    expect(await memberCount(organization.id)).toBe(1);
    expect((await listAccess(context)).seatsAvailable).toBe(9);

    const sessions = await sql<{ revoked_at: Date | null }[]>`
      SELECT revoked_at FROM sessions WHERE account_id = ${persona.id}
    `;
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.revoked_at !== null)).toBe(true);

    const acceso = await sql<{ action: string }[]>`
      SELECT action FROM audit_entries
      WHERE subject_type IN ('membresia', 'invitacion', 'cuenta')
        AND account_id = ${persona.id}
    `;
    expect(acceso).toHaveLength(0);

    const [{ total: pendientes }] = await sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM member_invitations
      WHERE organization_id = ${organization.id}
    `;
    expect(pendientes).toBe(0);

    // El Contrato histórico conserva el nombre del antiguo Miembro.
    const [contrato] = await sql<{ actor_name: string }[]>`
      SELECT actor_name FROM audit_entries WHERE subject_type = 'contrato'
    `;
    expect(contrato.actor_name).toBe("Persona Saliente");

    const [eliminado] = await sql<{ payload: { nombre?: string } }[]>`
      SELECT payload FROM audit_entries WHERE action = 'acceso_eliminado'
    `;
    expect(eliminado.payload.nombre).toBe("Persona Saliente");
  });

  it("no toca las sesiones de esa Cuenta en otra Organización", async () => {
    const primera = await createAdministeredOrganization();
    const segunda = await createAdministeredOrganization();
    const persona = await createAccount();
    const memberId = await addMembership(primera.organization.id, persona.id, [
      "emitter",
    ]);
    await addMembership(segunda.organization.id, persona.id, ["emitter"]);
    await sql`
      INSERT INTO sessions (account_id, token_hash, expires_at, active_organization_id)
      VALUES (${persona.id}, ${randomUUID()}, NOW() + INTERVAL '12 hours', ${segunda.organization.id})
    `;

    await removeMember(primera.context, memberId);
    const [session] = await sql<{ revoked_at: Date | null }[]>`
      SELECT revoked_at FROM sessions WHERE account_id = ${persona.id}
    `;
    expect(session.revoked_at).toBeNull();
    expect(await memberCount(segunda.organization.id)).toBe(2);
  });

  it("protege al Administrador principal hasta que transfiera la condición", async () => {
    const { context, memberId } = await createAdministeredOrganization();
    await expect(removeMember(context, memberId)).rejects.toThrow(
      "Transfiere primero la condición de Administrador principal a otro Administrador activo."
    );
  });

  it("impide eliminar al último Administrador activo", async () => {
    const organization = await createOrganization();
    const account = await createAccount();
    const memberId = await addMembership(organization.id, account.id, ["administrator"]);
    const context = await buildContext(organization.id, account, ["administrator"]);

    await expect(removeMember(context, memberId)).rejects.toThrow(
      "La Organización debe conservar al menos un Administrador activo."
    );
  });

  it("no encuentra un acceso de otra Organización", async () => {
    const primera = await createAdministeredOrganization();
    const segunda = await createAdministeredOrganization();
    await expect(removeMember(primera.context, segunda.memberId)).rejects.toThrow(
      NotFoundError
    );
  });

  it("permite volver a invitar el mismo correo después de eliminar el acceso", async () => {
    const { organization, context } = await createAdministeredOrganization();
    const persona = await createAccount({ password: PASSWORD });
    const memberId = await addMembership(organization.id, persona.id, ["emitter"]);
    await removeMember(context, memberId);

    const { token } = await inviteAndSend(context, persona.email, ["reviewer"]);
    expect(await activateInvitation(token, { password: PASSWORD })).toMatchObject({
      ok: true,
    });
    const [member] = await sql<{ roles: OrganizationRole[] }[]>`
      SELECT roles FROM organization_members
      WHERE organization_id = ${organization.id} AND account_id = ${persona.id}
    `;
    expect(member.roles).toEqual(["reviewer"]);
  });
});

describe("transferPrimaryAdmin", () => {
  it("mueve sólo la protección y deja intactos los roles del anterior", async () => {
    const { organization, context, memberId } = await createAdministeredOrganization();
    const relevo = await createAccount({ fullName: "Persona Relevo" });
    const relevoId = await addMembership(organization.id, relevo.id, [
      "administrator",
      "emitter",
    ]);

    await transferPrimaryAdmin(context, relevoId);

    const rows = await sql<
      { id: string; is_primary_admin: boolean; roles: OrganizationRole[] }[]
    >`
      SELECT id, is_primary_admin, roles FROM organization_members
      WHERE organization_id = ${organization.id}
    `;
    const anterior = rows.find((row) => row.id === memberId);
    const nuevo = rows.find((row) => row.id === relevoId);
    expect(anterior?.is_primary_admin).toBe(false);
    expect(anterior?.roles).toEqual(["administrator"]);
    expect(nuevo?.is_primary_admin).toBe(true);
    expect(nuevo?.roles).toEqual(["administrator", "emitter"]);

    const [entry] = await sql<{ payload: { nombre?: string } }[]>`
      SELECT payload FROM audit_entries
      WHERE action = 'administrador_principal_transferido'
    `;
    expect(entry.payload.nombre).toBe("Persona Relevo");

    // Después de transferir, el acceso anterior ya puede eliminarse.
    const siguiente = await buildContext(organization.id, relevo, ["administrator"], {
      isPrimaryAdmin: true,
    });
    await expect(removeMember(siguiente, memberId)).resolves.toBeUndefined();
  });

  it("sólo la ejecuta el Administrador principal vigente", async () => {
    const { organization, context, memberId } = await createAdministeredOrganization();
    const otra = await createAccount();
    const otraId = await addMembership(organization.id, otra.id, ["administrator"]);
    const noPrincipal = await buildContext(organization.id, otra, ["administrator"]);

    await expect(transferPrimaryAdmin(noPrincipal, memberId)).rejects.toThrow(
      AuthorizationError
    );
    await expect(transferPrimaryAdmin(context, otraId)).resolves.toBeUndefined();
  });

  it("exige un destino existente con rol Administrador", async () => {
    const { organization, context } = await createAdministeredOrganization();
    const emisora = await createAccount();
    const emisoraId = await addMembership(organization.id, emisora.id, ["emitter"]);

    await expect(transferPrimaryAdmin(context, emisoraId)).rejects.toThrow(
      "La condición sólo puede transferirse a un Miembro activo con rol Administrador."
    );
    await expect(transferPrimaryAdmin(context, randomUUID())).rejects.toThrow(
      NotFoundError
    );
  });
});

describe("updateProfileName", () => {
  it("actualiza el nombre propio y lo audita sin tocar el historial", async () => {
    const { organization, context, account } = await createAdministeredOrganization();
    await prepareInvitation(context, "historial@example.invalid", ["emitter"]);

    await updateProfileName(account.id, "  Persona   Renombrada ");

    const [row] = await sql<{ full_name: string }[]>`
      SELECT full_name FROM accounts WHERE id = ${account.id}
    `;
    expect(row.full_name).toBe("Persona Renombrada");

    const entries = await sql<{ action: string; actor_name: string }[]>`
      SELECT action, actor_name FROM audit_entries ORDER BY created_at ASC, id ASC
    `;
    expect(entries[0].actor_name).toBe(account.fullName);
    expect(entries[1]).toMatchObject({
      action: "nombre_actualizado",
      actor_name: "Persona Renombrada",
    });

    // Las acciones futuras usan el nombre nuevo.
    const siguiente = await buildContext(organization.id, {
      ...account,
      fullName: "Persona Renombrada",
    }, ["administrator"], { isPrimaryAdmin: true });
    await prepareInvitation(siguiente, "futura@example.invalid", ["emitter"]);
    const [ultima] = await sql<{ actor_name: string }[]>`
      SELECT actor_name FROM audit_entries ORDER BY created_at DESC, id DESC LIMIT 1
    `;
    expect(ultima.actor_name).toBe("Persona Renombrada");
  });

  it("no modifica el nombre de otra Cuenta", async () => {
    const primera = await createAccount({ fullName: "Persona Uno" });
    const segunda = await createAccount({ fullName: "Persona Dos" });
    await updateProfileName(primera.id, "Persona Uno Corregida");

    const [row] = await sql<{ full_name: string }[]>`
      SELECT full_name FROM accounts WHERE id = ${segunda.id}
    `;
    expect(row.full_name).toBe("Persona Dos");
  });

  it("exige un nombre completo", async () => {
    const account = await createAccount({ fullName: "Persona Uno" });
    await expect(updateProfileName(account.id, "  A  ")).rejects.toThrow(
      "Captura tu nombre completo."
    );
    const [row] = await sql<{ full_name: string }[]>`
      SELECT full_name FROM accounts WHERE id = ${account.id}
    `;
    expect(row.full_name).toBe("Persona Uno");
  });
});

describe("autorización de la pantalla Accesos", () => {
  it("rechaza a un Emisor en toda acción de administración de acceso", async () => {
    const { organization, account, memberId, context } =
      await createAdministeredOrganization();
    const { id } = await inviteAndSend(context, "protegida@example.invalid");
    const emisor = await buildContext(organization.id, account, ["emitter"]);

    await expect(listAccess(emisor)).rejects.toThrow(AuthorizationError);
    await expect(
      prepareInvitation(emisor, "intruso@example.invalid", ["emitter"])
    ).rejects.toThrow(AuthorizationError);
    await expect(sendInvitation(emisor, id)).rejects.toThrow(AuthorizationError);
    await expect(updateInvitationRoles(emisor, id, ["reviewer"])).rejects.toThrow(
      AuthorizationError
    );
    await expect(revokeInvitation(emisor, id)).rejects.toThrow(AuthorizationError);
    await expect(deleteInvitation(emisor, id)).rejects.toThrow(AuthorizationError);
    await expect(updateMemberRoles(emisor, memberId, ["emitter"])).rejects.toThrow(
      AuthorizationError
    );
    await expect(removeMember(emisor, memberId)).rejects.toThrow(AuthorizationError);
    await expect(transferPrimaryAdmin(emisor, memberId)).rejects.toThrow(
      AuthorizationError
    );
  });
});
