#!/usr/bin/env node
/**
 * Prueba de humo de extremo a extremo de la versión local dockerizada.
 *
 *   node scripts/smoke.mjs [--only=nombre,nombre] [--verbose] [--no-cleanup]
 *
 * Qué transporte usa cada cosa
 * ----------------------------
 * HTTP real contra `FIDES_APP_URL` (por omisión http://localhost:3002)
 * para todo el producto:
 *   · `/acceso`, `/acceso/totp`, `/invitacion/[token]` y todas las pantallas
 *     del portal se manejan enviando el formulario que la propia página
 *     renderiza. Las Server Actions se invocan por su ruta de mejora
 *     progresiva (`multipart/form-data` con los campos `$ACTION_*` que React
 *     escribe en el HTML) o, cuando la acción no vive en un formulario
 *     (`guardarCampos`, `markWalkedAction`), con el encabezado `Next-Action`
 *     y el identificador leído del bundle del cliente o del payload RSC.
 *   · `/c/[token]`, `/c/[token]/evidencia/subir`, `/c/[token]/aceptar`,
 *     `/c/[token]/listo`, `/c/[token]/pdf`, `/app/contratos/[id]/pdf`
 *     y `/api/salud` son rutas normales.
 *   · La bandeja local se lee en `http://localhost:8025/api/messages`.
 *
 * PostgreSQL (`postgres` sobre 127.0.0.1:54329) se usa sólo para:
 *   · aserciones sobre el estado real (Estados, Intentos, evidencia, informes
 *     AI, decisiones, paquetes fríos, outbox, trabajos);
 *   · atajos de preparación que no forman parte del producto: comprobar que las
 *     cuentas globales no traen secreto TOTP, leer identificadores de
 *     Contrapartes y Contratos-plantilla, forzar `expires_at` de un enlace al
 *     pasado y limpiar lo que esta prueba creó;
 *   · una reparación temporal del catálogo de opciones (ver `catalogos`).
 *
 * Nada sale de la máquina: la prueba sólo habla con la aplicación local,
 * la captura local y PostgreSQL local.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { DEFAULT_DATABASE_URL, appUrl } from "./defaults.mjs";
import {
  ACCOUNTS as DEMO_ACCOUNTS,
  DEMO_CATALOG_TOTALS,
  DEMO_CONTRACT_COVERAGE,
  DEMO_ORGANIZATION_SLUGS,
  ORGANIZATIONS as DEMO_ORGANIZATIONS,
} from "./demo-catalog.mjs";

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.join(ROOT, ".env"));

const ARGS = process.argv.slice(2);
const VERBOSE = ARGS.includes("--verbose");
const NO_CLEANUP = ARGS.includes("--no-cleanup");
const ONLY = (ARGS.find((item) => item.startsWith("--only=")) ?? "")
  .slice("--only=".length)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const APP = appUrl();
const SINK = (process.env.FIDES_SINK_HTTP_URL ?? "http://localhost:8025").replace(/\/$/, "");
const DATABASE_URL =
  process.env.FIDES_SMOKE_DATABASE_URL ??
  DEFAULT_DATABASE_URL;
// Mismo valor predeterminado que `scripts/seed.mjs`: la contraseña pública del
// demo sintético, para que el humo corra sin `.env`.
const PASSWORD = process.env.FIDES_SEED_PASSWORD || "FidesDemo123!";

const RUN = crypto.randomBytes(3).toString("hex");
const STARTED_AT = new Date();

const sql = postgres(DATABASE_URL, {
  max: 6,
  onnotice: () => undefined,
  connect_timeout: 10,
  connection: { search_path: "fides,public" },
});

// ---------------------------------------------------------------------------
// Registro y aserciones
// ---------------------------------------------------------------------------

const results = [];
const notes = [];
const created = {
  contracts: new Set(),
  drafts: new Set(),
  folders: new Set(),
  counterparties: new Set(),
  accounts: new Set(),
  invitations: new Set(),
};

function log(...parts) {
  if (VERBOSE) console.log("   ·", ...parts);
}

class CheckFailure extends Error {}

function expect(condition, message) {
  if (!condition) throw new CheckFailure(message);
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new CheckFailure(`${message} (esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)})`);
  }
}

// ---------------------------------------------------------------------------
// Cliente HTTP con tarro de galletas
// ---------------------------------------------------------------------------

class Session {
  constructor(label) {
    this.label = label;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  absorb(response) {
    const raw =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    for (const entry of raw) {
      const [pair] = entry.split(";");
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async raw(target, init = {}) {
    const url = new URL(target, APP);
    const headers = { ...init.headers };
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    const response = await fetch(url, { ...init, headers, redirect: "manual" });
    this.absorb(response);
    return response;
  }

  /** Sigue las redirecciones a mano para conservar las galletas. */
  async follow(target, init = {}) {
    let current = target;
    let response = await this.raw(current, init);
    for (let hop = 0; hop < 8; hop += 1) {
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) break;
      await response.arrayBuffer().catch(() => undefined);
      current = location;
      response = await this.raw(current);
    }
    response.finalUrl = new URL(current, APP).toString();
    return response;
  }

  async page(target) {
    const response = await this.follow(target);
    const html = await response.text();
    await scanChunks(html);
    return { response, html, status: response.status, url: response.finalUrl };
  }

  /** Envía un formulario renderizado, tal como lo haría un navegador sin JS. */
  async submit(target, form, fields = {}) {
    const body = new FormData();
    for (const [name, value] of Object.entries(form.hidden)) body.set(name, value);
    for (const [name, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        body.delete(name);
        for (const item of value) body.append(name, String(item));
        continue;
      }
      body.set(name, String(value));
    }
    const response = await this.follow(target, { method: "POST", body });
    const html = await response.text();
    await scanChunks(html);
    return { response, html, status: response.status, url: response.finalUrl };
  }

  /** Invoca una Server Action que no vive en un formulario. */
  async invoke(target, actionId, args) {
    const response = await this.raw(target, {
      method: "POST",
      headers: {
        "Next-Action": actionId,
        "content-type": "text/plain;charset=UTF-8",
      },
      body: JSON.stringify(args),
    });
    const text = await response.text();
    return {
      status: response.status,
      text,
      state: flightState(text),
      redirect: response.headers.get("x-action-redirect"),
    };
  }
}

// ---------------------------------------------------------------------------
// Lectura del HTML que produce React
// ---------------------------------------------------------------------------

function decodeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseForms(html) {
  const forms = [];
  const pattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const inner = match[2];
    const hidden = {};
    for (const input of inner.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
      const name = /name="([^"]*)"/.exec(input[0])?.[1];
      if (!name) continue;
      hidden[name] = decodeAttribute(/value="([^"]*)"/.exec(input[0])?.[1] ?? "");
    }
    const reference = Object.entries(hidden).find(([name]) => /^\$ACTION_\d+:0$/.test(name));
    let actionId = null;
    if (reference) {
      try {
        actionId = JSON.parse(reference[1]).id;
      } catch {
        actionId = null;
      }
    }
    forms.push({
      attributes: match[1],
      inner,
      hidden,
      actionId,
      text: inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    });
  }
  return forms;
}

/**
 * Elige un formulario por sus campos ocultos, por un fragmento de su marcado
 * o por el texto visible del botón.
 */
function pickForm(html, criteria) {
  const forms = Array.isArray(html) ? html : parseForms(html);
  const found = forms.filter((form) => {
    if (criteria.hidden) {
      for (const [name, value] of Object.entries(criteria.hidden)) {
        if (value === true) {
          if (!(name in form.hidden)) return false;
        } else if (form.hidden[name] !== value) return false;
      }
    }
    if (criteria.without) {
      for (const name of criteria.without) if (name in form.hidden) return false;
    }
    if (criteria.markup && !form.inner.includes(criteria.markup)) return false;
    if (criteria.notMarkup && form.inner.includes(criteria.notMarkup)) return false;
    if (criteria.text && !form.text.includes(criteria.text)) return false;
    return true;
  });
  if (found.length === 0) {
    throw new CheckFailure(
      `No encontré el formulario ${JSON.stringify(criteria)} en la página.`
    );
  }
  return found[criteria.index ?? 0];
}

function flightPayload(html) {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
    .map((match) => JSON.parse(`"${match[1]}"`))
    .join("");
}

/** Referencias de Server Action serializadas en el payload RSC, con sus args. */
function flightActions(html) {
  const payload = flightPayload(html);
  const rows = new Map();
  for (const match of payload.matchAll(/^([0-9a-f]+):(\[[\s\S]*?)$/gm)) {
    try {
      rows.set(match[1], JSON.parse(match[2]));
    } catch {
      /* la línea no era JSON completo */
    }
  }
  const actions = [];
  for (const match of payload.matchAll(/^[0-9a-f]+:(\{"id":"[0-9a-f]+"[^\n]*)$/gm)) {
    let parsed;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    let bound = [];
    if (typeof parsed.bound === "string" && parsed.bound.startsWith("$@")) {
      bound = rows.get(parsed.bound.slice(2)) ?? [];
    }
    actions.push({ id: parsed.id, bound });
  }
  return actions;
}

/** Estado devuelto por una Server Action invocada con `Next-Action`. */
function flightState(text) {
  for (const line of text.split("\n")) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const body = line.slice(index + 1);
    if (!body.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object" && "ok" in parsed) return parsed;
    } catch {
      /* la línea no era JSON completo */
    }
  }
  return null;
}

const seenChunks = new Set();
const actionIds = new Map();

/** El identificador de cada Server Action importada por un cliente. */
async function scanChunks(html) {
  const sources = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1])
    ),
  ];
  for (const source of sources) {
    if (seenChunks.has(source)) continue;
    seenChunks.add(source);
    const response = await fetch(`${APP}${source}`);
    if (!response.ok) continue;
    const text = await response.text();
    for (const match of text.matchAll(
      /createServerReference\)\("([0-9a-f]+)"[^)]*?"([A-Za-z]+)"\)/g
    )) {
      actionIds.set(match[2], match[1]);
    }
  }
}

function actionId(name) {
  const id = actionIds.get(name);
  if (!id) throw new CheckFailure(`No pude resolver el identificador de \`${name}\`.`);
  return id;
}

// ---------------------------------------------------------------------------
// Cuentas sintéticas (ADR-0082)
// ---------------------------------------------------------------------------

const ACCOUNTS = DEMO_ACCOUNTS.map((account) => ({
  email: account.email,
  memberships: account.memberships,
  landing: account.memberships.length === 0 ? "/plataforma" : "/app",
  defaultOrganization:
    account.email === "aviacion-norte-admin@aviacion-norte.local"
      ? "aviacion-norte-operaciones"
      : account.memberships[0]?.slug ?? null,
}));

const TEMPLATE_VALUES = Object.fromEntries(
  DEMO_ORGANIZATIONS.flatMap((organization) =>
    organization.templates.map((item, index) => [
      item.name,
      () => ({
        ...item.demoValues(index),
        ...(organization.slug === "transportes"
          ? { origen: `Guadalajara Smoke ${RUN}` }
          : {}),
      }),
    ])
  )
);

const DEFAULT_TEMPLATE = Object.fromEntries(
  DEMO_ORGANIZATIONS.map((organization) => [
    organization.slug,
    organization.templates[0].name,
  ])
);

const BASIC_CONFIGURATION = Object.fromEntries(
  DEMO_ORGANIZATIONS.map((organization) => [
    organization.slug,
    {
      linkDays: organization.settings.linkDays,
      requiresIne: false,
      requiresVideo: false,
      reviewPolicy: "none",
    },
  ])
);

// ---------------------------------------------------------------------------
// Datos de referencia leídos una sola vez
// ---------------------------------------------------------------------------

const world = {
  organizations: new Map(),
  templates: new Map(),
  counterparties: new Map(),
  accounts: new Map(),
};

async function loadWorld() {
  const organizations = await sql`
    SELECT o.id, o.slug, o.name, o.legal_name, o.seat_limit,
           s.default_link_days, s.default_requires_video,
           s.default_requires_ine, s.default_review_policy
    FROM organizations o
    JOIN organization_settings s ON s.organization_id = o.id
    WHERE o.slug = ANY (${DEMO_ORGANIZATION_SLUGS}::text[])
  `;
  for (const row of organizations) world.organizations.set(row.slug, row);
  expectEqual(
    world.organizations.size,
    DEMO_ORGANIZATIONS.length,
    "faltan Organizaciones sembradas"
  );

  const templates = await sql`
    SELECT t.id, t.name, o.slug FROM contract_templates t
    JOIN organizations o ON o.id = t.organization_id
  `;
  for (const row of templates) world.templates.set(`${row.slug}:${row.name}`, row.id);

  const counterparties = await sql`
    SELECT c.id, c.name, o.slug FROM counterparties c
    JOIN organizations o ON o.id = c.organization_id
    WHERE c.active ORDER BY c.name
  `;
  for (const row of counterparties) {
    const list = world.counterparties.get(row.slug) ?? [];
    list.push(row);
    world.counterparties.set(row.slug, list);
  }

  const accounts = await sql`
    SELECT id, email, is_platform_admin, totp_secret FROM accounts
  `;
  for (const row of accounts) world.accounts.set(row.email, row);

  const entitlements = await sql`
    SELECT o.slug, e.capability, e.enabled
    FROM commercial_entitlements e
    JOIN organizations o ON o.id = e.organization_id
    WHERE o.slug = ANY (${DEMO_ORGANIZATION_SLUGS}::text[])
  `;
  const capabilities = new Map();
  for (const row of entitlements) {
    const current = capabilities.get(row.slug) ?? {};
    current[row.capability] = row.enabled;
    capabilities.set(row.slug, current);
  }

  for (const expected of DEMO_ORGANIZATIONS) {
    const actual = world.organizations.get(expected.slug);
    expect(Boolean(actual), `falta la Organización ${expected.slug}`);
    expectEqual(actual.name, expected.name, `nombre inesperado para ${expected.slug}`);
    expectEqual(
      actual.legal_name,
      expected.legalName,
      `razón social inesperada para ${expected.slug}`
    );
    expectEqual(
      actual.seat_limit,
      expected.seatLimit,
      `límite de asientos inesperado para ${expected.slug}`
    );
    expectEqual(
      actual.default_link_days,
      expected.settings.linkDays,
      `vigencia predeterminada inesperada para ${expected.slug}`
    );
    expectEqual(
      actual.default_requires_video,
      expected.settings.requiresVideo,
      `video predeterminado inesperado para ${expected.slug}`
    );
    expectEqual(
      actual.default_requires_ine,
      expected.settings.requiresIne,
      `INE predeterminada inesperada para ${expected.slug}`
    );
    expectEqual(
      actual.default_review_policy,
      expected.settings.reviewPolicy,
      `revisión predeterminada inesperada para ${expected.slug}`
    );
    for (const [capability, enabled] of Object.entries(expected.entitlements)) {
      expectEqual(
        capabilities.get(expected.slug)?.[capability],
        enabled,
        `capacidad ${capability} inesperada para ${expected.slug}`
      );
    }
    for (const item of expected.templates) {
      expect(
        world.templates.has(`${expected.slug}:${item.name}`),
        `falta el Contrato-plantilla «${item.name}» de ${expected.slug}`
      );
    }
  }

  const [dataset] = await sql`
    SELECT
      (SELECT count(*)::int FROM organizations) AS organizations,
      (SELECT count(*)::int FROM accounts) AS accounts,
      (SELECT count(*)::int FROM contract_templates) AS templates,
      (SELECT count(*)::int FROM counterparties) AS counterparties,
      (SELECT count(*)::int FROM contract_folders) AS folders,
      (SELECT count(*)::int FROM contracts) AS contracts,
      (SELECT count(*)::int FROM contract_drafts) AS drafts
  `;
  for (const [key, expected] of Object.entries(DEMO_CATALOG_TOTALS)) {
    // Borradores y Contratos son datos operativos: la semilla reconciliable
    // conserva los que una persona haya creado en el demo local. El smoke sólo
    // exige que el catálogo base siga completo y no borra trabajo ajeno.
    if (key === "drafts" || key === "contracts") {
      expect(
        dataset[key] >= expected,
        `dataset demo incompleto: ${key} (mínimo ${expected}, obtenido ${dataset[key]})`
      );
    } else {
      expectEqual(dataset[key], expected, `dataset demo inesperado: ${key}`);
    }
  }

  const coverage = await sql`
    SELECT status, classification, count(*)::int AS total
    FROM contracts GROUP BY status, classification
  `;
  const coverageMap = new Map(
    coverage.map((row) => [`${row.status}:${row.classification}`, row.total])
  );
  for (const [key, expected] of Object.entries(DEMO_CONTRACT_COVERAGE)) {
    const actual = coverageMap.get(key) ?? 0;
    expect(
      actual >= expected,
      `cobertura demo incompleta: ${key} (mínimo ${expected}, obtenido ${actual})`
    );
  }

  const [reviews] = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE evidence.total > 0)::int AS with_evidence
    FROM review_tasks task
    JOIN LATERAL (
      SELECT count(*)::int AS total FROM evidence_items item
      WHERE item.attempt_id = task.attempt_id
    ) evidence ON TRUE
    WHERE task.status = 'open'
  `;
  expectEqual(
    reviews.total,
    DEMO_CONTRACT_COVERAGE["in_review:active"],
    "el dataset no tiene una revisión abierta por Organización"
  );
  expectEqual(
    reviews.with_evidence,
    DEMO_CONTRACT_COVERAGE["in_review:active"],
    "las revisiones abiertas no tienen evidencia sintética"
  );
}

function organizationId(slug) {
  const row = world.organizations.get(slug);
  if (!row) throw new CheckFailure(`No encontré la Organización ${slug}.`);
  return row.id;
}

function templateId(slug, name) {
  const id = world.templates.get(`${slug}:${name}`);
  if (!id) throw new CheckFailure(`No encontré el Contrato-plantilla «${name}» de ${slug}.`);
  return id;
}

function counterparty(slug, index) {
  const list = world.counterparties.get(slug) ?? [];
  const row = list[index % list.length];
  if (!row) throw new CheckFailure(`No hay Contrapartes activas en ${slug}.`);
  return row;
}

// ---------------------------------------------------------------------------
// Sesiones
// ---------------------------------------------------------------------------

const sessionCache = new Map();

async function signIn(email, { fresh = false } = {}) {
  if (!fresh && sessionCache.has(email)) return sessionCache.get(email);
  const session = new Session(email);
  const first = await session.page("/acceso");
  const form = pickForm(first.html, { markup: 'name="correo"' });
  const response = await session.raw("/acceso", {
    method: "POST",
    body: formBody(form, { correo: email, contrasena: PASSWORD }),
  });
  await response.arrayBuffer().catch(() => undefined);
  const location = response.headers.get("location");
  const record = { session, status: response.status, location };
  if (!fresh) sessionCache.set(email, record);
  return record;
}

function formBody(form, fields) {
  const body = new FormData();
  for (const [name, value] of Object.entries(form.hidden)) body.set(name, value);
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    body.set(name, String(value));
  }
  return body;
}

async function portal(email) {
  const record = await signIn(email);
  expect(
    record.location === "/app" ||
      record.location === "/app/organizaciones" ||
      record.location === "/plataforma",
    `«${email}» no pudo entrar (destino ${record.location}).`
  );
  const account = ACCOUNTS.find((item) => item.email === email);
  if (
    account?.memberships.length > 1 &&
    account?.defaultOrganization &&
    record.selectedOrganization !== account.defaultOrganization
  ) {
    const page = await record.session.page("/app/organizaciones");
    const form = pickForm(page.html, {
      hidden: { organizationId: organizationId(account.defaultOrganization) },
    });
    const selected = await record.session.submit("/app/organizaciones", form, {});
    expect(
      new URL(selected.url).pathname === "/app/contratos",
      `«${email}» no pudo seleccionar ${account.defaultOrganization}`
    );
    record.selectedOrganization = account.defaultOrganization;
  }
  return record.session;
}

// ---------------------------------------------------------------------------
// Emisión de Contratos por HTTP
// ---------------------------------------------------------------------------

const startForms = new Map();

/**
 * Los formularios se leen de la página real en cada Borrador: React empareja
 * el estado devuelto con `$ACTION_KEY`, así que reutilizar el marcado de otro
 * render descarta silenciosamente el resultado de la acción.
 */
async function draftForms(session, draftPath) {
  const page = await session.page(draftPath);
  const forms = parseForms(page.html);
  return {
    html: page.html,
    customize: pickForm(forms, { markup: 'name="linkDays"' }),
    folder: pickForm(forms, { markup: 'name="folderId"' }),
  };
}

async function reviewForm(session, reviewPath) {
  const page = await session.page(reviewPath);
  return { form: pickForm(page.html, { hidden: { draftId: true } }), html: page.html };
}

async function startDraftForm(session, slug, templateName) {
  const key = `start:${slug}:${templateName}`;
  if (!startForms.has(key)) {
    const page = await session.page("/app/contratos/nuevo");
    const wanted = templateId(slug, templateName);
    startForms.set(key, pickForm(page.html, { hidden: { templateId: wanted } }));
  }
  return startForms.get(key);
}

/**
 * Recorre el producto: `Capturar datos`, partes, configuración y
 * `Generar Contrato`. Devuelve la Referencia, el Contrato y el enlace opaco.
 */
async function issue(session, slug, options = {}) {
  const templateName = options.template ?? DEFAULT_TEMPLATE[slug];
  const start = await startDraftForm(session, slug, templateName);
  const response = await session.raw("/app/contratos/nuevo", {
    method: "POST",
    body: formBody(start, {}),
  });
  await response.arrayBuffer().catch(() => undefined);
  const draftPath = response.headers.get("location");
  expect(
    typeof draftPath === "string" && draftPath.startsWith("/app/contratos/nuevo/"),
    `«Capturar datos» no creó el Borrador (${response.status} → ${draftPath}).`
  );
  const draftId = draftPath.split("/").pop();
  created.drafts.add(draftId);

  const forms = await draftForms(session, draftPath);

  const values = { ...TEMPLATE_VALUES[templateName](), ...options.values };
  const holder = counterparty(slug, options.holder ?? 0);
  const signer = counterparty(slug, options.signer ?? 1);
  const saved = await session.invoke(draftPath, actionId("guardarCampos"), [
    {
      draftId,
      fieldValues: values,
      holderId: holder.id,
      signerId: signer.id,
    },
  ]);
  expect(saved.state?.ok === true, `«guardarCampos» falló: ${saved.state?.error ?? saved.status}`);

  const customization = options.useDefaults
    ? null
    : options.customize ?? BASIC_CONFIGURATION[slug];
  if (customization) {
    const evidence = await session.invoke(draftPath, actionId("guardarEvidencia"), [
      {
        draftId,
        requiresIne: customization.requiresIne === true,
        requiresVideo: customization.requiresVideo === true,
      },
    ]);
    expect(
      evidence.state?.ok === true,
      `«guardarEvidencia» falló: ${evidence.state?.error ?? evidence.status}`
    );
    const fields = {
      linkDays: customization.linkDays,
      reviewPolicy: customization.reviewPolicy ?? "none",
    };
    const page = await session.submit(draftPath, forms.customize, fields);
    expect(
      !page.html.includes("No pudimos completar la operación"),
      "«Personalizar este contrato» no aceptó la configuración."
    );
  }

  if (options.folderId) {
    await session.submit(draftPath, forms.folder, { folderId: options.folderId });
  }

  const reviewPath = `${draftPath}/revisar`;
  const generate = await reviewForm(session, reviewPath);
  const issued = await session.submit(reviewPath, generate.form, {});

  const reference = /AC-\d{8}-\d{4}/.exec(issued.html)?.[0] ?? null;
  const contractId = /\/app\/contratos\/([0-9a-f-]{36})/.exec(issued.html)?.[1] ?? null;
  const tokens = [...new Set([...issued.html.matchAll(/\/c\/([A-Za-z0-9_-]{20,})/g)].map((m) => m[1]))];
  expect(
    reference !== null && contractId !== null && tokens.length === 1,
    `«Generar Contrato» no emitió el Contrato: ${issueBlockers(issued.html)}`
  );
  created.contracts.add(contractId);
  log(`emitido ${reference} (${slug})`);
  return { draftId, draftPath, reference, contractId, token: tokens[0] };
}

/**
 * Texto legible de un PDF: pdf-lib comprime los flujos con `FlateDecode` y
 * escribe las cadenas en hexadecimal, así que hay que inflar y decodificar
 * antes de buscar la Referencia o comprobar que el token no aparece.
 */
function pdfText(buffer) {
  const parts = [buffer.toString("latin1")];
  let index = 0;
  while (index < buffer.length) {
    const start = buffer.indexOf("stream", index);
    if (start === -1) break;
    let begin = start + "stream".length;
    if (buffer[begin] === 0x0d) begin += 1;
    if (buffer[begin] === 0x0a) begin += 1;
    const end = buffer.indexOf("endstream", begin);
    if (end === -1) break;
    try {
      parts.push(zlib.inflateSync(buffer.subarray(begin, end)).toString("latin1"));
    } catch {
      parts.push(buffer.subarray(begin, end).toString("latin1"));
    }
    index = end + "endstream".length;
  }
  const joined = parts.join("\n");
  const decodedHex = joined.replace(/<([0-9A-Fa-f]{2,})>/g, (whole, hex) =>
    hex.length % 2 === 0 ? Buffer.from(hex, "hex").toString("latin1") : whole
  );
  return `${joined}\n${decodedHex}`;
}

/** Motivos que la pantalla `Revisar y generar` muestra cuando no puede emitir. */
function issueBlockers(html) {
  const alert = /Todavía no puedes generar el contrato([\s\S]{0,900}?)<\/ul>/.exec(html);
  if (alert) return stripTags(alert[1]);
  const message = /role="alert"[^>]*>([\s\S]{0,400}?)<\/div>/.exec(html);
  if (message) return stripTags(message[1]);
  return stripTags(html).slice(0, 300);
}

/** Referencias con enlace al expediente: las filas reales de un listado. */
function resultRows(html) {
  const rows = new Map();
  for (const match of html.matchAll(
    /href="\/app\/contratos\/([0-9a-f-]{36})"[^>]*>\s*(AC-\d{8}-\d{4})\s*</g
  )) {
    rows.set(match[1], match[2]);
  }
  return rows;
}

/** Total que informa la paginación; `null` cuando la lista no la muestra. */
function resultTotal(html) {
  const match = /\(\s*(\d+)\s+resultados?\s*\)/.exec(stripTags(html));
  return match ? Number(match[1]) : null;
}

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Recorrido del Firmante
// ---------------------------------------------------------------------------

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
  Buffer.from("imagen sintetica de prueba, sin persona real\n".repeat(24), "utf8"),
  Buffer.from([0xff, 0xd9]),
]);

async function openSigner(token) {
  const response = await fetch(`${APP}/c/${token}`, { redirect: "manual" });
  const html = await response.text();
  return { status: response.status, html };
}

async function walk(token) {
  const page = await openSigner(token);
  expectEqual(page.status, 200, "el enlace del Firmante no abrió");
  const action = flightActions(page.html).find(
    (item) => Array.isArray(item.bound) && item.bound[0] === token
  );
  expect(Boolean(action), "no encontré la acción `Contrato recorrido` en el recorrido.");
  const response = await fetch(`${APP}/c/${token}`, {
    method: "POST",
    headers: { "Next-Action": action.id, "content-type": "text/plain;charset=UTF-8" },
    body: JSON.stringify([token]),
    redirect: "manual",
  });
  await response.arrayBuffer().catch(() => undefined);
  expectEqual(response.status, 200, "`Contrato recorrido` no se registró");
}

async function uploadEvidence(token, kind, { marker = "aceptar" } = {}) {
  const body = new FormData();
  body.set("tipo", kind);
  if (kind === "video") {
    body.set("sintetico", "1");
    body.set("marcador", marker);
  } else {
    body.set("archivo", new Blob([JPEG], { type: "image/jpeg" }), `${kind}-sintetica.jpg`);
  }
  const response = await fetch(`${APP}/c/${token}/evidencia/subir`, { method: "POST", body });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

async function acceptSigner(token) {
  const session = new Session("firmante");
  const page = await session.page(`/c/${token}/aceptar`);
  expect(
    page.html.includes('name="aceptacion"'),
    `«Aceptar contrato» no está disponible (${page.url}).`
  );
  const form = pickForm(page.html, { markup: 'name="aceptacion"' });
  return session.submit(`/c/${token}/aceptar`, form, { aceptacion: "si" });
}

async function acceptWithoutLegend(token) {
  const session = new Session("firmante");
  const page = await session.page(`/c/${token}/aceptar`);
  const form = pickForm(page.html, { markup: 'name="aceptacion"' });
  return session.submit(`/c/${token}/aceptar`, form, {});
}

async function signerJourney(token, { ine = false, video = false, marker = "aceptar" } = {}) {
  await walk(token);
  if (ine) {
    for (const kind of ["ine_front", "ine_back"]) {
      const uploaded = await uploadEvidence(token, kind);
      expectEqual(uploaded.status, 200, `no se pudo subir ${kind}`);
    }
  }
  if (video) {
    const uploaded = await uploadEvidence(token, "video", { marker });
    expectEqual(uploaded.status, 200, "no se pudo subir el video guiado");
  }
  return acceptSigner(token);
}

// ---------------------------------------------------------------------------
// Consultas de apoyo
// ---------------------------------------------------------------------------

async function contractRow(contractId) {
  const [row] = await sql`SELECT * FROM contracts WHERE id = ${contractId}`;
  return row ?? null;
}

async function attempts(contractId) {
  return sql`
    SELECT id, sequence, status, walked_at, submitted_at, closed_at
    FROM acceptance_attempts WHERE contract_id = ${contractId} ORDER BY sequence
  `;
}

async function openTask(contractId) {
  const [row] = await sql`
    SELECT id, status, attempt_id FROM review_tasks
    WHERE contract_id = ${contractId} ORDER BY created_at DESC LIMIT 1
  `;
  return row ?? null;
}

async function waitFor(description, probe, { timeoutMs = 25000, intervalMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new CheckFailure(`Se agotó la espera de ${description}.`);
}

let sinkBaseline = new Set();

async function sinkMessages() {
  const response = await fetch(`${SINK}/api/messages`);
  expectEqual(response.ok, true, "la captura local no respondió");
  const body = await response.json();
  return (body.messages ?? []).filter((message) => !sinkBaseline.has(message.id));
}

// ---------------------------------------------------------------------------
// Comprobaciones
// ---------------------------------------------------------------------------

const checks = [];

function check(name, requirement, run) {
  checks.push({ name, requirement, run });
}

// --- salud ---------------------------------------------------------------

check("salud", "entorno", async () => {
  const response = await fetch(`${APP}/api/salud`);
  expectEqual(response.status, 200, "/api/salud no respondió 200");
  const body = await response.json();
  expectEqual(body.ok, true, "/api/salud no reporta la base disponible");

  for (const [label, url] of [
    ["captura local", `${SINK}/health`],
    ["doble AI", `${process.env.FIDES_AI_HTTP_URL ?? "http://localhost:8030"}/health`],
  ]) {
    const probe = await fetch(url);
    expectEqual(probe.ok, true, `${label} no respondió en ${url}`);
  }

  const landing = await fetch(`${APP}/`);
  const landingHtml = await landing.text();
  expectEqual(landing.status, 200, "la landing no respondió 200");
  expect(landingHtml.includes("Fides"), "la marca visible Fides no aparece en la landing");

  const manifestResponse = await fetch(`${APP}/manifest.webmanifest`);
  expectEqual(manifestResponse.status, 200, "el manifiesto instalable no respondió 200");
  expect(
    manifestResponse.headers.get("content-type")?.includes("application/manifest+json"),
    "el manifiesto instalable no usa application/manifest+json"
  );
  const manifest = await manifestResponse.json();
  expectEqual(manifest.name, "Fides", "el manifiesto no usa la marca Fides");
  expectEqual(manifest.display, "standalone", "el manifiesto no declara modo instalable");
  expect((manifest.icons ?? []).length >= 3, "el manifiesto no declara todos los iconos instalables");
  for (const icon of manifest.icons ?? []) {
    const iconResponse = await fetch(new URL(icon.src, APP));
    expectEqual(iconResponse.status, 200, `falta el icono instalable ${icon.src}`);
  }
});

// --- catálogos: invariante del entorno sembrado --------------------------

check("catalogos", "entorno", async () => {
  const broken = await sql`
    SELECT f.id, f.key, t.name AS template
    FROM contract_field_definitions f
    JOIN contract_templates t ON t.id = f.template_id
    WHERE f.data_type IN ('select', 'suggest')
      AND jsonb_typeof(f.options) <> 'array'
  `;
  if (broken.length === 0) return;

  // Reparación temporal del entorno: sin esto ningún Contrato-plantilla con
  // un Campo con opciones puede emitirse y el resto de la prueba no
  // tendría señal. Queda registrado como falla y reportado como defecto.
  await sql`
    UPDATE contract_field_definitions
    SET options = (options #>> '{}')::jsonb
    WHERE data_type IN ('select', 'suggest')
      AND jsonb_typeof(options) <> 'array'
  `;
  notes.push(
    `Se normalizaron ${broken.length} catálogo(s) de opciones doblemente codificados para poder continuar: ` +
      broken.map((row) => `${row.template}/${row.key}`).join(", ") +
      ". La reparación queda en la base, así que esta comprobación sólo vuelve a fallar " +
      "después de `FIDES_SEED_RESET=true npm run db:seed`."
  );
  throw new CheckFailure(
    `scripts/seed.mjs guarda \`contract_field_definitions.options\` como cadena JSON y no como arreglo; ` +
      `\`toOptions\` devuelve [] y las opciones de captura desaparecen. ` +
      `Afecta: ${broken.map((row) => `${row.template}/${row.key}`).join(", ")}.`
  );
});

// --- 1. acceso y alcance -------------------------------------------------

check("acceso", "1 · toda cuenta entra y sólo ve su alcance", async () => {
  for (const account of ACCOUNTS) {
    const record = await signIn(account.email, { fresh: true });
    expectEqual(record.status, 303, `«${account.email}» no obtuvo redirección al entrar`);
    expectEqual(record.location, account.landing, `«${account.email}» aterrizó donde no debía`);
  }

  // Credenciales incorrectas: mensaje neutro, sin sesión.
  const stranger = new Session("desconocido");
  const page = await stranger.page("/acceso");
  const form = pickForm(page.html, { markup: 'name="correo"' });
  const denied = await stranger.submit("/acceso", form, {
    correo: "transportes-admin@transportes.local",
    contrasena: `${PASSWORD}-incorrecta`,
  });
  expect(
    denied.html.includes("Correo o contraseña incorrectos"),
    "una contraseña incorrecta no fue rechazada"
  );

  // Alcance: un Emisor de Transportes no ve Contratos de otra Organización.
  const uno = await portal("transportes-admin@transportes.local");
  const contratos = await uno.page("/app/contratos");
  expectEqual(contratos.status, 200, "el portal de Transportes no cargó");
  expect(
    contratos.html.includes("Transportes"),
    "el portal no muestra la Organización activa de la sesión"
  );

  // Sin sesión no hay portal.
  const anonymous = new Session("anónimo");
  const blocked = await anonymous.page("/app/contratos");
  expect(
    blocked.url.includes("/acceso"),
    `una sesión anónima llegó a ${blocked.url} en lugar de /acceso`
  );

  // Un Revisor sin rol Emisor no puede crear Contratos.
  const revisor = await portal("aviacion-norte-revisor@aviacion-norte.local");
  const nuevo = await revisor.page("/app/contratos/nuevo");
  expect(
    nuevo.status >= 400 || !nuevo.html.includes("Capturar datos"),
    "una cuenta sin rol Emisor llegó a `Crear contrato`"
  );
});

// --- 2. las cuentas globales entran sin segundo factor -------------------

check("totp", "2 · las cuentas globales entran sin segundo factor", async () => {
  const email = "platform-admin@fides.local";
  const record = await signIn(email, { fresh: true });
  expectEqual(record.location, "/plataforma", "la cuenta global no entró directo a la plataforma");

  // El POC-Demo local no siembra TOTP (ADR-0041, Etapas 1 y 2), así que la
  // contraseña basta y el segundo paso no debe interponerse.
  const secret = world.accounts.get(email)?.totp_secret;
  expect(!secret, "la cuenta global tiene un secreto TOTP sembrado");

  const platform = await record.session.page("/plataforma");
  expectEqual(platform.status, 200, "la plataforma no cargó con la sola contraseña");
  expect(
    !platform.url.includes("/acceso/totp"),
    `la plataforma redirigió a ${platform.url}`
  );

  // El segundo paso ya está resuelto al crear la sesión, así que `/acceso/totp`
  // no muestra el formulario: devuelve a la plataforma sin pedir ningún código.
  const totpPage = await record.session.page("/acceso/totp");
  expectEqual(
    new URL(totpPage.url).pathname,
    "/plataforma",
    "el paso TOTP no devolvió a la plataforma"
  );
  expect(
    !totpPage.html.includes('name="codigo"'),
    "la pantalla del segundo factor pidió un código"
  );
  sessionCache.set(email, record);
});

// --- 5 (aislamiento) -----------------------------------------------------

check("aislamiento", "1 · un miembro no lee un Contrato de otra Organización", async () => {
  const dos = await portal("aviacion-norte-admin@aviacion-norte.local");
  const ajeno = await issue(dos, "aviacion-norte-operaciones");

  const uno = await portal("transportes-admin@transportes.local");
  const leak = await uno.page(`/app/contratos/${ajeno.contractId}`);
  expectEqual(leak.status, 404, "un miembro de Transportes leyó un Contrato de Aviacion Norte Operaciones");
  expect(
    !leak.html.includes(ajeno.reference),
    "la respuesta filtró la Referencia de otra Organización"
  );

  const pdf = await uno.raw(`/app/contratos/${ajeno.contractId}/pdf`);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  expect(pdf.status === 404 || pdf.status === 403, `el PDF ajeno respondió ${pdf.status}`);
  expect(!bytes.subarray(0, 5).toString("latin1").startsWith("%PDF"), "se entregó un PDF ajeno");

  const search = await uno.page(`/app/contratos?q=${encodeURIComponent(ajeno.reference)}`);
  expect(
    !resultRows(search.html).has(ajeno.contractId),
    "el buscador de Transportes devolvió un Contrato de Aviacion Norte Operaciones"
  );
  const visible = [...resultRows(search.html).keys()];
  if (visible.length > 0) {
    const owners = await sql`
      SELECT DISTINCT organization_id FROM contracts WHERE id = ANY (${visible}::uuid[])
    `;
    expectEqual(owners.length, 1, "el buscador mezcló Organizaciones");
    expectEqual(
      owners[0].organization_id,
      organizationId("transportes"),
      "el buscador devolvió un Contrato ajeno"
    );
  }
});

// --- 3. emisión con valores predeterminados ------------------------------

check("emision-predeterminada", "3 · Emisor crea con valores predeterminados", async () => {
  const uno = await portal("transportes-admin@transportes.local");
  const issued = await issue(uno, "transportes", { useDefaults: true });

  expect(/^AC-\d{8}-\d{4}$/.test(issued.reference), `Referencia con formato inesperado: ${issued.reference}`);
  const today = new Date();
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  expect(issued.reference.startsWith(`AC-${stamp}-`), "la Referencia no usa la fecha de emisión");
  expect(issued.token.length >= 20, "el enlace no es opaco");

  const row = await contractRow(issued.contractId);
  expectEqual(row.status, "pending", "el Contrato emitido no quedó `Pendiente de aceptación`");
  expectEqual(row.link_days, 7, "no se aplicó la vigencia predeterminada de Transportes");
  expectEqual(row.requires_ine, true, "no se aplicó la INE predeterminada de Transportes");
  expectEqual(row.requires_video, false, "se pidió video sin capacidad habilitada");
  expectEqual(row.review_policy, "manual", "la revisión predeterminada de Transportes cambió");
  expectEqual(row.customized, false, "un Contrato con valores predeterminados quedó marcado como personalizado");

  const [link] = await sql`
    SELECT expires_at, created_at FROM contract_links WHERE contract_id = ${issued.contractId}
  `;
  const days = Math.round((link.expires_at - link.created_at) / 86400000);
  expectEqual(days, 7, "la vigencia del enlace no corresponde a la configuración");

  const list = await uno.page("/app/contratos");
  expect(list.html.includes(issued.reference), "el Contrato emitido no aparece en la lista");
});

// --- 4. emisión personalizada --------------------------------------------

check("emision-personalizada", "4 · Emisor personaliza todas las opciones", async () => {
  const dos = await portal("aviacion-norte-admin@aviacion-norte.local");
  const issued = await issue(dos, "aviacion-norte-operaciones", {
    customize: { linkDays: 21, requiresIne: true, requiresVideo: true, reviewPolicy: "ai" },
  });

  const row = await contractRow(issued.contractId);
  expectEqual(row.link_days, 21, "no se guardó la vigencia elegida");
  expectEqual(row.requires_ine, true, "no se guardó la evidencia de INE elegida");
  expectEqual(row.requires_video, true, "no se guardó el video guiado elegido");
  expectEqual(row.review_policy, "ai", "no se guardó la política de revisión elegida");
  expectEqual(row.customized, true, "el Contrato personalizado no quedó marcado");

  // Fuera de 1–30 días el dominio falla cerrado.
  const start = await startDraftForm(
    dos,
    "aviacion-norte-operaciones",
    DEFAULT_TEMPLATE["aviacion-norte-operaciones"]
  );
  const response = await dos.raw("/app/contratos/nuevo", { method: "POST", body: formBody(start, {}) });
  await response.arrayBuffer().catch(() => undefined);
  const draftPath = response.headers.get("location");
  created.drafts.add(draftPath.split("/").pop());
  const forms = await draftForms(dos, draftPath);
  const rejected = await dos.submit(forms.customize.action ?? draftPath, forms.customize, {
    linkDays: 45,
    reviewPolicy: "manual",
  });
  expect(
    rejected.html.includes("1 a 30 días"),
    "una vigencia de 45 días no fue rechazada"
  );

  // Toda Organización puede elegir INE y video; la revisión AI sí permanece
  // limitada por la capacidad adicional.
  const uno = await portal("transportes-admin@transportes.local");
  const sinCapacidad = await issue(uno, "transportes", {
    customize: { linkDays: 3, requiresIne: true, requiresVideo: true, reviewPolicy: "ai" },
  });
  const restricted = await contractRow(sinCapacidad.contractId);
  expectEqual(restricted.requires_ine, true, "Transportes perdió su capacidad de INE");
  expectEqual(restricted.requires_video, true, "Transportes no conservó el video elegido");
  expectEqual(restricted.review_policy, "manual", "Transportes emitió con AI sin tener la capacidad");
  expectEqual(restricted.link_days, 3, "no se aplicó la vigencia personalizada");
});

// --- 5. recorrido sin evidencia ------------------------------------------

check("firmante-sin-evidencia", "5 · recorrido sin evidencia adicional", async () => {
  const uno = await portal("transportes-admin@transportes.local");
  const issued = await issue(uno, "transportes");

  const first = await openSigner(issued.token);
  expectEqual(first.status, 200, "el enlace no abrió");
  expect(first.html.includes(issued.reference), "el recorrido no muestra la Referencia");
  expect(
    /<button type="button"[^>]*disabled[^>]*>\s*Continuar/.test(first.html),
    "`Continuar` no está bloqueado antes de recorrer el contrato"
  );

  // Antes del recorrido, la etapa de aceptación devuelve a la lectura.
  const early = new Session("firmante");
  const gated = await early.page(`/c/${issued.token}/aceptar`);
  expect(
    gated.url.endsWith(`/c/${issued.token}`),
    `«Aceptar» quedó accesible sin recorrer el contrato (${gated.url})`
  );

  await walk(issued.token);
  const [attempt] = await attempts(issued.contractId);
  expect(attempt.walked_at !== null, "no se registró el evento `Contrato recorrido`");
  const [walkEvent] = await sql`
    SELECT type FROM contract_events
    WHERE contract_id = ${issued.contractId} AND type = 'contrato_recorrido'
  `;
  expect(Boolean(walkEvent), "no existe el evento técnico `contrato_recorrido`");

  const withoutLegend = await acceptWithoutLegend(issued.token);
  expect(
    withoutLegend.html.includes("Marca la casilla"),
    "se aceptó el contrato sin marcar la leyenda"
  );
  expectEqual((await contractRow(issued.contractId)).status, "pending", "el Contrato cambió de estado sin aceptación");

  const done = await acceptSigner(issued.token);
  expect(done.html.includes("Contrato aceptado"), "no se mostró `Contrato aceptado`");
  expect(done.html.includes(issued.reference), "la pantalla final no muestra la Referencia");

  const row = await contractRow(issued.contractId);
  expectEqual(row.status, "accepted", "el Contrato no quedó `Aceptado`");
  expect(row.accepted_at !== null, "no se registró la fecha de aceptación");

  const [acceptance] = await sql`
    SELECT kind FROM evidence_items WHERE contract_id = ${issued.contractId} AND kind = 'acceptance'
  `;
  expect(Boolean(acceptance), "no se conservó la evidencia de aceptación electrónica");
  const tasks = await sql`SELECT id FROM review_tasks WHERE contract_id = ${issued.contractId}`;
  expectEqual(tasks.length, 0, "`Sin revisión` creó una tarea de revisión");
});

// --- 6. recorridos con evidencia ------------------------------------------

check("firmante-ine", "6 · recorrido con INE (Aviacion Norte Operaciones)", async () => {
  const dos = await portal("aviacion-norte-admin@aviacion-norte.local");
  const issued = await issue(dos, "aviacion-norte-operaciones", {
    customize: { linkDays: 10, requiresIne: true, reviewPolicy: "none" },
  });

  await walk(issued.token);

  // Sin la evidencia del Perfil efectivo no hay aceptación.
  const early = new Session("firmante");
  const gated = await early.page(`/c/${issued.token}/aceptar`);
  expect(gated.url.includes("/evidencia"), `se pudo aceptar sin INE (${gated.url})`);

  const wrongKind = await uploadEvidence(issued.token, "video");
  expectEqual(wrongKind.status, 409, "se aceptó evidencia que el Perfil no solicita");

  for (const kind of ["ine_front", "ine_back"]) {
    const uploaded = await uploadEvidence(issued.token, kind);
    expectEqual(uploaded.status, 200, `no se pudo subir ${kind}`);
  }

  const done = await acceptSigner(issued.token);
  expect(done.html.includes("Contrato aceptado"), "el recorrido con INE no terminó aceptado");

  const [attempt] = await attempts(issued.contractId);
  const kinds = (
    await sql`SELECT kind, byte_size, sha256 FROM evidence_items WHERE attempt_id = ${attempt.id} ORDER BY kind`
  ).map((row) => row.kind);
  expect(kinds.includes("ine_front") && kinds.includes("ine_back"), "no se conservó la evidencia de INE");
  const sizes = await sql`
    SELECT byte_size, sha256, object_key FROM evidence_items
    WHERE attempt_id = ${attempt.id} AND kind = 'ine_front'
  `;
  expect(sizes[0].byte_size > 0 && sizes[0].sha256.length === 64, "la evidencia se guardó sin bytes ni huella");
  expect(Boolean(sizes[0].object_key), "la evidencia sensible no quedó en almacenamiento privado");
});

check("firmante-video", "6 · recorrido con video guiado (Euzen)", async () => {
  const tres = await portal("euzen-admin@euzen.local");
  const issued = await issue(tres, "euzen", {
    customize: { linkDays: 5, requiresVideo: true, reviewPolicy: "none" },
  });

  const row = await contractRow(issued.contractId);
  expectEqual(row.requires_video, true, "no se configuró el video guiado");
  expect(row.video_statement.length > 0, "el Contrato no congeló la declaración del video");
  expect(
    !row.video_statement.includes("{{"),
    "la declaración del video conserva marcadores sin resolver"
  );

  await walk(issued.token);
  const uploaded = await uploadEvidence(issued.token, "video");
  expectEqual(uploaded.status, 200, "no se pudo subir el video guiado");

  const done = await acceptSigner(issued.token);
  expect(done.html.includes("Contrato aceptado"), "el recorrido con video no terminó aceptado");

  const [attempt] = await attempts(issued.contractId);
  const [video] = await sql`
    SELECT content_type, byte_size, metadata FROM evidence_items
    WHERE attempt_id = ${attempt.id} AND kind = 'video'
  `;
  expect(Boolean(video), "no se conservó el video guiado");
  expect(video.content_type.startsWith("video/"), "el video no se guardó con su tipo");
});

check("firmante-ine-video", "6 · recorrido con INE y video", async () => {
  const dos = await portal("aviacion-norte-admin@aviacion-norte.local");
  const issued = await issue(dos, "aviacion-norte-operaciones", {
    customize: { linkDays: 12, requiresIne: true, requiresVideo: true, reviewPolicy: "none" },
  });

  await walk(issued.token);
  await uploadEvidence(issued.token, "ine_front");
  const partial = new Session("firmante");
  const stillGated = await partial.page(`/c/${issued.token}/aceptar`);
  expect(stillGated.url.includes("/evidencia"), "se pudo aceptar con la evidencia incompleta");

  await uploadEvidence(issued.token, "ine_back");
  await uploadEvidence(issued.token, "video");

  const done = await acceptSigner(issued.token);
  expect(done.html.includes("Contrato aceptado"), "el recorrido con ambas evidencias no terminó aceptado");

  const [attempt] = await attempts(issued.contractId);
  const kinds = (
    await sql`SELECT kind FROM evidence_items WHERE attempt_id = ${attempt.id} ORDER BY kind`
  ).map((row) => row.kind);
  for (const expected of ["acceptance", "ine_back", "ine_front", "video"]) {
    expect(kinds.includes(expected), `falta la evidencia ${expected}`);
  }
});

// --- 7. revisión manual: concluir, repetir, SKIP --------------------------

async function reviewSession(email) {
  return portal(email);
}

check("revision-manual", "7 · la revisión manual llega a la bandeja y se concluye", async () => {
  const dos = await portal("aviacion-norte-admin@aviacion-norte.local");
  const issued = await issue(dos, "aviacion-norte-operaciones", {
    customize: { linkDays: 10, requiresIne: true, reviewPolicy: "manual" },
  });

  const done = await signerJourney(issued.token, { ine: true });
  expect(done.html.includes("Proceso enviado a revisión"), "el recorrido no quedó a revisión");
  expectEqual((await contractRow(issued.contractId)).status, "in_review", "el Contrato no quedó `A revisión`");

  const revisor = await reviewSession("aviacion-norte-revisor@aviacion-norte.local");
  const inbox = await revisor.page("/app/revision");
  expect(inbox.html.includes(issued.reference), "la revisión no aparece en la bandeja del Revisor");

  const task = await openTask(issued.contractId);
  expect(Boolean(task), "no se creó la tarea de revisión");

  // Un Emisor sin rol Revisor no decide.
  const emisor = await portal("aviacion-norte-admin@aviacion-norte.local");
  const denied = await emisor.page(`/app/revision/${task.id}`);
  expect(
    denied.status >= 400 || !denied.html.includes("Aceptar contrato"),
    "una cuenta sin rol Revisor pudo abrir la pantalla de decisión"
  );

  const panel = await revisor.page(`/app/revision/${task.id}`);
  expect(panel.html.includes("Aceptar contrato"), "la pantalla de decisión no ofrece aceptar");
  const form = pickForm(panel.html, { hidden: { taskId: task.id }, markup: 'value="conclude"' });
  const resolved = await revisor.submit(`/app/revision/${task.id}`, form, { decision: "conclude" });
  expect(
    resolved.html.includes("Revisión concluida") || resolved.html.includes("ya fue resuelta"),
    `«Aceptar contrato» no registró la decisión: ${stripTags(resolved.html).slice(0, 200)}`
  );

  expectEqual((await contractRow(issued.contractId)).status, "accepted", "el Contrato no quedó `Aceptado`");
  const [decision] = await sql`SELECT decision, reviewer_name FROM review_decisions WHERE task_id = ${task.id}`;
  expectEqual(decision.decision, "conclude", "no se guardó la decisión `conclude`");
  expectEqual((await openTask(issued.contractId)).status, "resolved", "la tarea no quedó resuelta");
});

check("revision-repetir", "7 · `Repetir proceso` crea un Intento nuevo en el mismo Contrato", async () => {
  const dos = await portal("aviacion-norte-admin@aviacion-norte.local");
  const issued = await issue(dos, "aviacion-norte-operaciones", {
    customize: { linkDays: 10, requiresIne: true, requiresVideo: true, reviewPolicy: "manual" },
  });
  await signerJourney(issued.token, { ine: true, video: true });

  const revisor = await reviewSession("aviacion-norte-revisor@aviacion-norte.local");
  const task = await openTask(issued.contractId);
  const panel = await revisor.page(`/app/revision/${task.id}`);
  const form = pickForm(panel.html, { hidden: { taskId: task.id }, markup: 'name="reasonCode"' });

  // Motivo fuera de la lista cerrada.
  const invalid = await revisor.submit(`/app/revision/${task.id}`, form, { reasonCode: "porque-si" });
  expect(invalid.html.includes("Elige un motivo de la lista"), "se aceptó un motivo fuera de la lista");

  // `otro` exige texto libre.
  const missingText = await revisor.submit(`/app/revision/${task.id}`, form, { reasonCode: "otro" });
  expect(
    missingText.html.includes("Describe el motivo"),
    "`Otro` se aceptó sin explicación"
  );

  const repeated = await revisor.submit(`/app/revision/${task.id}`, form, {
    reasonCode: "video_incompleto",
  });
  expect(
    repeated.html.includes("intento nuevo") || repeated.html.includes("Copiar enlace"),
    `«Repetir proceso» no creó el sucesor: ${stripTags(repeated.html).slice(0, 240)}`
  );

  const rows = await attempts(issued.contractId);
  expectEqual(rows.length, 2, "no se creó un Intento sucesor");
  expectEqual(rows[0].status, "repeated", "el Intento anterior no quedó `repeated`");
  expectEqual(rows[1].status, "open", "el Intento sucesor no quedó abierto");
  expect(rows[1].walked_at === null, "el Intento sucesor heredó el recorrido del anterior");

  const sameContract = await sql`
    SELECT count(*)::int AS total FROM contracts WHERE id = ${issued.contractId}
  `;
  expectEqual(sameContract[0].total, 1, "la repetición creó otro Contrato");
  expectEqual((await contractRow(issued.contractId)).status, "pending", "la repetición no devolvió el Contrato a `Pendiente`");

  const links = await sql`
    SELECT token, revoked_at, attempt_id FROM contract_links
    WHERE contract_id = ${issued.contractId} ORDER BY created_at
  `;
  expectEqual(links.length, 2, "no se emitió un enlace nuevo");
  expect(links[0].revoked_at !== null, "el enlace del Intento repetido no se revocó");
  expect(links[1].revoked_at === null, "el enlace nuevo nació revocado");

  const oldLink = await openSigner(links[0].token);
  expect(
    oldLink.html.includes("no está disponible") || oldLink.status === 404,
    "el enlace revocado sigue sirviendo el recorrido"
  );

  // El Intento nuevo vuelve a exigir el recorrido completo y evidencia propia.
  const newToken = links[1].token;
  const reopened = await openSigner(newToken);
  expect(
    /<button type="button"[^>]*disabled[^>]*>\s*Continuar/.test(reopened.html),
    "el Intento sucesor no volvió a bloquear `Continuar`"
  );
  const rejected = await uploadEvidence(newToken, "ine_front");
  expectEqual(rejected.status, 409, "el Intento sucesor aceptó evidencia sin recorrer el contrato");

  const inherited = await sql`
    SELECT count(*)::int AS total FROM evidence_items WHERE attempt_id = ${rows[1].id}
  `;
  expectEqual(inherited[0].total, 0, "el Intento sucesor reutilizó la evidencia anterior");

  await signerJourney(newToken, { ine: true, video: true });
  const secondTask = await openTask(issued.contractId);
  expect(secondTask.id !== task.id, "la repetición reutilizó la tarea de revisión anterior");

  const closing = await revisor.page(`/app/revision/${secondTask.id}`);
  const concludeForm = pickForm(closing.html, { hidden: { taskId: secondTask.id }, markup: 'value="conclude"' });
  await revisor.submit(`/app/revision/${secondTask.id}`, concludeForm, { decision: "conclude" });
  expectEqual((await contractRow(issued.contractId)).status, "accepted", "el segundo Intento no cerró el Contrato");

  const history = await sql`
    SELECT decision, reason_code FROM review_decisions
    WHERE contract_id = ${issued.contractId} ORDER BY created_at
  `;
  expectEqual(history.length, 2, "el historial de decisiones quedó incompleto");
  expectEqual(history[0].decision, "repeat", "no se registró la decisión de repetir");
  expectEqual(history[0].reason_code, "video_incompleto", "no se registró el motivo cerrado");
});

check("revision-skip", "7 · `Omitir revisión y aceptar (SKIP)`", async () => {
  const dos = await portal("aviacion-norte-admin@aviacion-norte.local");
  const issued = await issue(dos, "aviacion-norte-operaciones", {
    customize: { linkDays: 10, requiresIne: true, reviewPolicy: "manual" },
  });
  await signerJourney(issued.token, { ine: true });

  const revisor = await reviewSession("aviacion-norte-revisor@aviacion-norte.local");
  const task = await openTask(issued.contractId);
  const panel = await revisor.page(`/app/revision/${task.id}`);
  const form = pickForm(panel.html, { hidden: { taskId: task.id }, markup: 'value="skip"' });
  const skipped = await revisor.submit(`/app/revision/${task.id}`, form, {
    decision: "skip",
    note: `SKIP sintético ${RUN}`,
  });
  expect(
    skipped.html.includes("no hubo revisión manual") || skipped.html.includes("ya fue resuelta"),
    `«SKIP» no quedó registrado: ${stripTags(skipped.html).slice(0, 200)}`
  );

  expectEqual((await contractRow(issued.contractId)).status, "accepted", "SKIP no aceptó el Contrato");
  const [decision] = await sql`SELECT decision, reason_text FROM review_decisions WHERE task_id = ${task.id}`;
  expectEqual(decision.decision, "skip", "la decisión no se registró como SKIP");
  expect(
    decision.reason_text === `SKIP sintético ${RUN}`,
    "no se conservó la nota documentada del SKIP"
  );
  const [event] = await sql`
    SELECT type FROM contract_events
    WHERE contract_id = ${issued.contractId} AND type = 'revision_omitida'
  `;
  expect(Boolean(event), "el historial no conserva la omisión de la revisión");
  const [audit] = await sql`
    SELECT action FROM audit_entries
    WHERE subject_id = ${issued.contractId} AND action = 'review.skip'
  `;
  expect(Boolean(audit), "la omisión no quedó en la auditoría");

  const file = await dos.page(`/app/contratos/${issued.contractId}`);
  expect(
    stripTags(file.html).includes("Omitir revisión") || stripTags(file.html).includes("SKIP"),
    "el expediente no muestra que la revisión se omitió"
  );
});

// --- 8. revisión asistida por AI -----------------------------------------

check("revision-ai", "8 · el doble AI recomienda, alerta y falla sin decidir", async () => {
  const dos = await portal("aviacion-norte-admin@aviacion-norte.local");

  // Dos Revisores activos para comprobar una alerta por cada uno.
  const accesos = await dos.page("/app/accesos");
  const adminAccount = world.accounts.get("aviacion-norte-admin@aviacion-norte.local");
  const [member] = await sql`
    SELECT id, roles FROM organization_members
    WHERE organization_id = ${organizationId("aviacion-norte-operaciones")} AND account_id = ${adminAccount.id}
  `;
  const rolesForm = pickForm(accesos.html, { hidden: { memberId: member.id }, markup: 'name="roles"' });
  await dos.submit("/app/accesos", rolesForm, { roles: ["administrator", "emitter", "reviewer"] });
  const reviewers = await sql`
    SELECT count(*)::int AS total FROM organization_members
    WHERE organization_id = ${organizationId("aviacion-norte-operaciones")} AND 'reviewer' = ANY (roles)
  `;
  expectEqual(reviewers[0].total, 2, "no quedaron dos Revisores activos en Aviacion Norte Operaciones");

  try {
    // (a) recomendación `accept`
    const accepted = await issue(dos, "aviacion-norte-operaciones", {
      customize: { linkDays: 8, requiresVideo: true, reviewPolicy: "ai" },
    });
    await signerJourney(accepted.token, { video: true, marker: "aceptar" });
    const acceptReport = await waitFor("el informe AI con recomendación `accept`", async () => {
      const [row] = await sql`
        SELECT status, recommendation, model, transcript FROM ai_review_reports
        WHERE contract_id = ${accepted.contractId}
      `;
      return row ?? null;
    });
    expectEqual(acceptReport.status, "completed", "el informe AI no se completó");
    expectEqual(acceptReport.recommendation, "accept", "el doble no recomendó aceptar");
    expectEqual(
      (await contractRow(accepted.contractId)).status,
      "in_review",
      "la recomendación AI aceptó el Contrato por su cuenta"
    );
    const noDecision = await sql`
      SELECT count(*)::int AS total FROM review_decisions WHERE contract_id = ${accepted.contractId}
    `;
    expectEqual(noDecision[0].total, 0, "la AI registró una decisión");

    // (b) recomendación `repeat` con alerta a cada Revisor
    const repeat = await issue(dos, "aviacion-norte-operaciones", {
      customize: { linkDays: 8, requiresVideo: true, reviewPolicy: "ai" },
    });
    await signerJourney(repeat.token, { video: true, marker: "repetir" });
    const repeatReport = await waitFor("el informe AI con recomendación `repeat`", async () => {
      const [row] = await sql`
        SELECT status, recommendation FROM ai_review_reports WHERE contract_id = ${repeat.contractId}
      `;
      return row ?? null;
    });
    expectEqual(repeatReport.recommendation, "repeat", "el doble no recomendó repetir");

    const delivered = await waitFor("las alertas de WhatsApp en la captura local", async () => {
      const messages = await sinkMessages();
      const alerts = messages.filter(
        (message) =>
          message.channel === "whatsapp" &&
          message.template === "revision_ai_recomienda_repetir" &&
          message.payload?.reference === repeat.reference
      );
      return alerts.length >= 2 ? alerts : null;
    });
    expectEqual(delivered.length, 2, "no llegó una alerta por cada Revisor activo");
    const recipients = new Set(delivered.map((message) => message.recipient));
    expectEqual(recipients.size, 2, "las alertas no distinguen destinatario");

    const contract = await contractRow(repeat.contractId);
    for (const alert of delivered) {
      const body = JSON.stringify(alert.payload);
      expect(!body.includes(repeat.token), "la alerta lleva el enlace del Firmante");
      expect(!body.includes("/c/"), "la alerta expone una ruta del recorrido del Firmante");
      expect(!body.includes(contract.video_statement), "la alerta lleva la declaración del video");
      expect(
        !body.includes(contract.contract_markdown.slice(0, 60)),
        "la alerta lleva texto del Contrato"
      );
      expect(!/transcript/i.test(body), "la alerta lleva la transcripción");
      expect(!/ine|video/i.test(String(alert.payload?.portalUrl ?? "")), "la alerta apunta a evidencia");
      expect(String(alert.payload?.portalUrl ?? "").includes("/app/revision"), "la alerta no lleva al portal");
    }

    // (c) falla del proveedor: nada se decide.
    const failing = await issue(dos, "aviacion-norte-operaciones", {
      customize: { linkDays: 8, requiresVideo: true, reviewPolicy: "ai" },
    });
    await signerJourney(failing.token, { video: true, marker: "falla" });
    const [failingAttempt] = await attempts(failing.contractId);
    await waitFor("el reintento registrado del trabajo `ai_review`", async () => {
      const [job] = await sql`
        SELECT attempts, last_error, status FROM background_jobs
        WHERE kind = 'ai_review' AND payload->>'attemptId' = ${failingAttempt.id}
      `;
      return job && job.attempts >= 1 && job.last_error ? job : null;
    });
    const failingRow = await contractRow(failing.contractId);
    expectEqual(failingRow.status, "in_review", "una falla del proveedor cambió el Estado del Contrato");
    const failingDecisions = await sql`
      SELECT count(*)::int AS total FROM review_decisions WHERE contract_id = ${failing.contractId}
    `;
    expectEqual(failingDecisions[0].total, 0, "una falla del proveedor produjo una decisión automática");
    const recommended = await sql`
      SELECT count(*)::int AS total FROM ai_review_reports
      WHERE contract_id = ${failing.contractId} AND recommendation IS NOT NULL
    `;
    expectEqual(recommended[0].total, 0, "una falla del proveedor dejó una recomendación");
    const stillOpen = await openTask(failing.contractId);
    expectEqual(stillOpen.status, "open", "la tarea de revisión se cerró sola tras la falla");
  } finally {
    await dos.submit("/app/accesos", rolesForm, { roles: ["administrator", "emitter"] });
  }
});

// --- 9. idempotencia y concurrencia ---------------------------------------

check("idempotencia", "9 · aceptar dos veces con el mismo enlace", async () => {
  const uno = await portal("transportes-admin@transportes.local");
  const issued = await issue(uno, "transportes");
  await walk(issued.token);

  const first = await acceptSigner(issued.token);
  expect(first.html.includes("Contrato aceptado"), "la primera aceptación falló");

  // Segunda vez sobre el mismo enlace: mismo resultado, sin efectos nuevos.
  const second = new Session("firmante");
  const repeat = await second.page(`/c/${issued.token}/listo`);
  expect(repeat.html.includes("Contrato aceptado"), "el segundo acceso no muestra el mismo resultado");
  expect(repeat.html.includes(issued.reference), "el segundo acceso no muestra la misma Referencia");

  const rows = await attempts(issued.contractId);
  expectEqual(rows.length, 1, "la segunda aceptación duplicó el Intento");
  expectEqual(rows[0].status, "accepted", "el Intento no quedó aceptado");
  const acceptanceItems = await sql`
    SELECT count(*)::int AS total FROM evidence_items
    WHERE attempt_id = ${rows[0].id} AND kind = 'acceptance'
  `;
  expectEqual(acceptanceItems[0].total, 1, "se duplicó la evidencia de aceptación");
  const events = await sql`
    SELECT count(*)::int AS total FROM contract_events
    WHERE contract_id = ${issued.contractId} AND type = 'contrato_aceptado'
  `;
  expectEqual(events[0].total, 1, "se duplicó el evento de aceptación");

  // Recorrer de nuevo un Intento cerrado no reabre nada.
  await walk(issued.token).catch(() => undefined);
  expectEqual((await contractRow(issued.contractId)).status, "accepted", "el Contrato salió de `Aceptado`");
});

check("concurrencia", "9 · dos decisiones simultáneas y cancelación sin decisión", async () => {
  const dos = await portal("aviacion-norte-admin@aviacion-norte.local");
  const adminAccount = world.accounts.get("aviacion-norte-admin@aviacion-norte.local");
  const [member] = await sql`
    SELECT id FROM organization_members
    WHERE organization_id = ${organizationId("aviacion-norte-operaciones")} AND account_id = ${adminAccount.id}
  `;
  const accesos = await dos.page("/app/accesos");
  const rolesForm = pickForm(accesos.html, { hidden: { memberId: member.id }, markup: 'name="roles"' });
  await dos.submit("/app/accesos", rolesForm, { roles: ["administrator", "emitter", "reviewer"] });

  try {
    const issued = await issue(dos, "aviacion-norte-operaciones", {
      customize: { linkDays: 10, requiresIne: true, reviewPolicy: "manual" },
    });
    await signerJourney(issued.token, { ine: true });
    const task = await openTask(issued.contractId);

    const first = await portal("aviacion-norte-revisor@aviacion-norte.local");
    const second = dos;
    const panelOne = await first.page(`/app/revision/${task.id}`);
    const panelTwo = await second.page(`/app/revision/${task.id}`);
    const formOne = pickForm(panelOne.html, { hidden: { taskId: task.id }, markup: 'value="conclude"' });
    const formTwo = pickForm(panelTwo.html, { hidden: { taskId: task.id }, markup: 'value="conclude"' });

    const [a, b] = await Promise.all([
      first.submit(`/app/revision/${task.id}`, formOne, { decision: "conclude" }),
      second.submit(`/app/revision/${task.id}`, formTwo, { decision: "conclude" }),
    ]);

    const decisions = await sql`
      SELECT reviewer_name, decision FROM review_decisions WHERE task_id = ${task.id}
    `;
    expectEqual(decisions.length, 1, "dos resoluciones simultáneas produjeron más de una decisión");

    const bodies = [stripTags(a.html), stripTags(b.html)];
    const shown = bodies.filter((body) => body.includes("ya tiene una decisión registrada"));
    expect(
      shown.length >= 1,
      `nadie vio la decisión registrada: ${bodies.map((body) => body.slice(0, 160)).join(" | ")}`
    );
    for (const body of shown) {
      expect(
        body.includes(decisions[0].reviewer_name),
        "la pantalla no dice quién registró la decisión"
      );
    }
    expectEqual(shown.length, 2, "alguna de las dos pantallas no mostró la decisión registrada");
    for (const page of [a, b]) {
      expect(
        !page.html.includes('value="conclude"'),
        "la pantalla siguió ofreciendo decidir después de resolverse"
      );
    }
    expectEqual((await contractRow(issued.contractId)).status, "accepted", "el Contrato no quedó aceptado");

    // Cancelar mientras está `A revisión` cierra la tarea sin decisión.
    const pending = await issue(dos, "aviacion-norte-operaciones", {
      customize: { linkDays: 10, requiresIne: true, reviewPolicy: "manual" },
    });
    await signerJourney(pending.token, { ine: true });
    const openBefore = await openTask(pending.contractId);
    expectEqual(openBefore.status, "open", "la tarea no nació abierta");

    const file = await dos.page(`/app/contratos/${pending.contractId}`);
    const cancelForm = pickForm(file.html, { hidden: { contractId: pending.contractId }, markup: 'name="reason"' });
    await dos.submit(`/app/contratos/${pending.contractId}`, cancelForm, {
      reason: `Cancelación sintética ${RUN}`,
    });

    expectEqual((await contractRow(pending.contractId)).status, "cancelled", "el Contrato no quedó `Cancelado`");
    const closed = await openTask(pending.contractId);
    expectEqual(closed.status, "closed_without_decision", "la cancelación no cerró la tarea sin decisión");
    const none = await sql`
      SELECT count(*)::int AS total FROM review_decisions WHERE task_id = ${closed.id}
    `;
    expectEqual(none[0].total, 0, "la cancelación registró una decisión");
  } finally {
    await dos.submit("/app/accesos", rolesForm, { roles: ["administrator", "emitter"] });
  }
});

// --- 10. vencimiento -------------------------------------------------------

check("vencimiento", "10 · el enlace vence y obliga a un Contrato nuevo", async () => {
  const uno = await portal("transportes-admin@transportes.local");
  const issued = await issue(uno, "transportes");

  await sql`
    UPDATE contract_links SET expires_at = NOW() - INTERVAL '1 minute'
    WHERE contract_id = ${issued.contractId}
  `;

  const signer = await openSigner(issued.token);
  expect(
    signer.html.includes("no está disponible") || signer.status === 404,
    "un enlace vencido siguió sirviendo el recorrido"
  );

  const file = await waitFor("el vencimiento del Contrato", async () => {
    const page = await uno.page(`/app/contratos/${issued.contractId}`);
    const row = await contractRow(issued.contractId);
    return row.status === "expired" ? { page, row } : null;
  });
  expectEqual(file.row.status, "expired", "el Contrato no quedó `Vencido`");
  expect(file.page.html.includes("Vencido"), "el expediente no muestra el Estado `Vencido`");

  const [attempt] = await attempts(issued.contractId);
  expectEqual(attempt.status, "expired", "el Intento no quedó vencido");
  const [event] = await sql`
    SELECT type FROM contract_events
    WHERE contract_id = ${issued.contractId} AND type = 'contrato_vencido'
  `;
  expect(Boolean(event), "no se registró el evento de vencimiento");

  // No hay forma de generar otro enlace para el mismo Contrato.
  expect(
    !file.page.html.includes("Generar Contrato"),
    "el expediente vencido ofrece generar otro enlace"
  );
  const links = await sql`
    SELECT count(*)::int AS total FROM contract_links WHERE contract_id = ${issued.contractId}
  `;
  expectEqual(links[0].total, 1, "un Contrato vencido obtuvo otro enlace");

  // `Crear nuevo a partir de este` produce un Borrador con la publicación vigente.
  expect(
    file.page.html.includes("Crear nuevo a partir de este"),
    "el expediente vencido no ofrece crear uno nuevo"
  );
  const form = pickForm(file.page.html, {
    hidden: { contractId: issued.contractId },
    text: "Crear nuevo a partir de este",
  });
  const response = await uno.raw(`/app/contratos/${issued.contractId}`, {
    method: "POST",
    body: formBody(form, {}),
  });
  await response.arrayBuffer().catch(() => undefined);
  const location = response.headers.get("location");
  expect(
    typeof location === "string" && location.startsWith("/app/contratos/nuevo/"),
    `«Crear nuevo a partir de este» no abrió un Borrador (${response.status} → ${location})`
  );
  const draftId = location.split("/").pop();
  created.drafts.add(draftId);

  const [draft] = await sql`
    SELECT template_id, origin_contract_id, field_values FROM contract_drafts WHERE id = ${draftId}
  `;
  expectEqual(draft.origin_contract_id, issued.contractId, "el Borrador nuevo no recuerda su origen");
  const [current] = await sql`
    SELECT v.id FROM contract_template_versions v
    WHERE v.template_id = ${draft.template_id} AND v.is_current
  `;
  const original = await contractRow(issued.contractId);
  expectEqual(
    current.id,
    original.template_version_id,
    "la publicación vigente cambió: el Borrador nuevo debe usar la vigente"
  );
  expectEqual((await contractRow(issued.contractId)).status, "expired", "el Contrato vencido cambió de Estado");
});

// --- 11. Ver PDF -----------------------------------------------------------

check("pdf", "11 · `Ver PDF` es bajo demanda y nunca lleva el enlace", async () => {
  const uno = await portal("transportes-admin@transportes.local");
  const issued = await issue(uno, "transportes");

  const beforeAny = await sql`
    SELECT count(*)::int AS total FROM contract_objects
    WHERE contract_id = ${issued.contractId} AND kind = 'accepted_pdf'
  `;
  expectEqual(beforeAny[0].total, 0, "se produjo un PDF sin que nadie lo pidiera");

  const reviewCopy = await uno.raw(`/app/contratos/${issued.contractId}/pdf`);
  const reviewBytes = Buffer.from(await reviewCopy.arrayBuffer());
  expectEqual(reviewCopy.status, 200, "`Ver PDF` no respondió antes de aceptar");
  expectEqual(reviewCopy.headers.get("content-type"), "application/pdf", "el PDF no se sirve como PDF");
  expectEqual(reviewBytes.subarray(0, 4).toString("latin1"), "%PDF", "el archivo no empieza con %PDF");
  const reviewText = pdfText(reviewBytes);
  expect(
    /PENDIENTE DE ACEPTACI/.test(reviewText),
    "la copia previa no está marcada como `PENDIENTE DE ACEPTACIÓN`"
  );
  expect(reviewText.includes(issued.reference), "la copia de revisión no lleva la Referencia");
  expect(!reviewText.includes(issued.token), "la copia de revisión contiene el token del enlace");
  expect(!/https?:\/\/[^\s)]*\/c\//.test(reviewText), "la copia de revisión contiene el Enlace contractual");
  expect(
    reviewCopy.headers.get("content-disposition").includes(issued.reference),
    "el nombre del archivo no usa la Referencia"
  );
  expect(
    !reviewCopy.headers.get("content-disposition").includes(issued.token),
    "el nombre del archivo lleva el token"
  );

  const signerCopy = await fetch(`${APP}/c/${issued.token}/pdf`);
  const signerBytes = Buffer.from(await signerCopy.arrayBuffer());
  expectEqual(signerBytes.subarray(0, 4).toString("latin1"), "%PDF", "el PDF del Firmante no es un PDF");
  const signerText = pdfText(signerBytes);
  expect(!signerText.includes(issued.token), "el PDF del Firmante lleva su propio token");
  expect(/PENDIENTE DE ACEPTACI/.test(signerText), "el Firmante no recibe la copia de revisión antes de aceptar");

  const stillNone = await sql`
    SELECT count(*)::int AS total FROM contract_objects
    WHERE contract_id = ${issued.contractId} AND kind = 'accepted_pdf'
  `;
  expectEqual(stillNone[0].total, 0, "la copia de revisión se guardó como copia aceptada");

  await signerJourney(issued.token, {});
  const acceptedOne = await uno.raw(`/app/contratos/${issued.contractId}/pdf`);
  const acceptedBytesOne = Buffer.from(await acceptedOne.arrayBuffer());
  const acceptedText = pdfText(acceptedBytesOne);
  expectEqual(acceptedBytesOne.subarray(0, 4).toString("latin1"), "%PDF", "la copia aceptada no es un PDF");
  expect(!/PENDIENTE DE ACEPTACI/.test(acceptedText), "la copia posterior sigue marcada como revisión");
  expect(acceptedText.includes(issued.reference), "la copia aceptada no lleva la Referencia");
  expect(
    /Copia contractual aceptada/.test(acceptedText),
    "la copia posterior no se identifica como copia contractual aceptada"
  );
  expect(!acceptedText.includes(issued.token), "la copia aceptada contiene el token");
  expect(
    !/https?:\/\/[^\s)]*\/c\//.test(acceptedText),
    "la copia aceptada contiene el Enlace contractual"
  );

  const acceptedTwo = await uno.raw(`/app/contratos/${issued.contractId}/pdf`);
  const acceptedBytesTwo = Buffer.from(await acceptedTwo.arrayBuffer());
  expect(
    acceptedBytesOne.equals(acceptedBytesTwo),
    "dos peticiones de la copia aceptada devolvieron bytes distintos"
  );
  const stored = await sql`
    SELECT count(*)::int AS total FROM contract_objects
    WHERE contract_id = ${issued.contractId} AND kind = 'accepted_pdf'
  `;
  expectEqual(stored[0].total, 1, "la copia aceptada no se conservó una sola vez");
});

// --- 12. buscador, páginas, carpetas, archivados y eliminados -------------

check("organizacion", "12 · buscador, páginas de 20, carpetas y clasificaciones", async () => {
  const uno = await portal("transportes-admin@transportes.local");

  const carpetas = await uno.page("/app/carpetas");
  const folderForm = pickForm(carpetas.html, { markup: 'name="name"' });
  const folderName = `Smoke ${RUN}`;
  await uno.submit("/app/carpetas", folderForm, { name: folderName });
  const [folder] = await sql`
    SELECT id FROM contract_folders
    WHERE organization_id = ${organizationId("transportes")} AND name = ${folderName}
  `;
  expect(Boolean(folder), "no se creó la carpeta operativa");
  created.folders.add(folder.id);

  const inFolder = [];
  for (let index = 0; index < 21; index += 1) {
    inFolder.push(await issue(uno, "transportes", { folderId: folder.id }));
  }

  const first = await uno.page(`/app/contratos?carpeta=${folder.id}`);
  const firstText = stripTags(first.html);
  expect(
    /Página\s+1\s+de\s+2/.test(firstText),
    `la paginación no reporta dos páginas: ${/Página[^A]*/.exec(firstText)?.[0] ?? "sin paginación"}`
  );
  expect(/\(\s*21\s+resultados\s*\)/.test(firstText), "el total de la carpeta no es 21");
  const onFirst = resultRows(first.html);
  expectEqual(onFirst.size, 20, "la primera página no trae 20 resultados");

  const second = await uno.page(`/app/contratos?carpeta=${folder.id}&page=2`);
  const onSecond = resultRows(second.html);
  expectEqual(onSecond.size, 1, "la segunda página no trae el resultado restante");
  expect([...onSecond.keys()].every((id) => !onFirst.has(id)), "las páginas se traslapan");

  const target = inFolder[0].reference;
  const targetId = inFolder[0].contractId;
  const search = await uno.page(`/app/contratos?q=${encodeURIComponent(target)}`);
  const found = resultRows(search.html);
  expectEqual(found.size, 1, "el buscador por Referencia no devolvió un único resultado");
  expect(found.has(targetId), "el buscador no encontró la Referencia exacta");

  const byField = await uno.page(
    `/app/contratos?q=${encodeURIComponent(`Guadalajara Smoke ${RUN}`)}`
  );
  expect(
    (resultTotal(byField.html) ?? 0) >= 21,
    `el buscador no encuentra por un Campo marcado como buscable (${resultTotal(byField.html)} resultados)`
  );
  expect(
    resultRows(byField.html).size <= 20,
    "el buscador entregó más de una página de resultados a la vez"
  );

  // Otra Organización no ve nada de esto. La Referencia es una secuencia por
  // Organización y por día, así que Aviacion Norte puede tener la misma cadena
  // para un Contrato propio: lo que nunca debe aparecer es este expediente.
  const dos = await portal("aviacion-norte-admin@aviacion-norte.local");
  const foreign = await dos.page(`/app/contratos?q=${encodeURIComponent(target)}`);
  expect(
    !resultRows(foreign.html).has(targetId),
    "otra Organización encontró el Contrato en su buscador"
  );
  const foreignIds = [...resultRows(foreign.html).keys()];
  if (foreignIds.length > 0) {
    const owners = await sql`
      SELECT DISTINCT organization_id FROM contracts WHERE id = ANY (${foreignIds}::uuid[])
    `;
    expectEqual(owners.length, 1, "el buscador mezcló Organizaciones");
    expectEqual(
      owners[0].organization_id,
      organizationId("aviacion-norte-operaciones"),
      "el buscador devolvió un Contrato de otra Organización"
    );
  }
  const foreignFolder = await dos.page(`/app/contratos?carpeta=${folder.id}`);
  expectEqual(
    resultRows(foreignFolder.html).size,
    0,
    "otra Organización pudo filtrar por una carpeta ajena"
  );

  // Archivar y restaurar.
  const archivable = { id: targetId };
  const file = await uno.page(`/app/contratos/${archivable.id}`);
  const archiveForm = pickForm(file.html, {
    hidden: { contractId: archivable.id, archived: "true" },
  });
  await uno.submit(`/app/contratos/${archivable.id}`, archiveForm, {});
  expectEqual(
    (await contractRow(archivable.id)).classification,
    "archived",
    "`Archivar` no cambió la clasificación"
  );
  const listAfterArchive = await uno.page(`/app/contratos?carpeta=${folder.id}`);
  expect(
    !resultRows(listAfterArchive.html).has(archivable.id),
    "el expediente archivado sigue en `Contratos`"
  );
  const archived = await uno.page("/app/archivados");
  expect(resultRows(archived.html).has(archivable.id), "el expediente archivado no aparece en `Archivados`");
  const restoreForm = pickForm(archived.html, { hidden: { contractId: archivable.id } });
  await uno.submit("/app/archivados", restoreForm, {});
  expectEqual(
    (await contractRow(archivable.id)).classification,
    "active",
    "`Restaurar` no devolvió el expediente"
  );

  // Eliminar un Contrato cerrado.
  const closed = await issue(uno, "transportes", { folderId: folder.id });
  await signerJourney(closed.token, {});
  const closedFile = await uno.page(`/app/contratos/${closed.contractId}`);
  const deleteForm = pickForm(closedFile.html, {
    hidden: { contractId: closed.contractId },
    text: "Eliminar definitivamente",
  });
  const deleted = await uno.submit(`/app/contratos/${closed.contractId}`, deleteForm, {});
  expect(
    deleted.url.includes("/app/eliminados"),
    `«Eliminar definitivamente» no llevó a Eliminados (${deleted.url})`
  );
  expectEqual((await contractRow(closed.contractId)).classification, "deleted", "el expediente no quedó eliminado");

  const eliminados = await uno.page("/app/eliminados");
  expect(eliminados.html.includes(closed.reference), "el expediente eliminado no aparece en `Eliminados`");
  expect(!/Restaurar/.test(stripTags(eliminados.html)), "`Eliminados` ofrece restaurar");
  expect(!/Descargar|Ver PDF|Exportar/.test(stripTags(eliminados.html)), "`Eliminados` ofrece descargas");
  const deletedPdf = await uno.raw(`/app/contratos/${closed.contractId}/pdf`);
  await deletedPdf.arrayBuffer().catch(() => undefined);
  expectEqual(deletedPdf.status, 404, "un expediente eliminado sigue entregando su PDF");

  // Eliminar un Contrato abierto lo cancela primero e invalida su enlace.
  const open = await issue(uno, "transportes", { folderId: folder.id });
  const openFile = await uno.page(`/app/contratos/${open.contractId}`);
  const openDelete = pickForm(openFile.html, {
    hidden: { contractId: open.contractId },
    text: "Eliminar definitivamente",
  });
  await uno.submit(`/app/contratos/${open.contractId}`, openDelete, {});
  const openRow = await contractRow(open.contractId);
  expectEqual(openRow.status, "cancelled", "eliminar un Contrato abierto no lo canceló");
  expectEqual(openRow.classification, "deleted", "el Contrato abierto no quedó eliminado");
  const [openLink] = await sql`
    SELECT revoked_at FROM contract_links WHERE contract_id = ${open.contractId}
  `;
  expect(openLink.revoked_at !== null, "el enlace del Contrato eliminado no se revocó");
  const stillServing = await openSigner(open.token);
  expect(
    stillServing.html.includes("no está disponible") || stillServing.status === 404,
    "el enlace de un Contrato eliminado sigue abriendo"
  );

  // Eliminar la carpeta no borra expedientes.
  const carpetasAgain = await uno.page("/app/carpetas");
  const removeFolder = pickForm(carpetasAgain.html, {
    hidden: { folderId: folder.id },
    text: "Eliminar",
  });
  await uno.submit("/app/carpetas", removeFolder, {});
  created.folders.delete(folder.id);
  const ids = inFolder.map((item) => item.contractId);
  const survivors = await sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE folder_id IS NULL)::int AS sueltos
    FROM contracts WHERE id = ANY (${ids}::uuid[])
  `;
  expectEqual(survivors[0].total, ids.length, "eliminar la carpeta borró expedientes");
  expectEqual(survivors[0].sueltos, ids.length, "los expedientes no quedaron sin carpeta");
});

// --- 13. custodia ----------------------------------------------------------

check("custodia", "13 · paquete frío, sin autoservicio y con Custodia activa", async () => {
  const uno = await portal("transportes-admin@transportes.local");
  const base = await issue(uno, "transportes");
  await signerJourney(base.token, {});

  const pkg = await waitFor("el paquete frío del Contrato cerrado", async () => {
    const [row] = await sql`
      SELECT object_key, sha256, byte_size, manifest, tier, closed_at
      FROM cold_contract_packages WHERE contract_id = ${base.contractId}
    `;
    return row ?? null;
  });
  expect(pkg.sha256.length === 64, "el paquete frío no tiene huella SHA-256");
  expect(pkg.byte_size > 0, "el paquete frío está vacío");
  const manifest = typeof pkg.manifest === "string" ? JSON.parse(pkg.manifest) : pkg.manifest;
  const manifestText = JSON.stringify(manifest);
  expect(manifestText.includes(base.reference), "el manifiesto no identifica el Contrato");
  expect(/sha256|hash|huella/i.test(manifestText), "el manifiesto no lleva hashes");
  expect(
    /contrato\.md/.test(manifestText) &&
      /aviso-privacidad\.md/.test(manifestText),
    "el manifiesto no lista el contrato y el Aviso de Privacidad congelado"
  );
  expect(
    !/contrato\.pdf/.test(manifestText),
    "el cierre produjo un PDF sin que una persona usara `Ver PDF`"
  );

  // Sin Custodia activa el portal no ofrece autoservicio.
  const file = await uno.page(`/app/contratos/${base.contractId}`);
  expect(file.html.includes("Custodia del expediente"), "el expediente no muestra la custodia");
  expect(!/Descargar ZIP/.test(stripTags(file.html)), "sin Custodia activa el portal ofrece `Descargar ZIP`");
  expect(!/>\s*Exportar\s*</.test(file.html), "sin Custodia activa el portal ofrece `Exportar`");
  expect(
    stripTags(file.html).includes("canal externo acordado"),
    "el portal no explica el canal externo para una Organización sin Custodia activa"
  );

  // Con Custodia activa los trabajos existen y el worker los completa.
  const tres = await portal("euzen-admin@euzen.local");
  const active = await issue(tres, "euzen", {
    customize: { linkDays: 5, requiresVideo: true, reviewPolicy: "none" },
  });
  await signerJourney(active.token, { video: true });
  await waitFor("el paquete frío de Euzen", async () => {
    const [row] = await sql`
      SELECT id FROM cold_contract_packages WHERE contract_id = ${active.contractId}
    `;
    return row ?? null;
  });

  const activeFile = await tres.page(`/app/contratos/${active.contractId}`);
  expect(/Descargar ZIP/.test(stripTags(activeFile.html)), "con Custodia activa no aparece `Descargar ZIP`");
  const immediateDownload = await tres.raw(
    `/app/contratos/${active.contractId}/archivo`
  );
  const immediateBytes = Buffer.from(await immediateDownload.arrayBuffer());
  expectEqual(immediateDownload.status, 200, "la descarga inmediata no respondió 200");
  expectEqual(
    immediateDownload.headers.get("content-type"),
    "application/zip",
    "el archivo inmediato no se sirve como ZIP"
  );
  expectEqual(
    immediateBytes.subarray(0, 2).toString("latin1"),
    "PK",
    "el archivo inmediato no contiene bytes ZIP"
  );

  // Simula que el mismo paquete ya cumplió la ventana inmediata. Ahora el
  // portal debe preparar una copia temporal antes de permitir la descarga.
  await sql`
    UPDATE cold_contract_packages
    SET tier = 'cold', moved_to_cold_at = NOW()
    WHERE contract_id = ${active.contractId}
  `;
  const coldFile = await tres.page(`/app/contratos/${active.contractId}`);
  const zipForm = pickForm(coldFile.html, {
    hidden: { contractId: active.contractId },
    text: "Preparar ZIP",
  });
  await tres.submit(`/app/contratos/${active.contractId}`, zipForm, {});
  const recovery = await waitFor("la recuperación completada por el worker", async () => {
    const [row] = await sql`
      SELECT status, object_key, available_until FROM recovery_jobs
      WHERE contract_id = ${active.contractId} ORDER BY created_at DESC LIMIT 1
    `;
    return row && row.status === "available" ? row : null;
  });
  expect(Boolean(recovery.object_key), "la recuperación no dejó un objeto disponible");
  expect(recovery.available_until !== null, "la recuperación no tiene vigencia");

  const exportFile = await tres.page(`/app/contratos/${active.contractId}`);
  const exportForm = pickForm(exportFile.html, {
    hidden: { contractId: active.contractId },
    text: "Exportar",
  });
  await tres.submit(`/app/contratos/${active.contractId}`, exportForm, {});
  const exported = await waitFor("la exportación completada por el worker", async () => {
    const [row] = await sql`
      SELECT status, object_key FROM export_jobs
      WHERE organization_id = ${organizationId("euzen")}
        AND ${active.contractId}::uuid = ANY (contract_ids)
      ORDER BY created_at DESC LIMIT 1
    `;
    return row && row.status === "available" ? row : null;
  });
  expect(Boolean(exported.object_key), "la exportación no dejó un archivo");

  // Transportes no puede pedir nada aunque conozca la acción.
  const denied = await uno.submit(
    `/app/contratos/${base.contractId}`,
    { ...zipForm, hidden: { ...zipForm.hidden, contractId: base.contractId } },
    {}
  );
  expect(
    stripTags(denied.html).includes("canal externo acordado") ||
      stripTags(denied.html).includes("No tienes acceso"),
    "una Organización sin Custodia activa pudo pedir el archivo histórico"
  );
  const leakedJobs = await sql`
    SELECT count(*)::int AS total FROM recovery_jobs WHERE contract_id = ${base.contractId}
  `;
  expectEqual(leakedJobs[0].total, 0, "se creó un trabajo de recuperación sin Custodia activa");
});

// --- 14. accesos, asientos e invitaciones ---------------------------------

check("accesos", "14 · asientos, invitaciones de 30 días y Administrador principal", async () => {
  const uno = await portal("transportes-admin@transportes.local");
  const orgId = organizationId("transportes");
  const seatLimit = world.organizations.get("transportes").seat_limit;

  const invitees = [];
  async function prepareAndSend(email, roles = ["emitter"]) {
    const page = await uno.page("/app/accesos");
    const form = pickForm(page.html, { markup: 'name="email"' });
    const prepared = await uno.submit("/app/accesos", form, { email, roles });
    expect(
      stripTags(prepared.html).includes("Invitación preparada"),
      `no se pudo preparar la invitación de ${email}: ${stripTags(prepared.html).slice(0, 160)}`
    );
    const [invitation] = await sql`
      SELECT id FROM member_invitations WHERE organization_id = ${orgId} AND email = ${email}
    `;
    created.invitations.add(invitation.id);
    const refreshed = await uno.page("/app/accesos");
    const sendForm = pickForm(refreshed.html, {
      hidden: { invitationId: invitation.id },
      text: "Enviar",
    });
    await uno.submit("/app/accesos", sendForm, {});
    const [row] = await sql`
      SELECT status, expires_at, sent_at FROM member_invitations WHERE id = ${invitation.id}
    `;
    expectEqual(row.status, "invited", `la invitación de ${email} no quedó enviada`);
    const days = Math.round((row.expires_at - row.sent_at) / 86400000);
    expectEqual(days, 30, "la invitación no dura 30 días");
    const message = await waitFor(`el correo de invitación de ${email}`, async () => {
      const messages = await sinkMessages();
      return (
        messages.find(
          (item) => item.template === "invitacion_de_miembro" && item.recipient === email
        ) ?? null
      );
    });
    const url = String(message.payload?.url ?? "");
    expect(url.includes("/invitacion/"), "el correo no lleva el enlace de activación");
    invitees.push({ email, invitationId: invitation.id, token: url.split("/invitacion/")[1] });
    return invitees[invitees.length - 1];
  }

  async function activate(invitee) {
    const session = new Session(invitee.email);
    const page = await session.page(`/invitacion/${invitee.token}`);
    const form = pickForm(page.html, { hidden: { token: invitee.token } });
    return session.submit(`/invitacion/${invitee.token}`, form, {
      nombre: `Persona sintética ${invitee.email.split("@")[0]}`,
      contrasena: `${PASSWORD}-invitado`,
      confirmacion: `${PASSWORD}-invitado`,
    });
  }

  async function activeSeats() {
    const [row] = await sql`
      SELECT count(*)::int AS total FROM organization_members WHERE organization_id = ${orgId}
    `;
    return row.total;
  }

  const before = await activeSeats();
  expect(before < seatLimit, `Transportes ya tiene ${before} de ${seatLimit} asientos ocupados`);

  // Una invitación enviada no reserva Asiento.
  const probe = await prepareAndSend(`smoke-${RUN}-probe@example.invalid`);
  expectEqual(await activeSeats(), before, "una invitación enviada reservó un Asiento");

  // Llena hasta dejar un solo Asiento libre.
  const toFill = seatLimit - 1 - (await activeSeats());
  for (let index = 0; index < toFill; index += 1) {
    const invitee = await prepareAndSend(`smoke-${RUN}-${index}@example.invalid`);
    const activated = await activate(invitee);
    expect(
      !stripTags(activated.html).includes("sin asientos"),
      `la activación ${index} fue rechazada antes de tiempo`
    );
  }
  expectEqual(await activeSeats(), seatLimit - 1, "no se llenó la Organización hasta el penúltimo Asiento");

  // Dos activaciones simultáneas para un solo Asiento.
  const race = await prepareAndSend(`smoke-${RUN}-race@example.invalid`);
  const [first, second] = await Promise.all([activate(probe), activate(race)]);
  expectEqual(await activeSeats(), seatLimit, "el límite de Asientos no se respetó de forma atómica");

  const bodies = [stripTags(first.html), stripTags(second.html)];
  const refused = bodies.filter((body) => body.includes("No hay accesos disponibles"));
  expectEqual(
    refused.length,
    1,
    `no hubo exactamente una activación rechazada: ${bodies
      .map((body) => body.slice(0, 200))
      .join(" | ")}`
  );

  const invitationStates = await sql`
    SELECT email, status FROM member_invitations
    WHERE id = ANY (${[probe.invitationId, race.invitationId]})
  `;
  const stillInvited = invitationStates.filter((row) => row.status === "invited");
  expectEqual(stillInvited.length, 1, "la activación rechazada consumió la invitación");

  // El Administrador principal no se elimina antes de transferir.
  const [primary] = await sql`
    SELECT m.id FROM organization_members m
    WHERE m.organization_id = ${orgId} AND m.is_primary_admin
  `;
  const accesos = await uno.page("/app/accesos");
  let removalRefused;
  try {
    const removeForm = pickForm(accesos.html, {
      hidden: { memberId: primary.id },
      text: "Eliminar acceso",
    });
    const removed = await uno.submit("/app/accesos", removeForm, {});
    removalRefused = stripTags(removed.html).includes("Transfiere primero");
  } catch (error) {
    // Si el portal ni siquiera ofrece la acción, la regla también se cumple.
    removalRefused = error instanceof CheckFailure;
  }
  expect(removalRefused, "el Administrador principal pudo eliminarse sin transferir");

  // La Organización nunca queda sin Administrador activo.
  const rolesForm = pickForm(accesos.html, { hidden: { memberId: primary.id }, markup: 'name="roles"' });
  const stripped = await uno.submit("/app/accesos", rolesForm, { roles: ["emitter"] });
  expect(
    /Administrador principal debe conservar|al menos un Administrador/.test(stripTags(stripped.html)),
    "se pudo dejar la Organización sin Administrador activo"
  );
  const admins = await sql`
    SELECT count(*)::int AS total FROM organization_members
    WHERE organization_id = ${orgId} AND 'administrator' = ANY (roles)
  `;
  expect(admins[0].total >= 1, "la Organización quedó sin Administrador");

  // Limpieza: libera los Asientos sintéticos.
  for (const invitee of invitees) {
    const [account] = await sql`SELECT id FROM accounts WHERE email = ${invitee.email}`;
    if (account) created.accounts.add(account.id);
  }
  const smokeMembers = await sql`
    SELECT m.id FROM organization_members m
    JOIN accounts a ON a.id = m.account_id
    WHERE m.organization_id = ${orgId} AND a.email LIKE ${`smoke-${RUN}-%`}
  `;
  for (const member of smokeMembers) {
    const page = await uno.page("/app/accesos");
    const form = pickForm(page.html, { hidden: { memberId: member.id }, text: "Eliminar acceso" });
    await uno.submit("/app/accesos", form, {});
  }
  expectEqual(await activeSeats(), before, "no se liberaron los Asientos sintéticos");
});

// --- 15. nada sale de la máquina ------------------------------------------

check("sin-salida", "15 · la captura local es el único destino", async () => {
  const failed = await sql`
    SELECT channel, recipient, template, last_error FROM notification_outbox
    WHERE status = 'failed'
  `;
  expectEqual(
    failed.length,
    0,
    `hay ${failed.length} mensaje(s) en estado \`failed\`: ${failed
      .map((row) => `${row.template}→${row.recipient} (${row.last_error})`)
      .join("; ")}`
  );

  const delivered = await sql`
    SELECT count(*)::int AS total FROM notification_outbox
    WHERE status = 'sent' AND delivered_at >= ${STARTED_AT}
  `;
  expect(delivered[0].total > 0, "el worker no entregó ningún mensaje durante la prueba");

  const messages = await sinkMessages();
  expect(
    messages.length >= delivered[0].total,
    `la captura local recibió ${messages.length} mensaje(s) y el outbox marcó ${delivered[0].total} como entregados`
  );

  // Los destinos configurados son locales.
  for (const [label, value] of [
    ["FIDES_SINK_URL", process.env.FIDES_SINK_URL ?? "http://sink:8025/api/messages"],
    ["FIDES_AI_URL", process.env.FIDES_AI_URL ?? "http://ai-double:8030/analizar"],
  ]) {
    const host = new URL(value).hostname;
    expect(
      ["sink", "ai-double", "localhost", "127.0.0.1", "app"].includes(host),
      `${label} apunta a un destino externo: ${host}`
    );
  }

  // Ninguna alerta de la corrida lleva contenido contractual ni el enlace.
  const alerts = messages.filter((message) => message.channel === "whatsapp");
  for (const alert of alerts) {
    const body = JSON.stringify(alert.payload);
    expect(!body.includes("/c/"), "una alerta de WhatsApp lleva un enlace del Firmante");
    expect(body.length < 600, "una alerta de WhatsApp lleva demasiado contenido");
  }
});

// ---------------------------------------------------------------------------
// Limpieza
// ---------------------------------------------------------------------------

async function cleanup() {
  if (NO_CLEANUP) {
    notes.push("Se conservaron los datos de la corrida por `--no-cleanup`.");
    return;
  }
  try {
    const contracts = [...created.contracts].filter(Boolean);
    if (contracts.length > 0) {
      await sql`UPDATE contract_drafts SET issued_contract_id = NULL WHERE issued_contract_id = ANY (${contracts}::uuid[])`;
      await sql`UPDATE contract_drafts SET origin_contract_id = NULL WHERE origin_contract_id = ANY (${contracts}::uuid[])`;
      await sql`DELETE FROM export_jobs WHERE contract_ids && ${contracts}::uuid[]`;
      // `background_jobs` no depende de `contracts`: los trabajos diferidos
      // (`move_to_cold` a un año) quedarían huérfanos en cada corrida.
      await sql`
        DELETE FROM background_jobs
        WHERE status IN ('pending', 'running')
          AND COALESCE(payload->>'contractId', payload->>'contract_id') = ANY (${contracts})
      `;
      await sql`DELETE FROM contracts WHERE id = ANY (${contracts}::uuid[])`;
    }
    const drafts = [...created.drafts].filter(Boolean);
    if (drafts.length > 0) {
      await sql`DELETE FROM contract_drafts WHERE id = ANY (${drafts}::uuid[])`;
    }
    const folders = [...created.folders].filter(Boolean);
    if (folders.length > 0) {
      await sql`DELETE FROM contract_folders WHERE id = ANY (${folders}::uuid[])`;
    }
    const invitations = [...created.invitations].filter(Boolean);
    if (invitations.length > 0) {
      await sql`DELETE FROM member_invitations WHERE id = ANY (${invitations}::uuid[])`;
    }
    await sql`DELETE FROM accounts WHERE email LIKE ${`smoke-${RUN}-%`}`;
    await sql`DELETE FROM background_jobs WHERE status = 'failed' AND created_at >= ${STARTED_AT}`;
  } catch (error) {
    notes.push(`La limpieza no terminó: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n  Prueba de humo de Fides · corrida ${RUN}`);
  console.log(`  Aplicación ${APP} · captura ${SINK}\n`);

  await loadWorld();
  const initial = await fetch(`${SINK}/api/messages`).then((response) => response.json());
  sinkBaseline = new Set((initial.messages ?? []).map((message) => message.id));

  const selected = ONLY.length > 0 ? checks.filter((item) => ONLY.includes(item.name)) : checks;
  if (selected.length === 0) {
    console.error(`  Ninguna comprobación coincide con --only=${ONLY.join(",")}.`);
    console.error(`  Disponibles: ${checks.map((item) => item.name).join(", ")}\n`);
    await sql.end({ timeout: 5 });
    process.exit(1);
  }

  for (const item of selected) {
    const startedAt = Date.now();
    try {
      await item.run();
      results.push({ ...item, ok: true, ms: Date.now() - startedAt });
      console.log(`  ok    ${item.name}`);
    } catch (error) {
      results.push({
        ...item,
        ok: false,
        ms: Date.now() - startedAt,
        detail: error instanceof CheckFailure ? error.message : `${error.name}: ${error.message}`,
        stack: error instanceof CheckFailure ? null : error.stack,
      });
      console.log(`  FALLA ${item.name}`);
      if (VERBOSE && error.stack && !(error instanceof CheckFailure)) console.log(error.stack);
    }
  }

  await cleanup();

  const width = Math.max(...results.map((item) => item.name.length), 12);
  console.log(`\n  ${"Comprobación".padEnd(width)}  Estado  Tiempo  Criterio`);
  console.log(`  ${"-".repeat(width + 40)}`);
  for (const item of results) {
    console.log(
      `  ${item.name.padEnd(width)}  ${(item.ok ? "ok" : "FALLA").padEnd(6)}  ${String(`${item.ms} ms`).padEnd(7)} ${item.requirement}`
    );
  }

  const failures = results.filter((item) => !item.ok);
  if (failures.length > 0) {
    console.log("\n  Fallas\n");
    for (const item of failures) {
      console.log(`  · ${item.name}: ${item.detail}`);
    }
  }
  if (notes.length > 0) {
    console.log("\n  Avisos\n");
    for (const note of notes) console.log(`  · ${note}`);
  }

  console.log(
    `\n  ${results.length - failures.length} de ${results.length} comprobaciones en orden.\n`
  );

  await sql.end({ timeout: 5 });
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error("\n  La prueba se detuvo por un error inesperado:\n");
  console.error(error);
  await sql.end({ timeout: 5 }).catch(() => undefined);
  process.exit(1);
});
