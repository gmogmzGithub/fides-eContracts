import "server-only";

import { sql } from "@/lib/db";
import type { OrganizationContext } from "@/lib/auth/guards";
import { requireRole } from "@/lib/auth/guards";
import {
  CONTRACT_ALERT_EVENT_TYPES,
  contractAlertMessage,
} from "@/lib/domain/alert-copy";

export interface ContractAlertItem {
  id: string;
  contractId: string;
  reference: string;
  eventType: string;
  message: string;
  createdAt: Date;
}

export async function listRecentContractAlerts(
  context: OrganizationContext,
  limit = 6
): Promise<ContractAlertItem[]> {
  requireRole(context, "administrator", "emitter");
  const safeLimit = Math.min(12, Math.max(1, Math.trunc(limit)));
  const rows = await sql<
    {
      id: string;
      contract_id: string;
      reference: string;
      type: string;
      created_at: Date;
    }[]
  >`
    SELECT event.id, event.contract_id, contract.reference,
           event.type, event.created_at
    FROM contract_events event
    JOIN contracts contract ON contract.id = event.contract_id
    WHERE event.organization_id = ${context.organization.id}
      AND event.type = ANY(${CONTRACT_ALERT_EVENT_TYPES}::text[])
      AND contract.classification <> 'deleted'
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT ${safeLimit}
  `;

  return rows.map((row) => ({
    id: row.id,
    contractId: row.contract_id,
    reference: row.reference,
    eventType: row.type,
    // El WHERE usa exactamente CONTRACT_ALERT_EVENT_TYPES, cuyas entradas
    // provienen del mismo mapa de mensajes.
    message: contractAlertMessage(row.type)!,
    createdAt: row.created_at,
  }));
}
