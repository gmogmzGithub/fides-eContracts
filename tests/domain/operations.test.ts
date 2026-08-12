import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { createDraft, issueContract, saveDraft } from "@/lib/domain/drafts";
import {
  enqueueJob,
  enqueueNotification,
  recordAudit,
  recordContractEvent,
  type Executor,
  type JobKind,
} from "@/lib/domain/operations";
import {
  createAccount,
  createIssuableOrganization,
  createOrganization,
} from "@/tests/helpers/database";

// ---------------------------------------------------------------------------
// Arnés mínimo: las cuatro operaciones sólo necesitan claves foráneas reales.
// ---------------------------------------------------------------------------

interface Basics {
  organizationId: string;
  accountId: string;
}

async function basics(): Promise<Basics> {
  const organization = await createOrganization();
  const account = await createAccount();
  return { organizationId: organization.id, accountId: account.id };
}

interface ContractBasics extends Basics {
  contractId: string;
  attemptId: string;
}

/** Un Contrato emitido por el camino real, para las claves foráneas. */
async function issuedContract(): Promise<ContractBasics> {
  const fixture = await createIssuableOrganization();
  const draftId = await createDraft(fixture.context, {
    templateId: fixture.template.id,
  });
  await saveDraft(fixture.context, draftId, {
    holderId: fixture.holder.id,
    signerId: fixture.signer.id,
    fieldValues: { objeto: "Servicio sintético", monto: "100" },
  });
  const issued = await issueContract(fixture.context, draftId);
  const [attempt] = await sql<{ id: string }[]>`
    SELECT id FROM acceptance_attempts WHERE contract_id = ${issued.contractId}
  `;
  return {
    organizationId: fixture.organization.id,
    accountId: fixture.account.id,
    contractId: issued.contractId,
    attemptId: attempt.id,
  };
}

async function payloadKind(
  table:
    | "audit_entries"
    | "contract_events"
    | "notification_outbox"
    | "background_jobs",
  id: string
): Promise<string> {
  const [row] = await sql<{ tipo: string }[]>`
    SELECT jsonb_typeof(payload) AS tipo FROM ${sql(table)} WHERE id = ${id}
  `;
  return row.tipo;
}

// ---------------------------------------------------------------------------
// recordAudit
// ---------------------------------------------------------------------------

describe("recordAudit", () => {
  it("conserva actor, capacidad, sujeto y carga útil", async () => {
    const { organizationId, accountId } = await basics();
    await recordAudit({
      organizationId,
      accountId,
      actorName: "Persona Revisora",
      actorKind: "platform",
      capability: "administrator+reviewer",
      action: "review.conclude",
      subjectType: "contract",
      subjectId: "AC-2026-000001",
      payload: { referencia: "AC-2026-000001", intentos: 2 },
    });

    const [row] = await sql<
      {
        id: string;
        organization_id: string | null;
        account_id: string | null;
        actor_name: string;
        actor_kind: string;
        capability: string | null;
        action: string;
        subject_type: string;
        subject_id: string | null;
        payload: Record<string, unknown>;
        created_at: Date;
      }[]
    >`SELECT * FROM audit_entries`;

    expect(row.organization_id).toBe(organizationId);
    expect(row.account_id).toBe(accountId);
    expect(row.actor_name).toBe("Persona Revisora");
    expect(row.actor_kind).toBe("platform");
    expect(row.capability).toBe("administrator+reviewer");
    expect(row.action).toBe("review.conclude");
    expect(row.subject_type).toBe("contract");
    expect(row.subject_id).toBe("AC-2026-000001");
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.payload).toEqual({
      referencia: "AC-2026-000001",
      intentos: 2,
    });
  });

  it("guarda la carga útil como objeto JSON y no como cadena", async () => {
    const { organizationId } = await basics();
    await recordAudit({
      organizationId,
      action: "prueba.objeto",
      payload: {
        texto: "con \"comillas\" y acentos: ñ",
        anidado: { lista: [1, 2, 3], verdadero: true },
      },
    });

    const [row] = await sql<{ id: string; payload: unknown }[]>`
      SELECT id, payload FROM audit_entries
    `;
    expect(await payloadKind("audit_entries", row.id)).toBe("object");
    expect(typeof row.payload).toBe("object");
    expect(row.payload).toEqual({
      texto: 'con "comillas" y acentos: ñ',
      anidado: { lista: [1, 2, 3], verdadero: true },
    });

    const [leido] = await sql<{ texto: string; primero: string }[]>`
      SELECT payload->>'texto' AS texto,
             payload#>>'{anidado,lista,0}' AS primero
      FROM audit_entries WHERE id = ${row.id}
    `;
    expect(leido.texto).toBe('con "comillas" y acentos: ñ');
    expect(leido.primero).toBe("1");
  });

  it("aplica valores mínimos cuando sólo llega la acción", async () => {
    await recordAudit({ action: "acceso.intento" });

    const [row] = await sql<
      {
        id: string;
        organization_id: string | null;
        account_id: string | null;
        actor_name: string;
        actor_kind: string;
        capability: string | null;
        subject_type: string;
        subject_id: string | null;
        payload: Record<string, unknown>;
      }[]
    >`SELECT * FROM audit_entries`;

    expect(row.organization_id).toBeNull();
    expect(row.account_id).toBeNull();
    expect(row.actor_name).toBe("");
    expect(row.actor_kind).toBe("member");
    expect(row.capability).toBeNull();
    expect(row.subject_type).toBe("");
    expect(row.subject_id).toBeNull();
    expect(row.payload).toEqual({});
    expect(await payloadKind("audit_entries", row.id)).toBe("object");
  });

  it("acepta nulos explícitos en Organización y Cuenta", async () => {
    await recordAudit({
      organizationId: null,
      accountId: null,
      capability: null,
      subjectId: null,
      action: "plataforma.sin_organizacion",
    });
    const [row] = await sql<{ organization_id: string | null }[]>`
      SELECT organization_id FROM audit_entries
    `;
    expect(row.organization_id).toBeNull();
  });

  it("funciona dentro de una transacción y se revierte con ella", async () => {
    const { organizationId } = await basics();

    await sql.begin(async (tx) => {
      await recordAudit(
        { organizationId, action: "dentro.de.transaccion" },
        tx
      );
      return true;
    });

    await expect(
      sql.begin(async (tx) => {
        await recordAudit({ organizationId, action: "revertida" }, tx);
        throw new Error("revertir");
      })
    ).rejects.toThrow("revertir");

    const acciones = await sql<{ action: string; id: string }[]>`
      SELECT action, id FROM audit_entries
    `;
    expect(acciones.map((row) => row.action)).toEqual([
      "dentro.de.transaccion",
    ]);
    expect(await payloadKind("audit_entries", acciones[0].id)).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// recordContractEvent
// ---------------------------------------------------------------------------

describe("recordContractEvent", () => {
  it("encola una alerta por cada canal habilitado con texto honesto", async () => {
    const base = await issuedContract();
    await sql`
      UPDATE organization_settings
      SET alert_email_enabled = TRUE,
          alert_email_recipient = 'alertas@example.test',
          alert_whatsapp_enabled = TRUE,
          alert_whatsapp_recipient = '+523312345678'
      WHERE organization_id = ${base.organizationId}
    `;

    await recordContractEvent({
      contractId: base.contractId,
      organizationId: base.organizationId,
      attemptId: base.attemptId,
      type: "enlace_abierto",
      actorKind: "signer",
    });

    const rows = await sql<
      {
        channel: string;
        recipient: string;
        template: string;
        dedupe_key: string;
        payload: {
          reference: string;
          message: string;
          eventType: string;
          eventId: string;
          portalPath: string;
        };
      }[]
    >`
      SELECT channel, recipient, template, dedupe_key, payload
      FROM notification_outbox
      ORDER BY channel
    `;

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.channel, row.recipient])).toEqual([
      ["email", "alertas@example.test"],
      ["whatsapp", "+523312345678"],
    ]);
    for (const row of rows) {
      expect(row.template).toBe("actividad_contractual");
      expect(row.dedupe_key).toMatch(/^contract-alert:.+:(email|whatsapp)$/);
      expect(row.payload.message).toBe("Fue abierto");
      expect(row.payload.eventType).toBe("enlace_abierto");
      expect(row.payload.eventId).toBeTruthy();
      expect(row.payload.portalPath).toBe(`/app/contratos/${base.contractId}`);
      expect(row.payload.reference).toMatch(/^AC-/);
    }
  });

  it("conserva Contrato, Intento, actor, sensibilidad y carga útil", async () => {
    const base = await issuedContract();
    await recordContractEvent({
      contractId: base.contractId,
      organizationId: base.organizationId,
      attemptId: base.attemptId,
      type: "prueba_evento",
      actorKind: "signer",
      actorId: base.accountId,
      actorName: "Persona Firmante",
      sensitive: true,
      payload: { categoria: "video", bytes: 1024 },
    });

    const [row] = await sql<
      {
        id: string;
        contract_id: string;
        organization_id: string;
        attempt_id: string | null;
        type: string;
        actor_kind: string;
        actor_id: string | null;
        actor_name: string;
        sensitive: boolean;
        payload: Record<string, unknown>;
        created_at: Date;
      }[]
    >`SELECT * FROM contract_events WHERE type = 'prueba_evento'`;

    expect(row.contract_id).toBe(base.contractId);
    expect(row.organization_id).toBe(base.organizationId);
    expect(row.attempt_id).toBe(base.attemptId);
    expect(row.actor_kind).toBe("signer");
    expect(row.actor_id).toBe(base.accountId);
    expect(row.actor_name).toBe("Persona Firmante");
    expect(row.sensitive).toBe(true);
    expect(row.payload).toEqual({ categoria: "video", bytes: 1024 });
    expect(row.created_at).toBeInstanceOf(Date);
    expect(await payloadKind("contract_events", row.id)).toBe("object");
  });

  it("aplica valores mínimos y nunca marca sensible por omisión", async () => {
    const base = await issuedContract();
    await recordContractEvent({
      contractId: base.contractId,
      organizationId: base.organizationId,
      type: "prueba_minima",
      actorKind: "system",
    });

    const [row] = await sql<
      {
        id: string;
        attempt_id: string | null;
        actor_id: string | null;
        actor_name: string;
        sensitive: boolean;
        payload: Record<string, unknown>;
      }[]
    >`SELECT * FROM contract_events WHERE type = 'prueba_minima'`;

    expect(row.attempt_id).toBeNull();
    expect(row.actor_id).toBeNull();
    expect(row.actor_name).toBe("");
    expect(row.sensitive).toBe(false);
    expect(row.payload).toEqual({});
    expect(await payloadKind("contract_events", row.id)).toBe("object");
  });

  it("guarda la carga útil como objeto JSON dentro de una transacción", async () => {
    const base = await issuedContract();
    await sql.begin(async (tx) => {
      await recordContractEvent(
        {
          contractId: base.contractId,
          organizationId: base.organizationId,
          type: "prueba_transaccion",
          actorKind: "member",
          payload: { lista: ["a", "b"], numero: 3.5 },
        },
        tx
      );
      return true;
    });

    const [row] = await sql<{ id: string; payload: unknown }[]>`
      SELECT id, payload FROM contract_events WHERE type = 'prueba_transaccion'
    `;
    expect(await payloadKind("contract_events", row.id)).toBe("object");
    expect(row.payload).toEqual({ lista: ["a", "b"], numero: 3.5 });
  });

  it("se revierte junto con su transacción", async () => {
    const base = await issuedContract();
    await expect(
      sql.begin(async (tx) => {
        await recordContractEvent(
          {
            contractId: base.contractId,
            organizationId: base.organizationId,
            type: "prueba_revertida",
            actorKind: "member",
          },
          tx
        );
        throw new Error("revertir");
      })
    ).rejects.toThrow("revertir");

    const [row] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM contract_events
      WHERE type = 'prueba_revertida'
    `;
    expect(row.total).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// enqueueNotification
// ---------------------------------------------------------------------------

describe("enqueueNotification", () => {
  it("deja la notificación pendiente en el outbox", async () => {
    const { organizationId } = await basics();
    await enqueueNotification({
      organizationId,
      channel: "whatsapp",
      recipient: "revisor@example.invalid",
      template: "alerta_revision_ai",
      payload: { revisor: "Persona", referencia: "AC-2026-000001" },
      dedupeKey: "ai_repeat:intento:cuenta",
    });

    const [row] = await sql<
      {
        id: string;
        organization_id: string | null;
        channel: string;
        recipient: string;
        template: string;
        payload: Record<string, unknown>;
        dedupe_key: string | null;
        status: string;
        attempts: number;
        last_error: string | null;
        available_at: Date;
        delivered_at: Date | null;
      }[]
    >`SELECT * FROM notification_outbox`;

    expect(row.organization_id).toBe(organizationId);
    expect(row.channel).toBe("whatsapp");
    expect(row.recipient).toBe("revisor@example.invalid");
    expect(row.template).toBe("alerta_revision_ai");
    expect(row.dedupe_key).toBe("ai_repeat:intento:cuenta");
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBeNull();
    expect(row.delivered_at).toBeNull();
    expect(row.available_at).toBeInstanceOf(Date);
    expect(row.payload).toEqual({
      revisor: "Persona",
      referencia: "AC-2026-000001",
    });
    expect(await payloadKind("notification_outbox", row.id)).toBe("object");
  });

  it("una llave de deduplicación repetida no hace nada", async () => {
    const { organizationId } = await basics();
    const entrada = {
      organizationId,
      channel: "whatsapp" as const,
      recipient: "revisor@example.invalid",
      template: "alerta_revision_ai",
      payload: { intento: 1 },
      dedupeKey: "misma-llave",
    };
    await enqueueNotification(entrada);
    await enqueueNotification({
      ...entrada,
      recipient: "otra@example.invalid",
      payload: { intento: 2 },
    });

    const filas = await sql<
      { recipient: string; payload: Record<string, unknown> }[]
    >`SELECT recipient, payload FROM notification_outbox`;
    expect(filas).toHaveLength(1);
    expect(filas[0].recipient).toBe("revisor@example.invalid");
    expect(filas[0].payload).toEqual({ intento: 1 });
  });

  it("sin llave de deduplicación admite varias filas", async () => {
    await enqueueNotification({
      channel: "email",
      recipient: "uno@example.invalid",
      template: "invitacion",
    });
    await enqueueNotification({
      channel: "email",
      recipient: "dos@example.invalid",
      template: "invitacion",
    });

    const filas = await sql<
      { organization_id: string | null; dedupe_key: string | null; payload: unknown }[]
    >`SELECT organization_id, dedupe_key, payload FROM notification_outbox`;
    expect(filas).toHaveLength(2);
    expect(filas.every((row) => row.dedupe_key === null)).toBe(true);
    expect(filas.every((row) => row.organization_id === null)).toBe(true);
    expect(filas.every((row) => JSON.stringify(row.payload) === "{}")).toBe(
      true
    );
  });

  it("funciona con el ejecutor de una transacción y se revierte con ella", async () => {
    const { organizationId } = await basics();
    await sql.begin(async (tx) => {
      await enqueueNotification(
        {
          organizationId,
          channel: "email",
          recipient: "dentro@example.invalid",
          template: "aviso",
          payload: { origen: "transaccion" },
          dedupeKey: "dentro",
        },
        tx
      );
      return true;
    });

    await expect(
      sql.begin(async (tx) => {
        await enqueueNotification(
          {
            organizationId,
            channel: "email",
            recipient: "fuera@example.invalid",
            template: "aviso",
            dedupeKey: "fuera",
          },
          tx
        );
        throw new Error("revertir");
      })
    ).rejects.toThrow("revertir");

    const filas = await sql<{ id: string; recipient: string }[]>`
      SELECT id, recipient FROM notification_outbox
    `;
    expect(filas.map((row) => row.recipient)).toEqual([
      "dentro@example.invalid",
    ]);
    expect(await payloadKind("notification_outbox", filas[0].id)).toBe(
      "object"
    );
  });
});

// ---------------------------------------------------------------------------
// enqueueJob
// ---------------------------------------------------------------------------

describe("enqueueJob", () => {
  it("encola el trabajo con su carga útil, llave y momento de ejecución", async () => {
    const runAfter = new Date(Date.now() + 3_600_000);
    await enqueueJob(
      "seal_cold_package",
      { contractId: "c-1", intentos: [1, 2] },
      { dedupeKey: "seal_cold_package:c-1", runAfter }
    );

    const [row] = await sql<
      {
        id: string;
        kind: string;
        payload: Record<string, unknown>;
        dedupe_key: string | null;
        status: string;
        attempts: number;
        last_error: string | null;
        run_after: Date;
        completed_at: Date | null;
      }[]
    >`SELECT * FROM background_jobs`;

    expect(row.kind).toBe("seal_cold_package");
    expect(row.dedupe_key).toBe("seal_cold_package:c-1");
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBeNull();
    expect(row.completed_at).toBeNull();
    expect(row.run_after.getTime()).toBeCloseTo(runAfter.getTime(), -3);
    expect(row.payload).toEqual({ contractId: "c-1", intentos: [1, 2] });
    expect(await payloadKind("background_jobs", row.id)).toBe("object");
  });

  it("sin opciones queda disponible de inmediato y sin llave", async () => {
    const antes = Date.now();
    await enqueueJob("ai_review", { attemptId: "a-1" });

    const [row] = await sql<
      { id: string; dedupe_key: string | null; run_after: Date }[]
    >`SELECT id, dedupe_key, run_after FROM background_jobs`;
    expect(row.dedupe_key).toBeNull();
    expect(row.run_after.getTime()).toBeGreaterThanOrEqual(antes - 2000);
    expect(row.run_after.getTime()).toBeLessThanOrEqual(Date.now() + 2000);
    expect(await payloadKind("background_jobs", row.id)).toBe("object");
  });

  it("una llave de deduplicación repetida no encola otro trabajo", async () => {
    await enqueueJob("export", { primero: true }, { dedupeKey: "export:1" });
    await enqueueJob("export", { primero: false }, { dedupeKey: "export:1" });

    const filas = await sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM background_jobs
    `;
    expect(filas).toHaveLength(1);
    expect(filas[0].payload).toEqual({ primero: true });
  });

  it("admite cada categoría de trabajo del dominio", async () => {
    const kinds: JobKind[] = [
      "ai_review",
      "seal_cold_package",
      "recovery",
      "export",
      "move_to_cold",
    ];
    for (const kind of kinds) {
      await enqueueJob(kind, { kind }, { dedupeKey: `${kind}:1` });
    }
    const filas = await sql<{ kind: string }[]>`
      SELECT kind FROM background_jobs ORDER BY kind ASC
    `;
    expect(filas.map((row) => row.kind)).toEqual([...kinds].sort());
  });

  it("funciona con el ejecutor de una transacción y se revierte con ella", async () => {
    await sql.begin(async (tx) => {
      await enqueueJob(
        "move_to_cold",
        { contractId: "c-2" },
        { dedupeKey: "move_to_cold:c-2" },
        tx
      );
      return true;
    });

    await expect(
      sql.begin(async (tx) => {
        await enqueueJob("recovery", { contractId: "c-3" }, {}, tx);
        throw new Error("revertir");
      })
    ).rejects.toThrow("revertir");

    const filas = await sql<{ id: string; kind: string }[]>`
      SELECT id, kind FROM background_jobs
    `;
    expect(filas.map((row) => row.kind)).toEqual(["move_to_cold"]);
    expect(await payloadKind("background_jobs", filas[0].id)).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// Contrato compartido de las cuatro operaciones
// ---------------------------------------------------------------------------

describe("carga útil de las operaciones", () => {
  it("las cuatro escrituras aceptan la raíz y el ejecutor de transacción", async () => {
    const base = await issuedContract();

    async function escribir(executor: Executor, sufijo: string): Promise<void> {
      await recordAudit(
        {
          organizationId: base.organizationId,
          action: `operacion.${sufijo}`,
          payload: { sufijo },
        },
        executor
      );
      await recordContractEvent(
        {
          contractId: base.contractId,
          organizationId: base.organizationId,
          type: `evento_${sufijo}`,
          actorKind: "system",
          payload: { sufijo },
        },
        executor
      );
      await enqueueNotification(
        {
          organizationId: base.organizationId,
          channel: "email",
          recipient: `${sufijo}@example.invalid`,
          template: "aviso",
          payload: { sufijo },
          dedupeKey: `aviso:${sufijo}`,
        },
        executor
      );
      await enqueueJob(
        "export",
        { sufijo },
        { dedupeKey: `export:${sufijo}` },
        executor
      );
    }

    await escribir(sql, "raiz");
    await sql.begin(async (tx) => {
      await escribir(tx, "transaccion");
      return true;
    });

    const [tipos] = await sql<
      {
        auditorias: string;
        eventos: string;
        notificaciones: string;
        trabajos: string;
      }[]
    >`
      SELECT
        (SELECT COUNT(*)::text FROM audit_entries
          WHERE jsonb_typeof(payload) = 'object'
            AND action LIKE 'operacion.%') AS auditorias,
        (SELECT COUNT(*)::text FROM contract_events
          WHERE jsonb_typeof(payload) = 'object'
            AND type LIKE 'evento_%') AS eventos,
        (SELECT COUNT(*)::text FROM notification_outbox
          WHERE jsonb_typeof(payload) = 'object') AS notificaciones,
        (SELECT COUNT(*)::text FROM background_jobs
          WHERE jsonb_typeof(payload) = 'object') AS trabajos
    `;
    expect(tipos.auditorias).toBe("2");
    expect(tipos.eventos).toBe("2");
    expect(tipos.notificaciones).toBe("2");
    expect(tipos.trabajos).toBe("2");

    // Ninguna carga útil quedó como cadena doblemente codificada.
    const [cadenas] = await sql<{ total: string }[]>`
      SELECT (
        (SELECT COUNT(*) FROM audit_entries WHERE jsonb_typeof(payload) = 'string') +
        (SELECT COUNT(*) FROM contract_events WHERE jsonb_typeof(payload) = 'string') +
        (SELECT COUNT(*) FROM notification_outbox WHERE jsonb_typeof(payload) = 'string') +
        (SELECT COUNT(*) FROM background_jobs WHERE jsonb_typeof(payload) = 'string')
      )::text AS total
    `;
    expect(cadenas.total).toBe("0");
  });
});
