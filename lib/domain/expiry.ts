import "server-only";
import { sql } from "@/lib/db";
import { enqueueJob, recordContractEvent } from "@/lib/domain/operations";

interface DueRow {
  attempt_id: string;
  contract_id: string;
  organization_id: string;
  reference: string;
  sequence: number;
  expires_at: Date;
}

/**
 * Vence los Contratos cuyo enlace caducó sin Intento enviado.
 * Un intento ya `A revisión` conserva sus evidencias y nunca se toca:
 * el vencimiento del enlace no cambia un intento que ya fue recibido.
 */
async function expireDue(contractId: string | null): Promise<number> {
  const due = await sql<DueRow[]>`
    SELECT a.id AS attempt_id, a.contract_id, a.organization_id,
           c.reference, a.sequence, l.expires_at
    FROM acceptance_attempts a
    JOIN contracts c ON c.id = a.contract_id
    JOIN contract_links l ON l.attempt_id = a.id
    WHERE a.status = 'open'
      AND a.submitted_at IS NULL
      AND c.status = 'pending'
      AND l.revoked_at IS NULL
      AND l.expires_at <= NOW()
      AND (${contractId}::uuid IS NULL OR c.id = ${contractId}::uuid)
  `;
  if (due.length === 0) return 0;

  let expired = 0;
  for (const row of due) {
    const changed = await sql.begin(async (tx) => {
      const attempts = await tx<{ id: string }[]>`
        UPDATE acceptance_attempts
        SET status = 'expired', closed_at = NOW()
        WHERE id = ${row.attempt_id}
          AND status = 'open'
          AND submitted_at IS NULL
        RETURNING id
      `;
      if (attempts.length === 0) return false;

      const contracts = await tx<{ id: string }[]>`
        UPDATE contracts
        SET status = 'expired', expired_at = NOW(), closed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${row.contract_id} AND status = 'pending'
        RETURNING id
      `;
      if (contracts.length === 0) return false;

      await recordContractEvent(
        {
          contractId: row.contract_id,
          organizationId: row.organization_id,
          attemptId: row.attempt_id,
          type: "enlace_vencido",
          actorKind: "system",
          actorName: "Sistema",
          payload: { secuencia: row.sequence },
        },
        tx
      );
      await recordContractEvent(
        {
          contractId: row.contract_id,
          organizationId: row.organization_id,
          attemptId: row.attempt_id,
          type: "contrato_vencido",
          actorKind: "system",
          actorName: "Sistema",
          payload: { referencia: row.reference },
        },
        tx
      );
      // Un Contrato vencido queda cerrado: su paquete se sella igual que uno aceptado.
      await enqueueJob(
        "seal_cold_package",
        { contractId: row.contract_id },
        { dedupeKey: `seal_cold_package:${row.contract_id}` },
        tx
      );
      return true;
    });
    if (changed) expired += 1;
  }
  return expired;
}

/** Barrido del worker sobre toda la plataforma. */
export async function expireDueLinks(): Promise<number> {
  return expireDue(null);
}

/** Lectura perezosa: el expediente y el recorrido no muestran datos rancios. */
export async function ensureContractFreshness(
  contractId: string
): Promise<void> {
  await expireDue(contractId);
}
