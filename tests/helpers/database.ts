import { sql } from "@/lib/db";
import { hashPassword } from "@/lib/crypto/password";
import { sha256Hex } from "@/lib/crypto/tokens";
import { loadOrganizationProfile } from "@/lib/auth/guards";
import type { OrganizationContext } from "@/lib/auth/guards";
import type {
  Capability,
  OrganizationRole,
  ReviewPolicy,
} from "@/lib/domain/types";
import type { FieldDataType } from "@/lib/domain/templates";

/** Vacía el esquema `fides` conservando la estructura y las migraciones. */
export async function truncateAll(): Promise<void> {
  const tables = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'fides' AND tablename NOT LIKE '%migration%'
  `;
  if (tables.length === 0) return;
  const list = tables.map((row) => `fides."${row.tablename}"`).join(", ");
  await sql.unsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export interface OrganizationFixtureOptions {
  name?: string;
  slug?: string;
  legalName?: string;
  capabilities?: Partial<Record<Capability, boolean>>;
  defaults?: {
    linkDays?: number;
    requiresVideo?: boolean;
    requiresIne?: boolean;
    reviewPolicy?: ReviewPolicy;
  };
}

export interface OrganizationFixture {
  id: string;
  name: string;
  slug: string;
}

let sequence = 0;
function nextSuffix(): string {
  sequence += 1;
  return `${sequence}-${Math.floor(performance.now() * 1000) % 100000}`;
}

export async function createOrganization(
  options: OrganizationFixtureOptions = {}
): Promise<OrganizationFixture> {
  const suffix = nextSuffix();
  const name = options.name ?? `Organización ${suffix}`;
  const slug = options.slug ?? `organizacion-${suffix}`;
  const [organization] = await sql<{ id: string }[]>`
    INSERT INTO organizations (name, slug, legal_name)
    VALUES (${name}, ${slug}, ${options.legalName ?? `${name}, S.A. de C.V.`})
    RETURNING id
  `;

  const capabilities: Record<Capability, boolean> = {
    ai_review: false,
    active_custody: false,
    evidence_video: false,
    evidence_ine: false,
    ...options.capabilities,
  };
  for (const [capability, enabled] of Object.entries(capabilities)) {
    await sql`
      INSERT INTO commercial_entitlements (organization_id, capability, enabled)
      VALUES (${organization.id}, ${capability}, ${enabled})
    `;
  }

  await sql`
    INSERT INTO organization_settings (
      organization_id, default_link_days, default_requires_video,
      default_requires_ine, default_review_policy
    ) VALUES (
      ${organization.id},
      ${options.defaults?.linkDays ?? 7},
      ${options.defaults?.requiresVideo ?? false},
      ${options.defaults?.requiresIne ?? false},
      ${options.defaults?.reviewPolicy ?? "none"}
    )
  `;

  return { id: organization.id, name, slug };
}

export interface AccountFixture {
  id: string;
  email: string;
  fullName: string;
}

export async function createAccount(options: {
  email?: string;
  fullName?: string;
  password?: string;
  isPlatformAdmin?: boolean;
  isLegalPublisher?: boolean;
  totpSecret?: string | null;
} = {}): Promise<AccountFixture> {
  const suffix = nextSuffix();
  const email = options.email ?? `persona-${suffix}@example.invalid`;
  const fullName = options.fullName ?? `Persona ${suffix}`;
  const [account] = await sql<{ id: string }[]>`
    INSERT INTO accounts (
      email, full_name, password_hash, is_platform_admin,
      is_legal_publisher, totp_secret
    ) VALUES (
      ${email}, ${fullName},
      ${hashPassword(options.password ?? "Contrasena.De.Prueba.1")},
      ${options.isPlatformAdmin ?? false},
      ${options.isLegalPublisher ?? false},
      ${options.totpSecret ?? null}
    )
    RETURNING id
  `;
  return { id: account.id, email, fullName };
}

export async function addMembership(
  organizationId: string,
  accountId: string,
  roles: OrganizationRole[],
  isPrimaryAdmin = false
): Promise<string> {
  const [member] = await sql<{ id: string }[]>`
    INSERT INTO organization_members (
      organization_id, account_id, roles, is_primary_admin
    ) VALUES (
      ${organizationId}, ${accountId}, ${roles as string[]}, ${isPrimaryAdmin}
    )
    RETURNING id
  `;
  return member.id;
}

/**
 * Contexto equivalente al que resuelve `requireOrganizationContext` en una
 * petición real, sin pasar por cookies ni por la sesión HTTP.
 */
export async function buildContext(
  organizationId: string,
  account: AccountFixture,
  roles: OrganizationRole[],
  options: { isPrimaryAdmin?: boolean; isPlatformAdmin?: boolean } = {}
): Promise<OrganizationContext> {
  const organization = await loadOrganizationProfile(organizationId);
  const membership = {
    organizationId,
    organizationName: organization.name,
    organizationSlug: organization.slug,
    roles,
    isPrimaryAdmin: options.isPrimaryAdmin ?? false,
  };
  return {
    account: {
      accountId: account.id,
      email: account.email,
      fullName: account.fullName,
      isPlatformAdmin: options.isPlatformAdmin ?? false,
      isLegalPublisher: false,
      totpEnrolled: false,
      totpSatisfied: true,
      sessionId: "00000000-0000-4000-8000-000000000000",
      activeOrganizationId: organizationId,
    },
    membership,
    organization,
    memberships: [membership],
  };
}

export interface FieldSeed {
  key: string;
  label: string;
  dataType?: FieldDataType;
  required?: boolean;
  options?: string[];
  searchable?: boolean;
  highlighted?: boolean;
}

export interface TemplateFixture {
  id: string;
  versionId: string;
  name: string;
}

export async function createTemplate(
  organizationId: string,
  options: {
    name?: string;
    markdown?: string;
    label?: string;
    fields?: FieldSeed[];
    acceptanceLegend?: string;
    videoStatementTemplate?: string;
    defaults?: {
      linkDays?: number;
      requiresVideo?: boolean;
      requiresIne?: boolean;
      reviewPolicy?: ReviewPolicy;
    };
    publishedBy?: string | null;
  } = {}
): Promise<TemplateFixture> {
  const suffix = nextSuffix();
  const name = options.name ?? `Contrato-plantilla ${suffix}`;
  const fields = options.fields ?? [
    { key: "objeto", label: "Objeto", searchable: true, highlighted: true },
    { key: "monto", label: "Monto", dataType: "money" as const },
  ];
  const markdown =
    options.markdown ??
    [
      `# ${name}`,
      "",
      "Celebrado por {{organizacion.razon_social}} y {{titular.nombre}}.",
      "",
      "Objeto: {{objeto}}. Monto: {{monto}}.",
      "",
      "Referencia {{contrato.referencia}} del {{contrato.fecha}}.",
      "",
      "Acepta {{firmante.nombre}}.",
    ].join("\n");

  const [template] = await sql<{ id: string }[]>`
    INSERT INTO contract_templates (
      organization_id, name, summary, acceptance_legend,
      video_statement_template, default_link_days, default_requires_video,
      default_requires_ine, default_review_policy
    ) VALUES (
      ${organizationId}, ${name}, 'Contenido sintético de prueba.',
      ${options.acceptanceLegend ??
        "Manifiesto mi aceptación del contrato mediante la acción Aceptar contrato."},
      ${options.videoStatementTemplate ??
        "Soy {{firmante.nombre}} y acepto el contrato por {{contrato.monto_principal}}."},
      ${options.defaults?.linkDays ?? 7},
      ${options.defaults?.requiresVideo ?? false},
      ${options.defaults?.requiresIne ?? false},
      ${options.defaults?.reviewPolicy ?? "none"}
    )
    RETURNING id
  `;

  let position = 0;
  for (const field of fields) {
    position += 1;
    await sql`
      INSERT INTO contract_field_definitions (
        template_id, key, label, data_type, required, options,
        searchable, highlighted, position
      ) VALUES (
        ${template.id}, ${field.key}, ${field.label},
        ${field.dataType ?? "text"}, ${field.required ?? true},
        ${JSON.stringify(field.options ?? [])}::text::jsonb,
        ${field.searchable ?? false}, ${field.highlighted ?? false}, ${position}
      )
    `;
  }

  const [version] = await sql<{ id: string }[]>`
    INSERT INTO contract_template_versions (
      template_id, label, markdown, markdown_hash, is_current, published_by
    ) VALUES (
      ${template.id}, ${options.label ?? "1.0"}, ${markdown},
      ${sha256Hex(markdown)}, TRUE, ${options.publishedBy ?? null}
    )
    RETURNING id
  `;

  return { id: template.id, versionId: version.id, name };
}

export async function createPrivacyNotice(
  organizationId: string,
  options: { label?: string; simplified?: string; full?: string } = {}
): Promise<string> {
  const full = options.full ?? "Aviso de Privacidad sintético con finalidades.";
  const simplified = options.simplified ?? full;
  const [notice] = await sql<{ id: string }[]>`
    INSERT INTO privacy_notice_versions (
      organization_id, label, simplified_markdown, full_markdown,
      notice_hash, is_current
    ) VALUES (
      ${organizationId}, ${options.label ?? "1.0"}, ${simplified}, ${full},
      ${sha256Hex(JSON.stringify({ fullMarkdown: full }))},
      TRUE
    )
    RETURNING id
  `;
  return notice.id;
}

export async function createCounterpartyRow(
  organizationId: string,
  options: {
    name?: string;
    personKind?: "fisica" | "moral";
    active?: boolean;
    rfc?: string | null;
  } = {}
): Promise<{ id: string; name: string }> {
  const suffix = nextSuffix();
  const name = options.name ?? `Contraparte ${suffix}`;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO counterparties (
      organization_id, person_kind, name, rfc, active
    ) VALUES (
      ${organizationId}, ${options.personKind ?? "fisica"}, ${name},
      ${options.rfc ?? null}, ${options.active ?? true}
    )
    RETURNING id
  `;
  return { id: row.id, name };
}

/**
 * Organización lista para emitir: plantilla vigente, aviso vigente,
 * contrapartes activas y un Emisor con contexto resuelto.
 */
export async function createIssuableOrganization(
  options: OrganizationFixtureOptions & {
    roles?: OrganizationRole[];
    fields?: FieldSeed[];
    templateDefaults?: {
      linkDays?: number;
      requiresVideo?: boolean;
      requiresIne?: boolean;
      reviewPolicy?: ReviewPolicy;
    };
  } = {}
) {
  const organization = await createOrganization(options);
  const account = await createAccount();
  const roles = options.roles ?? (["administrator", "emitter"] as OrganizationRole[]);
  const memberId = await addMembership(organization.id, account.id, roles, true);
  const context = await buildContext(organization.id, account, roles, {
    isPrimaryAdmin: true,
  });
  const template = await createTemplate(organization.id, {
    fields: options.fields,
    defaults: options.templateDefaults,
  });
  const noticeId = await createPrivacyNotice(organization.id);
  const holder = await createCounterpartyRow(organization.id, {
    personKind: "moral",
  });
  const signer = await createCounterpartyRow(organization.id);

  return {
    organization,
    account,
    memberId,
    context,
    template,
    noticeId,
    holder,
    signer,
  };
}
