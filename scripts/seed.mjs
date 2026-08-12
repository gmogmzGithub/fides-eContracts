#!/usr/bin/env node
/**
 * Semilla sintética completa del POC-Demo local de Fides (ADR-0082).
 *
 * Crea el catálogo definido en `scripts/demo-catalog.mjs`, con los tres
 * accesos sintéticos de Retto y expedientes coherentes:
 * un Borrador y siete Contratos por Organización. Los Contratos cubren todos
 * los Estados visibles, además de Archivados y Eliminados. Los expedientes A
 * revisión incluyen evidencia sintética y una tarea realmente accionable.
 *
 * La contraseña pública predeterminada es `FidesDemo123!`. Nunca se contacta a
 * personas o proveedores reales y ningún archivo representa evidencia real.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { DEFAULT_DATABASE_URL } from "./defaults.mjs";
import {
  ACCOUNTS,
  demoCasesFor,
  DEMO_ACCOUNT_EMAILS,
  DEMO_CATALOG_TOTALS,
  DEMO_ORGANIZATION_SLUGS,
  ORGANIZATIONS,
  RETENTION_POLICIES,
  SYNTHETIC_NOTE,
} from "./demo-catalog.mjs";

const DEFAULT_SEED_PASSWORD = "FidesDemo123!";
const SCRYPT_COST = 16384;
const KEY_LENGTH = 64;
const SCHEMA = "fides";
const DAY_MS = 86_400_000;
const DEFAULT_CURRENCY = "MXN";
const CURRENCY_FIELD_SUFFIX = "_moneda";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto
    .scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, { N: SCRYPT_COST })
    .toString("hex");
  return `scrypt$${SCRYPT_COST}$${salt}$${derived}`;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalizeJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON no finito.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Tipo no serializable: ${typeof value}.`);
}

function noticeHash(full) {
  return sha256Hex(canonicalizeJson({ fullMarkdown: full }));
}

function fail(message) {
  throw new Error(message);
}

function atDaysAgo(days, minutes = 0) {
  const date = new Date(Date.now() - days * DAY_MS);
  date.setUTCHours(15, minutes, 0, 0);
  return date;
}

function plusMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function dateKey(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function referenceFor(date, sequence = 1) {
  return `AC-${dateKey(date)}-${String(sequence).padStart(4, "0")}`;
}

function currencyValueKey(fieldKey) {
  return `${fieldKey}${CURRENCY_FIELD_SUFFIX}`;
}

function currencyFor(field, values) {
  const options = field.options?.length ? field.options : ["USD", DEFAULT_CURRENCY];
  const candidate = String(values[currencyValueKey(field.key)] ?? "")
    .trim()
    .toUpperCase();
  if (candidate && options.includes(candidate)) return candidate;
  return options.includes(DEFAULT_CURRENCY) ? DEFAULT_CURRENCY : options[0] ?? DEFAULT_CURRENCY;
}

function formatMoneyValue(value, currency = DEFAULT_CURRENCY) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
  }).format(Number(value));
}

function formatField(field, value, values) {
  if (field.dataType === "money") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return formatMoneyValue(numeric, currencyFor(field, values));
    }
  }
  if (field.dataType === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "America/Mexico_City",
    }).format(new Date(`${value}T12:00:00-06:00`));
  }
  return value;
}

function extractAmount(value) {
  const match = /\bpor\s+(\d+(?:[.,]\d{1,2})?)\s*(MXN|USD|EUR|CAD)?\b/iu.exec(
    value
  );
  if (!match) return null;
  return {
    value: match[1].replace(",", "."),
    currency: String(match[2] ?? DEFAULT_CURRENCY).toUpperCase(),
  };
}

function renderTemplate(source, template, values, context) {
  const fields = new Map(template.fields.map((field) => [field.key, field]));
  const primaryMoneyField =
    template.fields.find(
      (field) =>
        field.dataType === "money" &&
        field.highlighted &&
        String(values[field.key] ?? "").trim()
    ) ??
    template.fields.find(
      (field) =>
        field.dataType === "money" && String(values[field.key] ?? "").trim()
    );
  const amountField =
    primaryMoneyField ??
    template.fields.find(
      (field) =>
        field.highlighted && extractAmount(String(values[field.key] ?? "")) !== null
    ) ??
    template.fields.find(
      (field) => extractAmount(String(values[field.key] ?? "")) !== null
    );
  const extractedAmount =
    !primaryMoneyField && amountField
      ? extractAmount(String(values[amountField.key] ?? ""))
      : null;
  const replacements = {
    "organizacion.nombre": context.organization.name,
    "organizacion.razon_social": context.organization.legalName,
    "titular.nombre": context.holder.name,
    "titular.rfc": context.holder.rfc,
    "titular.domicilio": context.holder.address,
    "titular.correo": context.holder.email,
    "titular.telefono": context.holder.phone,
    "firmante.nombre": context.signer.name,
    "contrato.referencia": context.reference,
    "contrato.fecha": new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "America/Mexico_City",
    }).format(context.issuedAt),
    "contrato.monto_principal": primaryMoneyField
      ? formatField(primaryMoneyField, values[primaryMoneyField.key] ?? "", values)
      : extractedAmount
        ? formatMoneyValue(extractedAmount.value, extractedAmount.currency)
        : "",
  };
  return source.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (whole, key) => {
    if (Object.hasOwn(replacements, key)) return replacements[key];
    const field = fields.get(key);
    return field ? formatField(field, values[key] ?? "", values) : whole;
  });
}

const CONTEXT_KEYS = new Set([
  "organizacion.nombre",
  "organizacion.razon_social",
  "titular.nombre",
  "titular.rfc",
  "titular.domicilio",
  "titular.correo",
  "titular.telefono",
  "firmante.nombre",
  "contrato.referencia",
  "contrato.fecha",
  "contrato.monto_principal",
]);

function unknownPlaceholders(markdown, fieldKeys) {
  const unknown = new Set();
  for (const match of markdown.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) {
    if (!CONTEXT_KEYS.has(match[1]) && !fieldKeys.includes(match[1])) {
      unknown.add(match[1]);
    }
  }
  return [...unknown];
}

function privacyNotice(organization) {
  const evidence = [];
  if (organization.entitlements.evidence_ine) evidence.push("capturas sintéticas de INE");
  if (organization.entitlements.evidence_video) evidence.push("video guiado sintético");
  const configured =
    evidence.length > 0
      ? `Según el Contrato, el recorrido también puede solicitar ${evidence.join(" y ")}.`
      : "El recorrido no solicita INE o video.";
  const full = `# Aviso de Privacidad

${SYNTHETIC_NOTE}

## Responsable

${organization.legalName}, con domicilio en ${organization.city}.

## Datos y finalidades

Este POC-Demo utiliza exclusivamente datos sintéticos para mostrar la preparación, aceptación, revisión y conservación de Contratos. ${configured}

## Encargado

Fides conserva el texto, los eventos y la evidencia por cuenta del Responsable y no utiliza esta información para fines propios.

## Conservación y derechos

Los plazos que muestra este entorno son demostrativos. Las solicitudes del demo se dirigen a privacidad@fides.local. Antes de usar datos reales deberán aprobarse el aviso, los plazos y los canales aplicables.`;
  return { simplified: full, full };
}

async function writeLocalObject(key, body, contentType, metadata) {
  const root = path.resolve(
    process.env.FIDES_OBJECT_DIR ?? path.join(process.cwd(), ".data", "objetos")
  );
  const normalized = path.posix.normalize(key);
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    fail(`clave de objeto inválida: ${key}`);
  }
  const objectPath = path.resolve(root, normalized);
  if (!objectPath.startsWith(`${root}${path.sep}`)) {
    fail(`la clave sale del directorio de objetos: ${key}`);
  }
  await fs.mkdir(path.dirname(objectPath), { recursive: true });
  await fs.writeFile(objectPath, body, { mode: 0o600 });
  await fs.writeFile(
    `${objectPath}.fides-metadata.json`,
    JSON.stringify({ contentType, size: body.byteLength, metadata }),
    { encoding: "utf8", mode: 0o600 }
  );
}

async function syncAccounts(tx, passwordHash) {
  const accountIds = new Map();
  for (const account of ACCOUNTS) {
    const [row] = await tx`
      INSERT INTO ${tx(SCHEMA)}.accounts
        (email, full_name, password_hash, is_platform_admin,
         is_legal_publisher, totp_secret, totp_confirmed_at)
      VALUES (
        ${account.email}, ${account.fullName}, ${passwordHash},
        ${Boolean(account.isPlatformAdmin)}, ${Boolean(account.isLegalPublisher)},
        NULL, NULL
      )
      ON CONFLICT (email) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        password_hash = EXCLUDED.password_hash,
        is_platform_admin = EXCLUDED.is_platform_admin,
        is_legal_publisher = EXCLUDED.is_legal_publisher,
        totp_secret = NULL,
        totp_confirmed_at = NULL,
        updated_at = NOW()
      RETURNING id
    `;
    accountIds.set(account.email, row.id);
  }
  return accountIds;
}

async function syncMemberships(tx, accountIds) {
  const ids = [...accountIds.values()];
  const organizations = await tx`
    SELECT id, slug FROM ${tx(SCHEMA)}.organizations
    WHERE slug = ANY(${DEMO_ORGANIZATION_SLUGS}::text[])
  `;
  const organizationIds = new Map(organizations.map((row) => [row.slug, row.id]));
  if (organizationIds.size !== ORGANIZATIONS.length) {
    fail("faltan Organizaciones antes de reconciliar las membresías");
  }
  await tx`
    DELETE FROM ${tx(SCHEMA)}.organization_members
    WHERE account_id = ANY(${ids}::uuid[])
      AND organization_id = ANY(${[...organizationIds.values()]}::uuid[])
  `;
  for (const account of ACCOUNTS) {
    for (const membership of account.memberships) {
      await tx`
        INSERT INTO ${tx(SCHEMA)}.organization_members
          (organization_id, account_id, roles, is_primary_admin)
        VALUES (
          ${organizationIds.get(membership.slug)}, ${accountIds.get(account.email)},
          ${membership.roles}::text[], ${Boolean(membership.primaryAdmin)}
        )
      `;
    }
  }
}

async function publishTemplate(tx, templateId, template, publisherId) {
  const keys = template.fields.map((field) => field.key);
  const unknown = unknownPlaceholders(template.markdown, keys);
  if (unknown.length > 0) {
    fail(`la Plantilla ${template.name} usa marcadores desconocidos: ${unknown.join(", ")}`);
  }
  const hash = sha256Hex(template.markdown);
  const [row] = await tx`
    INSERT INTO ${tx(SCHEMA)}.contract_template_versions
      (template_id, label, markdown, markdown_hash, is_current, published_by)
    VALUES (${templateId}, '1.0', ${template.markdown}, ${hash}, TRUE, ${publisherId})
    RETURNING id, published_at
  `;
  return row;
}

async function seedCatalog(tx, accountIds) {
  const publisherId = accountIds.get("platform-admin@fides.local");
  const runtime = [];
  for (const [organizationIndex, organization] of ORGANIZATIONS.entries()) {
    const [org] = await tx`
      INSERT INTO ${tx(SCHEMA)}.organizations (slug, name, legal_name, seat_limit)
      VALUES (${organization.slug}, ${organization.name}, ${organization.legalName}, ${organization.seatLimit})
      RETURNING id
    `;
    const organizationId = org.id;

    for (const [capability, enabled] of Object.entries(organization.entitlements)) {
      await tx`
        INSERT INTO ${tx(SCHEMA)}.commercial_entitlements
          (organization_id, capability, enabled)
        VALUES (${organizationId}, ${capability}, ${enabled})
      `;
    }
    const settings = organization.settings;
    const alertAccount = ACCOUNTS.find((account) =>
      account.memberships.some(
        (membership) =>
          membership.slug === organization.slug &&
          membership.roles.includes("administrator")
      )
    );
    if (!alertAccount) {
      fail(`falta un Administrador para las alertas de ${organization.slug}`);
    }
    const alertWhatsapp = `+523355550${String(organizationIndex + 1).padStart(3, "0")}`;
    await tx`
      INSERT INTO ${tx(SCHEMA)}.organization_settings
        (organization_id, default_link_days, default_requires_video,
         default_requires_ine, default_review_policy, updated_by,
         alert_email_enabled, alert_email_recipient,
         alert_whatsapp_enabled, alert_whatsapp_recipient)
      VALUES (
        ${organizationId}, ${settings.linkDays}, ${settings.requiresVideo},
        ${settings.requiresIne}, ${settings.reviewPolicy}, ${publisherId},
        TRUE, ${alertAccount.email}, TRUE, ${alertWhatsapp}
      )
    `;

    const folders = [];
    for (const name of organization.folders) {
      const [folder] = await tx`
        INSERT INTO ${tx(SCHEMA)}.contract_folders (organization_id, name)
        VALUES (${organizationId}, ${name}) RETURNING id, name
      `;
      folders.push(folder);
    }

    for (const policy of RETENTION_POLICIES) {
      await tx`
        INSERT INTO ${tx(SCHEMA)}.retention_policies
          (organization_id, category, retention_months, description)
        VALUES (
          ${organizationId}, ${policy.category},
          ${policy.retentionMonths}, ${policy.description}
        )
      `;
    }

    const counterparties = [];
    for (const counterparty of organization.counterparties) {
      const [row] = await tx`
        INSERT INTO ${tx(SCHEMA)}.counterparties
          (organization_id, person_kind, name, rfc, email, phone, address,
           position, active, created_by)
        VALUES (
          ${organizationId}, ${counterparty.personKind}, ${counterparty.name},
          ${counterparty.rfc}, ${counterparty.email}, ${counterparty.phone},
          ${counterparty.address}, ${counterparty.position}, TRUE, ${publisherId}
        )
        RETURNING id
      `;
      counterparties.push({ ...counterparty, id: row.id });
    }

    const templates = [];
    for (const template of organization.templates) {
      const defaults = template.defaults;
      const [templateRow] = await tx`
        INSERT INTO ${tx(SCHEMA)}.contract_templates
          (organization_id, name, summary, base_model, acceptance_legend,
           video_statement_template, default_link_days, default_requires_video,
           default_requires_ine, default_review_policy)
        VALUES (
          ${organizationId}, ${template.name}, ${template.summary},
          ${template.baseModel}, ${template.acceptanceLegend},
          ${template.videoStatement}, ${defaults.linkDays},
          ${defaults.requiresVideo}, ${defaults.requiresIne},
          ${defaults.reviewPolicy}
        )
        RETURNING id
      `;
      for (const [position, field] of template.fields.entries()) {
        await tx`
          INSERT INTO ${tx(SCHEMA)}.contract_field_definitions
            (template_id, key, label, help_text, data_type, required, options,
             searchable, highlighted, position)
          VALUES (
            ${templateRow.id}, ${field.key}, ${field.label}, ${field.helpText ?? ""},
            ${field.dataType}, ${field.required !== false},
            ${JSON.stringify(field.options ?? [])}::text::jsonb,
            ${Boolean(field.searchable)}, ${Boolean(field.highlighted)},
            ${position + 1}
          )
        `;
      }
      const version = await publishTemplate(tx, templateRow.id, template, publisherId);
      templates.push({ ...template, id: templateRow.id, version });
    }

    const notice = privacyNotice(organization);
    const hash = noticeHash(notice.full);
    const [noticeRow] = await tx`
      INSERT INTO ${tx(SCHEMA)}.privacy_notice_versions
        (organization_id, label, simplified_markdown, full_markdown,
         notice_hash, is_current, published_by)
      VALUES (
        ${organizationId}, '1.0', ${notice.simplified}, ${notice.full},
        ${hash}, TRUE, ${publisherId}
      )
      RETURNING id, published_at
    `;

    runtime.push({
      organization,
      id: organizationId,
      folders,
      counterparties,
      templates,
      notice: { ...notice, id: noticeRow.id, hash, publishedAt: noticeRow.published_at },
    });
  }
  return runtime;
}

function accountFor(slug, role) {
  const preferred = ACCOUNTS.find((account) =>
    account.memberships.some(
      (membership) =>
        membership.slug === slug &&
        membership.roles.includes(role) &&
        !membership.primaryAdmin
    )
  );
  return (
    preferred ??
    ACCOUNTS.find((account) =>
      account.memberships.some(
        (membership) => membership.slug === slug && membership.roles.includes(role)
      )
    )
  );
}

function partiesFor(runtime, scenarioIndex) {
  const pairs = runtime.organization.partyPairs;
  if (pairs?.length > 0) {
    const [holderIndex, signerIndex] = pairs[scenarioIndex % pairs.length];
    return {
      holder: runtime.counterparties[holderIndex],
      signer: runtime.counterparties[signerIndex],
    };
  }
  const counterparty = runtime.counterparties[scenarioIndex % runtime.counterparties.length];
  return { holder: counterparty, signer: counterparty };
}

async function insertEvent(tx, input) {
  await tx`
    INSERT INTO ${tx(SCHEMA)}.contract_events
      (contract_id, organization_id, attempt_id, type, actor_kind,
       actor_id, actor_name, sensitive, payload, created_at)
    VALUES (
      ${input.contractId}, ${input.organizationId}, ${input.attemptId ?? null},
      ${input.type}, ${input.actorKind}, ${input.actorId ?? null},
      ${input.actorName ?? ""}, ${Boolean(input.sensitive)},
      ${JSON.stringify(input.payload ?? {})}::text::jsonb, ${input.createdAt}
    )
  `;
}

async function insertFileEvidence(tx, input) {
  const body = Buffer.from(
    input.kind === "video"
      ? `VIDEO SINTÉTICO DEL POC-DEMO\n${input.reference}\nSin persona real.\n`
      : `CAPTURA SINTÉTICA DEL POC-DEMO\n${input.reference}\nSin documento real.\n`,
    "utf8"
  );
  const contentType = input.kind === "video" ? "video/webm" : "image/png";
  const key = `organizations/${input.organizationId}/contracts/${input.contractId}/attempts/${input.attemptId}/${input.kind}-demo`;
  const hash = sha256Hex(body);
  const metadata = {
    fileName: `${input.kind}-demo.${input.kind === "video" ? "webm" : "png"}`,
    recordedInSession: input.kind === "video" ? true : null,
    shownStatement: input.kind === "video" ? input.videoStatement : null,
    attemptSequence: 1,
    documentHash: input.documentHash,
    receivedAt: input.createdAt.toISOString(),
    synthetic: true,
  };
  await writeLocalObject(key, body, contentType, {
    organizationId: input.organizationId,
    contractId: input.contractId,
    attemptId: input.attemptId,
    kind: input.kind,
    synthetic: "true",
  });
  await tx`
    INSERT INTO ${tx(SCHEMA)}.evidence_items
      (attempt_id, contract_id, organization_id, kind, object_key,
       content_type, byte_size, sha256, metadata, created_at)
    VALUES (
      ${input.attemptId}, ${input.contractId}, ${input.organizationId},
      ${input.kind}, ${key}, ${contentType}, ${body.byteLength}, ${hash},
      ${JSON.stringify(metadata)}::text::jsonb, ${input.createdAt}
    )
  `;
  await insertEvent(tx, {
    ...input,
    type: "evidencia_recibida",
    actorKind: "signer",
    actorName: input.signerName,
    payload: { categoria: input.kind, bytes: body.byteLength, sha256: hash, synthetic: true },
  });
  return { kind: input.kind, sha256: hash };
}

async function insertAcceptanceEvidence(tx, input, evidence) {
  const record = {
    tipo: "aceptacion_electronica",
    version: 1,
    contrato: { id: input.contractId, referencia: input.reference, hash_documento: input.documentHash },
    organizacion: { id: input.organizationId, nombre: input.organizationName },
    intento: { id: input.attemptId, secuencia: 1 },
    aviso_privacidad: { id: input.noticeId, hash: input.noticeHash },
    leyenda: input.acceptanceLegend,
    leyenda_aceptada: true,
    contrato_recorrido_en: input.walkedAt.toISOString(),
    nombre_declarado: input.signerName,
    agente_usuario: "Fides POC-Demo local (datos sintéticos)",
    evidencia: evidence
      .map((item) => ({ categoria: item.kind, sha256: item.sha256 }))
      .sort((a, b) => a.categoria.localeCompare(b.categoria)),
    aceptado_en: input.createdAt.toISOString(),
    synthetic: true,
  };
  const canonical = canonicalizeJson(record);
  await tx`
    INSERT INTO ${tx(SCHEMA)}.evidence_items
      (attempt_id, contract_id, organization_id, kind, object_key,
       content_type, byte_size, sha256, metadata, created_at)
    VALUES (
      ${input.attemptId}, ${input.contractId}, ${input.organizationId},
      'acceptance', NULL, 'application/json',
      ${Buffer.byteLength(canonical, "utf8")}, ${sha256Hex(canonical)},
      ${canonical}::text::jsonb, ${input.createdAt}
    )
  `;
}

function configurationFor(runtime, scenario) {
  const defaults = runtime.organization.settings;
  return {
    ...defaults,
    reviewPolicy:
      scenario.status === "in_review" && defaults.reviewPolicy === "none"
        ? "manual"
        : scenario.status === "accepted"
          ? "none"
          : defaults.reviewPolicy,
  };
}

async function seedDraft(tx, runtime, accountIds, scenarioIndex, scenario) {
  const templateIndex = runtime.organization.templateRotation?.[scenarioIndex] ?? 0;
  const template = runtime.templates[templateIndex];
  const { holder, signer } = partiesFor(runtime, scenarioIndex);
  const emitter = accountFor(runtime.organization.slug, "emitter");
  const values = template.demoValues(scenarioIndex);
  const defaults = runtime.organization.settings;
  const createdAt = atDaysAgo(scenario.daysAgo, scenarioIndex);
  await tx`
    INSERT INTO ${tx(SCHEMA)}.contract_drafts
      (organization_id, template_id, created_by, created_by_name,
       holder_counterparty_id, signer_counterparty_id, field_values,
       folder_id, link_days, requires_video, requires_ine, review_policy,
       defaults_snapshot, customized, classification, created_at, updated_at)
    VALUES (
      ${runtime.id}, ${template.id}, ${accountIds.get(emitter.email)},
      ${emitter.fullName}, ${holder.id}, ${signer.id},
      ${JSON.stringify(values)}::text::jsonb, ${runtime.folders[scenario.folder].id},
      ${defaults.linkDays}, ${defaults.requiresVideo}, ${defaults.requiresIne},
      ${defaults.reviewPolicy}, ${JSON.stringify(defaults)}::text::jsonb, FALSE,
      'active', ${createdAt}, ${createdAt}
    )
  `;
}

async function seedContract(tx, runtime, accountIds, scenarioIndex, scenario) {
  const templateIndex = runtime.organization.templateRotation?.[scenarioIndex] ?? 0;
  const template = runtime.templates[templateIndex];
  const { holder, signer } = partiesFor(runtime, scenarioIndex);
  const emitter = accountFor(runtime.organization.slug, "emitter");
  const reviewer = accountFor(runtime.organization.slug, "reviewer");
  const issuedAt = atDaysAgo(scenario.daysAgo, scenarioIndex);
  const walkedAt = plusMinutes(issuedAt, 25);
  const submittedAt = plusMinutes(issuedAt, 40);
  const reference = referenceFor(issuedAt);
  const values = template.demoValues(scenarioIndex);
  const configuration = configurationFor(runtime, scenario);
  const expiresAt = new Date(issuedAt.getTime() + configuration.linkDays * DAY_MS);
  const closedAt =
    scenario.status === "accepted"
      ? submittedAt
      : scenario.status === "expired"
        ? expiresAt
        : plusMinutes(issuedAt, 65);
  const renderContext = {
    organization: runtime.organization,
    holder,
    signer,
    reference,
    issuedAt,
  };
  const contractMarkdown = renderTemplate(
    template.markdown,
    template,
    values,
    renderContext
  );
  const videoStatement = configuration.requiresVideo
    ? renderTemplate(template.videoStatement, template, values, renderContext)
    : "";
  const documentHash = sha256Hex(
    canonicalizeJson({
      markdown: contractMarkdown,
      values,
      parties: [
        { role: "holder", party: holder },
        { role: "signer", party: signer },
      ].map(({ role, party }) => ({
        role,
        personKind: party.personKind,
        name: party.name,
        rfc: party.rfc,
        email: party.email,
        phone: party.phone,
        address: party.address,
        position: party.position,
      })),
      configuration,
      reference,
      templateVersionId: template.version.id,
      privacyNoticeVersionId: runtime.notice.id,
    })
  );
  const isFinal = ["accepted", "expired", "cancelled"].includes(scenario.status);
  const acceptedAt = scenario.status === "accepted" ? closedAt : null;
  const expiredAt = scenario.status === "expired" ? closedAt : null;
  const cancelledAt = scenario.status === "cancelled" ? closedAt : null;
  const archivedAt = scenario.classification === "archived" ? plusMinutes(closedAt, 5) : null;
  const deletedAt = scenario.classification === "deleted" ? plusMinutes(closedAt, 5) : null;
  const searchText = [
    reference,
    template.name,
    holder.name,
    signer.name,
    emitter.fullName,
    ...Object.values(values),
  ].join(" ");

  const [contract] = await tx`
    INSERT INTO ${tx(SCHEMA)}.contracts
      (organization_id, reference, template_id, template_version_id,
       template_name, template_label, privacy_notice_version_id,
       privacy_notice_label, privacy_notice_simplified_markdown,
       privacy_notice_full_markdown, privacy_notice_hash,
       privacy_notice_published_at, status, contract_markdown, field_values,
       document_hash, acceptance_legend, video_statement, link_days,
       requires_video, requires_ine, review_policy, defaults_snapshot,
       customized, folder_id, classification, created_by, created_by_name,
       issued_at, accepted_at, expired_at, cancelled_at, cancel_reason,
       closed_at, archived_at, deleted_at, search_text, updated_at)
    VALUES (
      ${runtime.id}, ${reference}, ${template.id}, ${template.version.id},
      ${template.name}, '1.0', ${runtime.notice.id}, '1.0',
      ${runtime.notice.simplified}, ${runtime.notice.full}, ${runtime.notice.hash},
      ${runtime.notice.publishedAt}, ${scenario.status}, ${contractMarkdown},
      ${JSON.stringify(values)}::text::jsonb, ${documentHash}, ${template.acceptanceLegend},
      ${videoStatement}, ${configuration.linkDays}, ${configuration.requiresVideo},
      ${configuration.requiresIne}, ${configuration.reviewPolicy},
      ${JSON.stringify(runtime.organization.settings)}::text::jsonb,
      ${configuration.reviewPolicy !== runtime.organization.settings.reviewPolicy},
      ${runtime.folders[scenario.folder].id}, ${scenario.classification},
      ${accountIds.get(emitter.email)}, ${emitter.fullName}, ${issuedAt},
      ${acceptedAt}, ${expiredAt}, ${cancelledAt},
      ${scenario.status === "cancelled" ? "Escenario sintético de demostración" : null},
      ${isFinal ? closedAt : null}, ${archivedAt}, ${deletedAt},
      ${searchText}, ${deletedAt ?? archivedAt ?? closedAt ?? issuedAt}
    )
    RETURNING id
  `;
  const contractId = contract.id;

  await tx`
    INSERT INTO ${tx(SCHEMA)}.contract_reference_sequences
      (organization_id, day, last_value)
    VALUES (${runtime.id}, ${issuedAt.toISOString().slice(0, 10)}, 1)
    ON CONFLICT (organization_id, day) DO UPDATE SET
      last_value = GREATEST(${tx(SCHEMA)}.contract_reference_sequences.last_value, 1)
  `;

  for (const { role, party } of [
    { role: "holder", party: holder },
    { role: "signer", party: signer },
  ]) {
    await tx`
      INSERT INTO ${tx(SCHEMA)}.contract_parties
        (contract_id, party_role, source_counterparty_id, person_kind, name,
         rfc, email, phone, address, position, snapshot, captured_at)
      VALUES (
        ${contractId}, ${role}, ${party.id}, ${party.personKind},
        ${party.name}, ${party.rfc}, ${party.email},
        ${party.phone}, ${party.address}, ${party.position},
        ${JSON.stringify(party)}::text::jsonb, ${issuedAt}
      )
    `;
  }

  const attemptStatus = {
    pending: "open",
    in_review: "in_review",
    accepted: "accepted",
    expired: "expired",
    cancelled: "cancelled",
  }[scenario.status];
  const submitted = ["in_review", "accepted"].includes(scenario.status);
  const walked = submitted;
  const [attempt] = await tx`
    INSERT INTO ${tx(SCHEMA)}.acceptance_attempts
      (contract_id, organization_id, sequence, status, walked_at,
       submitted_at, closed_at, created_at)
    VALUES (
      ${contractId}, ${runtime.id}, 1, ${attemptStatus},
      ${walked ? walkedAt : null}, ${submitted ? submittedAt : null},
      ${isFinal ? closedAt : null}, ${issuedAt}
    )
    RETURNING id
  `;
  const attemptId = attempt.id;
  const token = crypto.randomBytes(32).toString("base64url");
  const openedAt = walked ? plusMinutes(issuedAt, 10) : null;
  await tx`
    INSERT INTO ${tx(SCHEMA)}.contract_links
      (contract_id, attempt_id, token, token_hash, expires_at,
       first_opened_at, revoked_at, created_at)
    VALUES (
      ${contractId}, ${attemptId}, ${token}, ${sha256Hex(token)}, ${expiresAt},
      ${openedAt}, ${scenario.status === "cancelled" ? closedAt : null}, ${issuedAt}
    )
  `;

  await insertEvent(tx, {
    contractId,
    organizationId: runtime.id,
    attemptId,
    type: "contrato_emitido",
    actorKind: "member",
    actorId: accountIds.get(emitter.email),
    actorName: emitter.fullName,
    payload: { reference, templateName: template.name, documentHash, configuration },
    createdAt: issuedAt,
  });
  if (openedAt) {
    await insertEvent(tx, {
      contractId,
      organizationId: runtime.id,
      attemptId,
      type: "enlace_abierto",
      actorKind: "signer",
      actorName: signer.name,
      payload: { secuencia: 1, synthetic: true },
      createdAt: openedAt,
    });
    await insertEvent(tx, {
      contractId,
      organizationId: runtime.id,
      attemptId,
      type: "contrato_recorrido",
      actorKind: "signer",
      actorName: signer.name,
      payload: { secuencia: 1 },
      createdAt: walkedAt,
    });
  }

  if (submitted) {
    const evidence = [];
    const evidenceInput = {
      contractId,
      organizationId: runtime.id,
      attemptId,
      reference,
      documentHash,
      videoStatement,
      signerName: signer.name,
    };
    if (configuration.requiresIne) {
      evidence.push(
        await insertFileEvidence(tx, {
          ...evidenceInput,
          kind: "ine_front",
          createdAt: plusMinutes(submittedAt, -8),
        })
      );
      evidence.push(
        await insertFileEvidence(tx, {
          ...evidenceInput,
          kind: "ine_back",
          createdAt: plusMinutes(submittedAt, -7),
        })
      );
    }
    if (configuration.requiresVideo) {
      evidence.push(
        await insertFileEvidence(tx, {
          ...evidenceInput,
          kind: "video",
          createdAt: plusMinutes(submittedAt, -5),
        })
      );
    }
    await insertAcceptanceEvidence(
      tx,
      {
        ...evidenceInput,
        organizationName: runtime.organization.name,
        noticeId: runtime.notice.id,
        noticeHash: runtime.notice.hash,
        acceptanceLegend: template.acceptanceLegend,
        walkedAt,
        createdAt: submittedAt,
      },
      evidence
    );
    await insertEvent(tx, {
      contractId,
      organizationId: runtime.id,
      attemptId,
      type: scenario.status === "in_review" ? "intento_enviado_a_revision" : "contrato_aceptado",
      actorKind: "signer",
      actorName: signer.name,
      payload: { secuencia: 1, politica: configuration.reviewPolicy, synthetic: true },
      createdAt: submittedAt,
    });
  }

  if (scenario.status === "in_review") {
    const [task] = await tx`
      INSERT INTO ${tx(SCHEMA)}.review_tasks
        (attempt_id, contract_id, organization_id, status, created_at)
      VALUES (${attemptId}, ${contractId}, ${runtime.id}, 'open', ${submittedAt})
      RETURNING id
    `;
    if (configuration.reviewPolicy === "ai") {
      await tx`
        INSERT INTO ${tx(SCHEMA)}.ai_review_reports
          (attempt_id, contract_id, organization_id, model,
           configuration_version, status, transcript, expected_statement,
           findings, confidence, limitations, recommendation, created_at)
        VALUES (
          ${attemptId}, ${contractId}, ${runtime.id}, 'fides-demo-double',
          'demo-1', 'completed',
          'Declaración sintética recibida para demostración.', ${videoStatement},
          ${JSON.stringify([{ code: "demo_data", message: "Evidencia sintética lista para revisión humana." }])}::text::jsonb,
          0.940, 'Resultado generado por el doble local; no verifica identidad.',
          'accept', ${plusMinutes(submittedAt, 2)}
        )
      `;
      await insertEvent(tx, {
        contractId,
        organizationId: runtime.id,
        attemptId,
        type: "reporte_ai_registrado",
        actorKind: "system",
        actorName: "Doble AI local",
        payload: { taskId: task.id, recommendation: "accept", synthetic: true },
        createdAt: plusMinutes(submittedAt, 2),
      });
    }
  }

  if (scenario.status === "expired") {
    await insertEvent(tx, {
      contractId,
      organizationId: runtime.id,
      attemptId,
      type: "enlace_vencido",
      actorKind: "system",
      actorName: "Sistema",
      payload: { secuencia: 1 },
      createdAt: closedAt,
    });
    await insertEvent(tx, {
      contractId,
      organizationId: runtime.id,
      attemptId,
      type: "contrato_vencido",
      actorKind: "system",
      actorName: "Sistema",
      payload: { referencia: reference },
      createdAt: closedAt,
    });
  }
  if (scenario.status === "cancelled") {
    await insertEvent(tx, {
      contractId,
      organizationId: runtime.id,
      attemptId,
      type: "contrato_cancelado",
      actorKind: "member",
      actorId: accountIds.get(emitter.email),
      actorName: emitter.fullName,
      payload: { reason: "Escenario sintético de demostración" },
      createdAt: closedAt,
    });
  }
  if (scenario.classification === "archived") {
    await insertEvent(tx, {
      contractId,
      organizationId: runtime.id,
      attemptId,
      type: "expediente_archivado",
      actorKind: "member",
      actorId: accountIds.get(emitter.email),
      actorName: emitter.fullName,
      payload: {},
      createdAt: archivedAt,
    });
  }
  if (scenario.classification === "deleted") {
    await insertEvent(tx, {
      contractId,
      organizationId: runtime.id,
      attemptId,
      type: "expediente_eliminado",
      actorKind: "member",
      actorId: accountIds.get(reviewer.email),
      actorName: reviewer.fullName,
      payload: { cancelledOnDelete: true },
      createdAt: deletedAt,
    });
  }

  if (isFinal) {
    await tx`
      INSERT INTO ${tx(SCHEMA)}.background_jobs
        (kind, payload, dedupe_key, run_after, created_at)
      VALUES (
        'seal_cold_package', ${JSON.stringify({ contractId })}::text::jsonb,
        ${`seed:seal_cold_package:${contractId}`}, NOW(), NOW()
      )
    `;
    if (scenario.classification === "deleted" && runtime.organization.entitlements.active_custody) {
      await tx`
        INSERT INTO ${tx(SCHEMA)}.background_jobs
          (kind, payload, dedupe_key, run_after, created_at)
        VALUES (
          'move_to_cold',
          ${JSON.stringify({ contractId, organizationId: runtime.id, reason: "deleted" })}::text::jsonb,
          ${`seed:move_to_cold:${contractId}`}, NOW() + INTERVAL '30 seconds', NOW()
        )
      `;
    }
  }
}

async function seedDemoFiles(tx, runtime, accountIds) {
  for (const organization of runtime) {
    for (const [index, scenario] of demoCasesFor(organization.organization).entries()) {
      if (scenario.kind === "draft") {
        await seedDraft(tx, organization, accountIds, index, scenario);
      } else {
        await seedContract(tx, organization, accountIds, index, scenario);
      }
    }
  }
  await seedFavorites(tx, runtime, accountIds);
}

/**
 * Dos Favoritos del Emisor por Organización. `Crear contrato` presenta el
 * atajo para repetir un contrato frecuente y el POC-Demo tiene que mostrarlo
 * con datos. El Favorito es personal: sus compañeros siguen viéndolo vacío.
 */
async function seedFavorites(tx, runtime, accountIds) {
  for (const organization of runtime) {
    const emitter = accountFor(organization.organization.slug, "emitter");
    const accountId = accountIds.get(emitter.email);
    await tx`
      INSERT INTO ${tx(SCHEMA)}.contract_favorites
        (organization_id, contract_id, account_id)
      SELECT c.organization_id, c.id, ${accountId}
      FROM ${tx(SCHEMA)}.contracts c
      WHERE c.organization_id = ${organization.id}
        AND c.classification = 'active'
        AND c.status IN ('pending', 'accepted')
      ORDER BY c.issued_at DESC
      LIMIT 2
      ON CONFLICT DO NOTHING
    `;
  }
}

async function validateDemoData(tx) {
  const [totals] = await tx`
    SELECT
      (SELECT count(*)::int FROM ${tx(SCHEMA)}.organizations
       WHERE slug = ANY(${DEMO_ORGANIZATION_SLUGS}::text[])) AS organizations,
      (SELECT count(*)::int FROM ${tx(SCHEMA)}.accounts
       WHERE email = ANY(${DEMO_ACCOUNT_EMAILS}::text[])) AS accounts,
      (SELECT count(*)::int FROM ${tx(SCHEMA)}.contract_templates) AS templates,
      (SELECT count(*)::int FROM ${tx(SCHEMA)}.contracts) AS contracts,
      (SELECT count(*)::int FROM ${tx(SCHEMA)}.contract_drafts
       WHERE classification = 'active' AND issued_contract_id IS NULL) AS drafts,
      (SELECT count(*)::int FROM ${tx(SCHEMA)}.counterparties) AS counterparties,
      (SELECT count(*)::int FROM ${tx(SCHEMA)}.contract_folders) AS folders,
      (SELECT count(*)::int FROM ${tx(SCHEMA)}.accounts
       WHERE totp_secret IS NOT NULL) AS totp
  `;
  const expected = {
    ...DEMO_CATALOG_TOTALS,
    totp: 0,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (totals[key] !== value) {
      fail(`validación del demo: ${key}=${totals[key]}, se esperaban ${value}`);
    }
  }

  const [jsonShapes] = await tx`
    SELECT
      -- La columna options es NOT NULL con default vacío en todos los tipos,
      -- así que su forma se comprueba sin acotar a select: antes un campo
      -- suggest mal programado pasaba y degradaba a texto sin sugerencias.
      (SELECT count(*)::int
       FROM ${tx(SCHEMA)}.contract_field_definitions
       WHERE jsonb_typeof(options) <> 'array') AS options,
      (SELECT count(*)::int
       FROM ${tx(SCHEMA)}.contract_drafts
       WHERE jsonb_typeof(field_values) <> 'object'
          OR jsonb_typeof(defaults_snapshot) <> 'object') AS drafts,
      (SELECT count(*)::int
       FROM ${tx(SCHEMA)}.contracts
       WHERE jsonb_typeof(field_values) <> 'object'
          OR jsonb_typeof(defaults_snapshot) <> 'object') AS contracts,
      (SELECT count(*)::int
       FROM ${tx(SCHEMA)}.contract_parties
       WHERE jsonb_typeof(snapshot) <> 'object') AS parties,
      (SELECT count(*)::int
       FROM ${tx(SCHEMA)}.background_jobs
       WHERE jsonb_typeof(payload) <> 'object') AS jobs
  `;
  for (const [key, value] of Object.entries(jsonShapes)) {
    if (value !== 0) {
      fail(`validación JSON del demo: ${key} tiene ${value} valor(es) mal tipados`);
    }
  }

  const rows = await tx`
    SELECT o.slug,
      count(DISTINCT m.id)::int AS members,
      count(DISTINCT c.id) FILTER (WHERE c.status = 'pending')::int AS pending,
      count(DISTINCT c.id) FILTER (WHERE c.status = 'in_review')::int AS in_review,
      count(DISTINCT c.id) FILTER (WHERE c.status = 'accepted')::int AS accepted,
      count(DISTINCT c.id) FILTER (WHERE c.status = 'expired')::int AS expired,
      count(DISTINCT c.id) FILTER (WHERE c.status = 'cancelled')::int AS cancelled,
      count(DISTINCT c.id) FILTER (WHERE c.classification = 'archived')::int AS archived,
      count(DISTINCT c.id) FILTER (WHERE c.classification = 'deleted')::int AS deleted
    FROM ${tx(SCHEMA)}.organizations o
    LEFT JOIN ${tx(SCHEMA)}.organization_members m ON m.organization_id = o.id
    LEFT JOIN ${tx(SCHEMA)}.contracts c ON c.organization_id = o.id
    WHERE o.slug = ANY(${DEMO_ORGANIZATION_SLUGS}::text[])
    GROUP BY o.slug
  `;
  const membershipsByOrganization = new Map(
    ORGANIZATIONS.map(({ slug }) => [
      slug,
      ACCOUNTS.filter((account) =>
        account.memberships.some((membership) => membership.slug === slug)
      ).length,
    ])
  );
  const casesByOrganization = new Map(
    ORGANIZATIONS.map((organization) => [organization.slug, demoCasesFor(organization)])
  );
  for (const row of rows) {
    const cases = casesByOrganization.get(row.slug) ?? [];
    const contracts = cases.filter(({ kind }) => kind === "contract");
    const expectedRow = {
      members: membershipsByOrganization.get(row.slug),
      pending: contracts.filter(({ status }) => status === "pending").length,
      in_review: contracts.filter(({ status }) => status === "in_review").length,
      accepted: contracts.filter(({ status }) => status === "accepted").length,
      expired: contracts.filter(({ status }) => status === "expired").length,
      cancelled: contracts.filter(({ status }) => status === "cancelled").length,
      archived: contracts.filter(({ classification }) => classification === "archived").length,
      deleted: contracts.filter(({ classification }) => classification === "deleted").length,
    };
    for (const [key, value] of Object.entries(expectedRow)) {
      if (row[key] !== value) {
        fail(`validación de ${row.slug}: ${key}=${row[key]}, se esperaban ${value}`);
      }
    }
  }

  const [review] = await tx`
    SELECT
      count(*)::int AS tasks,
      count(*) FILTER (WHERE evidence.total > 0)::int AS with_evidence
    FROM ${tx(SCHEMA)}.review_tasks task
    JOIN LATERAL (
      SELECT count(*)::int AS total
      FROM ${tx(SCHEMA)}.evidence_items e
      WHERE e.attempt_id = task.attempt_id
    ) evidence ON TRUE
    WHERE task.status = 'open'
  `;
  const expectedReviews = ORGANIZATIONS.reduce(
    (total, organization) =>
      total +
      demoCasesFor(organization).filter(
        ({ kind, status }) => kind === "contract" && status === "in_review"
      ).length,
    0
  );
  if (review.tasks !== expectedReviews || review.with_evidence !== expectedReviews) {
    fail("cada Organización debe tener una revisión abierta con evidencia sintética");
  }

  const [joel] = await tx`
    SELECT count(*)::int AS memberships
    FROM ${tx(SCHEMA)}.organization_members m
    JOIN ${tx(SCHEMA)}.accounts a ON a.id = m.account_id
    WHERE a.email = 'aviacion-norte-admin@aviacion-norte.local'
  `;
  if (joel.memberships !== 2) {
    fail("la Cuenta individual de Andrea debe pertenecer a sus dos Organizaciones");
  }
}

function reportAccounts(password) {
  console.log(`\n  ${DEMO_CATALOG_TOTALS.accounts} cuentas locales · contraseña compartida: ${password}\n`);
  for (const account of ACCOUNTS) {
    const scope =
      account.memberships.length > 0
        ? account.memberships
            .map((membership) => `${membership.slug}: ${membership.roles.join(" + ")}`)
            .join("; ")
        : account.isLegalPublisher
          ? "Administrador de plataforma + Publicador de contenido jurídico"
          : "Administrador de plataforma";
    console.log(`  ${account.email.padEnd(48)}${scope}`);
  }
}

async function report(sql, password) {
  const rows = await sql`
    SELECT o.name,
      (SELECT count(*)::int FROM ${sql(SCHEMA)}.contract_templates t WHERE t.organization_id = o.id) AS templates,
      (SELECT count(*)::int FROM ${sql(SCHEMA)}.counterparties p WHERE p.organization_id = o.id) AS counterparties,
      (SELECT count(*)::int FROM ${sql(SCHEMA)}.contract_folders f WHERE f.organization_id = o.id) AS folders,
      (SELECT count(*)::int FROM ${sql(SCHEMA)}.organization_members m WHERE m.organization_id = o.id) AS members,
      (SELECT count(*)::int FROM ${sql(SCHEMA)}.contract_drafts d WHERE d.organization_id = o.id AND d.issued_contract_id IS NULL) AS drafts,
      (SELECT count(*)::int FROM ${sql(SCHEMA)}.contracts c WHERE c.organization_id = o.id) AS contracts
    FROM ${sql(SCHEMA)}.organizations o
    WHERE o.slug = ANY(${DEMO_ORGANIZATION_SLUGS}::text[])
    ORDER BY o.name
  `;
  console.log("\n  POC-Demo sintético creado\n");
  for (const row of rows) {
    console.log(
      `  ${row.name.padEnd(31)} ${row.templates} Plantilla(s) · ` +
        `${row.counterparties} Contrapartes · ${row.folders} Carpetas · ` +
        `${row.members} accesos · ${row.drafts + row.contracts} expedientes`
    );
  }
  console.log(
    `\n  Total: ${DEMO_CATALOG_TOTALS.organizations} Organizaciones · ` +
      `${DEMO_CATALOG_TOTALS.counterparties} Contrapartes · ` +
      `${DEMO_CATALOG_TOTALS.contracts + DEMO_CATALOG_TOTALS.drafts} expedientes`
  );
  console.log("  Cobertura por Organización: Borrador, Pendiente de aceptación, A revisión,");
  console.log("  Aceptado, Vencido, Cancelado, Archivado y Eliminado.");
  reportAccounts(password);
  console.log("\n  Los trabajos de custodia se completan en segundo plano al iniciar el worker.\n");
}

async function resetTables(sql) {
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = ${SCHEMA} AND tablename NOT LIKE '%migration%'
    ORDER BY tablename
  `;
  if (tables.length === 0) return;
  const list = tables.map((row) => `"${SCHEMA}"."${row.tablename}"`).join(", ");
  await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  console.log(`  Reinicio: ${tables.length} tablas sintéticas vaciadas.`);
}

async function main() {
  const password = process.env.FIDES_SEED_PASSWORD?.trim() || DEFAULT_SEED_PASSWORD;
  const reset =
    process.env.FIDES_SEED_RESET === "true" || process.argv.includes("--reset");
  const sql = postgres(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, {
    max: 1,
    onnotice: () => undefined,
    transform: { undefined: null },
    connection: { search_path: `${SCHEMA},public` },
  });

  try {
    const [schema] = await sql`
      SELECT to_regclass(${`${SCHEMA}.organizations`}) IS NOT NULL AS ready
    `;
    if (!schema?.ready) {
      fail("el esquema no existe; ejecuta primero `npm run db:migrate`");
    }
    if (reset) await resetTables(sql);

    const [existing] = await sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE slug = ANY(${DEMO_ORGANIZATION_SLUGS}::text[]))::int AS demo
      FROM ${sql(SCHEMA)}.organizations
    `;
    const passwordHash = hashPassword(password);

    if (!reset && existing.demo === ORGANIZATIONS.length) {
      const count = await sql.begin(async (tx) => {
        const accountIds = await syncAccounts(tx, passwordHash);
        await syncMemberships(tx, accountIds);
        return accountIds.size;
      });
      console.log(
        `\n  El POC-Demo ya tenía datos: se conservaron y se reconciliaron ${count} cuentas.`
      );
      reportAccounts(password);
      return;
    }
    if (!reset && existing.total > 0) {
      fail(
        "la base contiene la semilla anterior o un catálogo parcial. Para reemplazar sólo " +
          "los datos sintéticos locales ejecuta `npm run local:reset` o " +
          "`FIDES_SEED_RESET=true npm run db:seed`."
      );
    }

    await sql.begin(async (tx) => {
      const accountIds = await syncAccounts(tx, passwordHash);
      const runtime = await seedCatalog(tx, accountIds);
      await syncMemberships(tx, accountIds);
      await seedDemoFiles(tx, runtime, accountIds);
      await validateDemoData(tx);
    });
    await report(sql, password);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("\n  Semilla detenida por un error:\n");
  console.error(error);
  process.exit(1);
});
