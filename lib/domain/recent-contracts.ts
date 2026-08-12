import "server-only";

import { sql } from "@/lib/db";
import type { OrganizationContext } from "@/lib/auth/guards";
import { requireRole, usedCapability } from "@/lib/auth/guards";
import { NotFoundError } from "@/lib/domain/errors";
import { recordAudit } from "@/lib/domain/operations";
import type { ContractStatus } from "@/lib/domain/types";

export interface RecentContract {
  id: string;
  reference: string;
  templateName: string;
  holderName: string;
  signerName: string;
  status: ContractStatus;
  issuedAt: Date;
  updatedAt: Date;
  favorite: boolean;
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export interface RecentContractOptions {
  /** Sólo los Favoritos personales de quien consulta. */
  onlyFavorites?: boolean;
  limit?: number;
}

/**
 * Contratos que un Emisor puede reutilizar. Los favoritos personales aparecen
 * primero y despues manda la actividad mas reciente.
 *
 * `onlyFavorites` cambia el `LEFT JOIN` por un `JOIN` en vez de filtrar después:
 * así la consulta arranca desde `contract_favorites_account_idx` y cada variante
 * conserva su propio plan preparado.
 */
export async function listRecentContracts(
  context: OrganizationContext,
  query = "",
  { onlyFavorites = false, limit = 24 }: RecentContractOptions = {}
): Promise<RecentContract[]> {
  requireRole(context, "administrator", "emitter");
  const cleanQuery = query.trim();
  const pattern = cleanQuery ? likePattern(cleanQuery) : null;
  const rows = await sql<
    {
      id: string;
      reference: string;
      template_name: string;
      holder_name: string | null;
      signer_name: string | null;
      status: ContractStatus;
      issued_at: Date;
      updated_at: Date;
      favorite: boolean;
    }[]
  >`
    SELECT c.id, c.reference, c.template_name,
           h.name AS holder_name, s.name AS signer_name,
           c.status, c.issued_at, c.updated_at,
           (favorite.contract_id IS NOT NULL) AS favorite
    FROM contracts c
    LEFT JOIN contract_parties h
      ON h.contract_id = c.id AND h.party_role = 'holder'
    LEFT JOIN contract_parties s
      ON s.contract_id = c.id AND s.party_role = 'signer'
    ${onlyFavorites ? sql`JOIN` : sql`LEFT JOIN`} contract_favorites favorite
      ON favorite.contract_id = c.id
     AND favorite.account_id = ${context.account.accountId}
     AND favorite.organization_id = ${context.organization.id}
    WHERE c.organization_id = ${context.organization.id}
      AND c.classification <> 'deleted'
      AND (${pattern}::text IS NULL
           OR c.reference ILIKE ${pattern}
           OR c.search_text ILIKE ${pattern}
           OR COALESCE(h.name, '') ILIKE ${pattern}
           OR COALESCE(s.name, '') ILIKE ${pattern})
    ORDER BY (favorite.contract_id IS NOT NULL) DESC,
             GREATEST(c.updated_at, c.issued_at) DESC,
             c.issued_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    templateName: row.template_name,
    holderName: row.holder_name ?? "",
    signerName: row.signer_name ?? "",
    status: row.status,
    issuedAt: row.issued_at,
    updatedAt: row.updated_at,
    favorite: row.favorite,
  }));
}

export async function setContractFavorite(
  context: OrganizationContext,
  contractId: string,
  favorite: boolean
): Promise<void> {
  requireRole(context, "administrator", "emitter");

  if (favorite) {
    const result = await sql`
      INSERT INTO contract_favorites (organization_id, contract_id, account_id)
      SELECT c.organization_id, c.id, ${context.account.accountId}
      FROM contracts c
      WHERE c.id = ${contractId}
        AND c.organization_id = ${context.organization.id}
        AND c.classification <> 'deleted'
      ON CONFLICT (contract_id, account_id) DO NOTHING
    `;
    if (result.count === 0) {
      const [exists] = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM contract_favorites
          WHERE contract_id = ${contractId}
            AND account_id = ${context.account.accountId}
            AND organization_id = ${context.organization.id}
        ) AS exists
      `;
      if (!exists?.exists) throw new NotFoundError("No encontramos ese Contrato.");
    }
  } else {
    const exists = await sql`
      DELETE FROM contract_favorites favorite
      USING contracts c
      WHERE favorite.contract_id = c.id
        AND favorite.contract_id = ${contractId}
        AND favorite.account_id = ${context.account.accountId}
        AND favorite.organization_id = ${context.organization.id}
        AND c.organization_id = ${context.organization.id}
    `;
    if (exists.count === 0) {
      const [contract] = await sql<{ id: string }[]>`
        SELECT id FROM contracts
        WHERE id = ${contractId} AND organization_id = ${context.organization.id}
      `;
      if (!contract) throw new NotFoundError("No encontramos ese Contrato.");
    }
  }

  await recordAudit({
    organizationId: context.organization.id,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    capability: usedCapability(context),
    action: favorite ? "contrato_marcado_favorito" : "contrato_desmarcado_favorito",
    subjectType: "contract",
    subjectId: contractId,
  });
}
