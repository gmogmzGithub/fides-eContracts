import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface CookieOptions {
  httpOnly?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
  secure?: boolean;
  path?: string;
  expires?: Date | number;
}

interface CookieEntry {
  name: string;
  value: string;
  options: CookieOptions;
}

/** Almacén de cookies en memoria que sustituye a `next/headers`. */
const jar = vi.hoisted(() => new Map<string, CookieEntry>());

/**
 * `redirect` de Next interrumpe la ejecución lanzando; el doble reproduce ese
 * control de flujo con un error etiquetado que las pruebas pueden inspeccionar.
 */
const navigation = vi.hoisted(() => {
  class RedirectSignal extends Error {
    readonly digest: string;

    constructor(readonly url: string) {
      super(`NEXT_REDIRECT;${url}`);
      this.name = "RedirectSignal";
      this.digest = `NEXT_REDIRECT;${url}`;
    }
  }
  return { RedirectSignal };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get(name: string): CookieEntry | undefined {
      return jar.get(name);
    },
    set(name: string, value: string, options: CookieOptions = {}): void {
      jar.set(name, { name, value, options });
    },
    delete(name: string): void {
      jar.delete(name);
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new navigation.RedirectSignal(url);
  },
}));

// `tests/setup.ts` ya cargó `lib/auth/guards` antes de registrar los dobles: se
// reinicia el registro de módulos para que la importación use los dobles de
// `next/headers` y `next/navigation`. `lib/db` reutiliza la conexión global.
vi.resetModules();

const { sql } = await import("@/lib/db");
const { hashToken } = await import("@/lib/crypto/tokens");
const { createTotpSecret } = await import("@/lib/crypto/totp");
const { createSession } = await import("@/lib/auth/session");
const {
  canOpenSensitiveEvidence,
  hasRole,
  loadOrganizationProfile,
  requireAccount,
  requireOrganizationContext,
  requirePlatformAdmin,
  requireRole,
  usedCapability,
} = await import("@/lib/auth/guards");
const { AuthorizationError } = await import("@/lib/domain/errors");
const { addMembership, buildContext, createAccount, createOrganization } =
  await import("@/tests/helpers/database");

/** Comprueba que la operación terminó en una redirección al destino indicado. */
async function expectRedirect(
  operation: () => Promise<unknown>,
  destination: string
): Promise<void> {
  let captured: unknown = null;
  try {
    await operation();
  } catch (error) {
    captured = error;
  }
  if (!(captured instanceof navigation.RedirectSignal)) {
    throw new Error(
      `Se esperaba una redirección a ${destination} y la operación no redirigió.`
    );
  }
  expect(captured.digest).toBe(`NEXT_REDIRECT;${destination}`);
  expect(captured.url).toBe(destination);
}

async function setSessionOrganization(
  token: string,
  organizationId: string | null
): Promise<void> {
  await sql`
    UPDATE sessions SET active_organization_id = ${organizationId}
    WHERE token_hash = ${hashToken(token)}
  `;
}

beforeEach(() => {
  jar.clear();
});

describe("requireAccount", () => {
  it("envía a la pantalla de acceso a un visitante anónimo", async () => {
    await expectRedirect(() => requireAccount(), "/acceso");
  });

  it("envía a la pantalla de acceso cuando la sesión ya no es válida", async () => {
    const account = await createAccount();
    const token = await createSession(account.id, false);
    await sql`
      UPDATE sessions SET revoked_at = NOW() WHERE token_hash = ${hashToken(token)}
    `;
    await expectRedirect(() => requireAccount(), "/acceso");
  });

  it("devuelve la Cuenta de un Miembro autenticado", async () => {
    const account = await createAccount({ fullName: "Persona Miembro" });
    await createSession(account.id, false);

    const resolved = await requireAccount();
    expect(resolved).toMatchObject({
      accountId: account.id,
      fullName: "Persona Miembro",
      isPlatformAdmin: false,
    });
  });

  it("envía al segundo paso a una cuenta global con TOTP pendiente", async () => {
    const platform = await createAccount({
      isPlatformAdmin: true,
      totpSecret: createTotpSecret(),
    });
    await createSession(platform.id, false);
    await expectRedirect(() => requireAccount(), "/acceso/totp");
  });

  it("deja pasar a la cuenta global que ya resolvió su TOTP", async () => {
    const platform = await createAccount({
      isPlatformAdmin: true,
      totpSecret: createTotpSecret(),
    });
    await createSession(platform.id, true);
    expect(await requireAccount()).toMatchObject({
      isPlatformAdmin: true,
      totpEnrolled: true,
      totpSatisfied: true,
    });
  });

  it("no exige TOTP a una cuenta global sin secreto registrado", async () => {
    const platform = await createAccount({ isPlatformAdmin: true });
    await createSession(platform.id, false);
    expect(await requireAccount()).toMatchObject({
      isPlatformAdmin: true,
      totpEnrolled: false,
    });
  });

  it("no exige TOTP a una Cuenta de Miembro aunque tenga secreto", async () => {
    const account = await createAccount({ totpSecret: createTotpSecret() });
    await createSession(account.id, false);
    expect(await requireAccount()).toMatchObject({
      isPlatformAdmin: false,
      totpEnrolled: true,
      totpSatisfied: false,
    });
  });
});

describe("requirePlatformAdmin", () => {
  it("devuelve la cuenta global", async () => {
    const platform = await createAccount({ isPlatformAdmin: true });
    await createSession(platform.id, true);
    expect(await requirePlatformAdmin()).toMatchObject({ isPlatformAdmin: true });
  });

  it("devuelve a la aplicación de Organización a un Miembro", async () => {
    const account = await createAccount();
    await createSession(account.id, false);
    await expectRedirect(() => requirePlatformAdmin(), "/app");
  });

  it("envía a la pantalla de acceso a un visitante anónimo", async () => {
    await expectRedirect(() => requirePlatformAdmin(), "/acceso");
  });
});

describe("requireOrganizationContext", () => {
  it("resuelve la Organización en servidor y no acepta ningún parámetro del navegador", () => {
    expect(requireOrganizationContext).toHaveLength(0);
  });

  it("selecciona automáticamente la única membresía", async () => {
    const organization = await createOrganization({ name: "Única" });
    const account = await createAccount();
    await addMembership(organization.id, account.id, ["administrator", "emitter"], true);
    const token = await createSession(account.id, false);
    await setSessionOrganization(token, null);

    const context = await requireOrganizationContext();
    expect(context.membership).toEqual({
      organizationId: organization.id,
      organizationName: "Única",
      organizationSlug: organization.slug,
      roles: ["administrator", "emitter"],
      isPrimaryAdmin: true,
    });
    expect(context.organization.id).toBe(organization.id);
    expect(context.memberships).toHaveLength(1);
    expect(context.account.accountId).toBe(account.id);
  });

  it("pide elegir Organización cuando hay varias membresías sin una activa", async () => {
    const primera = await createOrganization({ name: "Alfa" });
    const segunda = await createOrganization({ name: "Beta" });
    const account = await createAccount();
    await addMembership(primera.id, account.id, ["emitter"]);
    await addMembership(segunda.id, account.id, ["reviewer"]);
    const token = await createSession(account.id, false);
    await setSessionOrganization(token, null);

    await expectRedirect(() => requireOrganizationContext(), "/app/organizaciones");
  });

  it("respeta la Organización activa guardada en la sesión", async () => {
    const primera = await createOrganization({ name: "Alfa" });
    const segunda = await createOrganization({ name: "Beta" });
    const account = await createAccount();
    await addMembership(primera.id, account.id, ["emitter"]);
    await addMembership(segunda.id, account.id, ["reviewer"]);
    const token = await createSession(account.id, false);
    await setSessionOrganization(token, segunda.id);

    const context = await requireOrganizationContext();
    expect(context.membership.organizationId).toBe(segunda.id);
    expect(context.membership.roles).toEqual(["reviewer"]);
  });

  it("nunca confía en una Organización sin membresía y vuelve a pedir la elección", async () => {
    const primera = await createOrganization({ name: "Alfa" });
    const segunda = await createOrganization({ name: "Beta" });
    const ajena = await createOrganization({ name: "Ajena" });
    const account = await createAccount();
    await addMembership(primera.id, account.id, ["emitter"]);
    await addMembership(segunda.id, account.id, ["reviewer"]);
    const token = await createSession(account.id, false);
    await setSessionOrganization(token, ajena.id);

    await expectRedirect(() => requireOrganizationContext(), "/app/organizaciones");
  });

  it("ignora una Organización ajena y usa la única membresía real", async () => {
    const propia = await createOrganization({ name: "Propia" });
    const ajena = await createOrganization({ name: "Ajena" });
    const account = await createAccount();
    await addMembership(propia.id, account.id, ["emitter"]);
    const token = await createSession(account.id, false);
    await setSessionOrganization(token, ajena.id);

    const context = await requireOrganizationContext();
    expect(context.membership.organizationId).toBe(propia.id);
    expect(context.organization.id).toBe(propia.id);
  });

  it("envía a la pantalla sin acceso cuando la Cuenta no tiene membresías", async () => {
    const account = await createAccount();
    await createSession(account.id, false);
    await expectRedirect(() => requireOrganizationContext(), "/acceso/sin-acceso");
  });

  it("envía a la superficie de plataforma a la cuenta global sin membresías", async () => {
    const platform = await createAccount({ isPlatformAdmin: true });
    await createSession(platform.id, true);
    await expectRedirect(() => requireOrganizationContext(), "/plataforma");
  });

  it("envía a la pantalla de acceso a un visitante anónimo", async () => {
    await expectRedirect(() => requireOrganizationContext(), "/acceso");
  });
});

describe("hasRole y requireRole", () => {
  it("reconoce los roles acumulados de la membresía", async () => {
    const organization = await createOrganization();
    const account = await createAccount();
    const context = await buildContext(organization.id, account, [
      "emitter",
      "reviewer",
    ]);

    expect(hasRole(context, "emitter")).toBe(true);
    expect(hasRole(context, "reviewer")).toBe(true);
    expect(hasRole(context, "administrator")).toBe(false);
  });

  it("acepta cuando la persona tiene cualquiera de los roles exigidos", async () => {
    const organization = await createOrganization();
    const account = await createAccount();
    const context = await buildContext(organization.id, account, ["reviewer"]);

    expect(requireRole(context, "administrator", "reviewer")).toBeUndefined();
    expect(() => requireRole(context, "reviewer")).not.toThrow();
  });

  it("rechaza cuando no tiene ninguno de los roles exigidos", async () => {
    const organization = await createOrganization();
    const account = await createAccount();
    const context = await buildContext(organization.id, account, ["emitter"]);

    expect(() => requireRole(context, "administrator")).toThrow(AuthorizationError);
    expect(() => requireRole(context, "administrator", "reviewer")).toThrow(
      "No tienes acceso a esta operación."
    );
    expect(() => requireRole(context)).toThrow(AuthorizationError);
  });
});

describe("canOpenSensitiveEvidence", () => {
  it("no deja abrir INE o video a quien sólo emite", async () => {
    const organization = await createOrganization();
    const account = await createAccount();
    const context = await buildContext(organization.id, account, ["emitter"]);
    expect(canOpenSensitiveEvidence(context)).toBe(false);
  });

  it("deja abrirla a un Administrador y a un Revisor", async () => {
    const organization = await createOrganization();
    const account = await createAccount();
    const administrador = await buildContext(organization.id, account, [
      "administrator",
    ]);
    const revisor = await buildContext(organization.id, account, ["reviewer"]);
    const ambos = await buildContext(organization.id, account, [
      "emitter",
      "reviewer",
    ]);

    expect(canOpenSensitiveEvidence(administrador)).toBe(true);
    expect(canOpenSensitiveEvidence(revisor)).toBe(true);
    expect(canOpenSensitiveEvidence(ambos)).toBe(true);
  });
});

describe("usedCapability", () => {
  it("describe los roles con los que se ejecutó la acción", async () => {
    const organization = await createOrganization();
    const account = await createAccount();
    const context = await buildContext(organization.id, account, [
      "administrator",
      "emitter",
    ]);
    expect(usedCapability(context)).toBe("administrator+emitter");
  });
});

describe("loadOrganizationProfile", () => {
  it("devuelve identidad, capacidades y valores predeterminados vigentes", async () => {
    const organization = await createOrganization({
      name: "Transportes",
      slug: "transportes",
      legalName: "Transportes Demo, S.A. de C.V.",
      capabilities: { ai_review: true, evidence_video: true },
      defaults: {
        linkDays: 12,
        requiresVideo: true,
        requiresIne: true,
        reviewPolicy: "ai",
      },
    });

    expect(await loadOrganizationProfile(organization.id)).toEqual({
      id: organization.id,
      name: "Transportes",
      slug: "transportes",
      legalName: "Transportes Demo, S.A. de C.V.",
      seatLimit: 10,
      capabilities: {
        ai_review: true,
        active_custody: false,
        evidence_video: true,
        evidence_ine: true,
      },
      defaults: {
        operationalVersion: 1,
        linkDays: 12,
        requiresVideo: true,
        requiresIne: true,
        reviewPolicy: "ai",
      },
    });
  });

  it("apaga adicionales no contratados y conserva INE y video universales", async () => {
    const organization = await createOrganization();
    await sql`
      DELETE FROM commercial_entitlements WHERE organization_id = ${organization.id}
    `;
    const profile = await loadOrganizationProfile(organization.id);
    expect(profile.capabilities).toEqual({
      ai_review: false,
      active_custody: false,
      evidence_video: true,
      evidence_ine: true,
    });
  });

  it("usa valores predeterminados seguros cuando falta la configuración", async () => {
    const organization = await createOrganization();
    await sql`
      DELETE FROM organization_settings WHERE organization_id = ${organization.id}
    `;
    const profile = await loadOrganizationProfile(organization.id);
    expect(profile.defaults).toEqual({
      operationalVersion: 1,
      linkDays: 7,
      requiresVideo: false,
      requiresIne: false,
      reviewPolicy: "none",
    });
  });

  it("refleja la versión operativa y el límite de Asientos guardados", async () => {
    const organization = await createOrganization();
    await sql`
      UPDATE organizations SET seat_limit = 4 WHERE id = ${organization.id}
    `;
    await sql`
      UPDATE organization_settings SET operational_version = 3
      WHERE organization_id = ${organization.id}
    `;
    const profile = await loadOrganizationProfile(organization.id);
    expect(profile.seatLimit).toBe(4);
    expect(profile.defaults.operationalVersion).toBe(3);
  });

  it("rechaza una Organización inexistente", async () => {
    await expect(loadOrganizationProfile(randomUUID())).rejects.toThrow(
      AuthorizationError
    );
  });
});
