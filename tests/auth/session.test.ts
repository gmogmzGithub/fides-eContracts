import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// `tests/setup.ts` ya cargó `lib/auth/session` antes de registrar los dobles:
// se reinicia el registro de módulos para que la importación use el doble de
// `next/headers`. `lib/db` reutiliza la misma conexión global.
vi.resetModules();

const { sql } = await import("@/lib/db");
const { hashToken } = await import("@/lib/crypto/tokens");
const { createTotpSecret } = await import("@/lib/crypto/totp");
const {
  createSession,
  destroySession,
  getSessionAccount,
  listMemberships,
  markTotpSatisfied,
  revokeAccountSessions,
  SESSION_COOKIE,
  setActiveOrganization,
} = await import("@/lib/auth/session");
const { addMembership, createAccount, createOrganization } = await import(
  "@/tests/helpers/database"
);

const HOUR_MS = 3_600_000;

function storedCookie(): CookieEntry | undefined {
  return jar.get(SESSION_COOKIE);
}

async function sessionRow(token: string): Promise<{
  id: string;
  expires_at: Date;
  revoked_at: Date | null;
  totp_satisfied: boolean;
  active_organization_id: string | null;
}> {
  const [row] = await sql<
    {
      id: string;
      expires_at: Date;
      revoked_at: Date | null;
      totp_satisfied: boolean;
      active_organization_id: string | null;
    }[]
  >`
    SELECT id, expires_at, revoked_at, totp_satisfied, active_organization_id
    FROM sessions WHERE token_hash = ${hashToken(token)}
  `;
  return row;
}

beforeEach(() => {
  jar.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SESSION_COOKIE", () => {
  it("usa un nombre de cookie propio de la plataforma", () => {
    expect(SESSION_COOKIE).toBe("fides_session");
  });
});

describe("createSession", () => {
  it("emite un token opaco, guarda sólo su hash y fija la cookie", async () => {
    const account = await createAccount();
    const token = await createSession(account.id, false);

    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const cookie = storedCookie();
    expect(cookie?.value).toBe(token);
    expect(cookie?.options.httpOnly).toBe(true);
    expect(cookie?.options.sameSite).toBe("lax");
    expect(cookie?.options.path).toBe("/");
    expect(cookie?.options.secure).toBe(false);

    const row = await sessionRow(token);
    expect(row.revoked_at).toBeNull();
    expect(row.totp_satisfied).toBe(false);
    expect(Math.abs(row.expires_at.getTime() - (Date.now() + 12 * HOUR_MS))).toBeLessThan(
      60_000
    );

    const expira = cookie?.options.expires;
    expect(expira).toBeInstanceOf(Date);
    expect(new Date(expira ?? 0).getTime()).toBe(row.expires_at.getTime());

    const [{ total }] = await sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM sessions WHERE token_hash = ${token}
    `;
    expect(total).toBe(0);
  });

  it("conserva el segundo factor ya satisfecho", async () => {
    const account = await createAccount({ isPlatformAdmin: true });
    const token = await createSession(account.id, true);
    expect((await sessionRow(token)).totp_satisfied).toBe(true);
  });

  it("marca la cookie como segura en producción", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const account = await createAccount();
    await createSession(account.id, false);
    expect(storedCookie()?.options.secure).toBe(true);
  });

  it("permite cookies inseguras en un despliegue local sin TLS", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FIDES_INSECURE_COOKIES", "true");
    const account = await createAccount();
    await createSession(account.id, false);
    expect(storedCookie()?.options.secure).toBe(false);
  });

  it("deja sin resolver la Organización activa cuando la Cuenta no tiene membresías", async () => {
    const account = await createAccount({ isPlatformAdmin: true });
    const token = await createSession(account.id, true);
    expect((await sessionRow(token)).active_organization_id).toBeNull();
  });

  it("preselecciona la Organización cuando hay exactamente una membresía", async () => {
    const organization = await createOrganization();
    const account = await createAccount();
    await addMembership(organization.id, account.id, ["emitter"]);

    const token = await createSession(account.id, false);
    expect((await sessionRow(token)).active_organization_id).toBe(organization.id);
  });

  // ADR-0025: quien pertenece a más de una Organización debe elegirla al entrar.
  // `createSession` toma la primera membresía sin `LIMIT 1` ni comprobar cuántas
  // hay, así que preselecciona una Organización arbitraria y se salta el selector.
  it(
    "no preselecciona Organización cuando la Cuenta tiene varias membresías",
    async () => {
      const primera = await createOrganization({ name: "Alfa" });
      const segunda = await createOrganization({ name: "Beta" });
      const account = await createAccount();
      await addMembership(primera.id, account.id, ["emitter"]);
      await addMembership(segunda.id, account.id, ["reviewer"]);

      const token = await createSession(account.id, false);
      expect((await sessionRow(token)).active_organization_id).toBeNull();
    }
  );
});

describe("getSessionAccount", () => {
  it("devuelve null cuando no hay cookie", async () => {
    expect(await getSessionAccount()).toBeNull();
  });

  it("devuelve null cuando la cookie no corresponde a ninguna sesión", async () => {
    jar.set(SESSION_COOKIE, {
      name: SESSION_COOKIE,
      value: "token-inventado",
      options: {},
    });
    expect(await getSessionAccount()).toBeNull();
  });

  it("devuelve el perfil de la sesión vigente", async () => {
    const organization = await createOrganization();
    const account = await createAccount({
      fullName: "Persona Con Sesión",
      isPlatformAdmin: true,
      isLegalPublisher: true,
      totpSecret: createTotpSecret(),
    });
    await addMembership(organization.id, account.id, ["administrator"]);
    const token = await createSession(account.id, true);
    const row = await sessionRow(token);

    expect(await getSessionAccount()).toEqual({
      accountId: account.id,
      email: account.email,
      fullName: "Persona Con Sesión",
      isPlatformAdmin: true,
      isLegalPublisher: true,
      totpEnrolled: true,
      totpSatisfied: true,
      sessionId: row.id,
      activeOrganizationId: organization.id,
    });
  });

  it("no declara segundo factor cuando la Cuenta no tiene secreto", async () => {
    const account = await createAccount();
    await createSession(account.id, false);
    expect(await getSessionAccount()).toMatchObject({
      totpEnrolled: false,
      totpSatisfied: false,
      isPlatformAdmin: false,
      isLegalPublisher: false,
      activeOrganizationId: null,
    });
  });

  it("devuelve null cuando la sesión venció", async () => {
    const account = await createAccount();
    const token = await createSession(account.id, false);
    await sql`
      UPDATE sessions SET expires_at = NOW() - INTERVAL '1 minute'
      WHERE token_hash = ${hashToken(token)}
    `;
    expect(await getSessionAccount()).toBeNull();
  });

  it("devuelve null cuando la sesión fue revocada", async () => {
    const account = await createAccount();
    const token = await createSession(account.id, false);
    await sql`
      UPDATE sessions SET revoked_at = NOW() WHERE token_hash = ${hashToken(token)}
    `;
    expect(await getSessionAccount()).toBeNull();
  });
});

describe("destroySession", () => {
  it("revoca la sesión en servidor y borra la cookie", async () => {
    const account = await createAccount();
    const token = await createSession(account.id, false);

    await destroySession();

    expect(storedCookie()).toBeUndefined();
    expect((await sessionRow(token)).revoked_at).not.toBeNull();
    expect(await getSessionAccount()).toBeNull();
  });

  it("no falla cuando no hay cookie de sesión", async () => {
    await expect(destroySession()).resolves.toBeUndefined();
    expect(storedCookie()).toBeUndefined();
  });
});

describe("revokeAccountSessions", () => {
  it("revoca todas las sesiones de la Cuenta sin tocar las de otra", async () => {
    const account = await createAccount();
    const otra = await createAccount();
    const primero = await createSession(account.id, false);
    const segundo = await createSession(account.id, false);
    const ajeno = await createSession(otra.id, false);

    await revokeAccountSessions(account.id);

    expect((await sessionRow(primero)).revoked_at).not.toBeNull();
    expect((await sessionRow(segundo)).revoked_at).not.toBeNull();
    expect((await sessionRow(ajeno)).revoked_at).toBeNull();
  });

  it("limita el alcance a una Organización y a las sesiones sin contexto", async () => {
    const primera = await createOrganization();
    const segunda = await createOrganization();
    const account = await createAccount();
    const enPrimera = await createSession(account.id, false);
    const enSegunda = await createSession(account.id, false);
    const sinContexto = await createSession(account.id, false);
    await sql`
      UPDATE sessions SET active_organization_id = ${primera.id}
      WHERE token_hash = ${hashToken(enPrimera)}
    `;
    await sql`
      UPDATE sessions SET active_organization_id = ${segunda.id}
      WHERE token_hash = ${hashToken(enSegunda)}
    `;

    await revokeAccountSessions(account.id, primera.id);

    expect((await sessionRow(enPrimera)).revoked_at).not.toBeNull();
    expect((await sessionRow(sinContexto)).revoked_at).not.toBeNull();
    expect((await sessionRow(enSegunda)).revoked_at).toBeNull();
  });

  it("conserva la fecha original de una sesión ya revocada", async () => {
    const account = await createAccount();
    const token = await createSession(account.id, false);
    await sql`
      UPDATE sessions SET revoked_at = NOW() - INTERVAL '1 hour'
      WHERE token_hash = ${hashToken(token)}
    `;
    const antes = (await sessionRow(token)).revoked_at;

    await revokeAccountSessions(account.id);
    expect((await sessionRow(token)).revoked_at).toEqual(antes);
  });
});

describe("listMemberships", () => {
  it("devuelve una lista vacía cuando la Cuenta no pertenece a ninguna Organización", async () => {
    const account = await createAccount();
    expect(await listMemberships(account.id)).toEqual([]);
  });

  it("devuelve las membresías ordenadas por nombre con sus roles", async () => {
    const beta = await createOrganization({ name: "Beta", slug: "beta" });
    const alfa = await createOrganization({ name: "Alfa", slug: "alfa" });
    const account = await createAccount();
    await addMembership(beta.id, account.id, ["emitter", "reviewer"]);
    await addMembership(alfa.id, account.id, ["administrator"], true);

    expect(await listMemberships(account.id)).toEqual([
      {
        organizationId: alfa.id,
        organizationName: "Alfa",
        organizationSlug: "alfa",
        roles: ["administrator"],
        isPrimaryAdmin: true,
      },
      {
        organizationId: beta.id,
        organizationName: "Beta",
        organizationSlug: "beta",
        roles: ["emitter", "reviewer"],
        isPrimaryAdmin: false,
      },
    ]);
  });

  it("no incluye membresías de otra Cuenta", async () => {
    const organization = await createOrganization();
    const account = await createAccount();
    const otra = await createAccount();
    await addMembership(organization.id, otra.id, ["emitter"]);
    expect(await listMemberships(account.id)).toEqual([]);
  });
});

describe("setActiveOrganization", () => {
  it("cambia la Organización activa de la sesión en servidor", async () => {
    const primera = await createOrganization();
    const segunda = await createOrganization();
    const account = await createAccount();
    await addMembership(primera.id, account.id, ["emitter"]);
    await addMembership(segunda.id, account.id, ["emitter"]);
    const token = await createSession(account.id, false);
    const { id: sessionId } = await sessionRow(token);

    await setActiveOrganization(sessionId, segunda.id);

    expect((await sessionRow(token)).active_organization_id).toBe(segunda.id);
    expect(await getSessionAccount()).toMatchObject({
      activeOrganizationId: segunda.id,
    });
  });

  it("ignora un identificador de sesión inexistente", async () => {
    const organization = await createOrganization();
    await expect(
      setActiveOrganization(randomUUID(), organization.id)
    ).resolves.toBeUndefined();
  });
});

describe("markTotpSatisfied", () => {
  it("marca el segundo paso como resuelto en esa sesión", async () => {
    const account = await createAccount({
      isPlatformAdmin: true,
      totpSecret: createTotpSecret(),
    });
    const token = await createSession(account.id, false);
    const { id: sessionId } = await sessionRow(token);
    expect(await getSessionAccount()).toMatchObject({ totpSatisfied: false });

    await markTotpSatisfied(sessionId);

    expect((await sessionRow(token)).totp_satisfied).toBe(true);
    expect(await getSessionAccount()).toMatchObject({
      totpEnrolled: true,
      totpSatisfied: true,
    });
  });

  it("ignora un identificador de sesión inexistente", async () => {
    await expect(markTotpSatisfied(randomUUID())).resolves.toBeUndefined();
  });
});
