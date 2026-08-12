#!/usr/bin/env node
/**
 * Comprueba por HTTP los accesos sintéticos definidos en
 * `scripts/demo-catalog.mjs`.
 *
 * Para cada Cuenta abre `/acceso`, envía el formulario real de Acción de
 * Servidor y verifica la superficie, la Organización y los roles esperados.
 * Andrea Rios tiene dos Accesos de Organización: la prueba exige el selector,
 * entra a cada Organización mediante su formulario real y comprueba que los
 * datos contractuales permanezcan aislados. Las otras Cuentas de Organización
 * tienen una sola membresía. También se comprueba una contraseña equivocada.
 *
 * Ninguna Cuenta del POC-Demo local usa TOTP.
 *
 * Variables:
 *   FIDES_APP_URL         dirección de la aplicación (http://localhost:3002)
 *   FIDES_SEED_PASSWORD   contraseña compartida (FidesDemo123!)
 */

import { ACCOUNTS, DEMO_CATALOG_TOTALS, ORGANIZATIONS } from "./demo-catalog.mjs";
import { appUrl } from "./defaults.mjs";

const APP = appUrl();
const PASSWORD = process.env.FIDES_SEED_PASSWORD || "FidesDemo123!";

const PLATFORM_SURFACE = "Administración de plataforma";
const PUBLISHER_BADGE = "Publicador de contenido jurídico";
const SUPPORT_BADGE = "Sólo consulta y soporte";
const MULTI_ORG_EMAIL = "aviacion-norte-admin@aviacion-norte.local";

const ROLE_LABELS = {
  administrator: "Administrador",
  emitter: "Emisor",
  reviewer: "Revisor",
};

/** Rutas del portal y cualquiera de los roles que permite abrirlas. */
const ROLE_ROUTES = [
  { path: "/app/contratos", roles: ["administrator", "emitter"] },
  { path: "/app/contratos/nuevo", roles: ["emitter"] },
  { path: "/app/revision", roles: ["reviewer"] },
  { path: "/app/recientes", roles: ["administrator", "emitter"] },
  { path: "/app/carpetas", roles: ["administrator", "emitter"] },
  { path: "/app/archivados", roles: ["administrator", "emitter"] },
  { path: "/app/eliminados", roles: ["administrator", "emitter"] },
  { path: "/app/accesos", roles: ["administrator"] },
  { path: "/app/configuracion", roles: ["administrator"] },
];

/** Elementos que el armazón del portal deriva de los roles activos. */
const ROLE_NAV = [
  { label: "Contratos", href: "/app/contratos", roles: ["administrator", "emitter"] },
  { label: "Crear contrato", href: "/app/contratos/nuevo", roles: ["emitter"] },
  { label: "A revisión", href: "/app/revision", roles: ["reviewer"] },
  { label: "Recientes", href: "/app/recientes", roles: ["administrator", "emitter"] },
  { label: "Carpetas", href: "/app/carpetas", roles: ["administrator", "emitter"] },
  { label: "Archivados", href: "/app/archivados", roles: ["administrator", "emitter"] },
  { label: "Eliminados", href: "/app/eliminados", roles: ["administrator", "emitter"] },
  { label: "Accesos", href: "/app/accesos", roles: ["administrator"] },
  { label: "Configuración", href: "/app/configuracion", roles: ["administrator"] },
];

const ORGANIZATIONS_BY_SLUG = new Map(
  ORGANIZATIONS.map((organization) => [organization.slug, organization])
);
const ORGANIZATION_NAMES = ORGANIZATIONS.map(({ name }) => name);

// ---------------------------------------------------------------------------
// Cliente HTTP mínimo con frasco de cookies
// ---------------------------------------------------------------------------

function unescapeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripHtml(value) {
  return unescapeHtml(value.replace(/<[^>]*>/g, "")).trim();
}

function elementContaining(html, tag, marker) {
  return (html.match(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "g")) ?? []).find(
    (candidate) => stripHtml(candidate).includes(marker)
  );
}

/**
 * Extrae los campos ocultos que Next.js inserta para la Acción de Servidor del
 * formulario que contiene `fieldName`. `marker` limita la búsqueda al `<li>`
 * de una Organización concreta en el selector.
 */
function hiddenFields(html, fieldName, marker) {
  const region = marker ? elementContaining(html, "li", marker) : html;
  if (!region) {
    throw new Error(`no encontré el bloque de \`${marker}\``);
  }
  const forms = region.match(/<form[\s\S]*?<\/form>/g) ?? [];
  const form = forms.find((candidate) => candidate.includes(`name="${fieldName}"`));
  if (!form) {
    const suffix = marker ? ` dentro de \`${marker}\`` : "";
    throw new Error(`no encontré el formulario con el campo \`${fieldName}\`${suffix}`);
  }
  const fields = {};
  for (const input of form.match(/<input[^>]*>/g) ?? []) {
    if (!input.includes('type="hidden"')) continue;
    const name = input.match(/name="([^"]*)"/)?.[1];
    if (!name) continue;
    fields[unescapeHtml(name)] = unescapeHtml(input.match(/value="([^"]*)"/)?.[1] ?? "");
  }
  return fields;
}

function mainContent(html) {
  return html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? "";
}

function activeOrganizationName(html) {
  const match = html.match(
    /<p class="truncate font-display text-lg leading-tight text-carbon">([\s\S]*?)<\/p>/
  );
  return match ? stripHtml(match[1]) : "";
}

class Session {
  constructor() {
    this.cookies = new Map();
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  absorb(response) {
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      if (index === -1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(path, init = {}) {
    const headers = { ...init.headers };
    const cookie = this.header();
    if (cookie) headers.cookie = cookie;
    const response = await fetch(`${APP}${path}`, {
      ...init,
      headers,
      redirect: "manual",
    });
    this.absorb(response);
    return response;
  }

  async get(path) {
    const response = await this.request(path);
    const redirected = response.status >= 300 && response.status < 400;
    const body = redirected ? "" : await response.text();
    return { status: response.status, location: response.headers.get("location"), body };
  }

  async follow(path, limit = 5) {
    let current = path;
    for (let hop = 0; hop < limit; hop += 1) {
      const page = await this.get(current);
      if (!page.location) return { ...page, path: current };
      current = page.location;
    }
    throw new Error(`\`${path}\` encadenó más de ${limit} redirecciones`);
  }

  /** Reenvía un formulario de Acción de Servidor con sus campos ocultos. */
  async submit(path, fieldName, values, marker) {
    const page = await this.get(path);
    if (page.status !== 200) {
      throw new Error(`\`${path}\` respondió ${page.status} en lugar de 200`);
    }
    const form = new FormData();
    for (const [name, value] of Object.entries(hiddenFields(page.body, fieldName, marker))) {
      form.append(name, value);
    }
    for (const [name, value] of Object.entries(values ?? {})) form.append(name, value);

    const response = await this.request(path, { method: "POST", body: form });
    const body = response.status === 303 ? "" : await response.text();
    return { status: response.status, location: response.headers.get("location"), body };
  }
}

// ---------------------------------------------------------------------------
// Aserciones
// ---------------------------------------------------------------------------

const failures = [];
let checks = 0;

function check(label, condition, detail) {
  checks += 1;
  if (condition) return true;
  failures.push(detail ? `${label} — ${detail}` : label);
  return false;
}

function expectsRole(roles, acceptedRoles) {
  return acceptedRoles.some((role) => roles.includes(role));
}

function accountScope(account) {
  if (account.isPlatformAdmin) {
    return account.isLegalPublisher
      ? "Administrador de plataforma + Publicador de contenido jurídico"
      : "Administrador de plataforma";
  }
  return account.memberships
    .map((membership) => {
      const organization = ORGANIZATIONS_BY_SLUG.get(membership.slug);
      const roleNames = membership.roles.map((role) => ROLE_LABELS[role]).join(" + ");
      return `${organization?.name ?? membership.slug}: ${roleNames}`;
    })
    .join(" / ");
}

async function signIn(account, password = PASSWORD) {
  const session = new Session();
  const result = await session.submit("/acceso", "correo", {
    correo: account.email,
    contrasena: password,
  });
  return { session, result };
}

async function verifyPlatformAccount(account) {
  const { session, result } = await signIn(account);
  const name = account.email;

  if (
    !check(
      `${name} · la contraseña entra`,
      result.status === 303,
      `respuesta ${result.status}: ${(result.body.match(/"error":"([^"]*)"/) ?? [])[1] ?? "sin redirección"}`
    )
  ) {
    return;
  }
  if (
    !check(
      `${name} · entra sin TOTP`,
      result.location === "/plataforma",
      `redirigió a ${result.location}`
    )
  ) {
    return;
  }

  const platform = await session.get("/plataforma");
  check(
    `${name} · abre la administración de plataforma`,
    platform.status === 200 && platform.body.includes(PLATFORM_SURFACE),
    `respuesta ${platform.status}`
  );
  check(
    `${name} · su facultad jurídica es exacta`,
    account.isLegalPublisher
      ? platform.body.includes(PUBLISHER_BADGE) && !platform.body.includes(SUPPORT_BADGE)
      : platform.body.includes(SUPPORT_BADGE) && !platform.body.includes(PUBLISHER_BADGE)
  );

  const cuenta = await session.get("/plataforma/cuenta");
  check(`${name} · abre \`/plataforma/cuenta\``, cuenta.status === 200, `respuesta ${cuenta.status}`);

  const portal = await session.get("/app");
  check(
    `${name} · no tiene una Organización activa`,
    portal.location === "/plataforma",
    `respuesta ${portal.status} hacia ${portal.location}`
  );
}

async function verifyRoleSurface(session, accountName, roles, portal) {
  const nav = (
    portal.body.match(/<nav[^>]*aria-label="Secciones del portal"[\s\S]*?<\/nav>/g) ?? []
  ).join("");
  check(`${accountName} · el portal dibuja su navegación`, nav.length > 0);

  for (const item of ROLE_NAV) {
    const expected = expectsRole(roles, item.roles);
    check(
      `${accountName} · ${expected ? "tiene" : "no tiene"} \`${item.label}\` en su navegación`,
      nav.includes(`href="${item.href}"`) === expected
    );
  }

  for (const route of ROLE_ROUTES) {
    const expected = expectsRole(roles, route.roles);
    const page = await session.get(route.path);
    check(
      `${accountName} · ${expected ? "abre" : "no abre"} \`${route.path}\``,
      expected ? page.status === 200 : page.status !== 200,
      `respuesta ${page.status}${page.location ? ` hacia ${page.location}` : ""}`
    );
  }
}

async function verifySingleOrganizationAccount(account) {
  const membership = account.memberships[0];
  const organization = ORGANIZATIONS_BY_SLUG.get(membership.slug);
  const { session, result } = await signIn(account);
  const name = account.email;

  if (!organization) {
    check(`${name} · la Organización existe en el catálogo`, false, membership.slug);
    return;
  }
  if (
    !check(
      `${name} · la contraseña entra`,
      result.status === 303,
      `respuesta ${result.status}: ${(result.body.match(/"error":"([^"]*)"/) ?? [])[1] ?? "sin redirección"}`
    )
  ) {
    return;
  }
  if (
    !check(
      `${name} · entra sin TOTP`,
      result.location === "/app",
      `redirigió a ${result.location}`
    )
  ) {
    return;
  }

  const portal = await session.follow("/app");
  if (
    !check(
      `${name} · abre su única Organización sin selector`,
      portal.status === 200 && portal.path !== "/app/organizaciones",
      `respuesta ${portal.status} en ${portal.path}`
    )
  ) {
    return;
  }

  const organizesFiles = expectsRole(membership.roles, ["administrator", "emitter"]);
  check(
    `${name} · aterriza en ${organizesFiles ? "/app/contratos" : "/app/revision"}`,
    portal.path === (organizesFiles ? "/app/contratos" : "/app/revision"),
    `aterrizó en ${portal.path}`
  );
  check(
    `${name} · la Organización activa es ${organization.name}`,
    activeOrganizationName(portal.body) === organization.name,
    `mostró ${activeOrganizationName(portal.body) || "ninguna"}`
  );
  const unexpected = ORGANIZATION_NAMES.filter((item) => item !== organization.name);
  check(
    `${name} · no ve otras Organizaciones`,
    unexpected.every((item) => !portal.body.includes(item)),
    unexpected.filter((item) => portal.body.includes(item)).join(", ")
  );

  await verifyRoleSurface(session, name, membership.roles, portal);

  const platform = await session.get("/plataforma");
  check(
    `${name} · no alcanza la administración de plataforma`,
    platform.location === "/app",
    `respuesta ${platform.status} hacia ${platform.location}`
  );
}

function selectorCard(selectorHtml, organizationName) {
  return elementContaining(selectorHtml, "li", organizationName) ?? "";
}

function verifySelectorRoles(accountName, selectorHtml, membership) {
  const organization = ORGANIZATIONS_BY_SLUG.get(membership.slug);
  if (!organization) {
    check(`${accountName} · la Organización existe en el catálogo`, false, membership.slug);
    return;
  }
  const card = selectorCard(selectorHtml, organization.name);
  check(`${accountName} · el selector muestra ${organization.name}`, card.length > 0);
  for (const [role, label] of Object.entries(ROLE_LABELS)) {
    check(
      `${accountName} · ${organization.name} ${membership.roles.includes(role) ? "tiene" : "no tiene"} rol ${label}`,
      card.includes(label) === membership.roles.includes(role)
    );
  }
}

async function verifyAndreaAccount(account) {
  const { session, result } = await signIn(account);
  const name = account.email;

  if (
    !check(
      `${name} · la contraseña entra`,
      result.status === 303,
      `respuesta ${result.status}: ${(result.body.match(/"error":"([^"]*)"/) ?? [])[1] ?? "sin redirección"}`
    )
  ) {
    return;
  }
  if (
    !check(`${name} · entra sin TOTP`, result.location === "/app", `redirigió a ${result.location}`)
  ) {
    return;
  }

  const selector = await session.follow("/app");
  if (
    !check(
      `${name} · aterriza en el selector de Organizaciones`,
      selector.status === 200 && selector.path === "/app/organizaciones",
      `respuesta ${selector.status} en ${selector.path}`
    )
  ) {
    return;
  }
  check(
    `${name} · el selector contiene exactamente sus dos Organizaciones`,
    account.memberships.every(({ slug }) =>
      selector.body.includes(ORGANIZATIONS_BY_SLUG.get(slug)?.name ?? slug)
    ) &&
      ORGANIZATION_NAMES.filter(
        (organizationName) =>
          !account.memberships.some(
            ({ slug }) => ORGANIZATIONS_BY_SLUG.get(slug)?.name === organizationName
          )
      ).every((organizationName) => !selector.body.includes(organizationName))
  );
  for (const membership of account.memberships) {
    verifySelectorRoles(name, selector.body, membership);
  }

  for (const membership of account.memberships) {
    const organization = ORGANIZATIONS_BY_SLUG.get(membership.slug);
    if (!organization) continue;
    const selected = await session.submit(
      "/app/organizaciones",
      "organizationId",
      {},
      organization.name
    );
    if (
      !check(
        `${name} · selecciona ${organization.name} con su formulario`,
        selected.status === 303 && selected.location === "/app/contratos",
        `respuesta ${selected.status} hacia ${selected.location}`
      )
    ) {
      continue;
    }

    const portal = await session.get("/app/contratos");
    if (
      !check(
        `${name} · abre ${organization.name}`,
        portal.status === 200 && activeOrganizationName(portal.body) === organization.name,
        `respuesta ${portal.status}; activa ${activeOrganizationName(portal.body) || "ninguna"}`
      )
    ) {
      continue;
    }
    await verifyRoleSurface(session, `${name} · ${organization.name}`, membership.roles, portal);

    const ownTemplates = organization.templates.map(({ name: templateName }) => templateName);
    const foreignTemplates = account.memberships
      .filter(({ slug }) => slug !== membership.slug)
      .flatMap(({ slug }) =>
        (ORGANIZATIONS_BY_SLUG.get(slug)?.templates ?? []).map(({ name: templateName }) => templateName)
      );
    const content = mainContent(portal.body);
    check(
      `${name} · ${organization.name} muestra sólo su contenido contractual`,
      ownTemplates.every((templateName) => content.includes(templateName)) &&
        foreignTemplates.every((templateName) => !content.includes(templateName)),
      `propias ausentes: ${ownTemplates.filter((item) => !content.includes(item)).join(", ") || "ninguna"}; ` +
        `ajenas visibles: ${foreignTemplates.filter((item) => content.includes(item)).join(", ") || "ninguna"}`
    );
  }

  const platform = await session.get("/plataforma");
  check(
    `${name} · no alcanza la administración de plataforma`,
    platform.location === "/app",
    `respuesta ${platform.status} hacia ${platform.location}`
  );
}

async function verifyWrongPassword(account) {
  const { result } = await signIn(account, `${PASSWORD}-incorrecta`);
  check(
    `${account.email} · una contraseña equivocada no entra`,
    result.status === 200 && result.body.includes("Correo o contraseña incorrectos"),
    `respuesta ${result.status} hacia ${result.location}`
  );
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

async function main() {
  const health = await fetch(`${APP}/api/salud`).catch(() => null);
  if (!health?.ok) {
    console.error(
      `\n  No respondió ${APP}. Levanta la pila local antes de verificar:\n` +
        "    docker compose up -d --build\n"
    );
    process.exit(1);
  }

  if (ACCOUNTS.length !== DEMO_CATALOG_TOTALS.accounts) {
    throw new Error(
      `el catálogo tiene ${ACCOUNTS.length} Cuentas; se esperaban ${DEMO_CATALOG_TOTALS.accounts}`
    );
  }

  console.log(`\n  Verificando las ${DEMO_CATALOG_TOTALS.accounts} cuentas del catálogo en ${APP}`);
  console.log(`  Contraseña compartida: ${PASSWORD}`);
  console.log("  Segundo factor: desactivado para todo el POC-Demo\n");

  for (const account of ACCOUNTS) {
    const before = failures.length;
    if (account.isPlatformAdmin) await verifyPlatformAccount(account);
    else if (account.email === MULTI_ORG_EMAIL) await verifyAndreaAccount(account);
    else await verifySingleOrganizationAccount(account);
    const ok = failures.length === before;
    console.log(`  ${ok ? "ok  " : "FALLA"} ${account.email.padEnd(47)}${accountScope(account)}`);
  }

  const wrongPasswordAccount = ACCOUNTS.find(
    (account) => account.email === "transportes-admin@transportes.local"
  );
  if (!wrongPasswordAccount) throw new Error("falta la Cuenta para probar la contraseña errónea");
  await verifyWrongPassword(wrongPasswordAccount);

  if (failures.length > 0) {
    console.error(`\n  ${failures.length} de ${checks} comprobaciones fallaron:\n`);
    for (const failure of failures) console.error(`  · ${failure}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `\n  ${checks} comprobaciones correctas: los ${DEMO_CATALOG_TOTALS.accounts} accesos funcionan.\n`
  );
}

main().catch((error) => {
  console.error(`\n  Verificación detenida por un error: ${error.message}\n`);
  process.exit(1);
});
