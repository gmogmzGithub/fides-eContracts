import "server-only";
import { sql, type Transaction } from "@/lib/db";
import { signerUrl } from "@/lib/app-url";
import { createOpaqueToken, hashToken } from "@/lib/crypto/tokens";

export interface IssuedLink {
  attemptId: string;
  linkId: string;
  token: string;
  url: string;
  expiresAt: Date;
}

export interface CurrentLink {
  token: string;
  url: string;
  expiresAt: Date;
  revoked: boolean;
}

export interface AttemptSummary {
  id: string;
  sequence: number;
  status: string;
  walkedAt: Date | null;
  submittedAt: Date | null;
  closedAt: Date | null;
  replacesAttemptId: string | null;
  createdAt: Date;
}

const MIN_LINK_DAYS = 1;
const MAX_LINK_DAYS = 30;

function normalizeLinkDays(value: number): number {
  if (!Number.isFinite(value)) return 7;
  return Math.min(MAX_LINK_DAYS, Math.max(MIN_LINK_DAYS, Math.trunc(value)));
}

/**
 * Crea el Intento de aceptación siguiente del Contrato y su enlace opaco.
 * El token vive en claro en servidor para que la Organización pueda
 * `Copiar enlace`; el hash es la única llave de búsqueda del Firmante.
 */
export async function createAttemptWithLink(
  tx: Transaction,
  params: {
    contractId: string;
    organizationId: string;
    linkDays: number;
    replacesAttemptId?: string | null;
  }
): Promise<IssuedLink> {
  const linkDays = normalizeLinkDays(params.linkDays);

  const [attempt] = await tx<{ id: string }[]>`
    INSERT INTO acceptance_attempts (
      contract_id, organization_id, sequence, status, replaces_attempt_id
    ) VALUES (
      ${params.contractId},
      ${params.organizationId},
      (
        SELECT COALESCE(MAX(sequence), 0) + 1
        FROM acceptance_attempts
        WHERE contract_id = ${params.contractId}
      ),
      'open',
      ${params.replacesAttemptId ?? null}
    )
    RETURNING id
  `;

  const token = createOpaqueToken();
  const [link] = await tx<{ id: string; expires_at: Date }[]>`
    INSERT INTO contract_links (
      contract_id, attempt_id, token, token_hash, expires_at
    ) VALUES (
      ${params.contractId}, ${attempt.id}, ${token}, ${hashToken(token)},
      NOW() + make_interval(days => ${linkDays}::int)
    )
    RETURNING id, expires_at
  `;

  return {
    attemptId: attempt.id,
    linkId: link.id,
    token,
    url: signerUrl(token),
    expiresAt: link.expires_at,
  };
}

/** Repetir proceso y cancelar invalidan cualquier acceso restante del enlace. */
export async function revokeAttemptLinks(
  tx: Transaction,
  attemptId: string
): Promise<void> {
  await tx`
    UPDATE contract_links
    SET revoked_at = NOW()
    WHERE attempt_id = ${attemptId} AND revoked_at IS NULL
  `;
}

export async function currentLink(
  contractId: string
): Promise<CurrentLink | null> {
  const [row] = await sql<
    { token: string; expires_at: Date; revoked_at: Date | null }[]
  >`
    SELECT l.token, l.expires_at, l.revoked_at
    FROM contract_links l
    JOIN acceptance_attempts a ON a.id = l.attempt_id
    WHERE l.contract_id = ${contractId}
      AND l.revoked_at IS NULL
      AND l.expires_at > NOW()
    ORDER BY a.sequence DESC, l.created_at DESC
    LIMIT 1
  `;
  if (!row) return null;
  return {
    token: row.token,
    url: signerUrl(row.token),
    expiresAt: row.expires_at,
    revoked: row.revoked_at !== null,
  };
}

export async function listAttempts(
  contractId: string
): Promise<AttemptSummary[]> {
  const rows = await sql<
    {
      id: string;
      sequence: number;
      status: string;
      walked_at: Date | null;
      submitted_at: Date | null;
      closed_at: Date | null;
      replaces_attempt_id: string | null;
      created_at: Date;
    }[]
  >`
    SELECT id, sequence, status, walked_at, submitted_at, closed_at,
           replaces_attempt_id, created_at
    FROM acceptance_attempts
    WHERE contract_id = ${contractId}
    ORDER BY sequence ASC
  `;
  return rows.map((row) => ({
    id: row.id,
    sequence: row.sequence,
    status: row.status,
    walkedAt: row.walked_at,
    submittedAt: row.submitted_at,
    closedAt: row.closed_at,
    replacesAttemptId: row.replaces_attempt_id,
    createdAt: row.created_at,
  }));
}
