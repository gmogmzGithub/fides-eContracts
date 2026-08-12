import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { revokeAttemptLinks } from "@/lib/domain/attempts";
import { createDraft, issueContract, saveDraft } from "@/lib/domain/drafts";
import { ensureContractFreshness, expireDueLinks } from "@/lib/domain/expiry";
import {
  acceptContract,
  markContractWalked,
  loadSignerView,
} from "@/lib/domain/signer";
import type { ReviewPolicy } from "@/lib/domain/types";
import { createIssuableOrganization } from "@/tests/helpers/database";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Emite un Contrato por la ruta real: Borrador, guardado y `Generar enlace`. */
async function emitirContrato(options: { reviewPolicy?: ReviewPolicy } = {}) {
  const fixture = await createIssuableOrganization();
  const draftId = await createDraft(fixture.context, {
    templateId: fixture.template.id,
    holderId: fixture.holder.id,
    signerId: fixture.signer.id,
    prefill: { objeto: "Servicio sintético de prueba", monto: "1500" },
  });
  await saveDraft(fixture.context, draftId, {
    reviewPolicy: options.reviewPolicy ?? "none",
    linkDays: 7,
  });
  const issued = await issueContract(fixture.context, draftId);
  return { ...fixture, draftId, issued };
}

async function vencerEnlace(contractId: string): Promise<void> {
  await sql`
    UPDATE contract_links SET expires_at = NOW() - INTERVAL '1 hour'
    WHERE contract_id = ${contractId}
  `;
}

async function estadoContrato(contractId: string): Promise<{
  status: string;
  expired_at: Date | null;
  closed_at: Date | null;
}> {
  const [row] = await sql<
    { status: string; expired_at: Date | null; closed_at: Date | null }[]
  >`
    SELECT status, expired_at, closed_at FROM contracts WHERE id = ${contractId}
  `;
  return row;
}

async function estadoIntento(contractId: string): Promise<{
  status: string;
  closed_at: Date | null;
}> {
  const [row] = await sql<{ status: string; closed_at: Date | null }[]>`
    SELECT status, closed_at FROM acceptance_attempts
    WHERE contract_id = ${contractId} ORDER BY sequence DESC LIMIT 1
  `;
  return row;
}

/** Tipos de evento del expediente, ordenados alfabéticamente. */
async function tiposDeEvento(contractId: string): Promise<string[]> {
  const filas = await sql<{ type: string }[]>`
    SELECT type FROM contract_events
    WHERE contract_id = ${contractId} ORDER BY type ASC
  `;
  return filas.map((fila) => fila.type);
}

async function contarEventos(contractId: string, tipo: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT count(*)::TEXT AS total FROM contract_events
    WHERE contract_id = ${contractId} AND type = ${tipo}
  `;
  return Number(row.total);
}

async function attemptIdVigente(contractId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM acceptance_attempts
    WHERE contract_id = ${contractId} ORDER BY sequence DESC LIMIT 1
  `;
  return row.id;
}

// ---------------------------------------------------------------------------
// expireDueLinks
// ---------------------------------------------------------------------------

describe("expireDueLinks", () => {
  it("vence el Contrato pendiente cuyo enlace caducó sin Intento enviado", async () => {
    const escenario = await emitirContrato();
    const contractId = escenario.issued.contractId;
    await vencerEnlace(contractId);

    expect(await expireDueLinks()).toBe(1);

    const contrato = await estadoContrato(contractId);
    expect(contrato.status).toBe("expired");
    expect(contrato.expired_at).not.toBeNull();
    expect(contrato.closed_at).not.toBeNull();

    const intento = await estadoIntento(contractId);
    expect(intento.status).toBe("expired");
    expect(intento.closed_at).not.toBeNull();

    expect(await tiposDeEvento(contractId)).toEqual([
      "contrato_emitido",
      "contrato_vencido",
      "enlace_vencido",
    ]);

    const eventos = await sql<
      { type: string; actor_kind: string; payload: Record<string, unknown> }[]
    >`
      SELECT type, actor_kind, payload FROM contract_events
      WHERE contract_id = ${contractId}
        AND type IN ('enlace_vencido', 'contrato_vencido')
    `;
    const porTipo = new Map(eventos.map((fila) => [fila.type, fila]));
    expect(porTipo.get("enlace_vencido")?.actor_kind).toBe("system");
    expect(porTipo.get("enlace_vencido")?.payload).toEqual({ secuencia: 1 });
    expect(porTipo.get("contrato_vencido")?.payload).toEqual({
      referencia: escenario.issued.reference,
    });
  });

  it("no toca un Intento que ya está a revisión", async () => {
    const escenario = await emitirContrato({ reviewPolicy: "manual" });
    const contractId = escenario.issued.contractId;
    await markContractWalked(escenario.issued.token);
    await acceptContract(escenario.issued.token, { legendAccepted: true });
    await vencerEnlace(contractId);

    expect(await expireDueLinks()).toBe(0);
    expect((await estadoContrato(contractId)).status).toBe("in_review");
    expect((await estadoIntento(contractId)).status).toBe("in_review");
    expect(await contarEventos(contractId, "enlace_vencido")).toBe(0);

    const [{ total }] = await sql<{ total: string }[]>`
      SELECT count(*)::TEXT AS total FROM evidence_items
      WHERE contract_id = ${contractId}
    `;
    expect(total).toBe("1");
  });

  it("no toca un Contrato ya aceptado ni un enlace revocado", async () => {
    const aceptado = await emitirContrato();
    await markContractWalked(aceptado.issued.token);
    await acceptContract(aceptado.issued.token, { legendAccepted: true });
    await vencerEnlace(aceptado.issued.contractId);

    const revocado = await emitirContrato();
    await sql.begin(async (tx) => {
      await revokeAttemptLinks(
        tx,
        await attemptIdVigente(revocado.issued.contractId)
      );
      return true;
    });
    await vencerEnlace(revocado.issued.contractId);

    expect(await expireDueLinks()).toBe(0);
    expect((await estadoContrato(aceptado.issued.contractId)).status).toBe(
      "accepted"
    );
    expect((await estadoContrato(revocado.issued.contractId)).status).toBe(
      "pending"
    );
    expect((await estadoIntento(revocado.issued.contractId)).status).toBe(
      "open"
    );
  });

  it("vence una sola vez el Intento aunque tenga enlaces duplicados", async () => {
    const escenario = await emitirContrato();
    const contractId = escenario.issued.contractId;
    // Estado sintético: dos enlaces caducados sobre el mismo Intento.
    await sql`
      INSERT INTO contract_links (
        contract_id, attempt_id, token, token_hash, expires_at
      ) VALUES (
        ${contractId}, ${await attemptIdVigente(contractId)},
        'token-duplicado-sintetico', 'hash-duplicado-sintetico',
        NOW() - INTERVAL '1 hour'
      )
    `;
    await vencerEnlace(contractId);

    expect(await expireDueLinks()).toBe(1);
    expect(await contarEventos(contractId, "enlace_vencido")).toBe(1);
    expect(await contarEventos(contractId, "contrato_vencido")).toBe(1);
    expect((await estadoContrato(contractId)).status).toBe("expired");
  });

  it("no cuenta dos veces el Contrato cuando un segundo Intento llega tarde", async () => {
    const escenario = await emitirContrato();
    const contractId = escenario.issued.contractId;

    // Estado sintético: dos Intentos abiertos sobre el mismo Contrato, cada uno
    // con su enlace caducado. El primero en procesarse deja el Contrato en
    // `Vencido`; para el segundo la actualización condicional del Contrato ya
    // no encuentra fila `pending` y la carrera se pierde sin registrar eventos.
    const [tardio] = await sql<{ id: string }[]>`
      INSERT INTO acceptance_attempts (
        contract_id, organization_id, sequence, status
      ) VALUES (
        ${contractId}, ${escenario.organization.id}, 2, 'open'
      )
      RETURNING id
    `;
    await sql`
      INSERT INTO contract_links (
        contract_id, attempt_id, token, token_hash, expires_at
      ) VALUES (
        ${contractId}, ${tardio.id}, 'token-tardio-sintetico',
        'hash-tardio-sintetico', NOW() - INTERVAL '1 hour'
      )
    `;
    await vencerEnlace(contractId);

    expect(await expireDueLinks()).toBe(1);

    expect((await estadoContrato(contractId)).status).toBe("expired");
    expect(await contarEventos(contractId, "enlace_vencido")).toBe(1);
    expect(await contarEventos(contractId, "contrato_vencido")).toBe(1);

    const intentos = await sql<{ sequence: number; status: string }[]>`
      SELECT sequence, status FROM acceptance_attempts
      WHERE contract_id = ${contractId} ORDER BY sequence
    `;
    expect(intentos.map((fila) => fila.status)).toEqual(["expired", "expired"]);
  });

  it("no vence un enlace todavía vigente", async () => {
    const escenario = await emitirContrato();
    expect(await expireDueLinks()).toBe(0);
    expect((await estadoContrato(escenario.issued.contractId)).status).toBe(
      "pending"
    );
  });

  it("cuenta cada Contrato vencido y es idempotente al repetirse", async () => {
    const primero = await emitirContrato();
    const segundo = await emitirContrato();
    const vigente = await emitirContrato();
    await vencerEnlace(primero.issued.contractId);
    await vencerEnlace(segundo.issued.contractId);

    expect(await expireDueLinks()).toBe(2);
    expect(await expireDueLinks()).toBe(0);
    expect(await expireDueLinks()).toBe(0);

    for (const contractId of [
      primero.issued.contractId,
      segundo.issued.contractId,
    ]) {
      expect((await estadoContrato(contractId)).status).toBe("expired");
      expect(await contarEventos(contractId, "enlace_vencido")).toBe(1);
      expect(await contarEventos(contractId, "contrato_vencido")).toBe(1);
    }
    expect((await estadoContrato(vigente.issued.contractId)).status).toBe(
      "pending"
    );
  });
});

// ---------------------------------------------------------------------------
// ensureContractFreshness
// ---------------------------------------------------------------------------

describe("ensureContractFreshness", () => {
  it("vence sólo el Contrato indicado", async () => {
    const objetivo = await emitirContrato();
    const otro = await emitirContrato();
    await vencerEnlace(objetivo.issued.contractId);
    await vencerEnlace(otro.issued.contractId);

    await ensureContractFreshness(objetivo.issued.contractId);

    expect((await estadoContrato(objetivo.issued.contractId)).status).toBe(
      "expired"
    );
    expect((await estadoContrato(otro.issued.contractId)).status).toBe(
      "pending"
    );

    expect(await expireDueLinks()).toBe(1);
    expect((await estadoContrato(otro.issued.contractId)).status).toBe(
      "expired"
    );
  });

  it("no cambia nada cuando el enlace sigue vigente", async () => {
    const escenario = await emitirContrato();
    await ensureContractFreshness(escenario.issued.contractId);

    expect((await estadoContrato(escenario.issued.contractId)).status).toBe(
      "pending"
    );
    expect(await tiposDeEvento(escenario.issued.contractId)).toEqual([
      "contrato_emitido",
    ]);
  });

  it("es idempotente aunque el recorrido la invoque varias veces", async () => {
    const escenario = await emitirContrato();
    const contractId = escenario.issued.contractId;
    await vencerEnlace(contractId);

    // La lectura perezosa del recorrido dispara el vencimiento.
    expect(await loadSignerView(escenario.issued.token)).toEqual({
      ok: false,
      reason: "expired",
    });
    await ensureContractFreshness(contractId);
    await ensureContractFreshness(contractId);

    expect(await contarEventos(contractId, "enlace_vencido")).toBe(1);
    expect(await contarEventos(contractId, "contrato_vencido")).toBe(1);
    expect((await estadoIntento(contractId)).status).toBe("expired");
  });
});
