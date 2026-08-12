import "server-only";
import type { Transaction } from "@/lib/db";

const TIME_ZONE = "America/Mexico_City";

const DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Día operativo en la zona horaria del piloto, como `YYYY-MM-DD`. */
export function referenceDay(now: Date = new Date()): string {
  return DAY_FORMATTER.format(now);
}

export function formatReference(day: string, value: number): string {
  return `AC-${day.replace(/-/g, "")}-${String(value).padStart(4, "0")}`;
}

/**
 * Referencia `AC-YYYYMMDD-NNNN`. La secuencia es atómica por Organización y
 * día: el `INSERT … ON CONFLICT DO UPDATE` toma el bloqueo de la fila, así que
 * dos emisiones simultáneas nunca reciben el mismo consecutivo.
 */
export async function nextReference(
  tx: Transaction,
  organizationId: string
): Promise<string> {
  const day = referenceDay();
  const [row] = await tx<{ last_value: number }[]>`
    INSERT INTO contract_reference_sequences (organization_id, day, last_value)
    VALUES (${organizationId}, ${day}::date, 1)
    ON CONFLICT (organization_id, day)
      DO UPDATE SET last_value = contract_reference_sequences.last_value + 1
    RETURNING last_value
  `;
  return formatReference(day, row.last_value);
}
