import { describe, expect, it } from "vitest";
import { appUrl } from "@/lib/app-url";
import { sql } from "@/lib/db";
import { hashToken } from "@/lib/crypto/tokens";
import {
  createAttemptWithLink,
  currentLink,
  listAttempts,
  revokeAttemptLinks,
  type IssuedLink,
} from "@/lib/domain/attempts";
import { createDraft, issueContract, saveDraft } from "@/lib/domain/drafts";
import { loadSignerView } from "@/lib/domain/signer";
import type { ReviewPolicy } from "@/lib/domain/types";
import { createIssuableOrganization } from "@/tests/helpers/database";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

interface EmisionOptions {
  reviewPolicy?: ReviewPolicy;
  linkDays?: number;
}

/** Emite un Contrato por la ruta real: Borrador, guardado y `Generar enlace`. */
async function emitirContrato(options: EmisionOptions = {}) {
  const fixture = await createIssuableOrganization();
  const draftId = await createDraft(fixture.context, {
    templateId: fixture.template.id,
    holderId: fixture.holder.id,
    signerId: fixture.signer.id,
    prefill: { objeto: "Servicio sintético de prueba", monto: "1500" },
  });
  await saveDraft(fixture.context, draftId, {
    reviewPolicy: options.reviewPolicy ?? "none",
    linkDays: options.linkDays ?? 7,
  });
  const issued = await issueContract(fixture.context, draftId);
  return { ...fixture, draftId, issued };
}

async function crearIntento(params: {
  contractId: string;
  organizationId: string;
  linkDays: number;
  replacesAttemptId?: string | null;
}): Promise<IssuedLink> {
  return sql.begin(async (tx) => createAttemptWithLink(tx, params));
}

async function revocar(attemptId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await revokeAttemptLinks(tx, attemptId);
    return true;
  });
}

/** Días completos entre la creación del enlace y su vencimiento. */
async function diasDeVigencia(linkId: string): Promise<number> {
  const [row] = await sql<{ dias: string }[]>`
    SELECT EXTRACT(EPOCH FROM (expires_at - created_at)) / 86400 AS dias
    FROM contract_links WHERE id = ${linkId}
  `;
  return Math.round(Number(row.dias));
}

async function attemptIdInicial(contractId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM acceptance_attempts
    WHERE contract_id = ${contractId} ORDER BY sequence ASC LIMIT 1
  `;
  return row.id;
}

// ---------------------------------------------------------------------------
// createAttemptWithLink
// ---------------------------------------------------------------------------

describe("createAttemptWithLink", () => {
  it("incrementa la secuencia y referencia al Intento que reemplaza", async () => {
    const escenario = await emitirContrato();
    const contractId = escenario.issued.contractId;
    const primero = await attemptIdInicial(contractId);

    const segundo = await crearIntento({
      contractId,
      organizationId: escenario.organization.id,
      linkDays: 7,
      replacesAttemptId: primero,
    });
    const tercero = await crearIntento({
      contractId,
      organizationId: escenario.organization.id,
      linkDays: 7,
      replacesAttemptId: segundo.attemptId,
    });

    const intentos = await sql<
      {
        id: string;
        sequence: number;
        status: string;
        replaces_attempt_id: string | null;
      }[]
    >`
      SELECT id, sequence, status, replaces_attempt_id
      FROM acceptance_attempts
      WHERE contract_id = ${contractId} ORDER BY sequence ASC
    `;
    expect(intentos).toEqual([
      {
        id: primero,
        sequence: 1,
        status: "open",
        replaces_attempt_id: null,
      },
      {
        id: segundo.attemptId,
        sequence: 2,
        status: "open",
        replaces_attempt_id: primero,
      },
      {
        id: tercero.attemptId,
        sequence: 3,
        status: "open",
        replaces_attempt_id: segundo.attemptId,
      },
    ]);
  });

  it("guarda el token en claro y su hash como única llave de búsqueda", async () => {
    const escenario = await emitirContrato();
    const enlace = await crearIntento({
      contractId: escenario.issued.contractId,
      organizationId: escenario.organization.id,
      linkDays: 7,
    });

    const [fila] = await sql<
      {
        token: string;
        token_hash: string;
        contract_id: string;
        attempt_id: string;
        revoked_at: Date | null;
        first_opened_at: Date | null;
      }[]
    >`
      SELECT token, token_hash, contract_id, attempt_id, revoked_at,
             first_opened_at
      FROM contract_links WHERE id = ${enlace.linkId}
    `;
    expect(fila.token).toBe(enlace.token);
    expect(fila.token_hash).toBe(hashToken(enlace.token));
    expect(fila.token_hash).not.toBe(enlace.token);
    expect(fila.contract_id).toBe(escenario.issued.contractId);
    expect(fila.attempt_id).toBe(enlace.attemptId);
    expect(fila.revoked_at).toBeNull();
    expect(fila.first_opened_at).toBeNull();

    expect(enlace.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(enlace.url).toBe(`${appUrl()}/c/${enlace.token}`);
    expect(enlace.expiresAt).toBeInstanceOf(Date);

    // El token nuevo abre el recorrido; el hash nunca funciona como token.
    const view = await loadSignerView(enlace.token);
    expect(view.ok).toBe(true);
    expect(await loadSignerView(fila.token_hash)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("ajusta la vigencia del enlace al rango de 1 a 30 días completos", async () => {
    const escenario = await emitirContrato();
    const base = {
      contractId: escenario.issued.contractId,
      organizationId: escenario.organization.id,
    };

    const casos: { pedido: number; esperado: number }[] = [
      { pedido: 0, esperado: 1 },
      { pedido: -5, esperado: 1 },
      { pedido: 1, esperado: 1 },
      { pedido: 15, esperado: 15 },
      { pedido: 30, esperado: 30 },
      { pedido: 45, esperado: 30 },
      { pedido: 7.9, esperado: 7 },
      { pedido: Number.NaN, esperado: 7 },
      { pedido: Number.POSITIVE_INFINITY, esperado: 7 },
    ];

    for (const caso of casos) {
      const enlace = await crearIntento({ ...base, linkDays: caso.pedido });
      expect(await diasDeVigencia(enlace.linkId)).toBe(caso.esperado);
    }
  });

  it("congela en el Contrato la vigencia elegida al emitir", async () => {
    const escenario = await emitirContrato({ linkDays: 3 });
    const [fila] = await sql<{ id: string }[]>`
      SELECT id FROM contract_links
      WHERE contract_id = ${escenario.issued.contractId}
    `;
    expect(await diasDeVigencia(fila.id)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// revokeAttemptLinks
// ---------------------------------------------------------------------------

describe("revokeAttemptLinks", () => {
  it("invalida los enlaces del Intento y no los reactiva", async () => {
    const escenario = await emitirContrato();
    const attemptId = await attemptIdInicial(escenario.issued.contractId);

    await revocar(attemptId);
    const [primera] = await sql<{ revoked_at: Date }[]>`
      SELECT revoked_at FROM contract_links WHERE attempt_id = ${attemptId}
    `;
    expect(primera.revoked_at).not.toBeNull();
    expect(await loadSignerView(escenario.issued.token)).toEqual({
      ok: false,
      reason: "revoked",
    });

    // Idempotente: la segunda revocación no mueve la marca original.
    await revocar(attemptId);
    const [segunda] = await sql<{ revoked_at: Date }[]>`
      SELECT revoked_at FROM contract_links WHERE attempt_id = ${attemptId}
    `;
    expect(segunda.revoked_at.getTime()).toBe(primera.revoked_at.getTime());
  });

  it("no toca los enlaces de otros Intentos", async () => {
    const escenario = await emitirContrato();
    const primero = await attemptIdInicial(escenario.issued.contractId);
    const sucesor = await crearIntento({
      contractId: escenario.issued.contractId,
      organizationId: escenario.organization.id,
      linkDays: 7,
      replacesAttemptId: primero,
    });

    await revocar(primero);

    const [otro] = await sql<{ revoked_at: Date | null }[]>`
      SELECT revoked_at FROM contract_links
      WHERE attempt_id = ${sucesor.attemptId}
    `;
    expect(otro.revoked_at).toBeNull();
    expect((await loadSignerView(sucesor.token)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// currentLink
// ---------------------------------------------------------------------------

describe("currentLink", () => {
  it("devuelve el enlace del Intento de mayor secuencia", async () => {
    const escenario = await emitirContrato();
    const contractId = escenario.issued.contractId;

    const inicial = await currentLink(contractId);
    expect(inicial).toEqual({
      token: escenario.issued.token,
      url: escenario.issued.url,
      expiresAt: expect.any(Date),
      revoked: false,
    });

    const sucesor = await crearIntento({
      contractId,
      organizationId: escenario.organization.id,
      linkDays: 7,
      replacesAttemptId: await attemptIdInicial(contractId),
    });
    const actual = await currentLink(contractId);
    expect(actual?.token).toBe(sucesor.token);
    expect(actual?.url).toBe(`${appUrl()}/c/${sucesor.token}`);
    expect(actual?.revoked).toBe(false);
  });

  it("devuelve null cuando el Contrato no tiene ningún enlace", async () => {
    await emitirContrato();
    expect(
      await currentLink("00000000-0000-4000-8000-000000000000")
    ).toBeNull();
  });

  // `currentLink` significa enlace vivo: revocado o vencido devuelve null,
  // igual que la definición que usa `getContractDetail`.
  it("devuelve null cuando ya no queda un enlace vivo", async () => {
    const revocado = await emitirContrato();
    await revocar(await attemptIdInicial(revocado.issued.contractId));
    expect(await currentLink(revocado.issued.contractId)).toBeNull();

    const vencido = await emitirContrato();
    await sql`
      UPDATE contract_links SET expires_at = NOW() - INTERVAL '1 hour'
      WHERE contract_id = ${vencido.issued.contractId}
    `;
    expect(await currentLink(vencido.issued.contractId)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listAttempts
// ---------------------------------------------------------------------------

describe("listAttempts", () => {
  it("lista los Intentos del Contrato en orden de secuencia", async () => {
    const escenario = await emitirContrato();
    const contractId = escenario.issued.contractId;
    const primero = await attemptIdInicial(contractId);
    const sucesor = await crearIntento({
      contractId,
      organizationId: escenario.organization.id,
      linkDays: 7,
      replacesAttemptId: primero,
    });
    await sql`
      UPDATE acceptance_attempts
      SET status = 'repeated', walked_at = NOW(), submitted_at = NOW(),
          closed_at = NOW()
      WHERE id = ${primero}
    `;

    const intentos = await listAttempts(contractId);
    expect(intentos).toHaveLength(2);
    expect(intentos[0].id).toBe(primero);
    expect(intentos[0].sequence).toBe(1);
    expect(intentos[0].status).toBe("repeated");
    expect(intentos[0].walkedAt).toBeInstanceOf(Date);
    expect(intentos[0].submittedAt).toBeInstanceOf(Date);
    expect(intentos[0].closedAt).toBeInstanceOf(Date);
    expect(intentos[0].replacesAttemptId).toBeNull();
    expect(intentos[0].createdAt).toBeInstanceOf(Date);
    expect(intentos[1].id).toBe(sucesor.attemptId);
    expect(intentos[1].sequence).toBe(2);
    expect(intentos[1].status).toBe("open");
    expect(intentos[1].walkedAt).toBeNull();
    expect(intentos[1].submittedAt).toBeNull();
    expect(intentos[1].closedAt).toBeNull();
    expect(intentos[1].replacesAttemptId).toBe(primero);
  });

  it("devuelve una lista vacía cuando el Contrato no existe", async () => {
    expect(
      await listAttempts("00000000-0000-4000-8000-000000000000")
    ).toEqual([]);
  });
});
