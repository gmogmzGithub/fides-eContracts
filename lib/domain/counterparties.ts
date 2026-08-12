import "server-only";
import { sql } from "@/lib/db";
import type { OrganizationContext } from "@/lib/auth/guards";
import { hasRole, requireRole, usedCapability } from "@/lib/auth/guards";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "@/lib/domain/errors";
import type { Executor } from "@/lib/domain/operations";
import { recordAudit } from "@/lib/domain/operations";

export type PersonKind = "fisica" | "moral";

export interface Counterparty {
  id: string;
  organizationId: string;
  personKind: PersonKind;
  name: string;
  rfc: string;
  email: string;
  phone: string;
  address: string;
  /** Cargo o facultades con las que comparece. */
  position: string;
  active: boolean;
  createdAt: Date;
}

export interface CounterpartyInput {
  personKind: PersonKind;
  name: string;
  rfc?: string;
  email?: string;
  phone?: string;
  address?: string;
  position?: string;
}

export type DraftParty = "holder" | "signer";

interface CounterpartyRow {
  id: string;
  organization_id: string;
  person_kind: PersonKind;
  name: string;
  rfc: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  position: string | null;
  active: boolean;
  created_at: Date;
}

function toCounterparty(row: CounterpartyRow): Counterparty {
  return {
    id: row.id,
    organizationId: row.organization_id,
    personKind: row.person_kind,
    name: row.name,
    rfc: row.rfc ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    address: row.address ?? "",
    position: row.position ?? "",
    active: row.active,
    createdAt: row.created_at,
  };
}

/** Fragmento nuevo en cada llamada: postgres.js no reutiliza fragmentos. */
function columns() {
  return sql`
    id, organization_id, person_kind, name, rfc, email, phone, address,
    position, active, created_at
  `;
}

function clean(value: string | undefined | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\b(sa de cv|sapi de cv|s a de c v|sa|sc|srl|cv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validate(input: CounterpartyInput): void {
  if (!input.name.trim()) {
    throw new ConflictError("La contraparte necesita nombre o razón social.");
  }
  if (input.personKind !== "fisica" && input.personKind !== "moral") {
    throw new ConflictError("Elige si es persona física o moral.");
  }
  const email = clean(input.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ConflictError("El correo de la contraparte no es válido.");
  }
}

async function insertCounterparty(
  context: OrganizationContext,
  input: CounterpartyInput,
  executor: Executor
): Promise<CounterpartyRow> {
  const [row] = await executor<CounterpartyRow[]>`
    INSERT INTO counterparties (
      organization_id, person_kind, name, rfc, email, phone, address,
      position, created_by
    ) VALUES (
      ${context.organization.id}, ${input.personKind}, ${input.name.trim()},
      ${clean(input.rfc)}, ${clean(input.email)}, ${clean(input.phone)},
      ${clean(input.address)}, ${clean(input.position)},
      ${context.account.accountId}
    )
    RETURNING ${columns()}
  `;
  return row;
}

async function auditCounterpartyCreated(
  context: OrganizationContext,
  row: CounterpartyRow,
  executor: Executor,
  draft?: { id: string; party: DraftParty }
): Promise<void> {
  await recordAudit(
    {
      organizationId: context.organization.id,
      accountId: context.account.accountId,
      actorName: context.account.fullName,
      capability: usedCapability(context),
      action: "contraparte_creada",
      subjectType: "counterparty",
      subjectId: row.id,
      payload: {
        name: row.name,
        personKind: row.person_kind,
        ...(draft ? { draftId: draft.id, party: draft.party } : {}),
      },
    },
    executor
  );
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Directorio compartido de la Organización; nunca hay libretas personales. */
export async function listCounterparties(
  organizationId: string,
  options: {
    query?: string;
    includeInactive?: boolean;
    personKind?: PersonKind;
  } = {},
  executor: Executor = sql
): Promise<Counterparty[]> {
  const query = (options.query ?? "").trim();
  const pattern = query ? `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = await executor<CounterpartyRow[]>`
    SELECT ${columns()}
    FROM counterparties
    WHERE organization_id = ${organizationId}
      AND (${options.includeInactive ?? false}::boolean OR active)
      AND (${options.personKind ?? null}::text IS NULL
           OR person_kind = ${options.personKind ?? null})
      AND (${pattern}::text IS NULL
           OR name ILIKE ${pattern}
           OR COALESCE(rfc, '') ILIKE ${pattern}
           OR COALESCE(email, '') ILIKE ${pattern}
           OR COALESCE(phone, '') ILIKE ${pattern})
    ORDER BY active DESC, lower(name)
    LIMIT 200
  `;
  return rows.map(toCounterparty);
}

export async function getCounterparty(
  organizationId: string,
  id: string,
  executor: Executor = sql
): Promise<Counterparty | null> {
  const [row] = await executor<CounterpartyRow[]>`
    SELECT ${columns()}
    FROM counterparties
    WHERE organization_id = ${organizationId} AND id = ${id}
  `;
  return row ? toCounterparty(row) : null;
}

/**
 * Posibles duplicados: la plataforma sólo advierte. Nunca fusiona registros ni
 * bloquea el flujo por semejanza de nombres (ADR-0071).
 */
export async function findPossibleDuplicates(
  organizationId: string,
  name: string
): Promise<Counterparty[]> {
  const normalized = normalizeName(name);
  if (normalized.length < 3) return [];
  const words = normalized.split(" ").filter((word) => word.length >= 3);
  const anchor = words.sort((a, b) => b.length - a.length)[0] ?? normalized;
  // El prefiltro compara sin acentos de los dos lados: el nombre buscado ya
  // viene normalizado y el guardado se transcribe en SQL, para que `Café Aéreo`
  // y `Cafe Aereo` se adviertan mutuamente.
  const rows = await sql<CounterpartyRow[]>`
    SELECT ${columns()}
    FROM counterparties
    WHERE organization_id = ${organizationId}
      AND translate(
            lower(name),
            'áàäâãéèëêíìïîóòöôõúùüûýÿçñ',
            'aaaaaeeeeiiiiooooouuuuyycn'
          ) LIKE ${`%${anchor}%`}
    ORDER BY active DESC, lower(name)
    LIMIT 50
  `;
  return rows
    .map(toCounterparty)
    .filter((candidate) => {
      const other = normalizeName(candidate.name);
      return (
        other === normalized ||
        other.includes(normalized) ||
        normalized.includes(other)
      );
    })
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

export async function createCounterparty(
  context: OrganizationContext,
  input: CounterpartyInput
): Promise<Counterparty> {
  requireRole(context, "administrator", "emitter");
  validate(input);
  return sql.begin(async (tx) => {
    const row = await insertCounterparty(context, input, tx);
    await auditCounterpartyCreated(context, row, tx);
    return toCounterparty(row);
  });
}

/**
 * Alta rápida dentro de Capturar datos. El candado del Borrador comparte la
 * misma frontera de serialización que `issueContract`: o la contraparte queda
 * creada, asignada y auditada, o la transacción no deja ningún registro.
 */
export async function createAndAssignDraftCounterparty(
  context: OrganizationContext,
  draftId: string,
  party: DraftParty,
  input: CounterpartyInput
): Promise<Counterparty> {
  requireRole(context, "emitter");
  validate(input);
  if (party !== "holder" && party !== "signer") {
    throw new ConflictError("Elige qué parte contractual quieres registrar.");
  }

  return sql.begin(async (tx) => {
    const [draft] = await tx<
      {
        id: string;
        created_by: string | null;
        classification: string;
        issued_contract_id: string | null;
      }[]
    >`
      SELECT id, created_by, classification, issued_contract_id
      FROM contract_drafts
      WHERE organization_id = ${context.organization.id} AND id = ${draftId}
      FOR UPDATE
    `;
    if (!draft) throw new NotFoundError("No encontramos ese Borrador.");
    if (draft.created_by !== context.account.accountId) {
      throw new AuthorizationError("Este Borrador pertenece a otro Emisor.");
    }
    if (draft.issued_contract_id) {
      throw new ConflictError("Este Borrador ya se emitió como Contrato.");
    }
    if (draft.classification !== "active") {
      throw new ConflictError("Este Borrador está en Eliminados.");
    }

    const row = await insertCounterparty(context, input, tx);
    if (party === "holder") {
      await tx`
        UPDATE contract_drafts
        SET holder_counterparty_id = ${row.id}, updated_at = NOW()
        WHERE id = ${draft.id}
      `;
    } else {
      await tx`
        UPDATE contract_drafts
        SET signer_counterparty_id = ${row.id}, updated_at = NOW()
        WHERE id = ${draft.id}
      `;
    }
    await auditCounterpartyCreated(context, row, tx, {
      id: draft.id,
      party,
    });
    return toCounterparty(row);
  });
}

export async function updateCounterparty(
  context: OrganizationContext,
  id: string,
  input: CounterpartyInput
): Promise<Counterparty> {
  requireRole(context, "administrator", "emitter");
  validate(input);
  const organizationId = context.organization.id;
  const before = await getCounterparty(organizationId, id);
  if (!before) throw new NotFoundError("No encontramos esa contraparte.");

  const [row] = await sql<CounterpartyRow[]>`
    UPDATE counterparties SET
      person_kind = ${input.personKind},
      name = ${input.name.trim()},
      rfc = ${clean(input.rfc)},
      email = ${clean(input.email)},
      phone = ${clean(input.phone)},
      address = ${clean(input.address)},
      position = ${clean(input.position)},
      updated_at = NOW()
    WHERE organization_id = ${organizationId} AND id = ${id}
    RETURNING ${columns()}
  `;
  const after = toCounterparty(row);
  const changed: Record<string, { antes: string; ahora: string }> = {};
  for (const key of [
    "personKind",
    "name",
    "rfc",
    "email",
    "phone",
    "address",
    "position",
  ] as const) {
    if (before[key] !== after[key]) {
      changed[key] = { antes: String(before[key]), ahora: String(after[key]) };
    }
  }
  // Corregir el directorio nunca toca un Contrato ya emitido: sólo afecta
  // selecciones futuras (ADR-0071).
  await recordAudit({
    organizationId,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    capability: usedCapability(context),
    action: "contraparte_actualizada",
    subjectType: "counterparty",
    subjectId: id,
    payload: { changed },
  });
  return after;
}

/** Sólo un Administrador desactiva; la desactivación no altera Contratos. */
export async function setCounterpartyActive(
  context: OrganizationContext,
  id: string,
  active: boolean
): Promise<void> {
  requireRole(context, "administrator");
  const organizationId = context.organization.id;
  const result = await sql`
    UPDATE counterparties SET active = ${active}, updated_at = NOW()
    WHERE organization_id = ${organizationId} AND id = ${id}
  `;
  if (result.count === 0) {
    throw new NotFoundError("No encontramos esa contraparte.");
  }
  await recordAudit({
    organizationId,
    accountId: context.account.accountId,
    actorName: context.account.fullName,
    capability: usedCapability(context),
    action: active ? "contraparte_reactivada" : "contraparte_desactivada",
    subjectType: "counterparty",
    subjectId: id,
  });
}

export function canManageCounterparties(context: OrganizationContext): boolean {
  return hasRole(context, "administrator") || hasRole(context, "emitter");
}
