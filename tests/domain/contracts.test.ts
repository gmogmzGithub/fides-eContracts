import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import type { OrganizationContext } from "@/lib/auth/guards";
import {
  cancelContract,
  countContracts,
  createFolder,
  createFromExpired,
  deleteContract,
  deleteFolder,
  duplicateForCorrection,
  getContractDetail,
  listFolders,
  moveToFolder,
  renameFolder,
  searchContracts,
  setArchived,
} from "@/lib/domain/contracts";
import type { IssuedContractResult, SaveDraftPatch } from "@/lib/domain/drafts";
import {
  createDraft,
  getDraft,
  issueContract,
  saveDraft,
} from "@/lib/domain/drafts";
import type { SignerView } from "@/lib/domain/signer";
import {
  acceptContract,
  loadSignerView,
  markContractWalked,
  storeEvidence,
} from "@/lib/domain/signer";
import {
  concludeAndAccept,
  listReviewTasks,
  repeatProcess,
  saveAiReport,
} from "@/lib/domain/review";
import { expireDueLinks } from "@/lib/domain/expiry";
import { publishTemplateVersion } from "@/lib/domain/templates";
import { setCounterpartyActive } from "@/lib/domain/counterparties";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "@/lib/domain/errors";
import {
  addMembership,
  buildContext,
  createAccount,
  createIssuableOrganization,
} from "@/tests/helpers/database";

// ---------------------------------------------------------------------------
// Utilidades del escenario
// ---------------------------------------------------------------------------

const VALORES: Record<string, string> = {
  objeto: "Traslado ejecutivo Toluca-Monterrey",
  monto: "125000",
};

const CLAVES_EXPEDIENTE = [
  "acceptanceLegend",
  "acceptedAt",
  "archivedAt",
  "attempts",
  "cancelReason",
  "cancelledAt",
  "classification",
  "closedAt",
  "configuration",
  "contractMarkdown",
  "currentLink",
  "custody",
  "customized",
  "defaults",
  "deletedAt",
  "documentHash",
  "emitterId",
  "emitterName",
  "events",
  "expiredAt",
  "fieldValues",
  "fields",
  "folderId",
  "folderName",
  "holder",
  "id",
  "issuedAt",
  "organizationId",
  "originContractId",
  "originReason",
  "openReviewTaskId",
  "permissions",
  "privacyNoticeVersionId",
  "reference",
  "signer",
  "status",
  "templateId",
  "templateLabel",
  "templateName",
  "templateVersionId",
  "updatedAt",
  "videoStatement",
].sort();

const CLAVES_PERMISOS = [
  "canAcceptReview",
  "canArchive",
  "canCancel",
  "canCopyLink",
  "canCreateSuccessor",
  "canDelete",
  "canDuplicate",
  "canMoveFolder",
  "canOpenSensitiveEvidence",
  "canViewDocument",
].sort();

type OpcionesOrganizacion = Parameters<typeof createIssuableOrganization>[0];

/**
 * Reparto completo de una Organización: el Emisor creador, otro Emisor, un
 * Administrador sin rol Emisor y un Revisor. Los roles no se acumulan aquí
 * para poder comprobar cada permiso por separado.
 */
async function montarEscenario(opciones: OpcionesOrganizacion = {}) {
  const base = await createIssuableOrganization(opciones);
  const organizationId = base.organization.id;

  const cuentaEmisor = await createAccount({ fullName: "Emisora Creadora" });
  await addMembership(organizationId, cuentaEmisor.id, ["emitter"]);
  const emisor = await buildContext(organizationId, cuentaEmisor, ["emitter"]);

  const cuentaOtroEmisor = await createAccount({ fullName: "Emisor Ajeno" });
  await addMembership(organizationId, cuentaOtroEmisor.id, ["emitter"]);
  const otroEmisor = await buildContext(organizationId, cuentaOtroEmisor, [
    "emitter",
  ]);

  const cuentaAdministrador = await createAccount({
    fullName: "Administradora Sola",
  });
  await addMembership(organizationId, cuentaAdministrador.id, ["administrator"]);
  const administrador = await buildContext(
    organizationId,
    cuentaAdministrador,
    ["administrator"]
  );

  const cuentaRevisor = await createAccount({ fullName: "Revisor Solo" });
  await addMembership(organizationId, cuentaRevisor.id, ["reviewer"]);
  const revisor = await buildContext(organizationId, cuentaRevisor, ["reviewer"]);

  const cuentaSinRol = await createAccount({ fullName: "Persona Sin Rol" });
  const sinRol = await buildContext(organizationId, cuentaSinRol, []);

  const plataforma = await buildContext(organizationId, base.account, [
    "administrator",
    "emitter",
  ], { isPlatformAdmin: true });

  return {
    ...base,
    emisor,
    cuentaEmisor,
    otroEmisor,
    cuentaOtroEmisor,
    administrador,
    cuentaAdministrador,
    revisor,
    cuentaRevisor,
    sinRol,
    plataforma,
  };
}

type Escenario = Awaited<ReturnType<typeof montarEscenario>>;

interface OpcionesEmision {
  contexto?: OrganizationContext;
  valores?: Record<string, string>;
  folderId?: string | null;
  configuracion?: SaveDraftPatch;
}

/** Camino real de creación: `createDraft` → `saveDraft` → `issueContract`. */
async function emitir(
  escenario: Escenario,
  opciones: OpcionesEmision = {}
): Promise<IssuedContractResult> {
  const contexto = opciones.contexto ?? escenario.emisor;
  const draftId = await createDraft(contexto, {
    templateId: escenario.template.id,
  });
  await saveDraft(contexto, draftId, {
    fieldValues: opciones.valores ?? VALORES,
    holderId: escenario.holder.id,
    signerId: escenario.signer.id,
    folderId: opciones.folderId ?? null,
    ...opciones.configuracion,
  });
  return issueContract(contexto, draftId);
}

async function abrirEnlace(token: string): Promise<SignerView> {
  const vista = await loadSignerView(token);
  if (!vista.ok) throw new Error(`El enlace no está disponible: ${vista.reason}`);
  return vista;
}

async function recorrerYAceptar(
  token: string
): Promise<"accepted" | "in_review"> {
  await abrirEnlace(token);
  await markContractWalked(token);
  const { result } = await acceptContract(token, {
    legendAccepted: true,
    declaredName: "Firmante Sintético",
    userAgent: "vitest",
  });
  return result;
}

async function vencer(contractId: string): Promise<void> {
  await sql`
    UPDATE contract_links SET expires_at = NOW() - INTERVAL '1 hour'
    WHERE contract_id = ${contractId}
  `;
  await expireDueLinks();
}

async function tareaAbierta(escenario: Escenario): Promise<string> {
  const { rows } = await listReviewTasks(escenario.revisor);
  expect(rows).toHaveLength(1);
  return rows[0].taskId;
}

async function crearCarpeta(
  contexto: OrganizationContext,
  nombre: string
): Promise<string> {
  await createFolder(contexto, nombre);
  const carpetas = await listFolders(contexto.organization.id);
  const limpio = nombre.trim().replace(/\s+/g, " ");
  const carpeta = carpetas.find((item) => item.name === limpio);
  if (!carpeta) throw new Error("No encontramos la carpeta recién creada.");
  return carpeta.id;
}

async function estadoContrato(
  contractId: string
): Promise<{ status: string; classification: string }> {
  const [row] = await sql<{ status: string; classification: string }[]>`
    SELECT status, classification FROM contracts WHERE id = ${contractId}
  `;
  return row;
}

async function enlacesVivos(contractId: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::TEXT AS total FROM contract_links
    WHERE contract_id = ${contractId} AND revoked_at IS NULL
  `;
  return Number(row.total);
}

async function contarEventos(
  contractId: string,
  tipo: string
): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::TEXT AS total FROM contract_events
    WHERE contract_id = ${contractId} AND type = ${tipo}
  `;
  return Number(row.total);
}

const IMAGEN = {
  buffer: Buffer.from("imagen-sintetica-de-prueba"),
  contentType: "image/png",
  fileName: "ine.png",
};

const VIDEO = {
  buffer: Buffer.from("video-sintetico-de-prueba"),
  contentType: "video/webm",
  fileName: "video.webm",
};

// ---------------------------------------------------------------------------
// getContractDetail
// ---------------------------------------------------------------------------

describe("getContractDetail", () => {
  it("entrega el expediente completo del Contrato recién emitido", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    const detalle = await getContractDetail(escenario.emisor, emitido.contractId);

    expect(Object.keys(detalle).sort()).toEqual(CLAVES_EXPEDIENTE);
    expect(detalle.id).toBe(emitido.contractId);
    expect(detalle.organizationId).toBe(escenario.organization.id);
    expect(detalle.reference).toBe(emitido.reference);
    expect(detalle.status).toBe("pending");
    expect(detalle.classification).toBe("active");
    expect(detalle.templateId).toBe(escenario.template.id);
    expect(detalle.templateName).toBe(escenario.template.name);
    expect(detalle.templateLabel).toBe("1.0");
    expect(detalle.templateVersionId).toBe(escenario.template.versionId);
    expect(detalle.privacyNoticeVersionId).toBe(escenario.noticeId);
    expect(detalle.contractMarkdown).toContain(escenario.template.name);
    expect(detalle.contractMarkdown).toContain(emitido.reference);
    expect(detalle.fieldValues).toEqual(VALORES);
    expect(detalle.fields.map((field) => field.key)).toEqual(["objeto", "monto"]);
    expect(detalle.documentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(detalle.acceptanceLegend).toContain("Aceptar contrato");
    expect(detalle.videoStatement).toBe("");
    expect(detalle.configuration).toEqual({
      linkDays: 7,
      requiresVideo: false,
      requiresIne: false,
      reviewPolicy: "none",
    });
    expect(detalle.defaults).toEqual(detalle.configuration);
    expect(detalle.customized).toBe(false);
    expect(detalle.folderId).toBeNull();
    expect(detalle.folderName).toBeNull();
    expect(detalle.emitterId).toBe(escenario.cuentaEmisor.id);
    expect(detalle.emitterName).toBe(escenario.cuentaEmisor.fullName);
    expect(detalle.issuedAt).toBeInstanceOf(Date);
    expect(detalle.acceptedAt).toBeNull();
    expect(detalle.expiredAt).toBeNull();
    expect(detalle.cancelledAt).toBeNull();
    expect(detalle.cancelReason).toBeNull();
    expect(detalle.closedAt).toBeNull();
    expect(detalle.archivedAt).toBeNull();
    expect(detalle.deletedAt).toBeNull();
    expect(detalle.updatedAt).toBeInstanceOf(Date);
    expect(detalle.originContractId).toBeNull();
    expect(detalle.originReason).toBeNull();
  });

  it("congela Titular contractual y Firmante como instantánea del expediente", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    const detalle = await getContractDetail(escenario.emisor, emitido.contractId);

    expect(detalle.holder).toEqual({
      role: "holder",
      sourceCounterpartyId: escenario.holder.id,
      personKind: "moral",
      name: escenario.holder.name,
      rfc: "",
      email: "",
      phone: "",
      address: "",
      position: "",
      capturedAt: expect.any(Date) as Date,
    });
    expect(detalle.signer?.role).toBe("signer");
    expect(detalle.signer?.personKind).toBe("fisica");
    expect(detalle.signer?.name).toBe(escenario.signer.name);
    expect(detalle.signer?.sourceCounterpartyId).toBe(escenario.signer.id);
  });

  it("entrega el primer Intento con su enlace vigente y el evento de emisión", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    const detalle = await getContractDetail(escenario.emisor, emitido.contractId);

    expect(detalle.attempts).toHaveLength(1);
    const intento = detalle.attempts[0];
    expect(intento.sequence).toBe(1);
    expect(intento.status).toBe("open");
    expect(intento.walkedAt).toBeNull();
    expect(intento.submittedAt).toBeNull();
    expect(intento.closedAt).toBeNull();
    expect(intento.replacesAttemptId).toBeNull();
    expect(intento.linkExpiresAt).toBeInstanceOf(Date);
    expect(intento.linkRevokedAt).toBeNull();
    expect(intento.linkFirstOpenedAt).toBeNull();
    expect(intento.evidence).toEqual([]);
    expect(intento.aiReport).toBeNull();
    expect(intento.decision).toBeNull();

    expect(detalle.currentLink).toEqual({
      token: emitido.token,
      url: emitido.url,
      expiresAt: expect.any(Date) as Date,
      revoked: false,
      firstOpenedAt: null,
    });

    expect(detalle.events.map((event) => event.type)).toEqual([
      "contrato_emitido",
    ]);
    expect(detalle.events[0].actorKind).toBe("member");
    expect(detalle.events[0].actorName).toBe(escenario.cuentaEmisor.fullName);
    expect(detalle.events[0].payload.reference).toBe(emitido.reference);
  });

  it("registra la primera presentación del enlace en el Intento", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await abrirEnlace(emitido.token);

    const detalle = await getContractDetail(escenario.emisor, emitido.contractId);

    expect(detalle.attempts[0].linkFirstOpenedAt).toBeInstanceOf(Date);
    expect(detalle.currentLink?.firstOpenedAt).toBeInstanceOf(Date);
    expect(detalle.events.map((event) => event.type)).toContain("enlace_abierto");
  });

  it("marca `customized` cuando el Emisor personaliza la configuración efectiva", async () => {
    const escenario = await montarEscenario({
      capabilities: { evidence_ine: true },
      templateDefaults: { linkDays: 5 },
    });
    const emitido = await emitir(escenario, {
      configuracion: { linkDays: 3, requiresIne: true },
    });

    const detalle = await getContractDetail(escenario.emisor, emitido.contractId);

    expect(detalle.configuration).toEqual({
      linkDays: 3,
      requiresVideo: false,
      requiresIne: true,
      reviewPolicy: "none",
    });
    expect(detalle.defaults).toEqual({
      linkDays: 7,
      requiresVideo: false,
      requiresIne: false,
      reviewPolicy: "none",
    });
    expect(detalle.customized).toBe(true);
  });

  it("usa la configuración efectiva cuando la instantánea de valores predeterminados no es legible", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await sql`
      UPDATE contracts SET defaults_snapshot = 'null'::jsonb
      WHERE id = ${emitido.contractId}
    `;

    const detalle = await getContractDetail(escenario.emisor, emitido.contractId);

    expect(detalle.defaults).toEqual(detalle.configuration);
  });

  it("ignora los campos inválidos de la instantánea de valores predeterminados", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await sql`
      UPDATE contracts
      SET defaults_snapshot = '{"linkDays":"nueve","requiresVideo":"si","requiresIne":1,"reviewPolicy":"otra"}'::jsonb
      WHERE id = ${emitido.contractId}
    `;

    const detalle = await getContractDetail(escenario.emisor, emitido.contractId);

    expect(detalle.defaults).toEqual(detalle.configuration);
  });

  it("expone la Carpeta operativa del expediente", async () => {
    const escenario = await montarEscenario();
    const carpetaId = await crearCarpeta(escenario.emisor, "Vuelos ejecutivos");
    const emitido = await emitir(escenario, { folderId: carpetaId });

    const detalle = await getContractDetail(escenario.emisor, emitido.contractId);

    expect(detalle.folderId).toBe(carpetaId);
    expect(detalle.folderName).toBe("Vuelos ejecutivos");
  });

  describe("permisos", () => {
    it("da al Emisor creador todo salvo eliminar y evidencia sensible", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);

      const detalle = await getContractDetail(
        escenario.emisor,
        emitido.contractId
      );

      expect(Object.keys(detalle.permissions).sort()).toEqual(CLAVES_PERMISOS);
      expect(detalle.permissions).toEqual({
        canCopyLink: true,
        canAcceptReview: false,
        canCancel: true,
        canArchive: true,
        canDelete: false,
        canDuplicate: false,
        canCreateSuccessor: false,
        canMoveFolder: true,
        canOpenSensitiveEvidence: false,
        canViewDocument: true,
      });
    });

    it("niega `Cancelar` al Emisor que no creó el Contrato", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);

      const detalle = await getContractDetail(
        escenario.otroEmisor,
        emitido.contractId
      );

      expect(detalle.permissions.canCancel).toBe(false);
      expect(detalle.permissions.canCopyLink).toBe(true);
      expect(detalle.permissions.canArchive).toBe(true);
      expect(detalle.permissions.canMoveFolder).toBe(true);
    });

    it("da al Administrador cancelar, eliminar y evidencia sensible", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);

      const detalle = await getContractDetail(
        escenario.administrador,
        emitido.contractId
      );

      expect(detalle.permissions).toEqual({
        canCopyLink: true,
        canAcceptReview: false,
        canCancel: true,
        canArchive: true,
        canDelete: true,
        canDuplicate: false,
        canCreateSuccessor: false,
        canMoveFolder: true,
        canOpenSensitiveEvidence: true,
        canViewDocument: true,
      });
    });

    it("permite al Revisor abrir el expediente para decidir una revisión", async () => {
      const escenario = await montarEscenario({
        defaults: { reviewPolicy: "manual" },
      });
      const emitido = await emitir(escenario);
      await recorrerYAceptar(emitido.token);
      const taskId = await tareaAbierta(escenario);

      const detalle = await getContractDetail(
        escenario.revisor,
        emitido.contractId
      );

      expect(detalle.status).toBe("in_review");
      expect(detalle.openReviewTaskId).toBe(taskId);
      expect(detalle.permissions.canAcceptReview).toBe(true);
      expect(detalle.permissions.canCancel).toBe(false);
      expect(detalle.permissions.canCopyLink).toBe(false);
      expect(detalle.permissions.canOpenSensitiveEvidence).toBe(true);
    });

    it("rechaza el expediente a una cuenta sin rol operativo", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);

      await expect(
        getContractDetail(escenario.sinRol, emitido.contractId)
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("ofrece `Duplicar para corregir` sólo después de cancelar", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);
      await cancelContract(escenario.emisor, emitido.contractId);

      const detalle = await getContractDetail(
        escenario.emisor,
        emitido.contractId
      );

      expect(detalle.status).toBe("cancelled");
      expect(detalle.permissions.canDuplicate).toBe(true);
      expect(detalle.permissions.canCreateSuccessor).toBe(false);
      expect(detalle.permissions.canCopyLink).toBe(false);
      expect(detalle.permissions.canCancel).toBe(false);
      expect(detalle.currentLink).toBeNull();
    });

    it("ofrece `Crear nuevo a partir de este` sólo después de vencer", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);
      await vencer(emitido.contractId);

      const detalle = await getContractDetail(
        escenario.emisor,
        emitido.contractId
      );

      expect(detalle.status).toBe("expired");
      expect(detalle.expiredAt).toBeInstanceOf(Date);
      expect(detalle.permissions.canCreateSuccessor).toBe(true);
      expect(detalle.permissions.canDuplicate).toBe(false);
      expect(detalle.permissions.canCopyLink).toBe(false);
    });

    it("no ofrece duplicar ni suceder a un Administrador sin rol Emisor", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);
      await cancelContract(escenario.administrador, emitido.contractId);

      const detalle = await getContractDetail(
        escenario.administrador,
        emitido.contractId
      );

      expect(detalle.permissions.canDuplicate).toBe(false);
    });

    it("cierra todas las acciones del expediente eliminado", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);
      await deleteContract(escenario.administrador, emitido.contractId);

      const detalle = await getContractDetail(
        escenario.administrador,
        emitido.contractId
      );

      expect(detalle.permissions).toEqual({
        canCopyLink: false,
        canAcceptReview: false,
        canCancel: false,
        canArchive: false,
        canDelete: false,
        canDuplicate: false,
        canCreateSuccessor: false,
        canMoveFolder: false,
        canOpenSensitiveEvidence: false,
        canViewDocument: false,
      });
    });

    it("conserva `Aceptado` sin acciones de cancelación ni de enlace", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);
      await recorrerYAceptar(emitido.token);

      const detalle = await getContractDetail(
        escenario.emisor,
        emitido.contractId
      );

      expect(detalle.status).toBe("accepted");
      expect(detalle.acceptedAt).toBeInstanceOf(Date);
      expect(detalle.permissions.canCopyLink).toBe(false);
      expect(detalle.permissions.canCancel).toBe(false);
      expect(detalle.permissions.canDuplicate).toBe(false);
      expect(detalle.permissions.canCreateSuccessor).toBe(false);
      expect(detalle.permissions.canArchive).toBe(true);
    });

    it("mantiene `Cancelar` mientras el Contrato está `A revisión`", async () => {
      const escenario = await montarEscenario({
        defaults: { reviewPolicy: "manual" },
      });
      const emitido = await emitir(escenario);
      expect(await recorrerYAceptar(emitido.token)).toBe("in_review");

      const detalle = await getContractDetail(
        escenario.emisor,
        emitido.contractId
      );

      expect(detalle.status).toBe("in_review");
      expect(detalle.permissions.canCancel).toBe(true);
      expect(detalle.permissions.canCopyLink).toBe(false);
    });
  });

  describe("evidencia y eventos sensibles", () => {
    it("oculta los eventos sensibles a una cuenta sólo con rol Emisor", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);
      await sql`
        INSERT INTO contract_events (
          contract_id, organization_id, type, actor_kind, actor_name,
          sensitive, payload
        ) VALUES (
          ${emitido.contractId}, ${escenario.organization.id},
          'evidencia_sensible_consultada', 'member', 'Revisor Solo', TRUE,
          '{"categoria":"ine_front"}'::jsonb
        )
      `;

      const paraEmisor = await getContractDetail(
        escenario.emisor,
        emitido.contractId
      );
      const paraAdministrador = await getContractDetail(
        escenario.administrador,
        emitido.contractId
      );
      const tipos = (detalle: { events: { type: string }[] }) =>
        detalle.events.map((event) => event.type);
      expect(tipos(paraEmisor)).not.toContain("evidencia_sensible_consultada");
      expect(tipos(paraAdministrador)).toContain(
        "evidencia_sensible_consultada"
      );
      const paraRevisor = await getContractDetail(
        escenario.revisor,
        emitido.contractId
      );
      expect(tipos(paraRevisor)).toContain("evidencia_sensible_consultada");
      expect(paraRevisor.permissions.canOpenSensitiveEvidence).toBe(true);
      expect(
        paraAdministrador.events.find(
          (event) => event.type === "evidencia_sensible_consultada"
        )?.payload
      ).toEqual({ categoria: "ine_front" });
    });

    it("marca INE y video como sensibles y nunca entrega su localizador privado", async () => {
      const escenario = await montarEscenario({
        capabilities: { evidence_ine: true, evidence_video: true },
      });
      const emitido = await emitir(escenario, {
        configuracion: { requiresIne: true, requiresVideo: true },
      });
      await abrirEnlace(emitido.token);
      await markContractWalked(emitido.token);
      await storeEvidence(emitido.token, "ine_front", IMAGEN);
      await storeEvidence(emitido.token, "ine_back", {
        ...IMAGEN,
        fileName: "ine-reverso.png",
      });
      await storeEvidence(emitido.token, "video", VIDEO, {
        recordedInSession: true,
      });
      await acceptContract(emitido.token, {
        legendAccepted: true,
        declaredName: "Firmante Sintético",
        userAgent: "vitest",
      });

      const detalle = await getContractDetail(
        escenario.administrador,
        emitido.contractId
      );

      const evidencia = detalle.attempts[0].evidence;
      const porCategoria = new Map(evidencia.map((item) => [item.kind, item]));
      expect([...porCategoria.keys()].sort()).toEqual([
        "acceptance",
        "ine_back",
        "ine_front",
        "video",
      ]);
      expect(porCategoria.get("ine_front")?.sensitive).toBe(true);
      expect(porCategoria.get("ine_back")?.sensitive).toBe(true);
      expect(porCategoria.get("video")?.sensitive).toBe(true);
      expect(porCategoria.get("acceptance")?.sensitive).toBe(false);
      expect(porCategoria.get("video")?.contentType).toBe("video/webm");
      expect(porCategoria.get("video")?.byteSize).toBe(VIDEO.buffer.byteLength);
      expect(porCategoria.get("video")?.sha256).toMatch(/^[0-9a-f]{64}$/);

      const claves = await sql<{ object_key: string }[]>`
        SELECT object_key FROM evidence_items
        WHERE contract_id = ${emitido.contractId} AND object_key IS NOT NULL
      `;
      expect(claves).toHaveLength(3);
      const serializado = JSON.stringify(detalle);
      for (const fila of claves) {
        expect(serializado).not.toContain(fila.object_key);
      }
      for (const item of evidencia) {
        expect(item).not.toHaveProperty("objectKey");
        expect(item).not.toHaveProperty("metadata");
      }
    });

    it("entrega la misma metadata de evidencia al Emisor sin abrir el objeto", async () => {
      const escenario = await montarEscenario({
        capabilities: { evidence_ine: true },
      });
      const emitido = await emitir(escenario, {
        configuracion: { requiresIne: true },
      });
      await abrirEnlace(emitido.token);
      await markContractWalked(emitido.token);
      await storeEvidence(emitido.token, "ine_front", IMAGEN);

      const detalle = await getContractDetail(
        escenario.emisor,
        emitido.contractId
      );

      expect(detalle.permissions.canOpenSensitiveEvidence).toBe(false);
      const ine = detalle.attempts[0].evidence.find(
        (item) => item.kind === "ine_front"
      );
      expect(ine?.sensitive).toBe(true);
      expect(ine?.byteSize).toBe(IMAGEN.buffer.byteLength);
      expect(JSON.stringify(detalle)).not.toContain("organizations/");
    });
  });

  describe("intentos, revisión y custodia", () => {
    it("encadena el Intento sucesor con la decisión de repetir", async () => {
      const escenario = await montarEscenario({
        defaults: { reviewPolicy: "manual" },
      });
      const emitido = await emitir(escenario);
      await recorrerYAceptar(emitido.token);
      const taskId = await tareaAbierta(escenario);
      const sucesor = await repeatProcess(
        escenario.revisor,
        taskId,
        "ine_ilegible"
      );

      const detalle = await getContractDetail(
        escenario.administrador,
        emitido.contractId
      );

      expect(detalle.status).toBe("pending");
      expect(detalle.attempts).toHaveLength(2);
      const [primero, segundo] = detalle.attempts;
      expect(primero.status).toBe("repeated");
      expect(primero.submittedAt).toBeInstanceOf(Date);
      expect(primero.closedAt).toBeInstanceOf(Date);
      expect(primero.linkRevokedAt).toBeInstanceOf(Date);
      expect(primero.decision).toMatchObject({
        decision: "repeat",
        reasonCode: "ine_ilegible",
        reviewerName: escenario.cuentaRevisor.fullName,
        followedAiRecommendation: null,
      });
      expect(segundo.sequence).toBe(2);
      expect(segundo.status).toBe("open");
      expect(segundo.replacesAttemptId).toBe(primero.id);
      expect(detalle.currentLink?.token).toBe(sucesor.token);
    });

    it("presenta el reporte del agente AI dentro de su Intento", async () => {
      const escenario = await montarEscenario({
        capabilities: { ai_review: true },
        defaults: { reviewPolicy: "ai" },
      });
      const emitido = await emitir(escenario);
      await recorrerYAceptar(emitido.token);
      const detalleAntes = await getContractDetail(
        escenario.administrador,
        emitido.contractId
      );
      await saveAiReport({
        contractId: emitido.contractId,
        attemptId: detalleAntes.attempts[0].id,
        model: "doble-local",
        configurationVersion: "2026.01",
        status: "completed",
        transcript: "Declaración sintética.",
        expectedStatement: "Declaración esperada.",
        findings: [{ tipo: "audio", nivel: "bajo" }],
        confidence: 0.87,
        limitations: "El agente recomienda; nunca decide.",
        recommendation: "accept",
      });

      const detalle = await getContractDetail(
        escenario.administrador,
        emitido.contractId
      );

      expect(detalle.status).toBe("in_review");
      expect(detalle.attempts[0].status).toBe("in_review");
      expect(detalle.attempts[0].aiReport).toMatchObject({
        model: "doble-local",
        configurationVersion: "2026.01",
        status: "completed",
        confidence: 0.87,
        recommendation: "accept",
      });
      expect(detalle.attempts[0].aiReport?.findings).toEqual([
        { tipo: "audio", nivel: "bajo" },
      ]);
    });

    it("registra la decisión de concluir sobre el Intento aceptado", async () => {
      const escenario = await montarEscenario({
        defaults: { reviewPolicy: "manual" },
      });
      const emitido = await emitir(escenario);
      await recorrerYAceptar(emitido.token);
      await concludeAndAccept(escenario.revisor, await tareaAbierta(escenario));

      const detalle = await getContractDetail(
        escenario.administrador,
        emitido.contractId
      );

      expect(detalle.status).toBe("accepted");
      expect(detalle.attempts[0].status).toBe("accepted");
      expect(detalle.attempts[0].decision?.decision).toBe("conclude");
      expect(detalle.attempts[0].decision?.reasonCode).toBeNull();
    });

    it("presenta un reporte AI fallido sin confianza ni hallazgos legibles", async () => {
      const escenario = await montarEscenario({
        capabilities: { ai_review: true },
        defaults: { reviewPolicy: "ai" },
      });
      const emitido = await emitir(escenario);
      await recorrerYAceptar(emitido.token);
      const antes = await getContractDetail(
        escenario.administrador,
        emitido.contractId
      );
      await saveAiReport({
        contractId: emitido.contractId,
        attemptId: antes.attempts[0].id,
        model: "doble-local",
        configurationVersion: "2026.01",
        status: "failed",
        limitations: "El doble local no pudo procesar el video.",
        recommendation: "accept",
      });
      // Un reporte con `findings` que no es una lista nunca debe romper la vista.
      await sql`
        UPDATE ai_review_reports SET findings = '{"nota":"formato inesperado"}'::jsonb
        WHERE contract_id = ${emitido.contractId}
      `;

      const detalle = await getContractDetail(
        escenario.administrador,
        emitido.contractId
      );

      expect(detalle.attempts[0].aiReport).toMatchObject({
        status: "failed",
        confidence: null,
        recommendation: null,
        findings: [],
      });
      expect(detalle.status).toBe("in_review");
    });

    it("tolera un Intento sin enlace y un expediente sin instantánea de partes", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);
      await sql`
        DELETE FROM contract_parties WHERE contract_id = ${emitido.contractId}
      `;
      await sql`
        INSERT INTO acceptance_attempts (
          contract_id, organization_id, sequence, status
        ) VALUES (
          ${emitido.contractId}, ${escenario.organization.id}, 2, 'open'
        )
      `;

      const detalle = await getContractDetail(
        escenario.administrador,
        emitido.contractId
      );

      expect(detalle.holder).toBeNull();
      expect(detalle.signer).toBeNull();
      expect(detalle.attempts).toHaveLength(2);
      expect(detalle.attempts[1].linkExpiresAt).toBeNull();
      expect(detalle.attempts[1].linkRevokedAt).toBeNull();
      expect(detalle.attempts[1].linkFirstOpenedAt).toBeNull();
      expect(detalle.currentLink?.token).toBe(emitido.token);
    });

    it("normaliza el registro de un evento cuyo contenido no es un objeto", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);
      await sql`
        INSERT INTO contract_events (
          contract_id, organization_id, type, actor_kind, actor_name, payload
        ) VALUES (
          ${emitido.contractId}, ${escenario.organization.id},
          'nota_operativa', 'system', 'Sistema', '["dato"]'::jsonb
        )
      `;

      const detalle = await getContractDetail(
        escenario.emisor,
        emitido.contractId
      );

      const evento = detalle.events.find(
        (item) => item.type === "nota_operativa"
      );
      expect(evento?.payload).toEqual({});
      expect(evento?.attemptId).toBeNull();
      expect(evento?.sensitive).toBe(false);
    });

    it("resume el Paquete contractual frío y la Custodia activa", async () => {
      const escenario = await montarEscenario({
        capabilities: { active_custody: true },
      });
      const emitido = await emitir(escenario);
      await recorrerYAceptar(emitido.token);
      await sql`
        INSERT INTO cold_contract_packages (
          contract_id, organization_id, object_key, sha256, byte_size, tier,
          closed_at
        ) VALUES (
          ${emitido.contractId}, ${escenario.organization.id},
          'paquete/sintetico.zip', ${"a".repeat(64)}, 4096, 'immediate', NOW()
        )
      `;

      const detalle = await getContractDetail(
        escenario.emisor,
        emitido.contractId
      );

      expect(detalle.custody).toEqual({
        sealed: true,
        tier: "immediate",
        packageHash: "a".repeat(64),
        byteSize: 4096,
        closedAt: expect.any(Date) as Date,
        activeCustody: true,
      });
    });

    it("informa que no hay paquete sellado ni Custodia activa", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);

      const detalle = await getContractDetail(
        escenario.emisor,
        emitido.contractId
      );

      expect(detalle.custody).toEqual({
        sealed: false,
        tier: null,
        packageHash: null,
        byteSize: null,
        closedAt: null,
        activeCustody: false,
      });
    });
  });

  describe("aislamiento y clasificación", () => {
    it("no encuentra un Contrato de otra Organización", async () => {
      const propia = await montarEscenario();
      const ajena = await montarEscenario();
      const emitido = await emitir(ajena);

      await expect(
        getContractDetail(propia.emisor, emitido.contractId)
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("acota por Organización antes de vencer perezosamente", async () => {
      const propia = await montarEscenario();
      const ajena = await montarEscenario();
      const emitido = await emitir(ajena);
      await sql`
        UPDATE contract_links SET expires_at = NOW() - INTERVAL '1 hour'
        WHERE contract_id = ${emitido.contractId}
      `;

      await expect(
        getContractDetail(propia.emisor, emitido.contractId)
      ).rejects.toBeInstanceOf(NotFoundError);
      expect((await estadoContrato(emitido.contractId)).status).toBe("pending");
    });

    it("no encuentra un identificador inexistente", async () => {
      const escenario = await montarEscenario();

      await expect(
        getContractDetail(
          escenario.emisor,
          "00000000-0000-4000-8000-000000000000"
        )
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("exige un rol de la Organización", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);

      await expect(
        getContractDetail(escenario.sinRol, emitido.contractId)
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("oculta el documento y el enlace del expediente eliminado", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);
      await deleteContract(escenario.administrador, emitido.contractId);

      const detalle = await getContractDetail(
        escenario.emisor,
        emitido.contractId
      );

      expect(detalle.classification).toBe("deleted");
      expect(detalle.deletedAt).toBeInstanceOf(Date);
      expect(detalle.contractMarkdown).toBe("");
      expect(detalle.currentLink).toBeNull();
      expect(detalle.permissions.canViewDocument).toBe(false);
      expect(detalle.reference).toBe(emitido.reference);
      expect(detalle.holder).toBeNull();
      expect(detalle.signer).toBeNull();
      expect(detalle.fieldValues).toEqual({});
      expect(detalle.fields).toEqual([]);
      expect(detalle.documentHash).toBe("");
      expect(detalle.attempts).toEqual([]);
      expect(detalle.events).toEqual([]);
      expect(detalle.custody).toEqual({
        sealed: false,
        tier: null,
        packageHash: null,
        byteSize: null,
        closedAt: null,
        activeCustody: false,
      });
    });

    it("impide al rol Revisor abrir `Eliminados`", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);
      await deleteContract(escenario.administrador, emitido.contractId);

      await expect(
        getContractDetail(escenario.revisor, emitido.contractId)
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("conserva el expediente archivado con documento y enlace", async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);
      await setArchived(escenario.emisor, emitido.contractId, true);

      const detalle = await getContractDetail(
        escenario.emisor,
        emitido.contractId
      );

      expect(detalle.classification).toBe("archived");
      expect(detalle.contractMarkdown).not.toBe("");
      expect(detalle.currentLink?.token).toBe(emitido.token);
      expect(detalle.permissions.canViewDocument).toBe(true);
    });

    it("reserva la Relación técnica de origen al Administrador de plataforma", async () => {
      const escenario = await montarEscenario();
      const original = await emitir(escenario);
      await cancelContract(escenario.emisor, original.contractId);
      const draftId = await duplicateForCorrection(
        escenario.emisor,
        original.contractId
      );
      const derivado = await issueContract(escenario.emisor, draftId);

      const paraOrganizacion = await getContractDetail(
        escenario.administrador,
        derivado.contractId
      );
      const paraPlataforma = await getContractDetail(
        escenario.plataforma,
        derivado.contractId
      );

      expect(paraOrganizacion.originContractId).toBeNull();
      expect(paraOrganizacion.originReason).toBeNull();
      expect(paraPlataforma.originContractId).toBe(original.contractId);
      expect(paraPlataforma.originReason).toBe("duplicate");
    });
  });

  // Bug: `expiry.ts` documenta lectura perezosa «el expediente y el recorrido
  // no muestran datos rancios», pero `getContractDetail` nunca llama a
  // `ensureContractFreshness`. Hasta que el worker barra, el expediente sigue
  // presentando `Pendiente de aceptación` y no ofrece el sucesor.
  it(
    "presenta `Vencido` en cuanto la Vigencia del enlace terminó, sin esperar al worker",
    async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);
      await sql`
        UPDATE contract_links SET expires_at = NOW() - INTERVAL '1 hour'
        WHERE contract_id = ${emitido.contractId}
      `;

      const detalle = await getContractDetail(
        escenario.emisor,
        emitido.contractId
      );

      expect(detalle.status).toBe("expired");
      expect(detalle.permissions.canCreateSuccessor).toBe(true);
      expect(detalle.permissions.canCopyLink).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// cancelContract
// ---------------------------------------------------------------------------

describe("cancelContract", () => {
  it("permite cancelar al Miembro creador y registra actor, fecha y motivo", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    await cancelContract(escenario.emisor, emitido.contractId, "  Dato erróneo  ");

    const detalle = await getContractDetail(escenario.emisor, emitido.contractId);
    expect(detalle.status).toBe("cancelled");
    expect(detalle.cancelledAt).toBeInstanceOf(Date);
    expect(detalle.closedAt).toBeInstanceOf(Date);
    expect(detalle.cancelReason).toBe("Dato erróneo");

    const evento = detalle.events.find(
      (item) => item.type === "contrato_cancelado"
    );
    expect(evento?.actorKind).toBe("member");
    expect(evento?.actorName).toBe(escenario.cuentaEmisor.fullName);
    expect(evento?.payload).toEqual({ reason: "Dato erróneo" });
    expect(evento?.createdAt).toBeInstanceOf(Date);

    const [auditoria] = await sql<
      { actor_name: string; account_id: string; payload: Record<string, unknown> }[]
    >`
      SELECT actor_name, account_id, payload FROM audit_entries
      WHERE action = 'contrato_cancelado' AND subject_id = ${emitido.contractId}
    `;
    expect(auditoria.account_id).toBe(escenario.cuentaEmisor.id);
    expect(auditoria.actor_name).toBe(escenario.cuentaEmisor.fullName);
    expect(auditoria.payload).toEqual({
      reference: emitido.reference,
      reason: "Dato erróneo",
    });
  });

  it("acepta la cancelación sin motivo", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    await cancelContract(escenario.emisor, emitido.contractId, "   ");

    const detalle = await getContractDetail(escenario.emisor, emitido.contractId);
    expect(detalle.cancelReason).toBeNull();
  });

  it("permite cancelar a cualquier Administrador aunque no haya creado el Contrato", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    await cancelContract(escenario.administrador, emitido.contractId);

    expect((await estadoContrato(emitido.contractId)).status).toBe("cancelled");
  });

  it("niega la cancelación a un Emisor que no creó el Contrato", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    await expect(
      cancelContract(escenario.otroEmisor, emitido.contractId)
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect((await estadoContrato(emitido.contractId)).status).toBe("pending");
  });

  it("niega la cancelación al rol Revisor", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    await expect(
      cancelContract(escenario.revisor, emitido.contractId)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("cancela un Contrato `A revisión` y cierra la tarea sin decisión", async () => {
    const escenario = await montarEscenario({
      defaults: { reviewPolicy: "manual" },
    });
    const emitido = await emitir(escenario);
    await recorrerYAceptar(emitido.token);
    const taskId = await tareaAbierta(escenario);

    await cancelContract(escenario.emisor, emitido.contractId, "Ya no procede");

    const [tarea] = await sql<
      { status: string; resolved_at: Date | null }[]
    >`SELECT status, resolved_at FROM review_tasks WHERE id = ${taskId}`;
    expect(tarea.status).toBe("closed_without_decision");
    expect(tarea.resolved_at).toBeInstanceOf(Date);

    const [decisiones] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total FROM review_decisions
      WHERE contract_id = ${emitido.contractId}
    `;
    expect(Number(decisiones.total)).toBe(0);

    await expect(
      concludeAndAccept(escenario.revisor, taskId)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("conserva Intentos y evidencia del Contrato cancelado", async () => {
    const escenario = await montarEscenario({
      capabilities: { evidence_ine: true },
      defaults: { reviewPolicy: "manual" },
    });
    const emitido = await emitir(escenario, {
      configuracion: { requiresIne: true },
    });
    await abrirEnlace(emitido.token);
    await markContractWalked(emitido.token);
    await storeEvidence(emitido.token, "ine_front", IMAGEN);
    await storeEvidence(emitido.token, "ine_back", {
      ...IMAGEN,
      fileName: "ine-reverso.png",
    });
    await recorrerYAceptar(emitido.token);

    await cancelContract(escenario.administrador, emitido.contractId);

    const detalle = await getContractDetail(
      escenario.administrador,
      emitido.contractId
    );
    expect(detalle.attempts).toHaveLength(1);
    expect(detalle.attempts[0].status).toBe("cancelled");
    expect(detalle.attempts[0].closedAt).toBeInstanceOf(Date);
    expect(detalle.attempts[0].evidence).toHaveLength(3);
  });

  it("revoca todos los enlaces vivos del expediente", async () => {
    const escenario = await montarEscenario({
      defaults: { reviewPolicy: "manual" },
    });
    const emitido = await emitir(escenario);
    await recorrerYAceptar(emitido.token);
    await repeatProcess(
      escenario.revisor,
      await tareaAbierta(escenario),
      "evidencia_faltante"
    );
    expect(await enlacesVivos(emitido.contractId)).toBe(1);

    await cancelContract(escenario.emisor, emitido.contractId);

    const [total] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total FROM contract_links
      WHERE contract_id = ${emitido.contractId}
    `;
    expect(Number(total.total)).toBe(2);
    expect(await enlacesVivos(emitido.contractId)).toBe(0);
    expect(await loadSignerView(emitido.token)).toEqual({
      ok: false,
      reason: "cancelled",
    });
  });

  it("rechaza cancelar un Contrato ya aceptado", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await recorrerYAceptar(emitido.token);

    await expect(
      cancelContract(escenario.emisor, emitido.contractId)
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await estadoContrato(emitido.contractId)).status).toBe("accepted");
  });

  it("rechaza cancelar un Contrato vencido", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await vencer(emitido.contractId);

    await expect(
      cancelContract(escenario.emisor, emitido.contractId)
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await estadoContrato(emitido.contractId)).status).toBe("expired");
  });

  it("rechaza cancelar dos veces el mismo Contrato", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await cancelContract(escenario.emisor, emitido.contractId, "Primera");

    await expect(
      cancelContract(escenario.emisor, emitido.contractId, "Segunda")
    ).rejects.toBeInstanceOf(ConflictError);

    const detalle = await getContractDetail(escenario.emisor, emitido.contractId);
    expect(detalle.cancelReason).toBe("Primera");
    expect(await contarEventos(emitido.contractId, "contrato_cancelado")).toBe(1);
  });

  it("rechaza cancelar un expediente eliminado", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await recorrerYAceptar(emitido.token);
    await deleteContract(escenario.administrador, emitido.contractId);

    await expect(
      cancelContract(escenario.administrador, emitido.contractId)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("no encuentra un Contrato de otra Organización", async () => {
    const propia = await montarEscenario();
    const ajena = await montarEscenario();
    const emitido = await emitir(ajena);

    await expect(
      cancelContract(propia.administrador, emitido.contractId)
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await estadoContrato(emitido.contractId)).status).toBe("pending");
  });

  it("produce exactamente una cancelación ante dos intentos concurrentes", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    const resultados = await Promise.allSettled([
      cancelContract(escenario.emisor, emitido.contractId, "Primera"),
      cancelContract(escenario.administrador, emitido.contractId, "Segunda"),
    ]);

    const cumplidas = resultados.filter(
      (resultado) => resultado.status === "fulfilled"
    );
    const rechazadas = resultados.filter(
      (resultado) => resultado.status === "rejected"
    );
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    for (const rechazada of rechazadas) {
      if (rechazada.status === "rejected") {
        expect(rechazada.reason).toBeInstanceOf(ConflictError);
      }
    }
    expect(await contarEventos(emitido.contractId, "contrato_cancelado")).toBe(1);
    expect((await estadoContrato(emitido.contractId)).status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// setArchived
// ---------------------------------------------------------------------------

describe("setArchived", () => {
  it("archiva y restaura sin tocar estado, enlace, evidencia ni custodia", async () => {
    const escenario = await montarEscenario({
      capabilities: { evidence_ine: true, active_custody: true },
    });
    const emitido = await emitir(escenario, {
      configuracion: { requiresIne: true },
    });
    await abrirEnlace(emitido.token);
    await markContractWalked(emitido.token);
    await storeEvidence(emitido.token, "ine_front", IMAGEN);
    const antes = await getContractDetail(
      escenario.administrador,
      emitido.contractId
    );

    await setArchived(escenario.emisor, emitido.contractId, true);
    const archivado = await getContractDetail(
      escenario.administrador,
      emitido.contractId
    );

    expect(archivado.classification).toBe("archived");
    expect(archivado.archivedAt).toBeInstanceOf(Date);
    expect(archivado.status).toBe(antes.status);
    expect(archivado.documentHash).toBe(antes.documentHash);
    expect(archivado.currentLink?.token).toBe(emitido.token);
    expect(archivado.attempts[0].evidence).toHaveLength(1);
    expect(archivado.custody).toEqual(antes.custody);
    expect(await enlacesVivos(emitido.contractId)).toBe(1);

    await setArchived(escenario.emisor, emitido.contractId, false);
    const restaurado = await getContractDetail(
      escenario.administrador,
      emitido.contractId
    );

    expect(restaurado.classification).toBe("active");
    expect(restaurado.archivedAt).toBeNull();
    expect(restaurado.status).toBe(antes.status);
    expect(restaurado.currentLink?.token).toBe(emitido.token);
  });

  it("retira el expediente archivado de la lista principal y lo muestra en `Archivados`", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    const otro = await emitir(escenario);

    await setArchived(escenario.emisor, emitido.contractId, true);

    const principal = await searchContracts(escenario.emisor, {
      classification: "active",
    });
    expect(principal.rows.map((row) => row.id)).toEqual([otro.contractId]);

    const archivados = await searchContracts(escenario.emisor, {
      classification: "archived",
    });
    expect(archivados.rows.map((row) => row.id)).toEqual([emitido.contractId]);

    expect(await countContracts(escenario.emisor)).toMatchObject({
      active: 1,
      archived: 1,
      deleted: 0,
      pending: 2,
    });
  });

  it("rechaza archivar dos veces", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await setArchived(escenario.emisor, emitido.contractId, true);

    await expect(
      setArchived(escenario.emisor, emitido.contractId, true)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rechaza restaurar un expediente que no está archivado", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    await expect(
      setArchived(escenario.emisor, emitido.contractId, false)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rechaza archivar un expediente eliminado", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await deleteContract(escenario.administrador, emitido.contractId);

    await expect(
      setArchived(escenario.administrador, emitido.contractId, true)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("niega archivar al rol Revisor", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    await expect(
      setArchived(escenario.revisor, emitido.contractId, true)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("no archiva un expediente de otra Organización", async () => {
    const propia = await montarEscenario();
    const ajena = await montarEscenario();
    const emitido = await emitir(ajena);

    await expect(
      setArchived(propia.administrador, emitido.contractId, true)
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await estadoContrato(emitido.contractId)).classification).toBe(
      "active"
    );
  });
});

// ---------------------------------------------------------------------------
// deleteContract
// ---------------------------------------------------------------------------

describe("deleteContract", () => {
  it("sólo lo ejecuta el rol Administrador", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    await expect(
      deleteContract(escenario.emisor, emitido.contractId)
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      deleteContract(escenario.revisor, emitido.contractId)
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect((await estadoContrato(emitido.contractId)).classification).toBe(
      "active"
    );
  });

  it("cancela atómicamente un Contrato pendiente e invalida sus enlaces", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    await deleteContract(escenario.administrador, emitido.contractId);

    const estado = await estadoContrato(emitido.contractId);
    expect(estado.status).toBe("cancelled");
    expect(estado.classification).toBe("deleted");
    expect(await enlacesVivos(emitido.contractId)).toBe(0);

    const detalle = await getContractDetail(
      escenario.administrador,
      emitido.contractId
    );
    expect(detalle.deletedAt).toBeInstanceOf(Date);
    expect(detalle.cancelledAt).toBeNull();
    expect(detalle.attempts).toEqual([]);
    expect(detalle.events).toEqual([]);

    const [persistido] = await sql<
      { cancelled_at: Date; attempt_status: string; payload: unknown; actor_name: string }[]
    >`
      SELECT c.cancelled_at, a.status AS attempt_status, e.payload, e.actor_name
      FROM contracts c
      JOIN acceptance_attempts a ON a.contract_id = c.id
      JOIN contract_events e ON e.contract_id = c.id
        AND e.type = 'expediente_eliminado'
      WHERE c.id = ${emitido.contractId}
    `;
    expect(persistido.cancelled_at).toBeInstanceOf(Date);
    expect(persistido.attempt_status).toBe("cancelled");
    expect(persistido.payload).toEqual({ cancelledOnDelete: true });
    expect(persistido.actor_name).toBe(escenario.cuentaAdministrador.fullName);
  });

  it("cierra sin decisión la revisión abierta del Contrato eliminado", async () => {
    const escenario = await montarEscenario({
      defaults: { reviewPolicy: "manual" },
    });
    const emitido = await emitir(escenario);
    await recorrerYAceptar(emitido.token);
    const taskId = await tareaAbierta(escenario);

    await deleteContract(escenario.administrador, emitido.contractId);

    const [tarea] = await sql<{ status: string }[]>`
      SELECT status FROM review_tasks WHERE id = ${taskId}
    `;
    expect(tarea.status).toBe("closed_without_decision");
    expect((await estadoContrato(emitido.contractId)).status).toBe("cancelled");
  });

  it("conserva el Estado contractual terminal de un Contrato aceptado", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await recorrerYAceptar(emitido.token);

    await deleteContract(escenario.administrador, emitido.contractId);

    const estado = await estadoContrato(emitido.contractId);
    expect(estado.status).toBe("accepted");
    expect(estado.classification).toBe("deleted");

    const detalle = await getContractDetail(
      escenario.administrador,
      emitido.contractId
    );
    expect(detalle.acceptedAt).toBeNull();
    expect(detalle.events).toEqual([]);
    const [persistido] = await sql<{ accepted_at: Date; payload: unknown }[]>`
      SELECT c.accepted_at, e.payload
      FROM contracts c
      JOIN contract_events e ON e.contract_id = c.id
        AND e.type = 'expediente_eliminado'
      WHERE c.id = ${emitido.contractId}
    `;
    expect(persistido.accepted_at).toBeInstanceOf(Date);
    expect(persistido.payload).toEqual({ cancelledOnDelete: false });
  });

  it("conserva el Estado contractual terminal de un Contrato vencido", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await vencer(emitido.contractId);

    await deleteContract(escenario.administrador, emitido.contractId);

    const estado = await estadoContrato(emitido.contractId);
    expect(estado.status).toBe("expired");
    expect(estado.classification).toBe("deleted");
  });

  it("retira el expediente de `Contratos` y de `Archivados`", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await setArchived(escenario.emisor, emitido.contractId, true);

    await deleteContract(escenario.administrador, emitido.contractId);

    const activos = await searchContracts(escenario.emisor, {
      classification: "active",
    });
    const archivados = await searchContracts(escenario.emisor, {
      classification: "archived",
    });
    const eliminados = await searchContracts(escenario.emisor, {
      classification: "deleted",
    });
    expect(activos.rows).toHaveLength(0);
    expect(archivados.rows).toHaveLength(0);
    expect(eliminados.rows.map((row) => row.id)).toEqual([emitido.contractId]);
  });

  it("impide producir cualquier enlace nuevo después de eliminar", async () => {
    const escenario = await montarEscenario({
      defaults: { reviewPolicy: "manual" },
    });
    const emitido = await emitir(escenario);
    await recorrerYAceptar(emitido.token);
    const taskId = await tareaAbierta(escenario);

    await deleteContract(escenario.administrador, emitido.contractId);

    expect(await loadSignerView(emitido.token)).toEqual({
      ok: false,
      reason: "cancelled",
    });
    await expect(
      repeatProcess(escenario.revisor, taskId, "otro", "Reintento")
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await enlacesVivos(emitido.contractId)).toBe(0);

    const detalle = await getContractDetail(
      escenario.administrador,
      emitido.contractId
    );
    expect(detalle.currentLink).toBeNull();
    expect(detalle.permissions.canCopyLink).toBe(false);
  });

  it("es idempotente: eliminar de nuevo no cambia nada", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await deleteContract(escenario.administrador, emitido.contractId);

    await deleteContract(escenario.administrador, emitido.contractId);

    expect(
      await contarEventos(emitido.contractId, "expediente_eliminado")
    ).toBe(1);
  });

  it("ordena el traslado al Archivo Muerto sólo con Custodia activa", async () => {
    const conCustodia = await montarEscenario({
      capabilities: { active_custody: true },
    });
    const sinCustodia = await montarEscenario();
    const primero = await emitir(conCustodia);
    const segundo = await emitir(sinCustodia);

    await deleteContract(conCustodia.administrador, primero.contractId);
    await deleteContract(sinCustodia.administrador, segundo.contractId);

    const trabajos = await sql<{ dedupe_key: string }[]>`
      SELECT dedupe_key FROM background_jobs WHERE kind = 'move_to_cold'
    `;
    expect(trabajos.map((row) => row.dedupe_key)).toEqual([
      `move_to_cold:${primero.contractId}`,
    ]);
  });

  it("produce exactamente una eliminación ante dos intentos concurrentes", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    const resultados = await Promise.allSettled([
      deleteContract(escenario.administrador, emitido.contractId),
      deleteContract(escenario.context, emitido.contractId),
    ]);

    expect(
      resultados.filter((resultado) => resultado.status === "fulfilled")
    ).toHaveLength(1);
    for (const resultado of resultados) {
      if (resultado.status === "rejected") {
        expect(resultado.reason).toBeInstanceOf(ConflictError);
      }
    }
    expect(
      await contarEventos(emitido.contractId, "expediente_eliminado")
    ).toBe(1);
    expect((await estadoContrato(emitido.contractId)).classification).toBe(
      "deleted"
    );
  });

  it("no encuentra un Contrato de otra Organización", async () => {
    const propia = await montarEscenario();
    const ajena = await montarEscenario();
    const emitido = await emitir(ajena);

    await expect(
      deleteContract(propia.administrador, emitido.contractId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// moveToFolder
// ---------------------------------------------------------------------------

describe("moveToFolder", () => {
  it("mueve el expediente a una Carpeta operativa y lo saca de ella", async () => {
    const escenario = await montarEscenario();
    const carpetaId = await crearCarpeta(escenario.emisor, "Chárter");
    const emitido = await emitir(escenario);

    await moveToFolder(escenario.emisor, emitido.contractId, carpetaId);
    const dentro = await getContractDetail(escenario.emisor, emitido.contractId);
    expect(dentro.folderId).toBe(carpetaId);
    expect(dentro.folderName).toBe("Chárter");

    await moveToFolder(escenario.emisor, emitido.contractId, null);
    const fuera = await getContractDetail(escenario.emisor, emitido.contractId);
    expect(fuera.folderId).toBeNull();
    expect(fuera.folderName).toBeNull();

    const [auditoria] = await sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM audit_entries
      WHERE action = 'contrato_movido_de_carpeta'
        AND subject_id = ${emitido.contractId}
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(auditoria.payload).toEqual({ folderId: null });
  });

  it("no encuentra una carpeta inexistente", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    await expect(
      moveToFolder(
        escenario.emisor,
        emitido.contractId,
        "00000000-0000-4000-8000-000000000000"
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("no encuentra una carpeta de otra Organización", async () => {
    const propia = await montarEscenario();
    const ajena = await montarEscenario();
    const carpetaAjena = await crearCarpeta(ajena.emisor, "Ajena");
    const emitido = await emitir(propia);

    await expect(
      moveToFolder(propia.emisor, emitido.contractId, carpetaAjena)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rechaza mover un expediente eliminado", async () => {
    const escenario = await montarEscenario();
    const carpetaId = await crearCarpeta(escenario.emisor, "Cerrados");
    const emitido = await emitir(escenario);
    await deleteContract(escenario.administrador, emitido.contractId);

    await expect(
      moveToFolder(escenario.emisor, emitido.contractId, carpetaId)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("permite mover un expediente archivado sin cambiar su clasificación", async () => {
    const escenario = await montarEscenario();
    const carpetaId = await crearCarpeta(escenario.emisor, "Histórico");
    const emitido = await emitir(escenario);
    await setArchived(escenario.emisor, emitido.contractId, true);

    await moveToFolder(escenario.administrador, emitido.contractId, carpetaId);

    const detalle = await getContractDetail(
      escenario.administrador,
      emitido.contractId
    );
    expect(detalle.classification).toBe("archived");
    expect(detalle.folderId).toBe(carpetaId);
  });

  it("niega mover al rol Revisor", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);

    await expect(
      moveToFolder(escenario.revisor, emitido.contractId, null)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("no mueve un expediente de otra Organización", async () => {
    const propia = await montarEscenario();
    const ajena = await montarEscenario();
    const emitido = await emitir(ajena);

    await expect(
      moveToFolder(propia.emisor, emitido.contractId, null)
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ---------------------------------------------------------------------------
// Carpetas operativas
// ---------------------------------------------------------------------------

describe("carpetas operativas", () => {
  it("crea una carpeta normalizando el nombre y la audita", async () => {
    const escenario = await montarEscenario();

    await createFolder(escenario.emisor, "  Vuelos   privados  ");

    const carpetas = await listFolders(escenario.organization.id);
    expect(carpetas).toEqual([
      { id: expect.any(String) as string, name: "Vuelos privados", count: 0 },
    ]);
    const [auditoria] = await sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM audit_entries WHERE action = 'carpeta_creada'
    `;
    expect(auditoria.payload).toEqual({ name: "Vuelos privados" });
  });

  it("rechaza una carpeta sin nombre", async () => {
    const escenario = await montarEscenario();

    await expect(
      createFolder(escenario.emisor, "   ")
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rechaza un nombre de más de ochenta caracteres", async () => {
    const escenario = await montarEscenario();

    await expect(
      createFolder(escenario.emisor, "C".repeat(81))
    ).rejects.toBeInstanceOf(ConflictError);
    await createFolder(escenario.emisor, "C".repeat(80));
    expect(await listFolders(escenario.organization.id)).toHaveLength(1);
  });

  it("rechaza un nombre duplicado sin distinguir mayúsculas", async () => {
    const escenario = await montarEscenario();
    await createFolder(escenario.emisor, "Operaciones");

    await expect(
      createFolder(escenario.emisor, "operaciones")
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await listFolders(escenario.organization.id)).toHaveLength(1);
  });

  it("permite el mismo nombre en otra Organización", async () => {
    const propia = await montarEscenario();
    const ajena = await montarEscenario();

    await createFolder(propia.emisor, "Operaciones");
    await createFolder(ajena.emisor, "Operaciones");

    expect(await listFolders(propia.organization.id)).toHaveLength(1);
    expect(await listFolders(ajena.organization.id)).toHaveLength(1);
  });

  it("cuenta los expedientes vivos y archivados de cada carpeta, y omite los eliminados", async () => {
    const escenario = await montarEscenario();
    const activos = await crearCarpeta(escenario.emisor, "Zeta activos");
    const vacia = await crearCarpeta(escenario.emisor, "alfa vacía");
    const primero = await emitir(escenario, { folderId: activos });
    const segundo = await emitir(escenario, { folderId: activos });
    const tercero = await emitir(escenario, { folderId: activos });
    await setArchived(escenario.emisor, segundo.contractId, true);
    await deleteContract(escenario.administrador, tercero.contractId);

    const carpetas = await listFolders(escenario.organization.id);

    expect(carpetas.map((carpeta) => carpeta.name)).toEqual([
      "alfa vacía",
      "Zeta activos",
    ]);
    expect(carpetas.find((carpeta) => carpeta.id === vacia)?.count).toBe(0);
    expect(carpetas.find((carpeta) => carpeta.id === activos)?.count).toBe(2);
    expect(primero.contractId).toBeTruthy();
  });

  it("no cuenta expedientes de otra Organización", async () => {
    const propia = await montarEscenario();
    const ajena = await montarEscenario();
    const carpeta = await crearCarpeta(propia.emisor, "Compartida");
    await emitir(ajena);

    expect(await listFolders(propia.organization.id)).toEqual([
      { id: carpeta, name: "Compartida", count: 0 },
    ]);
  });

  it("renombra una carpeta y conserva sus expedientes", async () => {
    const escenario = await montarEscenario();
    const carpeta = await crearCarpeta(escenario.emisor, "Provisional");
    const emitido = await emitir(escenario, { folderId: carpeta });

    await renameFolder(escenario.administrador, carpeta, "  Definitiva  ");

    expect(await listFolders(escenario.organization.id)).toEqual([
      { id: carpeta, name: "Definitiva", count: 1 },
    ]);
    const detalle = await getContractDetail(escenario.emisor, emitido.contractId);
    expect(detalle.folderName).toBe("Definitiva");
  });

  it("permite renombrar una carpeta con su mismo nombre", async () => {
    const escenario = await montarEscenario();
    const carpeta = await crearCarpeta(escenario.emisor, "Operaciones");

    await renameFolder(escenario.emisor, carpeta, "Operaciones");

    expect(await listFolders(escenario.organization.id)).toEqual([
      { id: carpeta, name: "Operaciones", count: 0 },
    ]);
  });

  it("rechaza renombrar hacia un nombre ya usado", async () => {
    const escenario = await montarEscenario();
    await createFolder(escenario.emisor, "Operaciones");
    const carpeta = await crearCarpeta(escenario.emisor, "Traslados");

    await expect(
      renameFolder(escenario.emisor, carpeta, "OPERACIONES")
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("no renombra una carpeta inexistente o de otra Organización", async () => {
    const propia = await montarEscenario();
    const ajena = await montarEscenario();
    const carpetaAjena = await crearCarpeta(ajena.emisor, "Ajena");

    await expect(
      renameFolder(
        propia.emisor,
        "00000000-0000-4000-8000-000000000000",
        "Nueva"
      )
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      renameFolder(propia.emisor, carpetaAjena, "Nueva")
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await listFolders(ajena.organization.id)).toEqual([
      { id: carpetaAjena, name: "Ajena", count: 0 },
    ]);
  });

  it("elimina la carpeta y deja sus expedientes sin carpeta", async () => {
    const escenario = await montarEscenario();
    const carpeta = await crearCarpeta(escenario.emisor, "Temporal");
    const emitido = await emitir(escenario, { folderId: carpeta });

    await deleteFolder(escenario.administrador, carpeta);

    expect(await listFolders(escenario.organization.id)).toEqual([]);
    const detalle = await getContractDetail(escenario.emisor, emitido.contractId);
    expect(detalle.id).toBe(emitido.contractId);
    expect(detalle.status).toBe("pending");
    expect(detalle.folderId).toBeNull();
    expect(detalle.folderName).toBeNull();
  });

  it("no elimina una carpeta inexistente o de otra Organización", async () => {
    const propia = await montarEscenario();
    const ajena = await montarEscenario();
    const carpetaAjena = await crearCarpeta(ajena.emisor, "Ajena");

    await expect(
      deleteFolder(propia.emisor, "00000000-0000-4000-8000-000000000000")
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      deleteFolder(propia.emisor, carpetaAjena)
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await listFolders(ajena.organization.id)).toHaveLength(1);
  });

  it("niega crear, renombrar y eliminar carpetas al rol Revisor", async () => {
    const escenario = await montarEscenario();
    const carpeta = await crearCarpeta(escenario.emisor, "Operaciones");

    await expect(
      createFolder(escenario.revisor, "Otra")
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      renameFolder(escenario.revisor, carpeta, "Otra")
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      deleteFolder(escenario.revisor, carpeta)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

// ---------------------------------------------------------------------------
// duplicateForCorrection
// ---------------------------------------------------------------------------

describe("duplicateForCorrection", () => {
  it("exige cancelar primero el Contrato", async () => {
    const escenario = await montarEscenario();
    const pendiente = await emitir(escenario);
    const aceptado = await emitir(escenario);
    await recorrerYAceptar(aceptado.token);
    const vencido = await emitir(escenario);
    await vencer(vencido.contractId);

    for (const contractId of [
      pendiente.contractId,
      aceptado.contractId,
      vencido.contractId,
    ]) {
      await expect(
        duplicateForCorrection(escenario.emisor, contractId)
      ).rejects.toBeInstanceOf(ConflictError);
    }
  });

  it("crea un Borrador nuevo con la Relación técnica de origen", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await cancelContract(escenario.emisor, emitido.contractId);

    const draftId = await duplicateForCorrection(
      escenario.otroEmisor,
      emitido.contractId
    );

    const borrador = await getDraft(escenario.otroEmisor, draftId);
    expect(borrador.templateId).toBe(escenario.template.id);
    expect(borrador.originContractId).toBe(emitido.contractId);
    expect(borrador.originReason).toBe("duplicate");
    expect(borrador.createdBy).toBe(escenario.cuentaOtroEmisor.id);
    expect(borrador.fieldValues).toEqual(VALORES);
    expect(borrador.canIssue).toBe(true);

    const [auditoria] = await sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM audit_entries
      WHERE action = 'contrato_duplicado_para_corregir' AND subject_id = ${draftId}
    `;
    expect(auditoria.payload).toEqual({
      originContractId: emitido.contractId,
      reference: emitido.reference,
    });
  });

  it("nunca copia Referencia, Huella documental, Intentos, enlaces ni evidencia", async () => {
    const escenario = await montarEscenario({
      capabilities: { evidence_ine: true },
      defaults: { reviewPolicy: "manual" },
    });
    const emitido = await emitir(escenario, {
      configuracion: { requiresIne: true },
    });
    await abrirEnlace(emitido.token);
    await markContractWalked(emitido.token);
    await storeEvidence(emitido.token, "ine_front", IMAGEN);
    await cancelContract(escenario.emisor, emitido.contractId);

    const draftId = await duplicateForCorrection(
      escenario.emisor,
      emitido.contractId
    );

    const borrador = await getDraft(escenario.emisor, draftId);
    expect(borrador).not.toHaveProperty("reference");
    expect(borrador).not.toHaveProperty("documentHash");
    const [conteos] = await sql<
      { contratos: string; intentos: string; enlaces: string; evidencia: string }[]
    >`
      SELECT
        (SELECT COUNT(*) FROM contracts)::TEXT AS contratos,
        (SELECT COUNT(*) FROM acceptance_attempts)::TEXT AS intentos,
        (SELECT COUNT(*) FROM contract_links)::TEXT AS enlaces,
        (SELECT COUNT(*) FROM evidence_items)::TEXT AS evidencia
    `;
    expect(conteos).toEqual({
      contratos: "1",
      intentos: "1",
      enlaces: "1",
      evidencia: "1",
    });
  });

  it("usa la publicación vigente y nunca la histórica del Contrato cancelado", async () => {
    const escenario = await montarEscenario();
    const publicador = await createAccount({ isLegalPublisher: true });
    const emitido = await emitir(escenario);
    await cancelContract(escenario.emisor, emitido.contractId);
    const nueva = await publishTemplateVersion({
      templateId: escenario.template.id,
      label: "2.0",
      markdown:
        "# Publicación vigente\n\nObjeto: {{objeto}}. Monto: {{monto}}.\nReferencia {{contrato.referencia}}.",
      publishedBy: publicador.id,
      publishedByName: publicador.fullName,
    });

    const draftId = await duplicateForCorrection(
      escenario.emisor,
      emitido.contractId
    );

    const borrador = await getDraft(escenario.emisor, draftId);
    expect(borrador.template.currentVersion?.id).toBe(nueva.id);
    expect(nueva.id).not.toBe(escenario.template.versionId);

    const derivado = await issueContract(escenario.emisor, draftId);
    const detalle = await getContractDetail(
      escenario.emisor,
      derivado.contractId
    );
    expect(detalle.templateVersionId).toBe(nueva.id);
    expect(detalle.templateLabel).toBe("2.0");
    expect(detalle.contractMarkdown).toContain("Publicación vigente");
    expect(detalle.reference).not.toBe(emitido.reference);
    expect(detalle.documentHash).not.toBe(
      (await getContractDetail(escenario.emisor, emitido.contractId)).documentHash
    );
  });

  it("precarga sólo los valores compatibles con la publicación vigente", async () => {
    const escenario = await montarEscenario({
      fields: [
        { key: "objeto", label: "Objeto" },
        { key: "plaza", label: "Plaza", dataType: "select", options: ["Norte", "Sur"] },
      ],
    });
    const emitido = await emitir(escenario, {
      valores: { objeto: "Traslado", plaza: "Norte" },
    });
    await cancelContract(escenario.emisor, emitido.contractId);
    await sql`
      UPDATE contract_field_definitions
      SET options = '["Sur", "Bajío"]'::jsonb
      WHERE template_id = ${escenario.template.id} AND key = 'plaza'
    `;

    const draftId = await duplicateForCorrection(
      escenario.emisor,
      emitido.contractId
    );

    const borrador = await getDraft(escenario.emisor, draftId);
    expect(borrador.fieldValues).toEqual({ objeto: "Traslado" });
    expect(borrador.missingFields).toEqual(["plaza"]);
    expect(borrador.canIssue).toBe(false);
  });

  it("descarta un valor cuyo campo desapareció de la publicación vigente", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await cancelContract(escenario.emisor, emitido.contractId);
    await sql`
      DELETE FROM contract_field_definitions
      WHERE template_id = ${escenario.template.id} AND key = 'monto'
    `;

    const draftId = await duplicateForCorrection(
      escenario.emisor,
      emitido.contractId
    );

    const borrador = await getDraft(escenario.emisor, draftId);
    expect(borrador.fieldValues).toEqual({ objeto: VALORES.objeto });
  });

  it("resuelve Titular y Firmante desde el Directorio activo actual", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await cancelContract(escenario.emisor, emitido.contractId);
    await setCounterpartyActive(escenario.context, escenario.signer.id, false);

    const draftId = await duplicateForCorrection(
      escenario.emisor,
      emitido.contractId
    );

    const borrador = await getDraft(escenario.emisor, draftId);
    expect(borrador.holder?.id).toBe(escenario.holder.id);
    expect(borrador.signer).toBeNull();
    expect(borrador.canIssue).toBe(false);
    expect(borrador.blockers).toContain("Falta elegir el Firmante.");
    await expect(
      issueContract(escenario.emisor, draftId)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("no arrastra una parte que ya no tiene registro en el Directorio", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await cancelContract(escenario.emisor, emitido.contractId);
    await sql`
      DELETE FROM contract_parties
      WHERE contract_id = ${emitido.contractId} AND party_role = 'holder'
    `;

    const draftId = await duplicateForCorrection(
      escenario.emisor,
      emitido.contractId
    );

    const borrador = await getDraft(escenario.emisor, draftId);
    expect(borrador.holder).toBeNull();
    expect(borrador.signer?.id).toBe(escenario.signer.id);
    expect(borrador.blockers).toContain("Falta elegir el Titular contractual.");
  });

  it("parte de la Configuración predeterminada de emisión actual, no de la congelada", async () => {
    const escenario = await montarEscenario({
      capabilities: { evidence_ine: true },
      defaults: { requiresIne: true },
      templateDefaults: { linkDays: 5 },
    });
    const emitido = await emitir(escenario, {
      configuracion: { linkDays: 3, requiresIne: false },
    });
    const cancelado = await getContractDetail(
      escenario.emisor,
      emitido.contractId
    );
    expect(cancelado.configuration).toEqual({
      linkDays: 3,
      requiresVideo: false,
      requiresIne: false,
      reviewPolicy: "none",
    });
    expect(cancelado.customized).toBe(true);
    await cancelContract(escenario.emisor, emitido.contractId);

    const draftId = await duplicateForCorrection(
      escenario.emisor,
      emitido.contractId
    );

    const borrador = await getDraft(escenario.emisor, draftId);
    expect(borrador.configuration).toEqual({
      linkDays: 7,
      requiresVideo: false,
      requiresIne: true,
      reviewPolicy: "none",
    });
    expect(borrador.defaults).toEqual(borrador.configuration);
    expect(borrador.customized).toBe(false);
  });

  it("conserva la Carpeta operativa cuando todavía existe", async () => {
    const escenario = await montarEscenario();
    const carpeta = await crearCarpeta(escenario.emisor, "Chárter");
    const emitido = await emitir(escenario, { folderId: carpeta });
    await cancelContract(escenario.emisor, emitido.contractId);

    const draftId = await duplicateForCorrection(
      escenario.emisor,
      emitido.contractId
    );

    const borrador = await getDraft(escenario.emisor, draftId);
    expect(borrador.folderId).toBe(carpeta);
    expect(borrador.folderName).toBe("Chárter");
  });

  it("deja el Borrador sin carpeta cuando la carpeta fue eliminada", async () => {
    const escenario = await montarEscenario();
    const carpeta = await crearCarpeta(escenario.emisor, "Temporal");
    const emitido = await emitir(escenario, { folderId: carpeta });
    await cancelContract(escenario.emisor, emitido.contractId);
    await deleteFolder(escenario.administrador, carpeta);

    const draftId = await duplicateForCorrection(
      escenario.emisor,
      emitido.contractId
    );

    const borrador = await getDraft(escenario.emisor, draftId);
    expect(borrador.folderId).toBeNull();
    expect(borrador.folderName).toBeNull();
  });

  it("exige el rol Emisor: un Administrador solo no puede duplicar", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await cancelContract(escenario.administrador, emitido.contractId);

    await expect(
      duplicateForCorrection(escenario.administrador, emitido.contractId)
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      duplicateForCorrection(escenario.revisor, emitido.contractId)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rechaza duplicar un expediente eliminado", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await cancelContract(escenario.emisor, emitido.contractId);
    await deleteContract(escenario.administrador, emitido.contractId);

    await expect(
      duplicateForCorrection(escenario.emisor, emitido.contractId)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  // La guarda «el contrato-plantilla ya no está disponible para esta
  // Organización» es defensiva: la llave foránea compuesta
  // `contracts_template_organization_fk` y el `ON DELETE RESTRICT` impiden
  // mover o borrar un contrato-plantilla con Contratos emitidos.
  it("mantiene el contrato-plantilla anclado a la Organización del Contrato", async () => {
    const escenario = await montarEscenario();
    const ajena = await montarEscenario();
    const emitido = await emitir(escenario);
    await cancelContract(escenario.emisor, emitido.contractId);

    await expect(sql`
      UPDATE contract_templates SET organization_id = ${ajena.organization.id}
      WHERE id = ${escenario.template.id}
    `).rejects.toThrow(/contracts_template_organization_fk/);
    await expect(sql`
      DELETE FROM contract_templates WHERE id = ${escenario.template.id}
    `).rejects.toThrow(/violates foreign key constraint/);
  });

  it("no duplica un Contrato de otra Organización", async () => {
    const propia = await montarEscenario();
    const ajena = await montarEscenario();
    const emitido = await emitir(ajena);
    await cancelContract(ajena.emisor, emitido.contractId);

    await expect(
      duplicateForCorrection(propia.emisor, emitido.contractId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // Bug: `compatibleValues` sólo valida las opciones de un campo `select`. Si la
  // publicación vigente cambia el tipo de dato, el valor histórico se precarga
  // igual y el Borrador queda imposible de emitir: `issueContract` lo rechaza
  // después con «debe ser un número».
  it(
    "no precarga un valor cuyo Campo contractual cambió a un tipo incompatible",
    async () => {
      const escenario = await montarEscenario();
      const emitido = await emitir(escenario);
      await cancelContract(escenario.emisor, emitido.contractId);
      await sql`
        UPDATE contract_field_definitions SET data_type = 'number'
        WHERE template_id = ${escenario.template.id} AND key = 'objeto'
      `;

      const draftId = await duplicateForCorrection(
        escenario.emisor,
        emitido.contractId
      );

      const borrador = await getDraft(escenario.emisor, draftId);
      expect(borrador.fieldValues.objeto).toBeUndefined();
      expect(borrador.missingFields).toContain("objeto");
    }
  );
});

// ---------------------------------------------------------------------------
// createFromExpired
// ---------------------------------------------------------------------------

describe("createFromExpired", () => {
  it("exige que el Contrato esté vencido", async () => {
    const escenario = await montarEscenario();
    const pendiente = await emitir(escenario);
    const aceptado = await emitir(escenario);
    await recorrerYAceptar(aceptado.token);
    const cancelado = await emitir(escenario);
    await cancelContract(escenario.emisor, cancelado.contractId);

    for (const contractId of [
      pendiente.contractId,
      aceptado.contractId,
      cancelado.contractId,
    ]) {
      await expect(
        createFromExpired(escenario.emisor, contractId)
      ).rejects.toBeInstanceOf(ConflictError);
    }
  });

  it("crea un Borrador sucesor sobre la publicación vigente", async () => {
    const escenario = await montarEscenario();
    const publicador = await createAccount({ isLegalPublisher: true });
    const carpeta = await crearCarpeta(escenario.emisor, "Renovaciones");
    const emitido = await emitir(escenario, { folderId: carpeta });
    await vencer(emitido.contractId);
    const nueva = await publishTemplateVersion({
      templateId: escenario.template.id,
      label: "3.0",
      markdown: "# Sucesor\n\nObjeto: {{objeto}}. Monto: {{monto}}.",
      publishedBy: publicador.id,
      publishedByName: publicador.fullName,
    });

    const draftId = await createFromExpired(
      escenario.otroEmisor,
      emitido.contractId
    );

    const borrador = await getDraft(escenario.otroEmisor, draftId);
    expect(borrador.originContractId).toBe(emitido.contractId);
    expect(borrador.originReason).toBe("successor");
    expect(borrador.createdBy).toBe(escenario.cuentaOtroEmisor.id);
    expect(borrador.template.currentVersion?.id).toBe(nueva.id);
    expect(borrador.fieldValues).toEqual(VALORES);
    expect(borrador.folderId).toBe(carpeta);

    const derivado = await issueContract(escenario.otroEmisor, draftId);
    const detalle = await getContractDetail(
      escenario.plataforma,
      derivado.contractId
    );
    expect(detalle.templateVersionId).toBe(nueva.id);
    expect(detalle.reference).not.toBe(emitido.reference);
    expect(detalle.originContractId).toBe(emitido.contractId);
    expect(detalle.originReason).toBe("successor");
    expect(detalle.attempts).toHaveLength(1);
    expect(detalle.currentLink?.token).not.toBe(emitido.token);

    const [auditoria] = await sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM audit_entries
      WHERE action = 'contrato_nuevo_desde_vencido' AND subject_id = ${draftId}
    `;
    expect(auditoria.payload).toEqual({
      originContractId: emitido.contractId,
      reference: emitido.reference,
    });
  });

  it("nunca reactiva el enlace vencido ni copia Intentos o evidencia", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await vencer(emitido.contractId);

    const draftId = await createFromExpired(escenario.emisor, emitido.contractId);

    expect(await loadSignerView(emitido.token)).toEqual({
      ok: false,
      reason: "expired",
    });
    const [conteos] = await sql<
      { contratos: string; intentos: string; enlaces: string }[]
    >`
      SELECT
        (SELECT COUNT(*) FROM contracts)::TEXT AS contratos,
        (SELECT COUNT(*) FROM acceptance_attempts)::TEXT AS intentos,
        (SELECT COUNT(*) FROM contract_links)::TEXT AS enlaces
    `;
    expect(conteos).toEqual({ contratos: "1", intentos: "1", enlaces: "1" });
    const borrador = await getDraft(escenario.emisor, draftId);
    expect(borrador).not.toHaveProperty("reference");
  });

  it("resuelve Titular y Firmante desde el Directorio activo actual", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await vencer(emitido.contractId);
    await setCounterpartyActive(escenario.context, escenario.holder.id, false);

    const draftId = await createFromExpired(escenario.emisor, emitido.contractId);

    const borrador = await getDraft(escenario.emisor, draftId);
    expect(borrador.holder).toBeNull();
    expect(borrador.signer?.id).toBe(escenario.signer.id);
    expect(borrador.blockers).toContain("Falta elegir el Titular contractual.");
  });

  it("parte de la Configuración predeterminada de emisión actual", async () => {
    const escenario = await montarEscenario({
      capabilities: { evidence_video: true },
      defaults: { requiresVideo: true, reviewPolicy: "manual" },
      templateDefaults: { linkDays: 9 },
    });
    const emitido = await emitir(escenario, {
      configuracion: { linkDays: 2, requiresVideo: false, reviewPolicy: "none" },
    });
    await vencer(emitido.contractId);

    const draftId = await createFromExpired(escenario.emisor, emitido.contractId);

    const borrador = await getDraft(escenario.emisor, draftId);
    expect(borrador.configuration).toEqual({
      linkDays: 7,
      requiresVideo: true,
      requiresIne: false,
      reviewPolicy: "manual",
    });
    expect(borrador.customized).toBe(false);
  });

  it("deja el Borrador sin carpeta cuando la carpeta fue eliminada", async () => {
    const escenario = await montarEscenario();
    const carpeta = await crearCarpeta(escenario.emisor, "Temporal");
    const emitido = await emitir(escenario, { folderId: carpeta });
    await vencer(emitido.contractId);
    await deleteFolder(escenario.administrador, carpeta);

    const draftId = await createFromExpired(escenario.emisor, emitido.contractId);

    const borrador = await getDraft(escenario.emisor, draftId);
    expect(borrador.folderId).toBeNull();
  });

  it("exige el rol Emisor y rechaza el expediente eliminado", async () => {
    const escenario = await montarEscenario();
    const emitido = await emitir(escenario);
    await vencer(emitido.contractId);

    await expect(
      createFromExpired(escenario.administrador, emitido.contractId)
    ).rejects.toBeInstanceOf(AuthorizationError);

    await deleteContract(escenario.administrador, emitido.contractId);
    await expect(
      createFromExpired(escenario.emisor, emitido.contractId)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("no crea un sucesor a partir de un Contrato de otra Organización", async () => {
    const propia = await montarEscenario();
    const ajena = await montarEscenario();
    const emitido = await emitir(ajena);
    await vencer(emitido.contractId);

    await expect(
      createFromExpired(propia.emisor, emitido.contractId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
