import crypto from "node:crypto";
import { inflateRawSync } from "node:zlib";
import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DATABASE_URL, sql } from "@/lib/db";
import type { Sql, Transaction } from "@/lib/db";
import type { OrganizationContext } from "@/lib/auth/guards";
import { sha256Hex } from "@/lib/crypto/tokens";
import { formatDate } from "@/lib/format";
import { getObjectStorage } from "@/lib/storage";
import { cancelContract, deleteContract } from "@/lib/domain/contracts";
import {
  getCustodyState,
  moveExpiredPackagesToCold,
  platformRecoverPackage,
  readContractArchive,
  readExportArtifact,
  requestBulkExport,
  requestHistoricalArchive,
  runExportJob,
  runRecoveryJob,
  sealColdPackage,
  searchColdArchive,
  type CustodyTier,
} from "@/lib/domain/custody";
import { buildContractPdf } from "@/lib/domain/documents";
import { createDraft, issueContract, saveDraft } from "@/lib/domain/drafts";
import type { IssuedContractResult, SaveDraftPatch } from "@/lib/domain/drafts";
import {
  AuthorizationError,
  DomainError,
  NotFoundError,
} from "@/lib/domain/errors";
import { expireDueLinks } from "@/lib/domain/expiry";
import {
  concludeAndAccept,
  repeatProcess,
  saveAiReport,
} from "@/lib/domain/review";
import {
  acceptContract,
  markContractWalked,
  storeEvidence,
} from "@/lib/domain/signer";
import type { OrganizationRole } from "@/lib/domain/types";
import {
  addMembership,
  buildContext,
  createAccount,
  createIssuableOrganization,
} from "@/tests/helpers/database";

// ---------------------------------------------------------------------------
// Utilidades del arnés
// ---------------------------------------------------------------------------

type Fixture = Awaited<ReturnType<typeof createIssuableOrganization>>;

const DIA_MS = 24 * 3600 * 1000;
const TRES_DIAS_MS = 3 * DIA_MS;
const ANIO_MS = 365 * DIA_MS;
const TOLERANCIA_MS = 5 * 60 * 1000;

interface ManifiestoIntento {
  id: string;
  secuencia: number;
  estado: string;
  recorrido_en: string | null;
  enviado_en: string | null;
  cerrado_en: string | null;
  reemplaza: string | null;
  archivos_incluidos: boolean;
}

interface Manifiesto {
  version: number;
  generado_en: string;
  organizacion: { id: string; nombre: string; razon_social: string };
  contrato: {
    id: string;
    referencia: string;
    estado: string;
    plantilla: string;
    publicacion: string;
    hash_documento: string;
    politica_revision: string;
    perfil_evidencia: { aceptacion: boolean; ine: boolean; video: boolean };
    valores: Record<string, string>;
    emitido_en: string;
    aceptado_en: string | null;
    cerrado_en: string;
    emitido_por: string;
  };
  aviso_privacidad: {
    publicacion_id: string;
    etiqueta: string;
    markdown: string;
    hash: string;
    publicado_en: string;
  };
  partes: { rol: string; tipo_persona: string; nombre: string }[];
  intento_concluyente: {
    id: string;
    secuencia: number;
    enviado_en: string | null;
    cerrado_en: string | null;
  } | null;
  intentos: ManifiestoIntento[];
  decisiones: {
    intento: string;
    revisor: string;
    decision: string;
    motivo: string | null;
    intento_sucesor: string | null;
  }[];
  reportes_ai: {
    modelo: string;
    estado: string;
    recomendacion: string | null;
    confianza: number | null;
  }[];
  linea_de_tiempo: {
    tipo: string;
    actor: string;
    nombre_actor: string;
    fecha: string;
    datos: Record<string, unknown> | null;
  }[];
  evidencia: {
    categoria: string;
    tipo: string;
    bytes: number;
    sha256: string;
  }[];
  hash_evidencia: string;
  componentes: { nombre: string; bytes: number; sha256: string }[];
}

interface PaqueteRow {
  contract_id: string;
  object_key: string;
  sha256: string;
  byte_size: number;
  tier: CustodyTier;
  closed_at: Date;
  moved_to_cold_at: Date | null;
  manifest: Manifiesto;
}

/** Lector ZIP mínimo, suficiente para inspeccionar el paquete sellado. */
function leerZip(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (
    offset + 30 <= archive.byteLength &&
    archive.readUInt32LE(offset) === 0x04034b50
  ) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const payload = archive.subarray(start, start + compressedSize);
    entries.set(
      name,
      method === 8 ? inflateRawSync(payload) : Buffer.from(payload)
    );
    offset = start + compressedSize;
  }
  return entries;
}

async function leerObjeto(key: string): Promise<Buffer> {
  const stored = await getObjectStorage().get(key);
  return stored.body;
}

async function leerPaquete(contractId: string): Promise<PaqueteRow> {
  const [row] = await sql<PaqueteRow[]>`
    SELECT contract_id, object_key, sha256, byte_size, tier, closed_at,
           moved_to_cold_at, manifest
    FROM cold_contract_packages WHERE contract_id = ${contractId}
  `;
  return row;
}

async function contarPaquetes(contractId: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total FROM cold_contract_packages
    WHERE contract_id = ${contractId}
  `;
  return Number(row.total);
}

async function abrirPaquete(contractId: string): Promise<{
  paquete: PaqueteRow;
  zip: Map<string, Buffer>;
  manifiesto: Manifiesto;
}> {
  const paquete = await leerPaquete(contractId);
  const archive = await leerObjeto(paquete.object_key);
  const zip = leerZip(archive);
  const manifiestoBytes = zip.get("manifiesto.json");
  if (!manifiestoBytes) throw new Error("El paquete no trae manifiesto.json");
  return {
    paquete,
    zip,
    manifiesto: JSON.parse(manifiestoBytes.toString("utf8")) as Manifiesto,
  };
}

async function emitir(
  fixture: Fixture,
  patch: SaveDraftPatch = {}
): Promise<IssuedContractResult> {
  const draftId = await createDraft(fixture.context, {
    templateId: fixture.template.id,
  });
  await saveDraft(fixture.context, draftId, {
    fieldValues: { objeto: "Servicio sintético", monto: "1000" },
    holderId: fixture.holder.id,
    signerId: fixture.signer.id,
    ...patch,
  });
  return issueContract(fixture.context, draftId);
}

async function aceptar(token: string): Promise<void> {
  await markContractWalked(token);
  await acceptContract(token, {
    legendAccepted: true,
    declaredName: "Firmante sintético",
    userAgent: "vitest",
  });
}

/** Contrato cerrado por la ruta real: emisión, recorrido y aceptación. */
async function contratoCerrado(
  fixture: Fixture,
  patch: SaveDraftPatch = {}
): Promise<IssuedContractResult> {
  const issued = await emitir(fixture, patch);
  await aceptar(issued.token);
  return issued;
}

/** Contrato cerrado y con su paquete ya sellado, como lo deja el worker. */
async function contratoResguardado(
  fixture: Fixture,
  patch: SaveDraftPatch = {}
): Promise<IssuedContractResult> {
  const issued = await contratoCerrado(fixture, patch);
  await sealColdPackage(issued.contractId);
  return issued;
}

async function subirIne(
  token: string,
  frente: Buffer,
  reverso: Buffer
): Promise<void> {
  await storeEvidence(token, "ine_front", {
    buffer: frente,
    contentType: "image/png",
    fileName: "frente.png",
  });
  await storeEvidence(token, "ine_back", {
    buffer: reverso,
    contentType: "image/png",
    fileName: "reverso.png",
  });
}

async function tareaAbierta(contractId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM review_tasks
    WHERE contract_id = ${contractId} AND status = 'open'
    ORDER BY created_at DESC LIMIT 1
  `;
  return row.id;
}

async function contextoCon(
  organizationId: string,
  roles: OrganizationRole[]
): Promise<OrganizationContext> {
  const account = await createAccount();
  await addMembership(organizationId, account.id, roles);
  return buildContext(organizationId, account, roles);
}

async function contarTrabajos(kind: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total FROM background_jobs WHERE kind = ${kind}
  `;
  return Number(row.total);
}

async function contarRecuperaciones(contractId: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total FROM recovery_jobs
    WHERE contract_id = ${contractId}
  `;
  return Number(row.total);
}

async function contarExportaciones(organizationId: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total FROM export_jobs
    WHERE organization_id = ${organizationId}
  `;
  return Number(row.total);
}

/**
 * Segunda conexión, independiente del pool de la aplicación: sostiene una
 * transacción abierta mientras el dominio corre en la conexión normal.
 */
function nuevaConexion(): Sql {
  return postgres(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, {
    max: 1,
    onnotice: () => undefined,
    transform: { undefined: null },
    connection: { search_path: "fides,public" },
  });
}

/** Espera a que otra sesión de esta misma base quede detenida en un candado. */
async function esperarSesionEnEspera(tx: Transaction): Promise<void> {
  const limite = Date.now() + 20_000;
  while (Date.now() < limite) {
    const [fila] = await tx<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
    `;
    if (Number(fila.total) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Ninguna sesión quedó esperando el candado.");
}

async function tiposDeEvento(contractId: string): Promise<string[]> {
  const rows = await sql<{ type: string }[]>`
    SELECT type FROM contract_events WHERE contract_id = ${contractId}
    ORDER BY created_at ASC, id ASC
  `;
  return rows.map((row) => row.type);
}

// ---------------------------------------------------------------------------
// Sellado del Paquete contractual frío
// ---------------------------------------------------------------------------

describe("sealColdPackage", () => {
  it("sella una sola vez y una segunda llamada conserva el mismo hash", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);

    await sealColdPackage(issued.contractId);
    const primero = await leerPaquete(issued.contractId);
    await sealColdPackage(issued.contractId);
    const segundo = await leerPaquete(issued.contractId);

    expect(await contarPaquetes(issued.contractId)).toBe(1);
    expect(segundo.sha256).toBe(primero.sha256);
    expect(segundo.byte_size).toBe(primero.byte_size);
    expect(segundo.object_key).toBe(primero.object_key);

    // El objeto sigue en su lugar: la reentrada no lo borra.
    const archive = await leerObjeto(primero.object_key);
    expect(sha256Hex(archive)).toBe(primero.sha256);
    expect(archive.byteLength).toBe(primero.byte_size);

    const objetos = await sql<{ tier: string; sha256: string }[]>`
      SELECT tier, sha256 FROM contract_objects
      WHERE contract_id = ${issued.contractId} AND kind = 'cold_package'
    `;
    expect(objetos).toHaveLength(1);
    expect(objetos[0].sha256).toBe(primero.sha256);

    const eventos = await tiposDeEvento(issued.contractId);
    expect(eventos.filter((tipo) => tipo === "paquete_frio_sellado")).toHaveLength(
      1
    );
  });

  it("sella las instantáneas exactas sin generar PDF automáticamente", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);

    const [snapshot] = await sql<
      {
        privacy_notice_label: string;
        privacy_notice_full_markdown: string;
        privacy_notice_hash: string;
      }[]
    >`
      SELECT privacy_notice_label, privacy_notice_full_markdown,
             privacy_notice_hash
      FROM contracts WHERE id = ${issued.contractId}
    `;
    // Una alteración posterior de la publicación no cambia el expediente.
    await sql`
      UPDATE privacy_notice_versions
      SET full_markdown = 'AVISO MODIFICADO'
      WHERE id = ${fixture.noticeId}
    `;
    await sealColdPackage(issued.contractId);

    const { paquete, zip, manifiesto } = await abrirPaquete(issued.contractId);

    expect([...zip.keys()]).toEqual([
      "contrato.md",
      "aviso-privacidad.md",
      "evidencia/aceptacion.json",
      "manifiesto.json",
    ]);

    const [contract] = await sql<
      { contract_markdown: string; document_hash: string; closed_at: Date }[]
    >`
      SELECT contract_markdown, document_hash, closed_at FROM contracts
      WHERE id = ${issued.contractId}
    `;
    expect(zip.get("contrato.md")?.toString("utf8")).toBe(
      contract.contract_markdown
    );
    expect(zip.has("contrato.pdf")).toBe(false);
    expect(zip.get("aviso-privacidad.md")?.toString("utf8")).toBe(
      snapshot.privacy_notice_full_markdown
    );

    const [pdfObjects] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM contract_objects
      WHERE contract_id = ${issued.contractId} AND kind = 'accepted_pdf'
    `;
    expect(pdfObjects.total).toBe("0");

    expect(manifiesto.aviso_privacidad).toMatchObject({
      publicacion_id: fixture.noticeId,
      etiqueta: snapshot.privacy_notice_label,
      markdown: snapshot.privacy_notice_full_markdown,
      hash: snapshot.privacy_notice_hash,
    });
    expect(manifiesto.aviso_privacidad.markdown).not.toBe(
      "AVISO MODIFICADO"
    );

    expect(manifiesto.version).toBe(1);
    expect(manifiesto.organizacion.id).toBe(fixture.organization.id);
    expect(manifiesto.organizacion.nombre).toBe(fixture.organization.name);
    expect(manifiesto.contrato.id).toBe(issued.contractId);
    expect(manifiesto.contrato.referencia).toBe(issued.reference);
    expect(manifiesto.contrato.estado).toBe("accepted");
    expect(manifiesto.contrato.hash_documento).toBe(contract.document_hash);
    expect(manifiesto.contrato.cerrado_en).toBe(contract.closed_at.toISOString());
    expect(manifiesto.contrato.valores).toEqual({
      objeto: "Servicio sintético",
      monto: "1000",
    });
    expect(manifiesto.aviso_privacidad.etiqueta).toBe("1.0");
    expect(manifiesto.partes.map((parte) => parte.rol).sort()).toEqual([
      "holder",
      "signer",
    ]);

    // El manifiesto inventaría cada componente con su hash verificable.
    expect(manifiesto.componentes.map((item) => item.nombre)).toEqual([
      "contrato.md",
      "aviso-privacidad.md",
      "evidencia/aceptacion.json",
    ]);
    for (const componente of manifiesto.componentes) {
      const bytes = zip.get(componente.nombre);
      expect(bytes).toBeDefined();
      expect(componente.bytes).toBe(bytes?.byteLength);
      expect(componente.sha256).toBe(sha256Hex(bytes as Buffer));
    }

    // La línea de tiempo conserva el historial del expediente.
    const tipos = manifiesto.linea_de_tiempo.map((evento) => evento.tipo);
    expect(tipos).toContain("contrato_emitido");
    expect(tipos).toContain("contrato_recorrido");
    expect(tipos).toContain("contrato_aceptado");
    expect(tipos).not.toContain("paquete_frio_sellado");
    expect(manifiesto.linea_de_tiempo[0].nombre_actor).toBe(
      fixture.account.fullName
    );

    expect(paquete.byte_size).toBeGreaterThan(0);
    expect(manifiesto.hash_evidencia).toMatch(/^[0-9a-f]{64}$/);
  });

  it("incluye exactamente el PDF aceptado que una persona pidió antes del sellado", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);
    const requested = await buildContractPdf(
      fixture.organization.id,
      issued.contractId
    );

    await sealColdPackage(issued.contractId);
    const { zip, manifiesto } = await abrirPaquete(issued.contractId);

    expect(zip.get("contrato.pdf")?.equals(requested.buffer)).toBe(true);
    expect(
      manifiesto.componentes.find((item) => item.nombre === "contrato.pdf")
        ?.sha256
    ).toBe(sha256Hex(requested.buffer));
  });

  it("falla cerrado si el PDF aceptado ya no coincide con su inventario", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);
    const requested = await buildContractPdf(
      fixture.organization.id,
      issued.contractId
    );
    const [pdf] = await sql<{ object_key: string }[]>`
      SELECT object_key FROM contract_objects
      WHERE contract_id = ${issued.contractId} AND kind = 'accepted_pdf'
    `;
    const altered = Buffer.from(requested.buffer);
    altered[altered.byteLength - 1] ^= 1;
    await getObjectStorage().put({
      key: pdf.object_key,
      body: altered,
      contentType: "application/pdf",
    });

    await expect(sealColdPackage(issued.contractId)).rejects.toThrow(
      "La copia contractual aceptada no coincide con su inventario."
    );
    expect(await contarPaquetes(issued.contractId)).toBe(0);
  });

  it("incluye la evidencia del intento concluyente y excluye la de los intentos repetidos", async () => {
    const fixture = await createIssuableOrganization({
      roles: ["administrator", "emitter", "reviewer"],
      capabilities: { evidence_ine: true, ai_review: true },
    });
    const issued = await emitir(fixture, {
      requiresIne: true,
      reviewPolicy: "ai",
    });

    const frentePrimero = Buffer.from("INE-FRENTE-INTENTO-1");
    const reversoPrimero = Buffer.from("INE-REVERSO-INTENTO-1");
    await markContractWalked(issued.token);
    await subirIne(issued.token, frentePrimero, reversoPrimero);
    await acceptContract(issued.token, {
      legendAccepted: true,
      declaredName: "Firmante sintético",
      userAgent: "vitest",
    });

    const [primerIntento] = await sql<{ id: string }[]>`
      SELECT id FROM acceptance_attempts WHERE contract_id = ${issued.contractId}
      ORDER BY sequence ASC LIMIT 1
    `;
    await saveAiReport({
      contractId: issued.contractId,
      attemptId: primerIntento.id,
      model: "modelo-sintetico",
      configurationVersion: "1",
      status: "completed",
      recommendation: "repeat",
      confidence: 0.4,
    });

    const repeticion = await repeatProcess(
      fixture.context,
      await tareaAbierta(issued.contractId),
      "ine_ilegible"
    );

    const frenteSegundo = Buffer.from("INE-FRENTE-INTENTO-2");
    const reversoSegundo = Buffer.from("INE-REVERSO-INTENTO-2");
    await markContractWalked(repeticion.token);
    await subirIne(repeticion.token, frenteSegundo, reversoSegundo);
    await acceptContract(repeticion.token, {
      legendAccepted: true,
      declaredName: "Firmante sintético",
      userAgent: "vitest",
    });

    const [segundoIntento] = await sql<{ id: string }[]>`
      SELECT id FROM acceptance_attempts WHERE contract_id = ${issued.contractId}
      ORDER BY sequence DESC LIMIT 1
    `;
    await saveAiReport({
      contractId: issued.contractId,
      attemptId: segundoIntento.id,
      model: "modelo-sintetico",
      configurationVersion: "1",
      status: "completed",
      recommendation: "accept",
      confidence: 0.92,
    });
    await concludeAndAccept(
      fixture.context,
      await tareaAbierta(issued.contractId)
    );

    await sealColdPackage(issued.contractId);
    const { zip, manifiesto } = await abrirPaquete(issued.contractId);

    // Sólo viajan los archivos del intento que produjo la aceptación.
    expect([...zip.keys()].sort()).toEqual([
      "aviso-privacidad.md",
      "contrato.md",
      "evidencia/aceptacion.json",
      "evidencia/ine-frente.png",
      "evidencia/ine-reverso.png",
      "manifiesto.json",
    ]);
    expect(zip.get("evidencia/ine-frente.png")?.equals(frenteSegundo)).toBe(true);
    expect(zip.get("evidencia/ine-reverso.png")?.equals(reversoSegundo)).toBe(
      true
    );

    const hashes = manifiesto.evidencia.map((item) => item.sha256);
    expect(hashes).toContain(sha256Hex(frenteSegundo));
    expect(hashes).not.toContain(sha256Hex(frentePrimero));
    expect(hashes).not.toContain(sha256Hex(reversoPrimero));

    // El historial conserva únicamente que el intento anterior existió.
    expect(manifiesto.intentos).toHaveLength(2);
    expect(manifiesto.intentos[0].estado).toBe("repeated");
    expect(manifiesto.intentos[0].archivos_incluidos).toBe(false);
    expect(manifiesto.intentos[0].enviado_en).not.toBeNull();
    expect(manifiesto.intentos[1].estado).toBe("accepted");
    expect(manifiesto.intentos[1].archivos_incluidos).toBe(true);
    expect(manifiesto.intentos[1].reemplaza).toBe(manifiesto.intentos[0].id);
    expect(manifiesto.intento_concluyente?.id).toBe(segundoIntento.id);
    expect(manifiesto.intento_concluyente?.secuencia).toBe(2);

    expect(manifiesto.decisiones.map((item) => item.decision)).toEqual([
      "repeat",
      "conclude",
    ]);
    expect(manifiesto.decisiones[0].motivo).toBe("ine_ilegible");
    expect(manifiesto.decisiones[0].intento_sucesor).toBe(segundoIntento.id);

    // Los reportes AI sólo acompañan al intento concluyente.
    expect(manifiesto.reportes_ai).toHaveLength(1);
    expect(manifiesto.reportes_ai[0].recomendacion).toBe("accept");
    expect(manifiesto.reportes_ai[0].confianza).toBeCloseTo(0.92, 2);

    expect(manifiesto.contrato.perfil_evidencia).toEqual({
      aceptacion: true,
      ine: true,
      video: false,
    });
  });

  it("conserva un reporte AI fallido sin recomendación ni confianza", async () => {
    const fixture = await createIssuableOrganization({
      roles: ["administrator", "emitter", "reviewer"],
      capabilities: { ai_review: true },
    });
    const issued = await emitir(fixture, { reviewPolicy: "ai" });
    await aceptar(issued.token);

    const [intento] = await sql<{ id: string }[]>`
      SELECT id FROM acceptance_attempts WHERE contract_id = ${issued.contractId}
    `;
    await saveAiReport({
      contractId: issued.contractId,
      attemptId: intento.id,
      model: "modelo-sintetico",
      configurationVersion: "1",
      status: "failed",
      recommendation: "accept",
    });
    await concludeAndAccept(
      fixture.context,
      await tareaAbierta(issued.contractId)
    );
    await sealColdPackage(issued.contractId);

    const { manifiesto } = await abrirPaquete(issued.contractId);
    expect(manifiesto.reportes_ai).toHaveLength(1);
    expect(manifiesto.reportes_ai[0].estado).toBe("failed");
    expect(manifiesto.reportes_ai[0].recomendacion).toBeNull();
    expect(manifiesto.reportes_ai[0].confianza).toBeNull();
    expect(manifiesto.decisiones[0].decision).toBe("conclude");
  });

  it("sella un Contrato cancelado con intento concluyente nulo", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await emitir(fixture);
    await cancelContract(fixture.context, issued.contractId, "Monto corregido");

    await sealColdPackage(issued.contractId);
    const { zip, manifiesto } = await abrirPaquete(issued.contractId);

    expect([...zip.keys()]).toEqual([
      "contrato.md",
      "aviso-privacidad.md",
      "manifiesto.json",
    ]);
    expect(manifiesto.contrato.estado).toBe("cancelled");
    expect(manifiesto.contrato.aceptado_en).toBeNull();
    expect(manifiesto.intento_concluyente).toBeNull();
    expect(manifiesto.intentos).toHaveLength(1);
    expect(manifiesto.intentos[0].estado).toBe("cancelled");
    expect(manifiesto.intentos[0].archivos_incluidos).toBe(false);
    expect(manifiesto.evidencia).toEqual([]);
    expect(manifiesto.reportes_ai).toEqual([]);
  });

  it("sella un Contrato vencido con intento concluyente nulo", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await emitir(fixture);
    await sql`
      UPDATE contract_links SET expires_at = NOW() - INTERVAL '1 day'
      WHERE contract_id = ${issued.contractId}
    `;
    expect(await expireDueLinks()).toBe(1);

    await sealColdPackage(issued.contractId);
    const { manifiesto } = await abrirPaquete(issued.contractId);

    expect(manifiesto.contrato.estado).toBe("expired");
    expect(manifiesto.intento_concluyente).toBeNull();
    expect(manifiesto.intentos[0].estado).toBe("expired");
  });

  it("no sella un Contrato que todavía no está cerrado", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await emitir(fixture);

    await sealColdPackage(issued.contractId);
    expect(await contarPaquetes(issued.contractId)).toBe(0);
  });

  it("no encuentra un Contrato inexistente", async () => {
    await expect(sealColdPackage(crypto.randomUUID())).rejects.toThrow(
      NotFoundError
    );
  });

  it("sin Custodia activa el paquete nace en Archivo Muerto", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);

    const paquete = await leerPaquete(issued.contractId);
    expect(paquete.tier).toBe("cold");
    expect(paquete.moved_to_cold_at).not.toBeNull();

    const [objeto] = await sql<{ tier: string }[]>`
      SELECT tier FROM contract_objects
      WHERE contract_id = ${issued.contractId} AND kind = 'cold_package'
    `;
    expect(objeto.tier).toBe("cold");
    expect(await contarTrabajos("move_to_cold")).toBe(0);
  });

  it("con Custodia activa el paquete queda inmediato y programa su traslado al año", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);

    const paquete = await leerPaquete(issued.contractId);
    expect(paquete.tier).toBe("immediate");
    expect(paquete.moved_to_cold_at).toBeNull();

    const [objeto] = await sql<{ tier: string }[]>`
      SELECT tier FROM contract_objects
      WHERE contract_id = ${issued.contractId} AND kind = 'cold_package'
    `;
    expect(objeto.tier).toBe("immediate");

    const trabajos = await sql<
      { payload: { contractId: string }; dedupe_key: string; run_after: Date }[]
    >`
      SELECT payload, dedupe_key, run_after FROM background_jobs
      WHERE kind = 'move_to_cold'
    `;
    expect(trabajos).toHaveLength(1);
    expect(trabajos[0].payload.contractId).toBe(issued.contractId);
    expect(trabajos[0].dedupe_key).toBe(`move_to_cold:${issued.contractId}`);
    expect(
      Math.abs(
        trabajos[0].run_after.getTime() -
          (paquete.closed_at.getTime() + ANIO_MS)
      )
    ).toBeLessThan(TOLERANCIA_MS);
  });
});

// ---------------------------------------------------------------------------
// Traslado anual a Archivo Muerto
// ---------------------------------------------------------------------------

describe("moveExpiredPackagesToCold", () => {
  it("traslada sólo los paquetes que ya cumplieron un año", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const antiguo = await contratoCerrado(fixture);
    const reciente = await contratoCerrado(fixture);
    await sealColdPackage(antiguo.contractId);
    await sealColdPackage(reciente.contractId);

    await sql`
      UPDATE cold_contract_packages
      SET closed_at = NOW() - INTERVAL '13 months'
      WHERE contract_id = ${antiguo.contractId}
    `;

    expect(await moveExpiredPackagesToCold()).toBe(1);

    const trasladado = await leerPaquete(antiguo.contractId);
    expect(trasladado.tier).toBe("cold");
    expect(trasladado.moved_to_cold_at).not.toBeNull();
    expect((await leerPaquete(reciente.contractId)).tier).toBe("immediate");

    const [objeto] = await sql<{ tier: string }[]>`
      SELECT tier FROM contract_objects
      WHERE contract_id = ${antiguo.contractId} AND kind = 'cold_package'
    `;
    expect(objeto.tier).toBe("cold");
    expect(await tiposDeEvento(antiguo.contractId)).toContain(
      "paquete_movido_a_frio"
    );
    expect(await tiposDeEvento(reciente.contractId)).not.toContain(
      "paquete_movido_a_frio"
    );
  });

  it("es idempotente y devuelve la cuenta de traslados", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const primero = await contratoCerrado(fixture);
    const segundo = await contratoCerrado(fixture);
    await sealColdPackage(primero.contractId);
    await sealColdPackage(segundo.contractId);
    await sql`
      UPDATE cold_contract_packages SET closed_at = NOW() - INTERVAL '2 years'
    `;

    expect(await moveExpiredPackagesToCold()).toBe(2);
    expect(await moveExpiredPackagesToCold()).toBe(0);

    const eventos = await tiposDeEvento(primero.contractId);
    expect(
      eventos.filter((tipo) => tipo === "paquete_movido_a_frio")
    ).toHaveLength(1);
  });

  it("no toca los paquetes que ya están en Archivo Muerto", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    await sql`
      UPDATE cold_contract_packages SET closed_at = NOW() - INTERVAL '5 years'
    `;

    expect(await moveExpiredPackagesToCold()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Estado de custodia por Organización y rol
// ---------------------------------------------------------------------------

describe("getCustodyState", () => {
  it("describe un Contrato abierto que todavía no tiene paquete", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await emitir(fixture);

    const estado = await getCustodyState(fixture.context, issued.contractId);
    expect(estado).toEqual({
      sealed: false,
      tier: null,
      packageHash: null,
      byteSize: null,
      closedAt: null,
      temporaryCopy: null,
      recovery: null,
      export: null,
      activeCustody: false,
      canRequest: false,
      canDownload: false,
      canDownloadExport: false,
      message: "El paquete se prepara cuando el contrato queda cerrado.",
    });
  });

  it("avisa que el paquete está en preparación cuando el Contrato ya cerró", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);

    const estado = await getCustodyState(fixture.context, issued.contractId);
    expect(estado.sealed).toBe(false);
    expect(estado.closedAt).not.toBeNull();
    expect(estado.message).toBe(
      "Estamos preparando el paquete de este contrato."
    );
  });

  it("sin Custodia activa no ofrece autoservicio y remite al canal externo", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    const paquete = await leerPaquete(issued.contractId);

    const estado = await getCustodyState(fixture.context, issued.contractId);
    expect(estado.sealed).toBe(true);
    expect(estado.tier).toBe("cold");
    expect(estado.activeCustody).toBe(false);
    expect(estado.packageHash).toBe(paquete.sha256);
    expect(estado.byteSize).toBe(paquete.byte_size);
    expect(estado.closedAt?.toISOString()).toBe(paquete.closed_at.toISOString());
    expect(estado.temporaryCopy).toBeNull();
    expect(estado.recovery).toBeNull();
    expect(estado.canDownload).toBe(false);
    expect(estado.message).toBe(
      "El contrato está resguardado. Para recibir una copia, un Administrador debe solicitarla por el canal externo acordado con el Proveedor."
    );
  });

  it("con Custodia activa el Administrador descarga durante el primer año", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);

    const estado = await getCustodyState(fixture.context, issued.contractId);
    expect(estado.activeCustody).toBe(true);
    expect(estado.tier).toBe("immediate");
    expect(estado.canDownload).toBe(true);
    expect(estado.message).toBe(
      "Los archivos de este contrato están disponibles durante el primer año desde su cierre."
    );
  });

  it("Emisores y Revisores ven el registro pero no pueden actuar sobre el ZIP", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);

    for (const roles of [["emitter"], ["reviewer"]] as OrganizationRole[][]) {
      const contexto = await contextoCon(fixture.organization.id, roles);
      const estado = await getCustodyState(contexto, issued.contractId);
      expect(estado.sealed).toBe(true);
      expect(estado.tier).toBe("immediate");
      expect(estado.activeCustody).toBe(true);
      expect(estado.canDownload).toBe(false);
    }
  });

  it("con Custodia activa un paquete histórico anuncia la preparación bajo demanda", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    await sql`
      UPDATE cold_contract_packages SET closed_at = NOW() - INTERVAL '18 months'
    `;
    await moveExpiredPackagesToCold();

    const estado = await getCustodyState(fixture.context, issued.contractId);
    expect(estado.tier).toBe("cold");
    expect(estado.canDownload).toBe(false);
    expect(estado.message).toBe(
      "El archivo está resguardado. `Descargar ZIP` inicia la preparación y estará disponible en un máximo de 48 horas."
    );
  });

  it("anuncia el trabajo en curso y después la falla", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    await requestHistoricalArchive(fixture.context, issued.contractId);

    const enCurso = await getCustodyState(fixture.context, issued.contractId);
    expect(enCurso.recovery?.status).toBe("queued");
    expect(enCurso.message).toBe(
      "Estamos preparando tu archivo. Estará disponible en un máximo de 48 horas."
    );

    await sql`UPDATE recovery_jobs SET status = 'running'`;
    const corriendo = await getCustodyState(fixture.context, issued.contractId);
    expect(corriendo.recovery?.status).toBe("running");
    expect(corriendo.message).toBe(
      "Estamos preparando tu archivo. Estará disponible en un máximo de 48 horas."
    );

    await sql`UPDATE recovery_jobs SET status = 'failed'`;
    const fallido = await getCustodyState(fixture.context, issued.contractId);
    expect(fallido.recovery?.status).toBe("failed");
    expect(fallido.message).toBe(
      "No se pudo preparar el archivo. Puedes intentarlo otra vez."
    );
  });

  it("no encuentra un Contrato de otra Organización", async () => {
    const fixture = await createIssuableOrganization();
    const otra = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);

    await expect(
      getCustodyState(otra.context, issued.contractId)
    ).rejects.toThrow(NotFoundError);
  });

  /**
   * ADR-0036: eliminar un expediente «corta su consulta documental, descarga y
   * exportación dentro del portal».
   */
  it(
    "un expediente eliminado corta la descarga dentro del portal",
    async () => {
      const fixture = await createIssuableOrganization({
        capabilities: { active_custody: true },
      });
      const issued = await contratoCerrado(fixture);
      await sealColdPackage(issued.contractId);
      await deleteContract(fixture.context, issued.contractId);

      const estado = await getCustodyState(fixture.context, issued.contractId);
      expect(estado.canRequest).toBe(false);
      expect(estado.canDownload).toBe(false);
      expect(estado.canDownloadExport).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// Solicitudes desde el portal
// ---------------------------------------------------------------------------

describe("requestHistoricalArchive", () => {
  it("un Administrador con Custodia activa encola la preparación", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);

    await requestHistoricalArchive(fixture.context, issued.contractId);

    const [job] = await sql<
      {
        id: string;
        status: string;
        retrieval_tier: string;
        origin: string;
        requested_by: string;
        requested_by_name: string;
      }[]
    >`
      SELECT id, status, retrieval_tier, origin, requested_by, requested_by_name
      FROM recovery_jobs WHERE contract_id = ${issued.contractId}
    `;
    expect(job.status).toBe("queued");
    expect(job.retrieval_tier).toBe("standard");
    expect(job.origin).toBe("portal");
    expect(job.requested_by).toBe(fixture.account.id);
    expect(job.requested_by_name).toBe(fixture.account.fullName);

    const [trabajo] = await sql<{ payload: { jobId: string } }[]>`
      SELECT payload FROM background_jobs WHERE kind = 'recovery'
    `;
    expect(trabajo.payload.jobId).toBe(job.id);

    expect(await tiposDeEvento(issued.contractId)).toContain(
      "archivo_historico_solicitado"
    );
    const [audit] = await sql<{ subject_id: string; capability: string }[]>`
      SELECT subject_id, capability FROM audit_entries
      WHERE action = 'custody.request_archive'
    `;
    expect(audit.subject_id).toBe(issued.contractId);
    expect(audit.capability).toBe("administrator+emitter");
  });

  it("reutiliza el trabajo vigente del mismo paquete", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);

    await requestHistoricalArchive(fixture.context, issued.contractId);
    await requestHistoricalArchive(fixture.context, issued.contractId);
    expect(await contarRecuperaciones(issued.contractId)).toBe(1);

    // Una copia todavía disponible tampoco abre otra recuperación.
    await sql`
      UPDATE recovery_jobs
      SET status = 'available', available_until = NOW() + INTERVAL '2 days'
    `;
    await requestHistoricalArchive(fixture.context, issued.contractId);
    expect(await contarRecuperaciones(issued.contractId)).toBe(1);
  });

  it("rechaza a quien no es Administrador y no deja trabajo alguno", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    const emisor = await contextoCon(fixture.organization.id, ["emitter"]);

    await expect(
      requestHistoricalArchive(emisor, issued.contractId)
    ).rejects.toThrow(AuthorizationError);
    expect(await contarRecuperaciones(issued.contractId)).toBe(0);
    expect(await contarTrabajos("recovery")).toBe(0);
  });

  it("rechaza la solicitud sin Custodia activa y remite al canal externo", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);

    await expect(
      requestHistoricalArchive(fixture.context, issued.contractId)
    ).rejects.toThrow(
      "Sin Custodia activa, la solicitud se atiende por el canal externo acordado con el Proveedor."
    );
    expect(await contarRecuperaciones(issued.contractId)).toBe(0);
    expect(await contarTrabajos("recovery")).toBe(0);
  });

  it("no encuentra un paquete que todavía no existe", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);

    await expect(
      requestHistoricalArchive(fixture.context, issued.contractId)
    ).rejects.toThrow("Este contrato todavía no tiene paquete.");
    expect(await contarRecuperaciones(issued.contractId)).toBe(0);
  });
});

describe("requestBulkExport", () => {
  it("un Administrador con Custodia activa encola la exportación del lote", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const primero = await contratoResguardado(fixture);
    const segundo = await contratoResguardado(fixture);

    const jobId = await requestBulkExport(fixture.context, [
      primero.contractId,
      segundo.contractId,
    ]);

    const [job] = await sql<
      { id: string; status: string; contract_ids: string[] }[]
    >`
      SELECT id, status, contract_ids FROM export_jobs WHERE id = ${jobId}
    `;
    expect(job.status).toBe("queued");
    expect(job.contract_ids).toEqual([primero.contractId, segundo.contractId]);

    const [trabajo] = await sql<{ payload: { jobId: string } }[]>`
      SELECT payload FROM background_jobs WHERE kind = 'export'
    `;
    expect(trabajo.payload.jobId).toBe(jobId);

    const [audit] = await sql<
      { subject_id: string; payload: { contratos: number } }[]
    >`
      SELECT subject_id, payload FROM audit_entries
      WHERE action = 'custody.request_export'
    `;
    expect(audit.subject_id).toBe(jobId);
    expect(audit.payload.contratos).toBe(2);
  });

  it("rechaza exportar un Contrato que todavía no tiene paquete", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const abierto = await emitir(fixture);

    await expect(
      requestBulkExport(fixture.context, [abierto.contractId])
    ).rejects.toThrow(
      "Sólo pueden exportarse contratos cerrados con su paquete resguardado."
    );
    const [job] = await sql<{ total: string }[]>`
      SELECT count(*)::text AS total FROM export_jobs
    `;
    expect(job.total).toBe("0");
  });

  it("rechaza un lote vacío", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    await expect(requestBulkExport(fixture.context, [])).rejects.toThrow(
      "Selecciona al menos un contrato."
    );
    expect(await contarExportaciones(fixture.organization.id)).toBe(0);
  });

  it("rechaza un lote con un Contrato de otra Organización", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const otra = await createIssuableOrganization();
    const propio = await contratoCerrado(fixture);
    const ajeno = await contratoCerrado(otra);

    await expect(
      requestBulkExport(fixture.context, [propio.contractId, ajeno.contractId])
    ).rejects.toThrow(AuthorizationError);
    expect(await contarExportaciones(fixture.organization.id)).toBe(0);
    expect(await contarTrabajos("export")).toBe(0);
  });

  it("rechaza la exportación sin Custodia activa y al Emisor", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);

    await expect(
      requestBulkExport(fixture.context, [issued.contractId])
    ).rejects.toThrow(AuthorizationError);

    const conCustodia = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const otro = await contratoCerrado(conCustodia);
    const emisor = await contextoCon(conCustodia.organization.id, ["emitter"]);
    await expect(
      requestBulkExport(emisor, [otro.contractId])
    ).rejects.toThrow(AuthorizationError);

    expect(await contarExportaciones(fixture.organization.id)).toBe(0);
    expect(await contarExportaciones(conCustodia.organization.id)).toBe(0);
    expect(await contarTrabajos("export")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Descarga autenticada de los artefactos disponibles
// ---------------------------------------------------------------------------

describe("readContractArchive", () => {
  it("entrega byte por byte el paquete inmediato autorizado", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoResguardado(fixture);
    const paquete = await leerPaquete(issued.contractId);

    const file = await readContractArchive(
      fixture.context,
      issued.contractId
    );

    expect(file.fileName).toBe(`${issued.reference}.zip`);
    expect(file.body.equals(await leerObjeto(paquete.object_key))).toBe(true);
  });

  it("entrega la copia recuperada sólo durante su ventana vigente", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoResguardado(fixture);
    await sql`
      UPDATE cold_contract_packages
      SET tier = 'cold', closed_at = NOW() - INTERVAL '2 years'
      WHERE contract_id = ${issued.contractId}
    `;
    await sql`
      UPDATE contract_objects SET tier = 'cold'
      WHERE contract_id = ${issued.contractId} AND kind = 'cold_package'
    `;
    await requestHistoricalArchive(fixture.context, issued.contractId);
    const [job] = await sql<{ id: string }[]>`
      SELECT id FROM recovery_jobs WHERE contract_id = ${issued.contractId}
    `;
    await runRecoveryJob(job.id);

    const file = await readContractArchive(
      fixture.context,
      issued.contractId
    );
    const paquete = await leerPaquete(issued.contractId);
    expect(file.body.equals(await leerObjeto(paquete.object_key))).toBe(true);

    await sql`
      UPDATE contract_objects SET expires_at = NOW() - INTERVAL '1 minute'
      WHERE contract_id = ${issued.contractId} AND kind = 'temporary_copy'
    `;
    await expect(
      readContractArchive(fixture.context, issued.contractId)
    ).rejects.toThrow("El archivo no está disponible para descargar.");
  });

  it("falla cerrado por rol, producto, Organización y clasificación", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoResguardado(fixture);
    const emisor = await contextoCon(fixture.organization.id, ["emitter"]);
    await expect(
      readContractArchive(emisor, issued.contractId)
    ).rejects.toBeInstanceOf(AuthorizationError);

    const sinProducto = await createIssuableOrganization();
    const cerrado = await contratoResguardado(sinProducto);
    await expect(
      readContractArchive(sinProducto.context, cerrado.contractId)
    ).rejects.toBeInstanceOf(AuthorizationError);

    const ajena = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    await expect(
      readContractArchive(ajena.context, issued.contractId)
    ).rejects.toBeInstanceOf(NotFoundError);

    await deleteContract(fixture.context, issued.contractId);
    await expect(
      readContractArchive(fixture.context, issued.contractId)
    ).rejects.toThrow("El expediente ya no está disponible en el portal.");
  });

  it("rechaza un objeto individual ausente o alterado", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const missing = await contratoResguardado(fixture);
    const missingPackage = await leerPaquete(missing.contractId);
    await getObjectStorage().delete(missingPackage.object_key);
    await expect(
      readContractArchive(fixture.context, missing.contractId)
    ).rejects.toThrow("No pudimos leer el archivo disponible.");

    const altered = await contratoResguardado(fixture);
    const alteredPackage = await leerPaquete(altered.contractId);
    await getObjectStorage().put({
      key: alteredPackage.object_key,
      body: Buffer.from("ZIP ALTERADO"),
      contentType: "application/zip",
    });
    await expect(
      readContractArchive(fixture.context, altered.contractId)
    ).rejects.toThrow("El archivo disponible no coincide con su hash.");

    const technical = await contratoResguardado(fixture);
    const storage = getObjectStorage();
    const failure = new Error("Falla sintética del adaptador");
    const get = vi.spyOn(storage, "get").mockRejectedValueOnce(failure);
    await expect(
      readContractArchive(fixture.context, technical.contractId)
    ).rejects.toBe(failure);
    get.mockRestore();
  });
});

describe("readExportArtifact", () => {
  it("entrega el lote disponible a la misma cuenta Administradora", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoResguardado(fixture);
    const jobId = await requestBulkExport(fixture.context, [issued.contractId]);
    await runExportJob(jobId);

    const [job] = await sql<{ object_key: string }[]>`
      SELECT object_key FROM export_jobs WHERE id = ${jobId}
    `;
    const file = await readExportArtifact(fixture.context, jobId);
    expect(file.fileName).toBe(`exportacion-${jobId}.zip`);
    expect(file.body.equals(await leerObjeto(job.object_key))).toBe(true);

    const state = await getCustodyState(fixture.context, issued.contractId);
    expect(state.export?.id).toBe(jobId);
    expect(state.canDownloadExport).toBe(true);
  });

  it("rechaza otra cuenta, Organización, rol, producto y clasificación", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoResguardado(fixture);
    const jobId = await requestBulkExport(fixture.context, [issued.contractId]);
    await runExportJob(jobId);

    const otraCuenta = await createAccount();
    await addMembership(
      fixture.organization.id,
      otraCuenta.id,
      ["administrator"]
    );
    const otroAdministrador = await buildContext(
      fixture.organization.id,
      otraCuenta,
      ["administrator"]
    );
    await expect(
      readExportArtifact(otroAdministrador, jobId)
    ).rejects.toBeInstanceOf(NotFoundError);

    const ajena = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    await expect(
      readExportArtifact(ajena.context, jobId)
    ).rejects.toBeInstanceOf(NotFoundError);

    const emisor = await contextoCon(fixture.organization.id, ["emitter"]);
    await expect(
      readExportArtifact(emisor, jobId)
    ).rejects.toBeInstanceOf(AuthorizationError);

    const sinProducto = await createIssuableOrganization();
    await expect(
      readExportArtifact(sinProducto.context, jobId)
    ).rejects.toBeInstanceOf(AuthorizationError);

    await deleteContract(fixture.context, issued.contractId);
    await expect(
      readExportArtifact(fixture.context, jobId)
    ).rejects.toThrow("La exportación no está disponible.");
  });

  it("rechaza una exportación expirada o cuyo objeto desapareció", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const expiredContract = await contratoResguardado(fixture);
    const expiredJob = await requestBulkExport(fixture.context, [
      expiredContract.contractId,
    ]);
    await runExportJob(expiredJob);
    await sql`
      UPDATE export_jobs SET available_until = NOW() - INTERVAL '1 minute'
      WHERE id = ${expiredJob}
    `;
    await expect(
      readExportArtifact(fixture.context, expiredJob)
    ).rejects.toThrow("La exportación no está disponible.");

    const missingContract = await contratoResguardado(fixture);
    const missingJob = await requestBulkExport(fixture.context, [
      missingContract.contractId,
    ]);
    await runExportJob(missingJob);
    const [job] = await sql<{ object_key: string }[]>`
      SELECT object_key FROM export_jobs WHERE id = ${missingJob}
    `;
    await getObjectStorage().delete(job.object_key);
    await expect(
      readExportArtifact(fixture.context, missingJob)
    ).rejects.toThrow("No pudimos leer la exportación disponible.");
  });
});

// ---------------------------------------------------------------------------
// Ejecución de los trabajos
// ---------------------------------------------------------------------------

describe("runRecoveryJob", () => {
  it("publica el ZIP exacto por tres días completos y avisa al solicitante", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    const paquete = await leerPaquete(issued.contractId);
    await requestHistoricalArchive(fixture.context, issued.contractId);
    const [pendiente] = await sql<{ id: string }[]>`SELECT id FROM recovery_jobs`;

    await runRecoveryJob(pendiente.id);

    const [job] = await sql<
      {
        status: string;
        object_key: string;
        available_until: Date;
        completed_at: Date;
      }[]
    >`
      SELECT status, object_key, available_until, completed_at
      FROM recovery_jobs WHERE id = ${pendiente.id}
    `;
    expect(job.status).toBe("available");
    expect(
      Math.abs(job.available_until.getTime() - (Date.now() + TRES_DIAS_MS))
    ).toBeLessThan(TOLERANCIA_MS);

    const [copia] = await sql<
      {
        object_key: string;
        tier: string;
        sha256: string;
        byte_size: number;
        expires_at: Date;
      }[]
    >`
      SELECT object_key, tier, sha256, byte_size, expires_at
      FROM contract_objects
      WHERE contract_id = ${issued.contractId} AND kind = 'temporary_copy'
    `;
    expect(copia.tier).toBe("temporary");
    expect(copia.object_key).toBe(job.object_key);
    expect(copia.sha256).toBe(paquete.sha256);
    expect(copia.byte_size).toBe(paquete.byte_size);

    // La copia es el mismo ZIP, sin descomprimir ni reconstruir.
    const original = await leerObjeto(paquete.object_key);
    const entregada = await leerObjeto(copia.object_key);
    expect(entregada.equals(original)).toBe(true);

    expect(await tiposDeEvento(issued.contractId)).toContain(
      "copia_temporal_publicada"
    );
    const [aviso] = await sql<
      { template: string; recipient: string; channel: string }[]
    >`
      SELECT template, recipient, channel FROM notification_outbox
    `;
    expect(aviso.template).toBe("archivo_historico_listo");
    expect(aviso.recipient).toBe(fixture.account.email);
    expect(aviso.channel).toBe("email");

    const estado = await getCustodyState(fixture.context, issued.contractId);
    expect(estado.temporaryCopy?.objectKey).toBe(copia.object_key);
    expect(estado.canDownload).toBe(true);
    expect(estado.message).toContain(
      `hasta el ${formatDate(copia.expires_at)}`
    );
  });

  it("una segunda ejecución del mismo trabajo no duplica la copia", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    await requestHistoricalArchive(fixture.context, issued.contractId);
    const [job] = await sql<{ id: string }[]>`SELECT id FROM recovery_jobs`;

    await runRecoveryJob(job.id);
    await runRecoveryJob(job.id);

    const [row] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM contract_objects
      WHERE contract_id = ${issued.contractId} AND kind = 'temporary_copy'
    `;
    expect(Number(row.total)).toBe(1);
  });

  it("no encuentra una recuperación inexistente", async () => {
    await expect(runRecoveryJob(crypto.randomUUID())).rejects.toThrow(
      NotFoundError
    );
  });

  it("publica la copia aunque la cuenta solicitante ya no exista", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    await requestHistoricalArchive(fixture.context, issued.contractId);
    // `requested_by` queda en NULL cuando se elimina la cuenta.
    await sql`UPDATE recovery_jobs SET requested_by = NULL`;
    const [job] = await sql<{ id: string }[]>`SELECT id FROM recovery_jobs`;

    await runRecoveryJob(job.id);

    const [estado] = await sql<{ status: string }[]>`
      SELECT status FROM recovery_jobs WHERE id = ${job.id}
    `;
    expect(estado.status).toBe("available");
    const [correos] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM notification_outbox
    `;
    expect(Number(correos.total)).toBe(0);
  });

  it("marca la recuperación como fallida sin entregar nada", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    const paquete = await leerPaquete(issued.contractId);
    await requestHistoricalArchive(fixture.context, issued.contractId);
    const [job] = await sql<{ id: string }[]>`SELECT id FROM recovery_jobs`;

    // El objeto conservado deja de coincidir con su hash registrado.
    await getObjectStorage().put({
      key: paquete.object_key,
      body: Buffer.from("paquete dañado"),
      contentType: "application/zip",
    });

    await expect(runRecoveryJob(job.id)).rejects.toThrow(DomainError);

    const [fallido] = await sql<{ status: string; error: string }[]>`
      SELECT status, error FROM recovery_jobs WHERE id = ${job.id}
    `;
    expect(fallido.status).toBe("failed");
    expect(fallido.error).toBe("El paquete recuperado no coincide con su hash.");

    const [row] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM contract_objects
      WHERE contract_id = ${issued.contractId} AND kind = 'temporary_copy'
    `;
    expect(Number(row.total)).toBe(0);

    const [aviso] = await sql<{ template: string }[]>`
      SELECT template FROM notification_outbox
    `;
    expect(aviso.template).toBe("archivo_historico_fallido");

    const estado = await getCustodyState(fixture.context, issued.contractId);
    expect(estado.temporaryCopy).toBeNull();
    expect(estado.message).toBe(
      "No se pudo preparar el archivo. Puedes intentarlo otra vez."
    );
  });

  it("al expirar la copia el contenido vuelve a Resguardado", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    await sql`
      UPDATE cold_contract_packages SET closed_at = NOW() - INTERVAL '2 years'
    `;
    await moveExpiredPackagesToCold();
    await requestHistoricalArchive(fixture.context, issued.contractId);
    const [job] = await sql<{ id: string }[]>`SELECT id FROM recovery_jobs`;
    await runRecoveryJob(job.id);

    expect(
      (await getCustodyState(fixture.context, issued.contractId)).canDownload
    ).toBe(true);

    await sql`
      UPDATE contract_objects SET expires_at = NOW() - INTERVAL '1 hour'
      WHERE kind = 'temporary_copy'
    `;
    await sql`
      UPDATE recovery_jobs SET available_until = NOW() - INTERVAL '1 hour'
    `;

    const estado = await getCustodyState(fixture.context, issued.contractId);
    expect(estado.temporaryCopy).toBeNull();
    expect(estado.canDownload).toBe(false);
    expect(estado.message).toBe(
      "El archivo está resguardado. `Descargar ZIP` inicia la preparación y estará disponible en un máximo de 48 horas."
    );

    // El contrato, sus metadatos y el paquete canónico siguen intactos.
    expect(estado.sealed).toBe(true);
    expect(estado.packageHash).toBe(
      (await leerPaquete(issued.contractId)).sha256
    );

    // Una necesidad posterior sí puede iniciar otra preparación.
    await requestHistoricalArchive(fixture.context, issued.contractId);
    expect(await contarRecuperaciones(issued.contractId)).toBe(2);
  });
});

describe("runExportJob", () => {
  it("entrega un contenedor con un ZIP completo por Contrato y nada más", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const primero = await contratoResguardado(fixture);
    const segundo = await contratoResguardado(fixture);

    const jobId = await requestBulkExport(fixture.context, [
      primero.contractId,
      segundo.contractId,
    ]);
    await runExportJob(jobId);

    const [job] = await sql<
      { status: string; object_key: string; available_until: Date }[]
    >`
      SELECT status, object_key, available_until FROM export_jobs
      WHERE id = ${jobId}
    `;
    expect(job.status).toBe("available");
    expect(job.object_key).toBe(
      `organizations/${fixture.organization.id}/exports/${jobId}.zip`
    );
    expect(
      Math.abs(job.available_until.getTime() - (Date.now() + TRES_DIAS_MS))
    ).toBeLessThan(TOLERANCIA_MS);

    const contenedor = leerZip(await leerObjeto(job.object_key));
    expect([...contenedor.keys()]).toEqual([
      `${primero.reference}.zip`,
      `${segundo.reference}.zip`,
    ]);

    // Cada paquete viaja byte por byte, sin CSV, índice ni componentes sueltos.
    for (const issued of [primero, segundo]) {
      const paquete = await leerPaquete(issued.contractId);
      const original = await leerObjeto(paquete.object_key);
      const dentro = contenedor.get(`${issued.reference}.zip`);
      expect(dentro?.equals(original)).toBe(true);
      expect(sha256Hex(dentro as Buffer)).toBe(paquete.sha256);
    }

    const [aviso] = await sql<
      { template: string; payload: { contratos: number } }[]
    >`
      SELECT template, payload FROM notification_outbox
    `;
    expect(aviso.template).toBe("exportacion_lista");
    expect(aviso.payload.contratos).toBe(2);
  });

  it("una falla del lote no entrega nada parcial", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const cerrado = await contratoResguardado(fixture);
    const perdido = await contratoResguardado(fixture);

    const jobId = await requestBulkExport(fixture.context, [
      cerrado.contractId,
      perdido.contractId,
    ]);
    // El objeto del paquete desaparece después de aceptar la solicitud.
    await sql`
      UPDATE cold_contract_packages
      SET object_key = 'organizations/inexistente/paquete-perdido.zip'
      WHERE contract_id = ${perdido.contractId}
    `;
    await expect(runExportJob(jobId)).rejects.toThrow(DomainError);

    const [job] = await sql<
      { status: string; object_key: string | null; error: string }[]
    >`
      SELECT status, object_key, error FROM export_jobs WHERE id = ${jobId}
    `;
    expect(job.status).toBe("failed");
    expect(job.object_key).toBeNull();
    expect(job.error).toBe("No pudimos leer el paquete resguardado.");

    const almacenado = await getObjectStorage().head(
      `organizations/${fixture.organization.id}/exports/${jobId}.zip`
    );
    expect(almacenado).toBeNull();

    const [aviso] = await sql<{ template: string }[]>`
      SELECT template FROM notification_outbox
    `;
    expect(aviso.template).toBe("exportacion_fallida");
  });

  it("una segunda ejecución no rehace el lote", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoResguardado(fixture);
    const jobId = await requestBulkExport(fixture.context, [issued.contractId]);

    await runExportJob(jobId);
    const [primero] = await sql<{ completed_at: Date }[]>`
      SELECT completed_at FROM export_jobs WHERE id = ${jobId}
    `;
    await runExportJob(jobId);
    const [segundo] = await sql<{ completed_at: Date; status: string }[]>`
      SELECT completed_at, status FROM export_jobs WHERE id = ${jobId}
    `;
    expect(segundo.status).toBe("available");
    expect(segundo.completed_at.toISOString()).toBe(
      primero.completed_at.toISOString()
    );
  });

  it("vuelve a sellar el paquete que desapareció después de solicitar el lote", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoResguardado(fixture);
    const jobId = await requestBulkExport(fixture.context, [issued.contractId]);
    await sql`
      DELETE FROM cold_contract_packages WHERE contract_id = ${issued.contractId}
    `;

    await runExportJob(jobId);

    const [job] = await sql<{ status: string; object_key: string | null }[]>`
      SELECT status, object_key FROM export_jobs WHERE id = ${jobId}
    `;
    expect(job.status).toBe("available");
    expect(job.object_key).toBeTruthy();
    const [pkg] = await sql<{ total: string }[]>`
      SELECT count(*)::text AS total FROM cold_contract_packages
      WHERE contract_id = ${issued.contractId}
    `;
    expect(pkg.total).toBe("1");
  });

  it("no encuentra una exportación inexistente", async () => {
    await expect(runExportJob(crypto.randomUUID())).rejects.toThrow(
      NotFoundError
    );
  });

  it("genera y falla el lote sin correo cuando la cuenta solicitante ya no existe", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const cerrado = await contratoResguardado(fixture);
    const perdido = await contratoResguardado(fixture);

    const listo = await requestBulkExport(fixture.context, [cerrado.contractId]);
    const fallido = await requestBulkExport(fixture.context, [
      perdido.contractId,
    ]);
    await sql`
      UPDATE cold_contract_packages
      SET object_key = 'organizations/inexistente/paquete-perdido.zip'
      WHERE contract_id = ${perdido.contractId}
    `;
    await sql`UPDATE export_jobs SET requested_by = NULL`;

    await runExportJob(listo);
    await expect(runExportJob(fallido)).rejects.toThrow(DomainError);

    const [correos] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM notification_outbox
    `;
    expect(Number(correos.total)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Vista interna del Administrador de plataforma
// ---------------------------------------------------------------------------

describe("platformRecoverPackage", () => {
  it("rechaza a quien no es Administrador de plataforma", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);

    await expect(
      platformRecoverPackage(fixture.account.id, issued.contractId, false)
    ).rejects.toThrow(AuthorizationError);
    await expect(
      platformRecoverPackage(crypto.randomUUID(), issued.contractId, true)
    ).rejects.toThrow(AuthorizationError);
  });

  it("la inspección interna no publica nada en el expediente", async () => {
    const fixture = await createIssuableOrganization();
    const plataforma = await createAccount({ isPlatformAdmin: true });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    const paquete = await leerPaquete(issued.contractId);

    await platformRecoverPackage(plataforma.id, issued.contractId, false);

    const [audit] = await sql<
      {
        action: string;
        actor_kind: string;
        organization_id: string;
        payload: { sha256: string; bytes: number };
      }[]
    >`
      SELECT action, actor_kind, organization_id, payload FROM audit_entries
      WHERE action LIKE 'custody.platform%'
    `;
    expect(audit.action).toBe("custody.platform_inspect");
    expect(audit.actor_kind).toBe("platform");
    expect(audit.organization_id).toBe(fixture.organization.id);
    expect(audit.payload.sha256).toBe(paquete.sha256);
    expect(audit.payload.bytes).toBe(paquete.byte_size);

    const estado = await getCustodyState(fixture.context, issued.contractId);
    expect(estado.temporaryCopy).toBeNull();
    expect(estado.canDownload).toBe(false);
    expect(await tiposDeEvento(issued.contractId)).not.toContain(
      "copia_temporal_publicada"
    );
  });

  it("publica el ZIP exacto dentro del expediente cuando corresponde", async () => {
    const fixture = await createIssuableOrganization();
    const plataforma = await createAccount({ isPlatformAdmin: true });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    const paquete = await leerPaquete(issued.contractId);

    await platformRecoverPackage(plataforma.id, issued.contractId, true);

    const [copia] = await sql<
      { object_key: string; sha256: string; expires_at: Date }[]
    >`
      SELECT object_key, sha256, expires_at FROM contract_objects
      WHERE contract_id = ${issued.contractId} AND kind = 'temporary_copy'
    `;
    expect(copia.sha256).toBe(paquete.sha256);
    expect(
      Math.abs(copia.expires_at.getTime() - (Date.now() + TRES_DIAS_MS))
    ).toBeLessThan(TOLERANCIA_MS);
    expect(
      (await leerObjeto(copia.object_key)).equals(
        await leerObjeto(paquete.object_key)
      )
    ).toBe(true);

    const [audit] = await sql<{ action: string }[]>`
      SELECT action FROM audit_entries WHERE action LIKE 'custody.platform%'
    `;
    expect(audit.action).toBe("custody.platform_publish");
    expect(await tiposDeEvento(issued.contractId)).toContain(
      "copia_temporal_publicada"
    );

    // Sin Custodia activa, un Administrador sí descarga la copia publicada.
    const estado = await getCustodyState(fixture.context, issued.contractId);
    expect(estado.activeCustody).toBe(false);
    expect(estado.canDownload).toBe(true);

    const emisor = await contextoCon(fixture.organization.id, ["emitter"]);
    expect(
      (await getCustodyState(emisor, issued.contractId)).canDownload
    ).toBe(false);
  });

  it("no encuentra un paquete inexistente", async () => {
    const fixture = await createIssuableOrganization();
    const plataforma = await createAccount({ isPlatformAdmin: true });
    const issued = await contratoCerrado(fixture);

    await expect(
      platformRecoverPackage(plataforma.id, issued.contractId, false)
    ).rejects.toThrow("Este contrato no tiene paquete frío.");
  });
});

describe("searchColdArchive", () => {
  it("agrupa el inventario por Organización", async () => {
    const primera = await createIssuableOrganization({ name: "Aerolínea Norte" });
    const segunda = await createIssuableOrganization({ name: "Clínica Sur" });
    const unoA = await contratoCerrado(primera);
    const unoB = await contratoCerrado(primera);
    const dosA = await contratoCerrado(segunda);
    for (const issued of [unoA, unoB, dosA]) {
      await sealColdPackage(issued.contractId);
    }

    const todas = await searchColdArchive({});
    expect(todas.total).toBe(3);
    expect(todas.page).toBe(1);
    expect(todas.pages).toBe(1);
    expect(todas.rows).toHaveLength(3);

    const soloPrimera = await searchColdArchive({
      organizationId: primera.organization.id,
    });
    expect(soloPrimera.total).toBe(2);
    expect(
      soloPrimera.rows.every(
        (row) => row.organizationId === primera.organization.id
      )
    ).toBe(true);
    expect(
      soloPrimera.rows.every((row) => row.organizationName === "Aerolínea Norte")
    ).toBe(true);
  });

  it("busca por referencia, Organización y contrato-plantilla", async () => {
    const primera = await createIssuableOrganization({ name: "Aerolínea Norte" });
    const segunda = await createIssuableOrganization({ name: "Clínica Sur" });
    const uno = await contratoCerrado(primera);
    const dos = await contratoCerrado(primera);
    const tres = await contratoCerrado(segunda);
    for (const issued of [uno, dos, tres]) {
      await sealColdPackage(issued.contractId);
    }
    // La Referencia contractual es consecutiva por Organización y día.
    expect(uno.reference).not.toBe(dos.reference);

    const porReferencia = await searchColdArchive({ query: dos.reference });
    expect(porReferencia.rows.map((row) => row.contractId)).toEqual([
      dos.contractId,
    ]);

    const porOrganizacion = await searchColdArchive({ query: "clínica" });
    expect(porOrganizacion.rows.map((row) => row.contractId)).toEqual([
      tres.contractId,
    ]);

    const porPlantilla = await searchColdArchive({
      query: segunda.template.name,
    });
    expect(porPlantilla.rows.map((row) => row.contractId)).toEqual([
      tres.contractId,
    ]);

    expect((await searchColdArchive({ query: "   " })).total).toBe(3);
    expect((await searchColdArchive({ query: "sin-resultado" })).total).toBe(0);
  });

  it("devuelve el inventario completo de cada paquete", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    const paquete = await leerPaquete(issued.contractId);

    const [row] = (await searchColdArchive({})).rows;
    expect(row).toEqual({
      contractId: issued.contractId,
      reference: issued.reference,
      organizationId: fixture.organization.id,
      organizationName: fixture.organization.name,
      tier: "immediate",
      byteSize: paquete.byte_size,
      sha256: paquete.sha256,
      objectKey: paquete.object_key,
      closedAt: paquete.closed_at,
      movedToColdAt: null,
    });
  });

  it("normaliza la página solicitada", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);

    expect((await searchColdArchive({ page: 0 })).page).toBe(1);
    expect((await searchColdArchive({ page: -3 })).page).toBe(1);

    const segunda = await searchColdArchive({ page: 2 });
    expect(segunda.page).toBe(2);
    expect(segunda.pages).toBe(1);
    expect(segunda.rows).toEqual([]);
  });

  it("no devuelve nada cuando no hay paquetes", async () => {
    const vacio = await searchColdArchive({ organizationId: crypto.randomUUID() });
    expect(vacio.total).toBe(0);
    expect(vacio.pages).toBe(1);
    expect(vacio.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ramas defensivas del sellado
// ---------------------------------------------------------------------------

/**
 * Estados que la ruta real no produce, pero que la base todavía admite. El
 * Paquete contractual frío se sella igual: nunca se queda sin manifiesto por un
 * dato accesorio incompleto.
 */
describe("sealColdPackage ante datos accesorios incompletos", () => {
  async function contratoConIne(): Promise<{
    fixture: Fixture;
    issued: IssuedContractResult;
  }> {
    const fixture = await createIssuableOrganization({
      capabilities: { evidence_ine: true },
    });
    const issued = await emitir(fixture, { requiresIne: true });
    await markContractWalked(issued.token);
    await subirIne(
      issued.token,
      Buffer.from("INE-FRENTE-SINTETICO"),
      Buffer.from("INE-REVERSO-SINTETICO")
    );
    await acceptContract(issued.token, {
      legendAccepted: true,
      declaredName: "Firmante sintético",
      userAgent: "vitest",
    });
    return { fixture, issued };
  }

  it("nombra con `.bin` la evidencia cuyo tipo de contenido no está catalogado", async () => {
    const { issued } = await contratoConIne();
    await sql`
      UPDATE evidence_items SET content_type = 'application/x-desconocido'
      WHERE contract_id = ${issued.contractId} AND kind = 'ine_front'
    `;

    await sealColdPackage(issued.contractId);
    const { zip, manifiesto } = await abrirPaquete(issued.contractId);

    expect([...zip.keys()].sort()).toEqual([
      "aviso-privacidad.md",
      "contrato.md",
      "evidencia/aceptacion.json",
      "evidencia/ine-frente.bin",
      "evidencia/ine-reverso.png",
      "manifiesto.json",
    ]);
    expect(zip.get("evidencia/ine-frente.bin")?.toString("utf8")).toBe(
      "INE-FRENTE-SINTETICO"
    );
    expect(
      manifiesto.evidencia.find((item) => item.categoria === "ine_front")?.tipo
    ).toBe("application/x-desconocido");
    expect(
      manifiesto.componentes.map((componente) => componente.nombre)
    ).toContain("evidencia/ine-frente.bin");
  });

  it("omite del ZIP la evidencia que se quedó sin localizador", async () => {
    const { issued } = await contratoConIne();
    await sql`
      UPDATE evidence_items SET object_key = ''
      WHERE contract_id = ${issued.contractId} AND kind = 'ine_back'
    `;

    await sealColdPackage(issued.contractId);
    const { zip, manifiesto } = await abrirPaquete(issued.contractId);

    expect([...zip.keys()].sort()).toEqual([
      "aviso-privacidad.md",
      "contrato.md",
      "evidencia/aceptacion.json",
      "evidencia/ine-frente.png",
      "manifiesto.json",
    ]);
    // El manifiesto sigue declarando la evidencia recibida aunque su archivo
    // ya no pueda recuperarse.
    expect(
      manifiesto.evidencia.map((item) => item.categoria).sort()
    ).toEqual(["acceptance", "ine_back", "ine_front"]);
    expect(
      manifiesto.componentes.map((componente) => componente.nombre)
    ).not.toContain("evidencia/ine-reverso.png");
  });

  it("sella el paquete aunque falte la parte Firmante en la instantánea", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);
    await sql`
      DELETE FROM contract_parties
      WHERE contract_id = ${issued.contractId} AND party_role = 'signer'
    `;

    await sealColdPackage(issued.contractId);
    const { zip, manifiesto } = await abrirPaquete(issued.contractId);

    expect(manifiesto.partes.map((parte) => parte.rol)).toEqual(["holder"]);
    expect(zip.has("contrato.pdf")).toBe(false);
    expect(manifiesto.hash_evidencia).toMatch(/^[0-9a-f]{64}$/);
  });

  it("acepta un Intento concluyente sin marcas de envío ni de cierre", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);
    await sql`
      UPDATE acceptance_attempts SET submitted_at = NULL, closed_at = NULL
      WHERE contract_id = ${issued.contractId}
    `;

    await sealColdPackage(issued.contractId);
    const { manifiesto } = await abrirPaquete(issued.contractId);

    expect(manifiesto.intento_concluyente?.enviado_en).toBeNull();
    expect(manifiesto.intento_concluyente?.cerrado_en).toBeNull();
    expect(manifiesto.intentos).toHaveLength(1);
    expect(manifiesto.intentos[0].enviado_en).toBeNull();
    expect(manifiesto.intentos[0].cerrado_en).toBeNull();
    // El cierre del Contrato es el que manda sobre el paquete.
    expect(manifiesto.contrato.cerrado_en).not.toBeNull();
  });

  it("redacta el contenido de un evento marcado como sensible", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);
    await sql`
      INSERT INTO contract_events (
        contract_id, organization_id, type, actor_kind, actor_name,
        sensitive, payload
      ) VALUES (
        ${issued.contractId}, ${fixture.organization.id},
        'evidencia_sensible_registrada', 'system', 'Sistema', TRUE,
        ${JSON.stringify({ archivo: "ine-frente.png" })}::text::jsonb
      )
    `;

    await sealColdPackage(issued.contractId);
    const { manifiesto } = await abrirPaquete(issued.contractId);

    const sensible = manifiesto.linea_de_tiempo.find(
      (evento) => evento.tipo === "evidencia_sensible_registrada"
    );
    expect(sensible).toBeDefined();
    expect(sensible?.datos).toBeNull();
    // El resto de la línea de tiempo conserva sus datos no sensibles.
    const sellado = manifiesto.linea_de_tiempo.find(
      (evento) => evento.tipo === "contrato_emitido"
    );
    expect(sellado?.datos).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sellado simultáneo del mismo Contrato
// ---------------------------------------------------------------------------

describe("sealColdPackage bajo concurrencia", () => {
  /**
   * Dos sellados del mismo Contrato producen un solo Paquete contractual frío.
   * El que llega tarde descarta su propio objeto en vez de dejar basura en el
   * almacenamiento privado.
   */
  it("descarta su objeto cuando otro sellado registró antes el paquete", async () => {
    const fixture = await createIssuableOrganization();
    const issued = await contratoCerrado(fixture);
    const [contrato] = await sql<{ closed_at: Date }[]>`
      SELECT closed_at FROM contracts WHERE id = ${issued.contractId}
    `;

    const claveAjena = `organizations/${fixture.organization.id}/cold/${issued.contractId}/paquete-ganador.zip`;
    const clavePropia = `organizations/${fixture.organization.id}/cold/${issued.contractId}/paquete-${issued.reference.replace(/[^A-Za-z0-9._-]/g, "-")}.zip`;

    let arrancar: () => void = () => undefined;
    const permiso = new Promise<void>((resolve) => {
      arrancar = resolve;
    });
    const perdedor = permiso.then(() => sealColdPackage(issued.contractId));

    const extra = nuevaConexion();
    try {
      await extra.begin(async (tx) => {
        await tx`
          INSERT INTO cold_contract_packages (
            contract_id, organization_id, object_key, sha256, byte_size,
            manifest, tier, closed_at
          ) VALUES (
            ${issued.contractId}, ${fixture.organization.id}, ${claveAjena},
            ${sha256Hex(Buffer.from("paquete ganador"))}, 15,
            '{}'::jsonb, 'cold', ${contrato.closed_at}
          )
        `;
        arrancar();
        await esperarSesionEnEspera(tx);
      });
      await perdedor;
    } finally {
      await perdedor.catch(() => undefined);
      await extra.end({ timeout: 5 });
    }

    expect(await contarPaquetes(issued.contractId)).toBe(1);
    const paquete = await leerPaquete(issued.contractId);
    expect(paquete.object_key).toBe(claveAjena);

    // El sellado perdedor limpió su propio objeto y no registró nada más.
    expect(await getObjectStorage().head(clavePropia)).toBeNull();
    const objetos = await sql<{ id: string }[]>`
      SELECT id FROM contract_objects
      WHERE contract_id = ${issued.contractId} AND kind = 'cold_package'
    `;
    expect(objetos).toHaveLength(0);
    expect(await tiposDeEvento(issued.contractId)).not.toContain(
      "paquete_frio_sellado"
    );
  });
});

// ---------------------------------------------------------------------------
// Fallas que no llegan como `Error`
// ---------------------------------------------------------------------------

describe("trabajos de custodia ante una falla sin `Error`", () => {
  it("registra `Error desconocido` en la recuperación", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    await requestHistoricalArchive(fixture.context, issued.contractId);
    const [trabajo] = await sql<{ id: string }[]>`
      SELECT id FROM recovery_jobs WHERE contract_id = ${issued.contractId}
    `;

    const espia = vi
      .spyOn(getObjectStorage(), "get")
      .mockRejectedValue("falla sin Error");
    let capturado: unknown;
    try {
      await runRecoveryJob(trabajo.id);
    } catch (error) {
      capturado = error;
    } finally {
      espia.mockRestore();
    }
    expect(capturado).toBe("falla sin Error");

    const [fila] = await sql<{ status: string; error: string | null }[]>`
      SELECT status, error FROM recovery_jobs WHERE id = ${trabajo.id}
    `;
    expect(fila.status).toBe("failed");
    expect(fila.error).toBe("Error desconocido");

    const [aviso] = await sql<{ template: string }[]>`
      SELECT template FROM notification_outbox
      WHERE dedupe_key = ${`recovery_failed:${trabajo.id}`}
    `;
    expect(aviso.template).toBe("archivo_historico_fallido");
  });

  it("registra `Error desconocido` en la exportación", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { active_custody: true },
    });
    const issued = await contratoCerrado(fixture);
    await sealColdPackage(issued.contractId);
    const trabajoId = await requestBulkExport(fixture.context, [
      issued.contractId,
    ]);

    const espia = vi
      .spyOn(getObjectStorage(), "get")
      .mockRejectedValue("falla sin Error");
    let capturado: unknown;
    try {
      await runExportJob(trabajoId);
    } catch (error) {
      capturado = error;
    } finally {
      espia.mockRestore();
    }
    expect(capturado).toBe("falla sin Error");

    const [fila] = await sql<{ status: string; error: string | null }[]>`
      SELECT status, error FROM export_jobs WHERE id = ${trabajoId}
    `;
    expect(fila.status).toBe("failed");
    expect(fila.error).toBe("Error desconocido");

    const [aviso] = await sql<{ template: string }[]>`
      SELECT template FROM notification_outbox
      WHERE dedupe_key = ${`export_failed:${trabajoId}`}
    `;
    expect(aviso.template).toBe("exportacion_fallida");
  });
});
