import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { AuthorizationError } from "@/lib/domain/errors";
import type {
  Capability,
  OrganizationRole,
  ReviewPolicy,
} from "@/lib/domain/types";
import {
  getSessionAccount,
  listMemberships,
  type Membership,
  type SessionAccount,
} from "@/lib/auth/session";

export interface OrganizationProfile {
  id: string;
  name: string;
  slug: string;
  legalName: string;
  seatLimit: number;
  capabilities: Record<Capability, boolean>;
  defaults: {
    operationalVersion: number;
    linkDays: number;
    requiresVideo: boolean;
    requiresIne: boolean;
    reviewPolicy: ReviewPolicy;
  };
}

export interface OrganizationContext {
  account: SessionAccount;
  membership: Membership;
  organization: OrganizationProfile;
  memberships: Membership[];
}

/** Cuenta autenticada; las cuentas globales deben haber resuelto su TOTP. */
export const requireAccount = cache(async function requireAccount(): Promise<SessionAccount> {
  const account = await getSessionAccount();
  if (!account) redirect("/acceso");
  if (account.isPlatformAdmin && account.totpEnrolled && !account.totpSatisfied) {
    redirect("/acceso/totp");
  }
  return account;
});

export async function requirePlatformAdmin(): Promise<SessionAccount> {
  const account = await requireAccount();
  if (!account.isPlatformAdmin) redirect("/app");
  return account;
}

export const loadOrganizationProfile = cache(
  async (organizationId: string): Promise<OrganizationProfile> => {
    // Una sola ida a la base: identidad, capacidades y valores predeterminados.
    const [organization] = await sql<
      {
        id: string;
        name: string;
        slug: string;
        legal_name: string;
        seat_limit: number;
        capabilities: { capability: Capability; enabled: boolean }[] | null;
        operational_version: number | null;
        default_link_days: number | null;
        default_requires_video: boolean | null;
        default_requires_ine: boolean | null;
        default_review_policy: ReviewPolicy | null;
      }[]
    >`
      SELECT o.id, o.name, o.slug, o.legal_name, o.seat_limit,
             c.capabilities,
             s.operational_version, s.default_link_days,
             s.default_requires_video, s.default_requires_ine,
             s.default_review_policy
      FROM organizations o
      LEFT JOIN organization_settings s ON s.organization_id = o.id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('capability', e.capability,
                                            'enabled', e.enabled)) AS capabilities
        FROM commercial_entitlements e
        WHERE e.organization_id = o.id
      ) c ON TRUE
      WHERE o.id = ${organizationId}
    `;
    if (!organization) throw new AuthorizationError();

    const capabilities: Record<Capability, boolean> = {
      ai_review: false,
      active_custody: false,
      // Servicio base universal: no dependen de un acuerdo comercial.
      evidence_video: true,
      evidence_ine: true,
    };
    for (const row of organization.capabilities ?? []) {
      if (row.capability === "ai_review" || row.capability === "active_custody") {
        capabilities[row.capability] = row.enabled;
      }
    }

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      legalName: organization.legal_name,
      seatLimit: organization.seat_limit,
      capabilities,
      defaults: {
        operationalVersion: organization.operational_version ?? 1,
        linkDays: organization.default_link_days ?? 7,
        requiresVideo: organization.default_requires_video ?? false,
        requiresIne: organization.default_requires_ine ?? false,
        reviewPolicy: organization.default_review_policy ?? "none",
      },
    };
  }
);

/**
 * Resuelve la Organización activa en servidor. Nunca se confía en un
 * `organization_id` enviado por el navegador como única autorización.
 */
export const requireOrganizationContext = cache(
  async function requireOrganizationContext(): Promise<OrganizationContext> {
  const account = await requireAccount();
  const memberships = await listMemberships(account.accountId);
  if (memberships.length === 0) {
    if (account.isPlatformAdmin) redirect("/plataforma");
    redirect("/acceso/sin-acceso");
  }
  const membership =
    memberships.find(
      (item) => item.organizationId === account.activeOrganizationId
    ) ?? (memberships.length === 1 ? memberships[0] : undefined);
  if (!membership) redirect("/app/organizaciones");

  return {
    account,
    membership,
    organization: await loadOrganizationProfile(membership.organizationId),
    memberships,
  };
});

export function hasRole(
  context: OrganizationContext,
  role: OrganizationRole
): boolean {
  return context.membership.roles.includes(role);
}

export function requireRole(
  context: OrganizationContext,
  ...roles: OrganizationRole[]
): void {
  if (!roles.some((role) => context.membership.roles.includes(role))) {
    throw new AuthorizationError();
  }
}

/** Sólo Administradores y Revisores abren INE, video u otra evidencia sensible. */
export function canOpenSensitiveEvidence(context: OrganizationContext): boolean {
  return hasRole(context, "administrator") || hasRole(context, "reviewer");
}

export function usedCapability(context: OrganizationContext): string {
  return context.membership.roles.join("+");
}
