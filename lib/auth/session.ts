import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { createOpaqueToken, hashToken } from "@/lib/crypto/tokens";
import type { OrganizationRole } from "@/lib/domain/types";

export const SESSION_COOKIE = "fides_session";
const SESSION_HOURS = 12;

export interface SessionAccount {
  accountId: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
  isLegalPublisher: boolean;
  totpEnrolled: boolean;
  totpSatisfied: boolean;
  sessionId: string;
  activeOrganizationId: string | null;
}

export interface Membership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  roles: OrganizationRole[];
  isPrimaryAdmin: boolean;
}

export async function createSession(
  accountId: string,
  totpSatisfied: boolean
): Promise<string> {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  // Sólo se preselecciona cuando hay exactamente una membresía: con varias, la
  // persona elige la Organización al entrar (ADR-0025).
  const memberships = await sql<{ organization_id: string }[]>`
    SELECT organization_id FROM organization_members WHERE account_id = ${accountId}
  `;
  const membership = memberships.length === 1 ? memberships[0] : undefined;
  await sql`
    INSERT INTO sessions (account_id, token_hash, expires_at, totp_satisfied, active_organization_id)
    VALUES (
      ${accountId}, ${hashToken(token)}, ${expiresAt}, ${totpSatisfied},
      ${membership?.organization_id ?? null}
    )
  `;
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.FIDES_INSECURE_COOKIES !== "true",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function markTotpSatisfied(sessionId: string): Promise<void> {
  await sql`UPDATE sessions SET totp_satisfied = TRUE WHERE id = ${sessionId}`;
}

export const getSessionAccount = cache(async function getSessionAccount(): Promise<SessionAccount | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await sql<
    {
      session_id: string;
      account_id: string;
      email: string;
      full_name: string;
      is_platform_admin: boolean;
      is_legal_publisher: boolean;
      totp_secret: string | null;
      totp_satisfied: boolean;
      active_organization_id: string | null;
    }[]
  >`
    SELECT
      s.id AS session_id,
      a.id AS account_id,
      a.email,
      a.full_name,
      a.is_platform_admin,
      a.is_legal_publisher,
      a.totp_secret,
      s.totp_satisfied,
      s.active_organization_id
    FROM sessions s
    JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ${hashToken(token)}
      AND s.revoked_at IS NULL
      AND s.expires_at > NOW()
  `;
  if (!row) return null;
  return {
    accountId: row.account_id,
    email: row.email,
    fullName: row.full_name,
    isPlatformAdmin: row.is_platform_admin,
    isLegalPublisher: row.is_legal_publisher,
    totpEnrolled: Boolean(row.totp_secret),
    totpSatisfied: row.totp_satisfied,
    sessionId: row.session_id,
    activeOrganizationId: row.active_organization_id,
  };
});

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await sql`UPDATE sessions SET revoked_at = NOW() WHERE token_hash = ${hashToken(token)}`;
  }
  store.delete(SESSION_COOKIE);
}

export async function revokeAccountSessions(
  accountId: string,
  organizationId?: string
): Promise<void> {
  if (organizationId) {
    await sql`
      UPDATE sessions SET revoked_at = NOW()
      WHERE account_id = ${accountId}
        AND revoked_at IS NULL
        AND (active_organization_id = ${organizationId} OR active_organization_id IS NULL)
    `;
    return;
  }
  await sql`UPDATE sessions SET revoked_at = NOW() WHERE account_id = ${accountId} AND revoked_at IS NULL`;
}

export const listMemberships = cache(async function listMemberships(
  accountId: string
): Promise<Membership[]> {
  const rows = await sql<
    {
      organization_id: string;
      name: string;
      slug: string;
      roles: OrganizationRole[];
      is_primary_admin: boolean;
    }[]
  >`
    SELECT m.organization_id, o.name, o.slug, m.roles, m.is_primary_admin
    FROM organization_members m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.account_id = ${accountId}
    ORDER BY o.name
  `;
  return rows.map((row) => ({
    organizationId: row.organization_id,
    organizationName: row.name,
    organizationSlug: row.slug,
    roles: row.roles,
    isPrimaryAdmin: row.is_primary_admin,
  }));
});

export async function setActiveOrganization(
  sessionId: string,
  organizationId: string
): Promise<void> {
  await sql`
    UPDATE sessions SET active_organization_id = ${organizationId} WHERE id = ${sessionId}
  `;
}
