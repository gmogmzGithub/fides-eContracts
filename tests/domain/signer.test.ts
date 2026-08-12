import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { canonicalizeJson } from "@/lib/canonical-json";
import { sha256Hex } from "@/lib/crypto/tokens";
import { revokeAttemptLinks } from "@/lib/domain/attempts";
import { cancelContract, deleteContract } from "@/lib/domain/contracts";
import { createDraft, issueContract, saveDraft } from "@/lib/domain/drafts";
import { DomainError } from "@/lib/domain/errors";
import { repeatProcess } from "@/lib/domain/review";
import {
  acceptContract,
  loadSignerView,
  markContractWalked,
  requiredEvidenceKinds,
  storeEvidence,
  type SignerLoad,
  type SignerView,
} from "@/lib/domain/signer";
import type { OrganizationRole, ReviewPolicy } from "@/lib/domain/types";
import { getObjectStorage } from "@/lib/storage";
import { createIssuableOrganization } from "@/tests/helpers/database";

// ---------------------------------------------------------------------------
// Utilidades del recorrido
// ---------------------------------------------------------------------------

interface EmisionOptions {
  requiresIne?: boolean;
  requiresVideo?: boolean;
  reviewPolicy?: ReviewPolicy;
  linkDays?: number;
  roles?: OrganizationRole[];
}

/** Emite un Contrato por la ruta real: Borrador, guardado y `Generar enlace`. */
async function emitirContrato(options: EmisionOptions = {}) {
  const fixture = await createIssuableOrganization({
    capabilities: {
      evidence_ine: true,
      evidence_video: true,
      ai_review: true,
    },
    roles: options.roles,
  });
  const draftId = await createDraft(fixture.context, {
    templateId: fixture.template.id,
    holderId: fixture.holder.id,
    signerId: fixture.signer.id,
    prefill: { objeto: "Servicio sintético de prueba", monto: "1500" },
  });
  await saveDraft(fixture.context, draftId, {
    requiresIne: options.requiresIne ?? false,
    requiresVideo: options.requiresVideo ?? false,
    reviewPolicy: options.reviewPolicy ?? "none",
    linkDays: options.linkDays ?? 7,
  });
  const issued = await issueContract(fixture.context, draftId);
  return { ...fixture, draftId, issued };
}

function vista(load: SignerLoad): SignerView {
  if (!load.ok) {
    throw new Error(`Se esperaba una vista abierta y llegó «${load.reason}».`);
  }
  return load;
}

interface ArchivoEvidencia {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}

function imagen(fileName: string, contenido = "imagen"): ArchivoEvidencia {
  return {
    buffer: Buffer.from(`${contenido}:${fileName}`, "utf8"),
    contentType: "image/jpeg",
    fileName,
  };
}

function video(contenido = "video"): ArchivoEvidencia {
  return {
    buffer: Buffer.from(`${contenido}-sintetico`, "utf8"),
    contentType: "video/webm",
    fileName: "declaracion.webm",
  };
}

async function completarEvidencia(
  token: string,
  perfil: { ine?: boolean; video?: boolean } = {}
): Promise<void> {
  await markContractWalked(token);
  if (perfil.ine) {
    await storeEvidence(token, "ine_front", imagen("ine-frente.jpg"));
    await storeEvidence(token, "ine_back", imagen("ine-reverso.jpg"));
  }
  if (perfil.video) {
    await storeEvidence(token, "video", video(), { recordedInSession: true });
  }
}

async function contarEventos(contractId: string, tipo: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT count(*)::TEXT AS total FROM contract_events
    WHERE contract_id = ${contractId} AND type = ${tipo}
  `;
  return Number(row.total);
}

async function vencerEnlace(contractId: string): Promise<void> {
  await sql`
    UPDATE contract_links SET expires_at = NOW() - INTERVAL '1 hour'
    WHERE contract_id = ${contractId} AND revoked_at IS NULL
  `;
}

async function revocarIntento(attemptId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await revokeAttemptLinks(tx, attemptId);
    return true;
  });
}

/**
 * Espera a que otra conexión de esta base quede detenida por un candado de
 * fila. Evita depender de un tiempo fijo para reproducir una carrera.
 */
async function esperarConsultaBloqueada(): Promise<void> {
  for (let intento = 0; intento < 400; intento += 1) {
    const [fila] = await sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
    `;
    if (fila.total > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Ninguna consulta concurrente quedó en espera del candado.");
}

async function attemptIdVigente(contractId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM acceptance_attempts
    WHERE contract_id = ${contractId}
    ORDER BY sequence DESC LIMIT 1
  `;
  return row.id;
}

interface FilaEvidencia {
  kind: string;
  object_key: string | null;
  content_type: string;
  byte_size: number;
  sha256: string;
  metadata: Record<string, unknown>;
}

async function leerEvidencia(
  attemptId: string,
  kind: string
): Promise<FilaEvidencia> {
  const [row] = await sql<FilaEvidencia[]>`
    SELECT kind, object_key, content_type, byte_size, sha256, metadata
    FROM evidence_items
    WHERE attempt_id = ${attemptId} AND kind = ${kind}
  `;
  return row;
}

interface RegistroAceptacion {
  tipo: string;
  version: number;
  contrato: { id: string; referencia: string; hash_documento: string };
  organizacion: { id: string; nombre: string };
  intento: { id: string; secuencia: number };
  aviso_privacidad: { id: string; hash: string };
  leyenda: string;
  leyenda_aceptada: boolean;
  contrato_recorrido_en: string | null;
  nombre_declarado: string;
  agente_usuario: string;
  evidencia: { categoria: string; sha256: string }[];
  aceptado_en: string;
}

// ---------------------------------------------------------------------------
// requiredEvidenceKinds
// ---------------------------------------------------------------------------

describe("Perfil de evidencia efectivo", () => {
  it("enumera sólo las categorías que el perfil exige", () => {
    expect(
      requiredEvidenceKinds({ requiresIne: false, requiresVideo: false })
    ).toEqual([]);
    expect(
      requiredEvidenceKinds({ requiresIne: true, requiresVideo: false })
    ).toEqual(["ine_front", "ine_back"]);
    expect(
      requiredEvidenceKinds({ requiresIne: false, requiresVideo: true })
    ).toEqual(["video"]);
    expect(
      requiredEvidenceKinds({ requiresIne: true, requiresVideo: true })
    ).toEqual(["ine_front", "ine_back", "video"]);
  });
});

// ---------------------------------------------------------------------------
// loadSignerView
// ---------------------------------------------------------------------------

describe("loadSignerView", () => {
  it("entrega el Contrato completo y el Aviso de Privacidad vigente", async () => {
    const escenario = await emitirContrato({ requiresVideo: true });
    const view = vista(await loadSignerView(escenario.issued.token));

    expect(view.token).toBe(escenario.issued.token);
    expect(view.organizationName).toBe(escenario.organization.name);
    expect(view.reference).toBe(escenario.issued.reference);
    expect(view.contractMarkdown).toContain("Servicio sintético de prueba");
    expect(view.contractMarkdown).toContain(escenario.issued.reference);
    expect(view.acceptanceLegend).toContain("Aceptar contrato");
    expect(view.videoStatement).toContain(escenario.signer.name);
    expect(view.privacy.markdown).toBe(
      "Aviso de Privacidad sintético con finalidades."
    );
    expect(view.privacy.fullMarkdown).toBe(
      "Aviso de Privacidad sintético con finalidades."
    );
    expect(view.requiresVideo).toBe(true);
    expect(view.requiresIne).toBe(false);
    expect(view.reviewPolicy).toBe("none");
    expect(view.walked).toBe(false);
    expect(view.evidence).toEqual({
      acceptance: false,
      ine_front: false,
      ine_back: false,
      video: false,
    });
    expect(view.stage).toBe("contract");
    expect(view.contractId).toBe(escenario.issued.contractId);
    expect(view.attemptId).toBe(await attemptIdVigente(view.contractId));
    expect(view.expiresAt).toBeInstanceOf(Date);
    expect(view.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(view.result).toBeUndefined();
  });

  it("registra la presentación del enlace exactamente una vez", async () => {
    const escenario = await emitirContrato();
    await loadSignerView(escenario.issued.token);
    await loadSignerView(escenario.issued.token);
    await loadSignerView(escenario.issued.token);

    expect(
      await contarEventos(escenario.issued.contractId, "enlace_abierto")
    ).toBe(1);

    const [evento] = await sql<
      { actor_kind: string; payload: { secuencia: number } }[]
    >`
      SELECT actor_kind, payload FROM contract_events
      WHERE contract_id = ${escenario.issued.contractId}
        AND type = 'enlace_abierto'
    `;
    expect(evento.actor_kind).toBe("signer");
    expect(evento.payload.secuencia).toBe(1);

    const [link] = await sql<{ first_opened_at: Date | null }[]>`
      SELECT first_opened_at FROM contract_links
      WHERE contract_id = ${escenario.issued.contractId}
    `;
    expect(link.first_opened_at).not.toBeNull();
  });

  it("falla cerrada ante un token inexistente o vacío", async () => {
    await emitirContrato();
    expect(await loadSignerView("token-que-no-existe")).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await loadSignerView("")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("falla cerrada cuando el enlace venció y vence el Contrato", async () => {
    const escenario = await emitirContrato();
    await vencerEnlace(escenario.issued.contractId);

    expect(await loadSignerView(escenario.issued.token)).toEqual({
      ok: false,
      reason: "expired",
    });

    const [contrato] = await sql<{ status: string }[]>`
      SELECT status FROM contracts WHERE id = ${escenario.issued.contractId}
    `;
    expect(contrato.status).toBe("expired");

    // Segunda lectura: ahora el propio Intento está `expired`.
    expect(await loadSignerView(escenario.issued.token)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("falla cerrada cuando el enlace fue revocado", async () => {
    const escenario = await emitirContrato();
    await revocarIntento(await attemptIdVigente(escenario.issued.contractId));

    expect(await loadSignerView(escenario.issued.token)).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("falla cerrada cuando el Contrato está cancelado", async () => {
    const escenario = await emitirContrato();
    await cancelContract(
      escenario.context,
      escenario.issued.contractId,
      "Prueba"
    );

    expect(await loadSignerView(escenario.issued.token)).toEqual({
      ok: false,
      reason: "cancelled",
    });
  });

  it("falla cerrada cuando el expediente está eliminado", async () => {
    const escenario = await emitirContrato();
    await deleteContract(escenario.context, escenario.issued.contractId);

    expect(await loadSignerView(escenario.issued.token)).toEqual({
      ok: false,
      reason: "cancelled",
    });
  });

  it("falla cerrada cuando el Intento ya no está abierto", async () => {
    const escenario = await emitirContrato();
    const attemptId = await attemptIdVigente(escenario.issued.contractId);
    // Estado sintético: un Intento `repeated` cuyo enlace todavía no se revoca.
    await sql`
      UPDATE acceptance_attempts SET status = 'repeated', closed_at = NOW()
      WHERE id = ${attemptId}
    `;

    expect(await loadSignerView(escenario.issued.token)).toEqual({
      ok: false,
      reason: "closed",
    });
  });

  it("falla cerrada cuando el Contrato dejó de estar pendiente", async () => {
    const escenario = await emitirContrato();
    // Estado sintético: Contrato fuera de `pending` con el Intento abierto.
    await sql`
      UPDATE contracts
      SET status = 'accepted', accepted_at = NOW(), closed_at = NOW()
      WHERE id = ${escenario.issued.contractId}
    `;

    expect(await loadSignerView(escenario.issued.token)).toEqual({
      ok: false,
      reason: "closed",
    });
  });

  it("falla cerrada cuando el Contrato quedó marcado como vencido", async () => {
    const escenario = await emitirContrato();
    await sql`
      UPDATE contracts
      SET status = 'expired', expired_at = NOW(), closed_at = NOW()
      WHERE id = ${escenario.issued.contractId}
    `;

    expect(await loadSignerView(escenario.issued.token)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("conserva siempre la publicación del Aviso vinculada al Contrato", async () => {
    // El esquema impide separar el Contrato de su publicación: la rama de
    // `notice_id` nulo en `hasCompleteNotice` es defensiva, no alcanzable.
    const escenario = await emitirContrato();
    await expect(
      sql`
        UPDATE contracts SET privacy_notice_version_id = NULL
        WHERE id = ${escenario.issued.contractId}
      `
    ).rejects.toThrow(/privacy_notice_version_id/);

    const [contrato] = await sql<{ privacy_notice_version_id: string }[]>`
      SELECT privacy_notice_version_id FROM contracts
      WHERE id = ${escenario.issued.contractId}
    `;
    expect(contrato.privacy_notice_version_id).toBe(escenario.noticeId);
  });

  it("falla cerrada cuando el Aviso de Privacidad está incompleto", async () => {
    const escenario = await emitirContrato();
    const noticeId = escenario.noticeId;

    await sql`
      UPDATE privacy_notice_versions SET full_markdown = ''
      WHERE id = ${noticeId}
    `;
    expect(await loadSignerView(escenario.issued.token)).toEqual({
      ok: false,
      reason: "no_privacy_notice",
    });

    await sql`
      UPDATE privacy_notice_versions
      SET full_markdown = 'Aviso de Privacidad sintético con finalidades.',
          notice_hash = ''
      WHERE id = ${noticeId}
    `;
    expect(await loadSignerView(escenario.issued.token)).toEqual({
      ok: false,
      reason: "no_privacy_notice",
    });
  });

  it("no registra la presentación cuando el recorrido falla cerrada", async () => {
    const escenario = await emitirContrato();
    await sql`
      UPDATE privacy_notice_versions SET full_markdown = ''
      WHERE id = ${escenario.noticeId}
    `;
    await loadSignerView(escenario.issued.token);

    expect(
      await contarEventos(escenario.issued.contractId, "enlace_abierto")
    ).toBe(0);
  });

  it("avanza de `contract` a `evidence` y a `accept` según el perfil", async () => {
    const escenario = await emitirContrato({
      requiresIne: true,
      requiresVideo: true,
    });
    const token = escenario.issued.token;

    expect(vista(await loadSignerView(token)).stage).toBe("contract");

    await markContractWalked(token);
    const recorrido = vista(await loadSignerView(token));
    expect(recorrido.walked).toBe(true);
    expect(recorrido.stage).toBe("evidence");

    await storeEvidence(token, "ine_front", imagen("ine-frente.jpg"));
    const conFrente = vista(await loadSignerView(token));
    expect(conFrente.evidence.ine_front).toBe(true);
    expect(conFrente.stage).toBe("evidence");

    await storeEvidence(token, "ine_back", imagen("ine-reverso.jpg"));
    expect(vista(await loadSignerView(token)).stage).toBe("evidence");

    await storeEvidence(token, "video", video(), { recordedInSession: true });
    const completo = vista(await loadSignerView(token));
    expect(completo.evidence).toEqual({
      acceptance: false,
      ine_front: true,
      ine_back: true,
      video: true,
    });
    expect(completo.stage).toBe("accept");
  });

  it("pasa directo a `accept` cuando el perfil no exige evidencia", async () => {
    const escenario = await emitirContrato();
    await markContractWalked(escenario.issued.token);
    expect(vista(await loadSignerView(escenario.issued.token)).stage).toBe(
      "accept"
    );
  });

  it("reporta `done` con el resultado del Intento enviado", async () => {
    const aceptado = await emitirContrato();
    await completarEvidencia(aceptado.issued.token);
    await acceptContract(aceptado.issued.token, { legendAccepted: true });
    const vistaAceptada = vista(await loadSignerView(aceptado.issued.token));
    expect(vistaAceptada.stage).toBe("done");
    expect(vistaAceptada.result).toBe("accepted");

    const enRevision = await emitirContrato({ reviewPolicy: "manual" });
    await completarEvidencia(enRevision.issued.token);
    await acceptContract(enRevision.issued.token, { legendAccepted: true });
    const vistaRevision = vista(await loadSignerView(enRevision.issued.token));
    expect(vistaRevision.stage).toBe("done");
    expect(vistaRevision.result).toBe("in_review");
    expect(vistaRevision.evidence.acceptance).toBe(true);
  });

  it("deja de exponer el resultado después de vencer, incluso si ya se aceptó o envió", async () => {
    const aceptado = await emitirContrato();
    await completarEvidencia(aceptado.issued.token);
    await acceptContract(aceptado.issued.token, { legendAccepted: true });
    await vencerEnlace(aceptado.issued.contractId);
    expect(await loadSignerView(aceptado.issued.token)).toEqual({
      ok: false,
      reason: "expired",
    });

    const enRevision = await emitirContrato({ reviewPolicy: "manual" });
    await completarEvidencia(enRevision.issued.token);
    await acceptContract(enRevision.issued.token, { legendAccepted: true });
    await vencerEnlace(enRevision.issued.contractId);
    expect(await loadSignerView(enRevision.issued.token)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

// ---------------------------------------------------------------------------
// markContractWalked
// ---------------------------------------------------------------------------

describe("markContractWalked", () => {
  it("registra `contrato_recorrido` una sola vez por Intento", async () => {
    const escenario = await emitirContrato();
    const token = escenario.issued.token;

    await markContractWalked(token);
    const [primero] = await sql<{ walked_at: Date | null }[]>`
      SELECT walked_at FROM acceptance_attempts
      WHERE contract_id = ${escenario.issued.contractId}
    `;
    expect(primero.walked_at).not.toBeNull();

    await markContractWalked(token);
    await markContractWalked(token);
    const [segundo] = await sql<{ walked_at: Date }[]>`
      SELECT walked_at FROM acceptance_attempts
      WHERE contract_id = ${escenario.issued.contractId}
    `;
    expect(segundo.walked_at.getTime()).toBe(
      (primero.walked_at as Date).getTime()
    );
    expect(
      await contarEventos(escenario.issued.contractId, "contrato_recorrido")
    ).toBe(1);
  });

  it("no duplica el evento cuando otra sesión marca el recorrido primero", async () => {
    const escenario = await emitirContrato();
    const token = escenario.issued.token;
    const contractId = escenario.issued.contractId;
    const attemptId = await attemptIdVigente(contractId);

    // Carrera real: la llamada lee el Intento todavía sin recorrer y su UPDATE
    // queda detenido por el candado hasta que la otra sesión confirma.
    let pendiente: Promise<void> = Promise.resolve();
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM acceptance_attempts WHERE id = ${attemptId} FOR UPDATE`;
      pendiente = markContractWalked(token);
      await esperarConsultaBloqueada();
      await tx`UPDATE acceptance_attempts SET walked_at = NOW() WHERE id = ${attemptId}`;
      return true;
    });
    await pendiente;

    const [fila] = await sql<{ walked_at: Date | null }[]>`
      SELECT walked_at FROM acceptance_attempts WHERE id = ${attemptId}
    `;
    expect(fila.walked_at).not.toBeNull();
    // Quien perdió la carrera no vuelve a escribir el evento técnico.
    expect(await contarEventos(contractId, "contrato_recorrido")).toBe(0);
  });

  it("exige recorrer de nuevo el Contrato en un Intento sucesor", async () => {
    const escenario = await emitirContrato({
      requiresIne: true,
      reviewPolicy: "manual",
      roles: ["administrator", "emitter", "reviewer"],
    });
    const contractId = escenario.issued.contractId;
    await completarEvidencia(escenario.issued.token, { ine: true });
    await acceptContract(escenario.issued.token, { legendAccepted: true });

    const [task] = await sql<{ id: string }[]>`
      SELECT id FROM review_tasks WHERE contract_id = ${contractId}
    `;
    const sucesor = await repeatProcess(
      escenario.context,
      task.id,
      "ine_ilegible"
    );

    const nuevaVista = vista(await loadSignerView(sucesor.token));
    expect(nuevaVista.walked).toBe(false);
    expect(nuevaVista.stage).toBe("contract");
    expect(nuevaVista.evidence.ine_front).toBe(false);

    await markContractWalked(sucesor.token);
    expect(await contarEventos(contractId, "contrato_recorrido")).toBe(2);

    const conteos = await sql<{ attempt_id: string; total: string }[]>`
      SELECT attempt_id, count(*)::TEXT AS total FROM contract_events
      WHERE contract_id = ${contractId} AND type = 'contrato_recorrido'
      GROUP BY attempt_id
    `;
    expect(conteos).toHaveLength(2);
    for (const fila of conteos) expect(fila.total).toBe("1");
  });

  it("rechaza cualquier acción cuando el Intento ya fue enviado", async () => {
    const escenario = await emitirContrato({ requiresIne: true });
    const token = escenario.issued.token;
    await completarEvidencia(token, { ine: true });
    await acceptContract(token, { legendAccepted: true });

    await expect(markContractWalked(token)).rejects.toThrow(
      "Este proceso ya fue enviado."
    );
    await expect(
      storeEvidence(token, "ine_front", imagen("otra.jpg"))
    ).rejects.toThrow("Este proceso ya fue enviado.");
  });

  it("rechaza acciones cuando el Contrato dejó de estar pendiente", async () => {
    const escenario = await emitirContrato();
    // Estado sintético: Contrato fuera de `pending` con el Intento abierto.
    await sql`
      UPDATE contracts
      SET status = 'accepted', accepted_at = NOW(), closed_at = NOW()
      WHERE id = ${escenario.issued.contractId}
    `;

    await expect(markContractWalked(escenario.issued.token)).rejects.toThrow(
      "Este contrato ya no admite acciones."
    );
  });

  it("rechaza recorrer un enlace revocado, vencido o desconocido", async () => {
    const revocado = await emitirContrato();
    await revocarIntento(await attemptIdVigente(revocado.issued.contractId));
    await expect(markContractWalked(revocado.issued.token)).rejects.toThrow(
      "Este enlace ya no está activo."
    );

    const vencido = await emitirContrato();
    await vencerEnlace(vencido.issued.contractId);
    await expect(markContractWalked(vencido.issued.token)).rejects.toThrow(
      "La vigencia del enlace terminó."
    );

    await expect(markContractWalked("token-inexistente")).rejects.toThrow(
      "El enlace no está disponible."
    );

    const cancelado = await emitirContrato();
    await cancelContract(cancelado.context, cancelado.issued.contractId);
    await expect(markContractWalked(cancelado.issued.token)).rejects.toThrow(
      "Este contrato ya no admite acciones."
    );
  });
});

// ---------------------------------------------------------------------------
// storeEvidence
// ---------------------------------------------------------------------------

describe("storeEvidence", () => {
  it("guarda el objeto privado con hash, tamaño, tipo y metadatos", async () => {
    const escenario = await emitirContrato({ requiresIne: true });
    const token = escenario.issued.token;
    const attemptId = await attemptIdVigente(escenario.issued.contractId);
    await markContractWalked(token);

    const archivo = imagen("ine-frente.jpg");
    const resultado = await storeEvidence(token, "ine_front", {
      ...archivo,
      contentType: "image/JPEG; charset=binary",
    });
    expect(resultado).toBeUndefined();

    const fila = await leerEvidencia(attemptId, "ine_front");
    expect(fila.object_key).toMatch(
      new RegExp(
        `^organizations/${escenario.organization.id}/contracts/${escenario.issued.contractId}/attempts/${attemptId}/ine_front-[0-9a-f-]{36}$`
      )
    );
    expect(fila.object_key).not.toMatch(/^https?:/);
    expect(fila.content_type).toBe("image/jpeg");
    expect(fila.byte_size).toBe(archivo.buffer.byteLength);
    expect(fila.sha256).toBe(sha256Hex(archivo.buffer));
    expect(fila.metadata.fileName).toBe("ine-frente.jpg");
    expect(fila.metadata.recordedInSession).toBeNull();
    expect(fila.metadata.shownStatement).toBeNull();
    expect(fila.metadata.attemptSequence).toBe(1);

    const [contrato] = await sql<{ document_hash: string }[]>`
      SELECT document_hash FROM contracts
      WHERE id = ${escenario.issued.contractId}
    `;
    expect(fila.metadata.documentHash).toBe(contrato.document_hash);
    expect(
      Number.isNaN(Date.parse(String(fila.metadata.receivedAt)))
    ).toBe(false);

    const almacen = getObjectStorage();
    const objeto = await almacen.get(fila.object_key as string);
    expect(objeto.body.equals(archivo.buffer)).toBe(true);
    expect(objeto.contentType).toBe("image/jpeg");
    expect(objeto.metadata).toEqual({
      organizationId: escenario.organization.id,
      contractId: escenario.issued.contractId,
      attemptId,
      kind: "ine_front",
    });
  });

  it("conserva la declaración mostrada y el origen del video", async () => {
    const escenario = await emitirContrato({ requiresVideo: true });
    const token = escenario.issued.token;
    const attemptId = await attemptIdVigente(escenario.issued.contractId);
    await markContractWalked(token);

    await storeEvidence(token, "video", video(), {
      recordedInSession: true,
      shownStatement: "Declaración exactamente como se mostró.",
    });
    const conTexto = await leerEvidencia(attemptId, "video");
    expect(conTexto.content_type).toBe("video/webm");
    expect(conTexto.metadata.recordedInSession).toBe(true);
    expect(conTexto.metadata.shownStatement).toBe(
      "Declaración exactamente como se mostró."
    );

    await storeEvidence(token, "video", video("otro"));
    const porOmision = await leerEvidencia(attemptId, "video");
    const [contrato] = await sql<{ video_statement: string }[]>`
      SELECT video_statement FROM contracts
      WHERE id = ${escenario.issued.contractId}
    `;
    expect(porOmision.metadata.shownStatement).toBe(contrato.video_statement);
    expect(porOmision.metadata.recordedInSession).toBe(true);
  });

  it("es única por Intento y categoría: reemplaza y borra el objeto anterior", async () => {
    const escenario = await emitirContrato({ requiresIne: true });
    const token = escenario.issued.token;
    const attemptId = await attemptIdVigente(escenario.issued.contractId);
    await markContractWalked(token);

    await storeEvidence(token, "ine_front", imagen("primera.jpg", "uno"));
    const primera = await leerEvidencia(attemptId, "ine_front");

    const segundoArchivo = imagen("segunda.jpg", "dos");
    await storeEvidence(token, "ine_front", segundoArchivo);
    const segunda = await leerEvidencia(attemptId, "ine_front");

    const [{ total }] = await sql<{ total: string }[]>`
      SELECT count(*)::TEXT AS total FROM evidence_items
      WHERE attempt_id = ${attemptId} AND kind = 'ine_front'
    `;
    expect(total).toBe("1");
    expect(segunda.object_key).not.toBe(primera.object_key);
    expect(segunda.sha256).toBe(sha256Hex(segundoArchivo.buffer));
    expect(segunda.metadata.fileName).toBe("segunda.jpg");

    const almacen = getObjectStorage();
    expect(await almacen.head(primera.object_key as string)).toBeNull();
    expect(await almacen.head(segunda.object_key as string)).not.toBeNull();
  });

  it("rechaza una categoría que el perfil efectivo no exige", async () => {
    const escenario = await emitirContrato();
    const token = escenario.issued.token;
    await markContractWalked(token);

    await expect(
      storeEvidence(token, "ine_front", imagen("ine.jpg"))
    ).rejects.toThrow("Este contrato no solicita INE.");
    await expect(
      storeEvidence(token, "ine_back", imagen("ine.jpg"))
    ).rejects.toThrow("Este contrato no solicita INE.");
    await expect(storeEvidence(token, "video", video())).rejects.toThrow(
      "Este contrato no solicita video."
    );
    await expect(
      storeEvidence(token, "acceptance", imagen("acta.jpg"))
    ).rejects.toThrow("La aceptación se registra al aceptar el contrato.");

    const [{ total }] = await sql<{ total: string }[]>`
      SELECT count(*)::TEXT AS total FROM evidence_items
    `;
    expect(total).toBe("0");
  });

  it("exige recorrer el Contrato antes de recibir evidencia", async () => {
    const escenario = await emitirContrato({ requiresIne: true });
    await expect(
      storeEvidence(escenario.issued.token, "ine_front", imagen("ine.jpg"))
    ).rejects.toThrow("Primero recorre el contrato completo.");
  });

  it("rechaza un video que no nació dentro del recorrido", async () => {
    const escenario = await emitirContrato({ requiresVideo: true });
    const token = escenario.issued.token;
    await markContractWalked(token);

    await expect(
      storeEvidence(token, "video", video(), { recordedInSession: false })
    ).rejects.toThrow(
      "El video debe grabarse dentro de este recorrido; no se aceptan archivos previos."
    );
    const [{ total }] = await sql<{ total: string }[]>`
      SELECT count(*)::TEXT AS total FROM evidence_items
    `;
    expect(total).toBe("0");
  });

  it("rechaza archivos vacíos y formatos incompatibles", async () => {
    const escenario = await emitirContrato({
      requiresIne: true,
      requiresVideo: true,
    });
    const token = escenario.issued.token;
    await markContractWalked(token);

    await expect(
      storeEvidence(token, "ine_front", {
        buffer: Buffer.alloc(0),
        contentType: "image/jpeg",
        fileName: "vacia.jpg",
      })
    ).rejects.toThrow("El archivo llegó vacío.");

    await expect(
      storeEvidence(token, "ine_front", {
        buffer: Buffer.from("pdf", "utf8"),
        contentType: "application/pdf",
        fileName: "ine.pdf",
      })
    ).rejects.toThrow("El formato de la imagen no es compatible.");

    await expect(
      storeEvidence(token, "video", {
        buffer: Buffer.from("gif", "utf8"),
        contentType: "image/gif",
        fileName: "video.gif",
      })
    ).rejects.toThrow("El formato del video no es compatible.");
  });

  it("aplica el límite de tamaño de imagen y de video", async () => {
    const escenario = await emitirContrato({
      requiresIne: true,
      requiresVideo: true,
    });
    const token = escenario.issued.token;
    await markContractWalked(token);

    await expect(
      storeEvidence(token, "ine_front", {
        buffer: Buffer.allocUnsafe(15 * 1024 * 1024 + 1),
        contentType: "image/png",
        fileName: "enorme.png",
      })
    ).rejects.toThrow("La imagen excede el tamaño permitido.");

    await expect(
      storeEvidence(token, "video", {
        buffer: Buffer.allocUnsafe(200 * 1024 * 1024 + 1),
        contentType: "video/mp4",
        fileName: "enorme.mp4",
      })
    ).rejects.toThrow("El video excede el tamaño permitido.");

    const [{ total }] = await sql<{ total: string }[]>`
      SELECT count(*)::TEXT AS total FROM evidence_items
    `;
    expect(total).toBe("0");
  });

  it("registra el evento de evidencia sin describir contenido personal", async () => {
    const escenario = await emitirContrato({ requiresIne: true });
    const token = escenario.issued.token;
    await markContractWalked(token);
    const archivo = imagen("ine-frente.jpg");
    await storeEvidence(token, "ine_front", archivo);

    const [evento] = await sql<
      { actor_kind: string; payload: Record<string, unknown> }[]
    >`
      SELECT actor_kind, payload FROM contract_events
      WHERE contract_id = ${escenario.issued.contractId}
        AND type = 'evidencia_recibida'
    `;
    expect(evento.actor_kind).toBe("signer");
    expect(evento.payload).toEqual({
      categoria: "ine_front",
      bytes: archivo.buffer.byteLength,
      tipo: "image/jpeg",
      sha256: sha256Hex(archivo.buffer),
    });
  });

  it("rechaza evidencia cuando el enlace ya no es utilizable", async () => {
    const escenario = await emitirContrato({ requiresIne: true });
    const token = escenario.issued.token;
    await markContractWalked(token);
    await revocarIntento(await attemptIdVigente(escenario.issued.contractId));

    await expect(
      storeEvidence(token, "ine_front", imagen("ine.jpg"))
    ).rejects.toBeInstanceOf(DomainError);
  });
});

// ---------------------------------------------------------------------------
// acceptContract
// ---------------------------------------------------------------------------

describe("acceptContract", () => {
  it("exige marcar la casilla de la leyenda", async () => {
    const escenario = await emitirContrato();
    await markContractWalked(escenario.issued.token);

    await expect(
      acceptContract(escenario.issued.token, { legendAccepted: false })
    ).rejects.toThrow("Marca la casilla de la leyenda para continuar.");

    const [{ total }] = await sql<{ total: string }[]>`
      SELECT count(*)::TEXT AS total FROM evidence_items WHERE kind = 'acceptance'
    `;
    expect(total).toBe("0");
  });

  it("exige el evento `Contrato recorrido` antes de aceptar", async () => {
    const escenario = await emitirContrato();
    await expect(
      acceptContract(escenario.issued.token, { legendAccepted: true })
    ).rejects.toThrow("Primero recorre el contrato completo.");
  });

  it("rechaza aceptar con evidencia parcial de INE", async () => {
    const escenario = await emitirContrato({ requiresIne: true });
    const token = escenario.issued.token;
    await markContractWalked(token);
    await storeEvidence(token, "ine_front", imagen("ine-frente.jpg"));

    await expect(
      acceptContract(token, { legendAccepted: true })
    ).rejects.toThrow("Falta evidencia del perfil de este contrato.");
  });

  it("rechaza aceptar sin el video que exige el perfil", async () => {
    const escenario = await emitirContrato({ requiresVideo: true });
    await markContractWalked(escenario.issued.token);

    await expect(
      acceptContract(escenario.issued.token, { legendAccepted: true })
    ).rejects.toThrow("Falta evidencia del perfil de este contrato.");
  });

  it("rechaza aceptar cuando el perfil exige INE y video y falta uno", async () => {
    const escenario = await emitirContrato({
      requiresIne: true,
      requiresVideo: true,
    });
    const token = escenario.issued.token;
    await completarEvidencia(token, { ine: true });

    await expect(
      acceptContract(token, { legendAccepted: true })
    ).rejects.toThrow("Falta evidencia del perfil de este contrato.");

    const [contrato] = await sql<{ status: string }[]>`
      SELECT status FROM contracts WHERE id = ${escenario.issued.contractId}
    `;
    expect(contrato.status).toBe("pending");
  });

  it("escribe el registro canónico de aceptación con hash estable", async () => {
    const escenario = await emitirContrato({
      requiresIne: true,
      requiresVideo: true,
    });
    const token = escenario.issued.token;
    const attemptId = await attemptIdVigente(escenario.issued.contractId);
    await completarEvidencia(token, { ine: true, video: true });

    const resultado = await acceptContract(token, {
      legendAccepted: true,
      declaredName: "  Firmante Declarado  ",
      userAgent: "Navegador de prueba",
    });
    expect(resultado).toEqual({
      result: "accepted",
      reference: escenario.issued.reference,
    });

    const [fila] = await sql<
      {
        object_key: string | null;
        content_type: string;
        byte_size: number;
        sha256: string;
        metadata: RegistroAceptacion;
      }[]
    >`
      SELECT object_key, content_type, byte_size, sha256, metadata
      FROM evidence_items
      WHERE attempt_id = ${attemptId} AND kind = 'acceptance'
    `;
    expect(fila.object_key).toBeNull();
    expect(fila.content_type).toBe("application/json");

    const canonico = canonicalizeJson(fila.metadata);
    expect(fila.sha256).toBe(sha256Hex(canonico));
    expect(fila.byte_size).toBe(Buffer.byteLength(canonico, "utf8"));

    const registro = fila.metadata;
    expect(registro.tipo).toBe("aceptacion_electronica");
    expect(registro.version).toBe(1);
    expect(registro.contrato.id).toBe(escenario.issued.contractId);
    expect(registro.contrato.referencia).toBe(escenario.issued.reference);
    expect(registro.contrato.hash_documento).toHaveLength(64);
    expect(registro.organizacion).toEqual({
      id: escenario.organization.id,
      nombre: escenario.organization.name,
    });
    expect(registro.intento).toEqual({ id: attemptId, secuencia: 1 });
    expect(registro.aviso_privacidad.id).toBe(escenario.noticeId);
    expect(registro.aviso_privacidad.hash).toHaveLength(64);
    expect(registro.leyenda_aceptada).toBe(true);
    expect(registro.leyenda).toContain("Aceptar contrato");
    expect(registro.contrato_recorrido_en).not.toBeNull();
    expect(registro.nombre_declarado).toBe("Firmante Declarado");
    expect(registro.agente_usuario).toBe("Navegador de prueba");
    expect(registro.evidencia.map((item) => item.categoria)).toEqual([
      "ine_back",
      "ine_front",
      "video",
    ]);
    expect(Number.isNaN(Date.parse(registro.aceptado_en))).toBe(false);

    const [evento] = await sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM contract_events
      WHERE contract_id = ${escenario.issued.contractId}
        AND type = 'contrato_aceptado'
    `;
    expect(evento.payload).toEqual({
      secuencia: 1,
      politica: "none",
      hash_aceptacion: fila.sha256,
    });
  });

  it("usa el nombre del Firmante y recorta el agente de usuario", async () => {
    const escenario = await emitirContrato();
    await completarEvidencia(escenario.issued.token);
    await acceptContract(escenario.issued.token, {
      legendAccepted: true,
      userAgent: "u".repeat(400),
    });

    const [fila] = await sql<{ metadata: RegistroAceptacion }[]>`
      SELECT metadata FROM evidence_items WHERE kind = 'acceptance'
    `;
    expect(fila.metadata.nombre_declarado).toBe(escenario.signer.name);
    expect(fila.metadata.agente_usuario).toHaveLength(300);
  });

  it("es idempotente: un Intento, un registro, un evento", async () => {
    const escenario = await emitirContrato();
    const token = escenario.issued.token;
    await completarEvidencia(token);

    const primero = await acceptContract(token, { legendAccepted: true });
    const segundo = await acceptContract(token, { legendAccepted: true });
    const tercero = await acceptContract(token, { legendAccepted: false });
    expect(segundo).toEqual(primero);
    expect(tercero).toEqual(primero);

    const [conteos] = await sql<
      { intentos: string; aceptaciones: string; eventos: string }[]
    >`
      SELECT
        (SELECT count(*) FROM acceptance_attempts
          WHERE contract_id = ${escenario.issued.contractId})::TEXT AS intentos,
        (SELECT count(*) FROM evidence_items
          WHERE contract_id = ${escenario.issued.contractId}
            AND kind = 'acceptance')::TEXT AS aceptaciones,
        (SELECT count(*) FROM contract_events
          WHERE contract_id = ${escenario.issued.contractId}
            AND type = 'contrato_aceptado')::TEXT AS eventos
    `;
    expect(conteos).toEqual({
      intentos: "1",
      aceptaciones: "1",
      eventos: "1",
    });
  });

  it("acepta y encola el sellado en frío cuando la política es `none`", async () => {
    const escenario = await emitirContrato();
    const token = escenario.issued.token;
    await completarEvidencia(token);
    const resultado = await acceptContract(token, { legendAccepted: true });
    expect(resultado.result).toBe("accepted");

    const [contrato] = await sql<
      { status: string; accepted_at: Date | null; closed_at: Date | null }[]
    >`
      SELECT status, accepted_at, closed_at FROM contracts
      WHERE id = ${escenario.issued.contractId}
    `;
    expect(contrato.status).toBe("accepted");
    expect(contrato.accepted_at).not.toBeNull();
    expect(contrato.closed_at).not.toBeNull();

    const [intento] = await sql<
      { status: string; submitted_at: Date | null; closed_at: Date | null }[]
    >`
      SELECT status, submitted_at, closed_at FROM acceptance_attempts
      WHERE contract_id = ${escenario.issued.contractId}
    `;
    expect(intento.status).toBe("accepted");
    expect(intento.submitted_at).not.toBeNull();
    expect(intento.closed_at).not.toBeNull();

    const trabajos = await sql<{ kind: string; dedupe_key: string | null }[]>`
      SELECT kind, dedupe_key FROM background_jobs
    `;
    expect(trabajos).toEqual([
      {
        kind: "seal_cold_package",
        dedupe_key: `seal_cold_package:${escenario.issued.contractId}`,
      },
    ]);

    const [{ total }] = await sql<{ total: string }[]>`
      SELECT count(*)::TEXT AS total FROM review_tasks
    `;
    expect(total).toBe("0");
  });

  it("envía a revisión manual sin encolar análisis por AI", async () => {
    const escenario = await emitirContrato({ reviewPolicy: "manual" });
    const token = escenario.issued.token;
    await completarEvidencia(token);
    const resultado = await acceptContract(token, { legendAccepted: true });
    expect(resultado.result).toBe("in_review");

    const [contrato] = await sql<
      { status: string; accepted_at: Date | null }[]
    >`
      SELECT status, accepted_at FROM contracts
      WHERE id = ${escenario.issued.contractId}
    `;
    expect(contrato.status).toBe("in_review");
    expect(contrato.accepted_at).toBeNull();

    const [intento] = await sql<
      { status: string; submitted_at: Date | null; closed_at: Date | null }[]
    >`
      SELECT status, submitted_at, closed_at FROM acceptance_attempts
      WHERE contract_id = ${escenario.issued.contractId}
    `;
    expect(intento.status).toBe("in_review");
    expect(intento.submitted_at).not.toBeNull();
    expect(intento.closed_at).toBeNull();

    const [tarea] = await sql<{ status: string; attempt_id: string }[]>`
      SELECT status, attempt_id FROM review_tasks
      WHERE contract_id = ${escenario.issued.contractId}
    `;
    expect(tarea.status).toBe("open");
    expect(tarea.attempt_id).toBe(
      await attemptIdVigente(escenario.issued.contractId)
    );

    const trabajos = await sql<{ kind: string }[]>`
      SELECT kind FROM background_jobs
    `;
    expect(trabajos).toEqual([]);

    expect(
      await contarEventos(
        escenario.issued.contractId,
        "intento_enviado_a_revision"
      )
    ).toBe(1);
    expect(
      await contarEventos(escenario.issued.contractId, "contrato_aceptado")
    ).toBe(0);
  });

  it("envía a revisión por AI y encola el análisis una sola vez", async () => {
    const escenario = await emitirContrato({ reviewPolicy: "ai" });
    const token = escenario.issued.token;
    const attemptId = await attemptIdVigente(escenario.issued.contractId);
    await completarEvidencia(token);
    await acceptContract(token, { legendAccepted: true });
    await acceptContract(token, { legendAccepted: true });

    const trabajos = await sql<
      { kind: string; dedupe_key: string | null; payload: unknown }[]
    >`
      SELECT kind, dedupe_key, payload FROM background_jobs
    `;
    expect(trabajos).toHaveLength(1);
    expect(trabajos[0].kind).toBe("ai_review");
    expect(trabajos[0].dedupe_key).toBe(`ai_review:${attemptId}`);
    expect(trabajos[0].payload).toEqual({
      contractId: escenario.issued.contractId,
      attemptId,
    });

    const [{ total }] = await sql<{ total: string }[]>`
      SELECT count(*)::TEXT AS total FROM review_tasks
      WHERE contract_id = ${escenario.issued.contractId}
    `;
    expect(total).toBe("1");
  });

  it("revalida la vigencia del enlace al momento de aceptar", async () => {
    const escenario = await emitirContrato();
    const token = escenario.issued.token;
    await completarEvidencia(token);
    await vencerEnlace(escenario.issued.contractId);

    await expect(
      acceptContract(token, { legendAccepted: true })
    ).rejects.toThrow("La vigencia del enlace terminó.");

    const [contrato] = await sql<{ status: string }[]>`
      SELECT status FROM contracts WHERE id = ${escenario.issued.contractId}
    `;
    expect(contrato.status).toBe("pending");
  });

  it("revalida la revocación del enlace al momento de aceptar", async () => {
    const escenario = await emitirContrato();
    const token = escenario.issued.token;
    await completarEvidencia(token);
    await revocarIntento(await attemptIdVigente(escenario.issued.contractId));

    await expect(
      acceptContract(token, { legendAccepted: true })
    ).rejects.toThrow("Este enlace ya no está activo.");
  });

  it("resuelve dos aceptaciones simultáneas en un solo Intento", async () => {
    const escenario = await emitirContrato();
    const token = escenario.issued.token;
    await completarEvidencia(token);

    const [primera, segunda] = await Promise.all([
      acceptContract(token, { legendAccepted: true }),
      acceptContract(token, { legendAccepted: true }),
    ]);
    expect(primera).toEqual({
      result: "accepted",
      reference: escenario.issued.reference,
    });
    expect(segunda).toEqual(primera);

    const [conteos] = await sql<
      { aceptaciones: string; eventos: string; trabajos: string }[]
    >`
      SELECT
        (SELECT count(*) FROM evidence_items
          WHERE contract_id = ${escenario.issued.contractId}
            AND kind = 'acceptance')::TEXT AS aceptaciones,
        (SELECT count(*) FROM contract_events
          WHERE contract_id = ${escenario.issued.contractId}
            AND type = 'contrato_aceptado')::TEXT AS eventos,
        (SELECT count(*) FROM background_jobs)::TEXT AS trabajos
    `;
    expect(conteos).toEqual({
      aceptaciones: "1",
      eventos: "1",
      trabajos: "1",
    });
  });

  it("resuelve dos envíos simultáneos a revisión en una sola tarea", async () => {
    const escenario = await emitirContrato({ reviewPolicy: "manual" });
    const token = escenario.issued.token;
    await completarEvidencia(token);

    const [primera, segunda] = await Promise.all([
      acceptContract(token, { legendAccepted: true }),
      acceptContract(token, { legendAccepted: true }),
    ]);
    expect(primera.result).toBe("in_review");
    expect(segunda).toEqual(primera);

    const [{ total }] = await sql<{ total: string }[]>`
      SELECT count(*)::TEXT AS total FROM review_tasks
      WHERE contract_id = ${escenario.issued.contractId}
    `;
    expect(total).toBe("1");
    expect(
      await contarEventos(
        escenario.issued.contractId,
        "intento_enviado_a_revision"
      )
    ).toBe(1);
  });

  it("no inventa un nombre cuando el Contrato no conserva el del Firmante", async () => {
    const escenario = await emitirContrato({ requiresIne: true });
    const token = escenario.issued.token;
    // Estado sintético: la instantánea del Firmante ya no está disponible.
    await sql`
      DELETE FROM contract_parties
      WHERE contract_id = ${escenario.issued.contractId}
        AND party_role = 'signer'
    `;

    await loadSignerView(token);
    await completarEvidencia(token, { ine: true });
    await acceptContract(token, { legendAccepted: true });

    const actores = await sql<{ actor_name: string }[]>`
      SELECT actor_name FROM contract_events
      WHERE contract_id = ${escenario.issued.contractId}
        AND actor_kind = 'signer'
    `;
    expect(actores).not.toHaveLength(0);
    for (const actor of actores) expect(actor.actor_name).toBe("");

    const [fila] = await sql<{ metadata: RegistroAceptacion }[]>`
      SELECT metadata FROM evidence_items WHERE kind = 'acceptance'
    `;
    expect(fila.metadata.nombre_declarado).toBe("");
  });

  it("rechaza un token desconocido", async () => {
    await expect(
      acceptContract("token-inexistente", { legendAccepted: true })
    ).rejects.toThrow("El enlace no está disponible.");
  });

  it("rechaza aceptar si el Aviso de Privacidad dejó de estar completo", async () => {
    const escenario = await emitirContrato();
    const token = escenario.issued.token;
    await completarEvidencia(token);
    await sql`
      UPDATE privacy_notice_versions SET full_markdown = ''
      WHERE id = ${escenario.noticeId}
    `;

    await expect(
      acceptContract(token, { legendAccepted: true })
    ).rejects.toThrow("El aviso de privacidad no está disponible.");
  });
});
