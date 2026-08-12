import "server-only";
import { sql } from "@/lib/db";
import type {
  AttemptStatus,
  Capability,
  Classification,
  ContractStatus,
  EvidenceKind,
  OrganizationRole,
  ReviewDecisionKind,
  ReviewPolicy,
} from "@/lib/domain/types";

/**
 * Lecturas exclusivas de la superficie del Proveedor. Atraviesan Organizaciones
 * a propósito (ADR-0040) y por eso cada pantalla que las usa deja auditoría.
 */

export const NO_CAPABILITIES: Record<Capability, boolean> = {
  ai_review: false,
  active_custody: false,
  evidence_video: true,
  evidence_ine: true,
};

export const CAPABILITY_ORDER: Capability[] = [
  "ai_review",
  "active_custody",
];

// ---------------------------------------------------------------------------
// Organizaciones
// ---------------------------------------------------------------------------

export interface OrganizationOverview {
  id: string;
  name: string;
  slug: string;
  legalName: string;
  seatLimit: number;
  activeSeats: number;
  capabilities: Record<Capability, boolean>;
  templateCount: number;
  publishedTemplateCount: number;
  contractCount: number;
  privacy: { label: string; publishedAt: Date; complete: boolean } | null;
}

interface OrganizationOverviewRow {
  id: string;
  name: string;
  slug: string;
  legal_name: string;
  seat_limit: number;
  active_seats: number;
  template_count: number;
  published_template_count: number;
  contract_count: number;
  privacy_label: string | null;
  privacy_published_at: Date | null;
  privacy_complete: boolean | null;
}

export async function listOrganizationsOverview(): Promise<OrganizationOverview[]> {
  const rows = await sql<OrganizationOverviewRow[]>`
    SELECT
      o.id, o.name, o.slug, o.legal_name, o.seat_limit,
      (SELECT COUNT(*)::int FROM organization_members m
        WHERE m.organization_id = o.id) AS active_seats,
      (SELECT COUNT(*)::int FROM contract_templates t
        WHERE t.organization_id = o.id) AS template_count,
      (SELECT COUNT(*)::int FROM contract_templates t
        JOIN contract_template_versions v
          ON v.template_id = t.id AND v.is_current
        WHERE t.organization_id = o.id) AS published_template_count,
      (SELECT COUNT(*)::int FROM contracts c
        WHERE c.organization_id = o.id) AS contract_count,
      p.label AS privacy_label,
      p.published_at AS privacy_published_at,
      (
        p.id IS NOT NULL
        AND btrim(p.full_markdown) <> ''
      ) AS privacy_complete
    FROM organizations o
    LEFT JOIN privacy_notice_versions p
      ON p.organization_id = o.id AND p.is_current
    ORDER BY o.name
  `;

  const entitlements = await sql<
    { organization_id: string; capability: Capability; enabled: boolean }[]
  >`SELECT organization_id, capability, enabled FROM commercial_entitlements`;

  return rows.map((row) => {
    const capabilities = { ...NO_CAPABILITIES };
    for (const item of entitlements) {
      if (
        item.organization_id === row.id &&
        (item.capability === "ai_review" || item.capability === "active_custody")
      ) {
        capabilities[item.capability] = item.enabled;
      }
    }
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      legalName: row.legal_name,
      seatLimit: row.seat_limit,
      activeSeats: row.active_seats,
      capabilities,
      templateCount: row.template_count,
      publishedTemplateCount: row.published_template_count,
      contractCount: row.contract_count,
      privacy:
        row.privacy_label && row.privacy_published_at
          ? {
              label: row.privacy_label,
              publishedAt: row.privacy_published_at,
              complete: row.privacy_complete === true,
            }
          : null,
    };
  });
}

export interface OrganizationOption {
  id: string;
  name: string;
}

export async function listOrganizationOptions(): Promise<OrganizationOption[]> {
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM organizations ORDER BY name
  `;
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export interface OrganizationMemberRow {
  memberId: string;
  accountId: string;
  fullName: string;
  email: string;
  roles: OrganizationRole[];
  isPrimaryAdmin: boolean;
  isPlatformAdmin: boolean;
  createdAt: Date;
}

export async function listOrganizationMembers(
  organizationId: string
): Promise<OrganizationMemberRow[]> {
  const rows = await sql<
    {
      member_id: string;
      account_id: string;
      full_name: string;
      email: string;
      roles: OrganizationRole[];
      is_primary_admin: boolean;
      is_platform_admin: boolean;
      created_at: Date;
    }[]
  >`
    SELECT m.id AS member_id, a.id AS account_id, a.full_name, a.email,
           m.roles, m.is_primary_admin, a.is_platform_admin, m.created_at
    FROM organization_members m
    JOIN accounts a ON a.id = m.account_id
    WHERE m.organization_id = ${organizationId}
    ORDER BY m.is_primary_admin DESC, a.full_name
  `;
  return rows.map((row) => ({
    memberId: row.member_id,
    accountId: row.account_id,
    fullName: row.full_name,
    email: row.email,
    roles: row.roles,
    isPrimaryAdmin: row.is_primary_admin,
    isPlatformAdmin: row.is_platform_admin,
    createdAt: row.created_at,
  }));
}

export interface OrganizationCounters {
  contracts: number;
  pending: number;
  inReview: number;
  accepted: number;
  coldPackages: number;
}

export async function getOrganizationCounters(
  organizationId: string
): Promise<OrganizationCounters> {
  const [row] = await sql<
    {
      contracts: number;
      pending: number;
      in_review: number;
      accepted: number;
      cold_packages: number;
    }[]
  >`
    SELECT
      COUNT(*)::int AS contracts,
      (COUNT(*) FILTER (WHERE status = 'pending'))::int AS pending,
      (COUNT(*) FILTER (WHERE status = 'in_review'))::int AS in_review,
      (COUNT(*) FILTER (WHERE status = 'accepted'))::int AS accepted,
      (SELECT COUNT(*)::int FROM cold_contract_packages p
        WHERE p.organization_id = ${organizationId}) AS cold_packages
    FROM contracts
    WHERE organization_id = ${organizationId}
  `;
  return {
    contracts: row?.contracts ?? 0,
    pending: row?.pending ?? 0,
    inReview: row?.in_review ?? 0,
    accepted: row?.accepted ?? 0,
    coldPackages: row?.cold_packages ?? 0,
  };
}

/** Escritura de capacidades contratadas: es configuración comercial, no jurídica. */
export async function setCapability(
  organizationId: string,
  capability: Capability,
  enabled: boolean
): Promise<void> {
  await sql`
    INSERT INTO commercial_entitlements (organization_id, capability, enabled, updated_at)
    VALUES (${organizationId}, ${capability}, ${enabled}, NOW())
    ON CONFLICT (organization_id, capability)
    DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
  `;
}

export async function organizationExists(organizationId: string): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM organizations WHERE id = ${organizationId}
  `;
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Soporte: diagnóstico de Contratos
// ---------------------------------------------------------------------------

export interface SupportSearchRow {
  id: string;
  reference: string;
  status: ContractStatus;
  classification: Classification;
  organizationId: string;
  organizationName: string;
  templateName: string;
  issuedAt: Date;
}

export async function searchContractsAcrossOrganizations(params: {
  query: string;
  organizationId?: string;
}): Promise<SupportSearchRow[]> {
  const query = params.query.trim();
  if (!query && !params.organizationId) return [];
  const pattern = `%${query}%`;
  const rows = await sql<
    {
      id: string;
      reference: string;
      status: ContractStatus;
      classification: Classification;
      organization_id: string;
      organization_name: string;
      template_name: string;
      issued_at: Date;
    }[]
  >`
    SELECT c.id, c.reference, c.status, c.classification,
           c.organization_id, o.name AS organization_name,
           c.template_name, c.issued_at
    FROM contracts c
    JOIN organizations o ON o.id = c.organization_id
    WHERE TRUE
      ${query ? sql`AND c.reference ILIKE ${pattern}` : sql``}
      ${
        params.organizationId
          ? sql`AND c.organization_id = ${params.organizationId}`
          : sql``
      }
    ORDER BY c.issued_at DESC
    LIMIT 50
  `;
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    status: row.status,
    classification: row.classification,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    templateName: row.template_name,
    issuedAt: row.issued_at,
  }));
}

export interface SupportParty {
  role: "holder" | "signer";
  personKind: "fisica" | "moral";
  name: string;
  rfc: string | null;
  email: string | null;
  phone: string | null;
}

export interface SupportAttempt {
  id: string;
  sequence: number;
  status: AttemptStatus;
  walkedAt: Date | null;
  submittedAt: Date | null;
  closedAt: Date | null;
  replacesAttemptId: string | null;
  createdAt: Date;
  evidence: { kind: EvidenceKind; sha256: string; byteSize: number }[];
}

export interface SupportLink {
  id: string;
  attemptId: string;
  expiresAt: Date;
  firstOpenedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  /** Vencimiento resuelto en la base para no depender del reloj del render. */
  expired: boolean;
}

export interface SupportEvent {
  id: string;
  type: string;
  actorKind: string;
  actorName: string;
  sensitive: boolean;
  attemptId: string | null;
  createdAt: Date;
}

export interface SupportDecision {
  id: string;
  decision: ReviewDecisionKind;
  reviewerName: string;
  reasonCode: string | null;
  reasonText: string | null;
  followedAiRecommendation: boolean | null;
  createdAt: Date;
}

export interface SupportAiReport {
  id: string;
  attemptId: string;
  model: string;
  status: "completed" | "failed";
  recommendation: string | null;
  confidence: string | null;
  createdAt: Date;
}

export interface SupportColdPackage {
  sha256: string;
  byteSize: number;
  tier: "immediate" | "cold";
  closedAt: Date;
  movedToColdAt: Date | null;
}

export interface SupportContractDetail {
  id: string;
  organizationId: string;
  organizationName: string;
  reference: string;
  status: ContractStatus;
  classification: Classification;
  templateId: string;
  templateName: string;
  templateLabel: string;
  templateVersionId: string;
  templateVersionHash: string;
  templateVersionPublishedAt: Date | null;
  privacyVersionId: string;
  privacyLabel: string;
  privacyHash: string;
  privacyPublishedAt: Date | null;
  documentHash: string;
  linkDays: number;
  requiresVideo: boolean;
  requiresIne: boolean;
  reviewPolicy: ReviewPolicy;
  customized: boolean;
  createdByName: string;
  issuedAt: Date;
  acceptedAt: Date | null;
  expiredAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  closedAt: Date | null;
  archivedAt: Date | null;
  deletedAt: Date | null;
  origin: {
    contractId: string;
    reference: string;
    organizationName: string;
    reason: string | null;
  } | null;
  successors: { id: string; reference: string; reason: string | null }[];
  parties: SupportParty[];
  attempts: SupportAttempt[];
  links: SupportLink[];
  events: SupportEvent[];
  decisions: SupportDecision[];
  aiReports: SupportAiReport[];
  coldPackage: SupportColdPackage | null;
}

export async function getSupportContractDetail(
  contractId: string
): Promise<SupportContractDetail | null> {
  const [row] = await sql<
    {
      id: string;
      organization_id: string;
      organization_name: string;
      reference: string;
      status: ContractStatus;
      classification: Classification;
      template_id: string;
      template_name: string;
      template_label: string;
      template_version_id: string;
      template_version_hash: string;
      template_version_published_at: Date | null;
      privacy_notice_version_id: string;
      privacy_label: string;
      privacy_hash: string;
      privacy_published_at: Date | null;
      document_hash: string;
      link_days: number;
      requires_video: boolean;
      requires_ine: boolean;
      review_policy: ReviewPolicy;
      customized: boolean;
      created_by_name: string;
      issued_at: Date;
      accepted_at: Date | null;
      expired_at: Date | null;
      cancelled_at: Date | null;
      cancel_reason: string | null;
      closed_at: Date | null;
      archived_at: Date | null;
      deleted_at: Date | null;
      origin_contract_id: string | null;
      origin_reason: string | null;
      origin_reference: string | null;
      origin_organization_name: string | null;
    }[]
  >`
    SELECT
      c.id, c.organization_id, o.name AS organization_name, c.reference, c.status,
      c.classification, c.template_id, c.template_name, c.template_label,
      c.template_version_id, tv.markdown_hash AS template_version_hash,
      tv.published_at AS template_version_published_at,
      c.privacy_notice_version_id, pn.label AS privacy_label,
      pn.notice_hash AS privacy_hash, pn.published_at AS privacy_published_at,
      c.document_hash, c.link_days, c.requires_video, c.requires_ine,
      c.review_policy, c.customized, c.created_by_name, c.issued_at, c.accepted_at,
      c.expired_at, c.cancelled_at, c.cancel_reason, c.closed_at, c.archived_at,
      c.deleted_at, c.origin_contract_id, c.origin_reason,
      origin.reference AS origin_reference,
      origin_org.name AS origin_organization_name
    FROM contracts c
    JOIN organizations o ON o.id = c.organization_id
    LEFT JOIN contract_template_versions tv ON tv.id = c.template_version_id
    LEFT JOIN privacy_notice_versions pn ON pn.id = c.privacy_notice_version_id
    LEFT JOIN contracts origin ON origin.id = c.origin_contract_id
    LEFT JOIN organizations origin_org ON origin_org.id = origin.organization_id
    WHERE c.id = ${contractId}
  `;
  if (!row) return null;

  const [
    successors,
    parties,
    attempts,
    evidence,
    links,
    events,
    decisions,
    aiReports,
    coldPackages,
  ] = await Promise.all([
    sql<{ id: string; reference: string; origin_reason: string | null }[]>`
      SELECT id, reference, origin_reason FROM contracts
      WHERE origin_contract_id = ${contractId}
      ORDER BY issued_at
    `,
    sql<
      {
        party_role: "holder" | "signer";
        person_kind: "fisica" | "moral";
        name: string;
        rfc: string | null;
        email: string | null;
        phone: string | null;
      }[]
    >`
      SELECT party_role, person_kind, name, rfc, email, phone
      FROM contract_parties WHERE contract_id = ${contractId}
      ORDER BY party_role DESC
    `,
    sql<
      {
        id: string;
        sequence: number;
        status: AttemptStatus;
        walked_at: Date | null;
        submitted_at: Date | null;
        closed_at: Date | null;
        replaces_attempt_id: string | null;
        created_at: Date;
      }[]
    >`
      SELECT id, sequence, status, walked_at, submitted_at, closed_at,
             replaces_attempt_id, created_at
      FROM acceptance_attempts WHERE contract_id = ${contractId}
      ORDER BY sequence
    `,
    sql<
      { attempt_id: string; kind: EvidenceKind; sha256: string; byte_size: number }[]
    >`
      SELECT attempt_id, kind, sha256, byte_size
      FROM evidence_items WHERE contract_id = ${contractId}
      ORDER BY created_at
    `,
    sql<
      {
        id: string;
        attempt_id: string;
        expires_at: Date;
        first_opened_at: Date | null;
        revoked_at: Date | null;
        created_at: Date;
        expired: boolean;
      }[]
    >`
      SELECT id, attempt_id, expires_at, first_opened_at, revoked_at, created_at,
             (expires_at <= NOW()) AS expired
      FROM contract_links WHERE contract_id = ${contractId}
      ORDER BY created_at
    `,
    sql<
      {
        id: string;
        type: string;
        actor_kind: string;
        actor_name: string;
        sensitive: boolean;
        attempt_id: string | null;
        created_at: Date;
      }[]
    >`
      SELECT id, type, actor_kind, actor_name, sensitive, attempt_id, created_at
      FROM contract_events WHERE contract_id = ${contractId}
      ORDER BY created_at
    `,
    sql<
      {
        id: string;
        decision: ReviewDecisionKind;
        reviewer_name: string;
        reason_code: string | null;
        reason_text: string | null;
        followed_ai_recommendation: boolean | null;
        created_at: Date;
      }[]
    >`
      SELECT id, decision, reviewer_name, reason_code, reason_text,
             followed_ai_recommendation, created_at
      FROM review_decisions WHERE contract_id = ${contractId}
      ORDER BY created_at
    `,
    sql<
      {
        id: string;
        attempt_id: string;
        model: string;
        status: "completed" | "failed";
        recommendation: string | null;
        confidence: string | null;
        created_at: Date;
      }[]
    >`
      SELECT id, attempt_id, model, status, recommendation, confidence, created_at
      FROM ai_review_reports WHERE contract_id = ${contractId}
      ORDER BY created_at
    `,
    sql<
      {
        sha256: string;
        byte_size: number;
        tier: "immediate" | "cold";
        closed_at: Date;
        moved_to_cold_at: Date | null;
      }[]
    >`
      SELECT sha256, byte_size, tier, closed_at, moved_to_cold_at
      FROM cold_contract_packages WHERE contract_id = ${contractId}
    `,
  ]);

  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    reference: row.reference,
    status: row.status,
    classification: row.classification,
    templateId: row.template_id,
    templateName: row.template_name,
    templateLabel: row.template_label,
    templateVersionId: row.template_version_id,
    templateVersionHash: row.template_version_hash,
    templateVersionPublishedAt: row.template_version_published_at,
    privacyVersionId: row.privacy_notice_version_id,
    privacyLabel: row.privacy_label,
    privacyHash: row.privacy_hash,
    privacyPublishedAt: row.privacy_published_at,
    documentHash: row.document_hash,
    linkDays: row.link_days,
    requiresVideo: row.requires_video,
    requiresIne: row.requires_ine,
    reviewPolicy: row.review_policy,
    customized: row.customized,
    createdByName: row.created_by_name,
    issuedAt: row.issued_at,
    acceptedAt: row.accepted_at,
    expiredAt: row.expired_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    closedAt: row.closed_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
    origin:
      row.origin_contract_id && row.origin_reference
        ? {
            contractId: row.origin_contract_id,
            reference: row.origin_reference,
            organizationName: row.origin_organization_name ?? "",
            reason: row.origin_reason,
          }
        : null,
    successors: successors.map((item) => ({
      id: item.id,
      reference: item.reference,
      reason: item.origin_reason,
    })),
    parties: parties.map((item) => ({
      role: item.party_role,
      personKind: item.person_kind,
      name: item.name,
      rfc: item.rfc,
      email: item.email,
      phone: item.phone,
    })),
    attempts: attempts.map((item) => ({
      id: item.id,
      sequence: item.sequence,
      status: item.status,
      walkedAt: item.walked_at,
      submittedAt: item.submitted_at,
      closedAt: item.closed_at,
      replacesAttemptId: item.replaces_attempt_id,
      createdAt: item.created_at,
      evidence: evidence
        .filter((entry) => entry.attempt_id === item.id)
        .map((entry) => ({
          kind: entry.kind,
          sha256: entry.sha256,
          byteSize: entry.byte_size,
        })),
    })),
    links: links.map((item) => ({
      id: item.id,
      attemptId: item.attempt_id,
      expiresAt: item.expires_at,
      firstOpenedAt: item.first_opened_at,
      revokedAt: item.revoked_at,
      createdAt: item.created_at,
      expired: item.expired,
    })),
    events: events.map((item) => ({
      id: item.id,
      type: item.type,
      actorKind: item.actor_kind,
      actorName: item.actor_name,
      sensitive: item.sensitive,
      attemptId: item.attempt_id,
      createdAt: item.created_at,
    })),
    decisions: decisions.map((item) => ({
      id: item.id,
      decision: item.decision,
      reviewerName: item.reviewer_name,
      reasonCode: item.reason_code,
      reasonText: item.reason_text,
      followedAiRecommendation: item.followed_ai_recommendation,
      createdAt: item.created_at,
    })),
    aiReports: aiReports.map((item) => ({
      id: item.id,
      attemptId: item.attempt_id,
      model: item.model,
      status: item.status,
      recommendation: item.recommendation,
      confidence: item.confidence,
      createdAt: item.created_at,
    })),
    coldPackage: coldPackages[0]
      ? {
          sha256: coldPackages[0].sha256,
          byteSize: coldPackages[0].byte_size,
          tier: coldPackages[0].tier,
          closedAt: coldPackages[0].closed_at,
          movedToColdAt: coldPackages[0].moved_to_cold_at,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Archivo Muerto (vista interna)
// ---------------------------------------------------------------------------

export type ColdPackageState =
  | "archived"
  | "in_progress"
  | "available"
  | "failed";

export const COLD_PACKAGE_STATE_LABELS: Record<ColdPackageState, string> = {
  archived: "Archivado",
  in_progress: "Recuperación en curso",
  available: "Disponible hasta",
  failed: "Recuperación fallida",
};

export interface ColdRecoveryState {
  contractId: string;
  contractStatus: ContractStatus;
  activeCustody: boolean;
  state: ColdPackageState;
  availableUntil: Date | null;
  lastRecoveryTier: "standard" | "bulk" | null;
  lastRecoveryAt: Date | null;
  lastRecoveryError: string | null;
}

function laterDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function isFuture(value: Date | null): boolean {
  return Boolean(value && new Date(value).getTime() > Date.now());
}

/**
 * Estados internos del paquete frío (ADR-0040, ADR-0081). Una copia temporal
 * vigente manda sobre un trabajo anterior fallido; una operación en curso manda
 * sobre todo lo demás.
 */
export async function listColdRecoveryStates(
  contractIds: string[]
): Promise<Map<string, ColdRecoveryState>> {
  const result = new Map<string, ColdRecoveryState>();
  if (contractIds.length === 0) return result;

  const rows = await sql<
    {
      contract_id: string;
      contract_status: ContractStatus;
      active_custody: boolean | null;
      recovery_status: string | null;
      job_available_until: Date | null;
      retrieval_tier: "standard" | "bulk" | null;
      recovery_error: string | null;
      recovery_created_at: Date | null;
      copy_available_until: Date | null;
    }[]
  >`
    SELECT
      c.id AS contract_id, c.status AS contract_status,
      ce.enabled AS active_custody,
      r.status AS recovery_status, r.available_until AS job_available_until,
      r.retrieval_tier, r.error AS recovery_error,
      r.created_at AS recovery_created_at,
      (SELECT MAX(co.expires_at) FROM contract_objects co
        WHERE co.contract_id = c.id AND co.kind = 'temporary_copy')
        AS copy_available_until
    FROM contracts c
    LEFT JOIN commercial_entitlements ce
      ON ce.organization_id = c.organization_id
     AND ce.capability = 'active_custody'
    LEFT JOIN LATERAL (
      SELECT status, available_until, retrieval_tier, error, created_at
      FROM recovery_jobs rj
      WHERE rj.contract_id = c.id
      ORDER BY rj.created_at DESC
      LIMIT 1
    ) r ON TRUE
    WHERE c.id = ANY(${contractIds}::uuid[])
  `;

  for (const row of rows) {
    const available = laterDate(
      isFuture(row.job_available_until) ? row.job_available_until : null,
      isFuture(row.copy_available_until) ? row.copy_available_until : null
    );
    let state: ColdPackageState = "archived";
    if (row.recovery_status === "queued" || row.recovery_status === "running") {
      state = "in_progress";
    } else if (available) {
      state = "available";
    } else if (row.recovery_status === "failed") {
      state = "failed";
    }
    result.set(row.contract_id, {
      contractId: row.contract_id,
      contractStatus: row.contract_status,
      activeCustody: row.active_custody === true,
      state,
      availableUntil: available,
      lastRecoveryTier: row.retrieval_tier,
      lastRecoveryAt: row.recovery_created_at,
      lastRecoveryError: row.recovery_error,
    });
  }
  return result;
}

export async function getColdPackageContext(contractId: string): Promise<{
  organizationId: string;
  organizationName: string;
  reference: string;
  activeCustody: boolean;
} | null> {
  const [row] = await sql<
    {
      organization_id: string;
      organization_name: string;
      reference: string;
      active_custody: boolean | null;
    }[]
  >`
    SELECT c.organization_id, o.name AS organization_name, c.reference,
           ce.enabled AS active_custody
    FROM contracts c
    JOIN organizations o ON o.id = c.organization_id
    LEFT JOIN commercial_entitlements ce
      ON ce.organization_id = c.organization_id AND ce.capability = 'active_custody'
    WHERE c.id = ${contractId}
  `;
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    reference: row.reference,
    activeCustody: row.active_custody === true,
  };
}

// ---------------------------------------------------------------------------
// Cuenta global: segundo factor
// ---------------------------------------------------------------------------

export interface AccountTotpState {
  enrolled: boolean;
  confirmedAt: Date | null;
  hasSecret: boolean;
}

export async function getAccountTotpState(
  accountId: string
): Promise<AccountTotpState> {
  const [row] = await sql<
    { totp_secret: string | null; totp_confirmed_at: Date | null }[]
  >`SELECT totp_secret, totp_confirmed_at FROM accounts WHERE id = ${accountId}`;
  return {
    // Misma definición que usa el acceso: si hay secreto, el segundo factor ya
    // protege la cuenta y volver a darlo de alta exige probar el código actual.
    enrolled: Boolean(row?.totp_secret),
    confirmedAt: row?.totp_confirmed_at ?? null,
    hasSecret: Boolean(row?.totp_secret),
  };
}

/** El secreto vive sólo en servidor; nunca se registra en auditoría. */
export async function readAccountTotpSecret(
  accountId: string
): Promise<string | null> {
  const [row] = await sql<{ totp_secret: string | null }[]>`
    SELECT totp_secret FROM accounts WHERE id = ${accountId}
  `;
  return row?.totp_secret ?? null;
}

export async function storeConfirmedTotpSecret(
  accountId: string,
  secret: string
): Promise<void> {
  await sql`
    UPDATE accounts
    SET totp_secret = ${secret}, totp_confirmed_at = NOW(), updated_at = NOW()
    WHERE id = ${accountId}
  `;
}
