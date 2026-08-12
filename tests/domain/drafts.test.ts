import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { canonicalizeJson } from "@/lib/canonical-json";
import { hashToken, sha256Hex } from "@/lib/crypto/tokens";
import { formatMoney } from "@/lib/format";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "@/lib/domain/errors";
import { longDate } from "@/lib/domain/templates";
import { formatReference, referenceDay } from "@/lib/domain/reference";
import type { EffectiveConfiguration } from "@/lib/domain/types";
import type { OrganizationRole } from "@/lib/domain/types";
import {
  assertCapabilities,
  clampToCapabilities,
  compatibleValues,
  createDraft,
  deleteDraft,
  getDraft,
  issueContract,
  listDeletedDrafts,
  listDrafts,
  missingRequiredFields,
  resolveDefaultConfiguration,
  saveDraft,
  toStringMap,
} from "@/lib/domain/drafts";
import {
  addMembership,
  buildContext,
  createAccount,
  createCounterpartyRow,
  createIssuableOrganization,
  createTemplate,
} from "@/tests/helpers/database";
import type { AccountFixture } from "@/tests/helpers/database";
import type { OrganizationContext } from "@/lib/auth/guards";
import {
  borradorListo,
  campo,
  CAMPOS_VARIADOS,
  perfilOrganizacion,
  plantillaSintetica,
  VALORES_COMPLETOS,
} from "@/tests/helpers/drafts";

// ---------------------------------------------------------------------------
// Utilidades locales
// ---------------------------------------------------------------------------

interface HuellaDeEmision {
  contratos: number;
  partes: number;
  intentos: number;
  enlaces: number;
  eventos: number;
  secuencias: number;
  auditoriasDeEmision: number;
  paquetesFrios: number;
  objetos: number;
  trabajos: number;
}

const NADA_EMITIDO: HuellaDeEmision = {
  contratos: 0,
  partes: 0,
  intentos: 0,
  enlaces: 0,
  eventos: 0,
  secuencias: 0,
  auditoriasDeEmision: 0,
  paquetesFrios: 0,
  objetos: 0,
  trabajos: 0,
};

/** Todo lo que `Generar enlace` debería escribir, contado de una sola vez. */
async function huellaDeEmision(): Promise<HuellaDeEmision> {
  const [row] = await sql<
    {
      contratos: string;
      partes: string;
      intentos: string;
      enlaces: string;
      eventos: string;
      secuencias: string;
      auditorias: string;
      paquetes: string;
      objetos: string;
      trabajos: string;
    }[]
  >`
    SELECT
      (SELECT count(*) FROM contracts)::TEXT AS contratos,
      (SELECT count(*) FROM contract_parties)::TEXT AS partes,
      (SELECT count(*) FROM acceptance_attempts)::TEXT AS intentos,
      (SELECT count(*) FROM contract_links)::TEXT AS enlaces,
      (SELECT count(*) FROM contract_events)::TEXT AS eventos,
      (SELECT count(*) FROM contract_reference_sequences)::TEXT AS secuencias,
      (SELECT count(*) FROM audit_entries
        WHERE action = 'contrato_emitido')::TEXT AS auditorias,
      (SELECT count(*) FROM cold_contract_packages)::TEXT AS paquetes,
      (SELECT count(*) FROM contract_objects)::TEXT AS objetos,
      (SELECT count(*) FROM background_jobs)::TEXT AS trabajos
  `;
  return {
    contratos: Number(row.contratos),
    partes: Number(row.partes),
    intentos: Number(row.intentos),
    enlaces: Number(row.enlaces),
    eventos: Number(row.eventos),
    secuencias: Number(row.secuencias),
    auditoriasDeEmision: Number(row.auditorias),
    paquetesFrios: Number(row.paquetes),
    objetos: Number(row.objetos),
    trabajos: Number(row.trabajos),
  };
}

interface FilaBorrador {
  field_values: Record<string, string>;
  defaults_snapshot: Record<string, unknown>;
  holder_counterparty_id: string | null;
  signer_counterparty_id: string | null;
  folder_id: string | null;
  link_days: number;
  requires_video: boolean;
  requires_ine: boolean;
  review_policy: string;
  customized: boolean;
  classification: string;
  issued_contract_id: string | null;
  deleted_at: Date | null;
}

async function filaBorrador(draftId: string): Promise<FilaBorrador> {
  const [row] = await sql<FilaBorrador[]>`
    SELECT field_values, defaults_snapshot, holder_counterparty_id,
           signer_counterparty_id, folder_id, link_days, requires_video,
           requires_ine, review_policy, customized, classification,
           issued_contract_id, deleted_at
    FROM contract_drafts WHERE id = ${draftId}
  `;
  return row;
}

interface FilaContrato {
  id: string;
  reference: string;
  status: string;
  template_version_id: string;
  template_name: string;
  template_label: string;
  privacy_notice_version_id: string;
  contract_markdown: string;
  field_values: Record<string, string>;
  document_hash: string;
  acceptance_legend: string;
  video_statement: string;
  link_days: number;
  requires_video: boolean;
  requires_ine: boolean;
  review_policy: string;
  defaults_snapshot: Record<string, unknown>;
  customized: boolean;
  classification: string;
  created_by: string;
  created_by_name: string;
  origin_contract_id: string | null;
  origin_reason: string | null;
  search_text: string;
  issued_at: Date;
}

async function filaContrato(contractId: string): Promise<FilaContrato> {
  const [row] = await sql<FilaContrato[]>`
    SELECT id, reference, status, template_version_id, template_name,
           template_label, privacy_notice_version_id, contract_markdown,
           field_values, document_hash, acceptance_legend, video_statement,
           link_days, requires_video, requires_ine, review_policy,
           defaults_snapshot, customized, classification, created_by,
           created_by_name, origin_contract_id, origin_reason, search_text,
           issued_at
    FROM contracts WHERE id = ${contractId}
  `;
  return row;
}

async function miembroNuevo(
  organizationId: string,
  roles: OrganizationRole[]
): Promise<{ cuenta: AccountFixture; contexto: OrganizationContext }> {
  const cuenta = await createAccount();
  await addMembership(organizationId, cuenta.id, roles);
  return { cuenta, contexto: await buildContext(organizationId, cuenta, roles) };
}

async function contextoRecargado(
  organizationId: string,
  cuenta: AccountFixture,
  roles: OrganizationRole[]
): Promise<OrganizationContext> {
  return buildContext(organizationId, cuenta, roles, { isPrimaryAdmin: true });
}

const ROLES_COMPLETOS: OrganizationRole[] = ["administrator", "emitter"];

async function crearCarpeta(
  organizationId: string,
  name: string
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO contract_folders (organization_id, name)
    VALUES (${organizationId}, ${name})
    RETURNING id
  `;
  return row.id;
}

// ---------------------------------------------------------------------------
// Configuración predeterminada de emisión
// ---------------------------------------------------------------------------

describe("resolveDefaultConfiguration", () => {
  it("parte de la Configuración predeterminada de la Organización", () => {
    const organizacion = perfilOrganizacion({
      capabilities: { evidence_video: true, evidence_ine: true, ai_review: true },
      defaults: {
        linkDays: 12,
        requiresVideo: true,
        requiresIne: true,
        reviewPolicy: "manual",
      },
    });
    expect(resolveDefaultConfiguration(organizacion, null)).toEqual({
      linkDays: 12,
      requiresVideo: true,
      requiresIne: true,
      reviewPolicy: "manual",
    });
  });

  it("el Contrato-plantilla eleva la evidencia y nunca la reduce", () => {
    const organizacion = perfilOrganizacion({
      capabilities: { evidence_video: true, evidence_ine: true },
      defaults: { requiresVideo: true, requiresIne: false },
    });
    const plantilla = plantillaSintetica({
      defaults: {
        linkDays: 7,
        requiresVideo: false,
        requiresIne: true,
        reviewPolicy: "none",
      },
    });
    const resultado = resolveDefaultConfiguration(organizacion, plantilla);
    expect(resultado.requiresVideo).toBe(true);
    expect(resultado.requiresIne).toBe(true);
  });

  it("conserva la Política de revisión más fuerte de las dos", () => {
    const organizacion = perfilOrganizacion({
      capabilities: { ai_review: true },
      defaults: { reviewPolicy: "manual" },
    });
    const sinRevision = plantillaSintetica({
      defaults: {
        linkDays: 7,
        requiresVideo: false,
        requiresIne: false,
        reviewPolicy: "none",
      },
    });
    const conAi = plantillaSintetica({
      defaults: {
        linkDays: 7,
        requiresVideo: false,
        requiresIne: false,
        reviewPolicy: "ai",
      },
    });
    expect(resolveDefaultConfiguration(organizacion, sinRevision).reviewPolicy).toBe(
      "manual"
    );
    expect(resolveDefaultConfiguration(organizacion, conAi).reviewPolicy).toBe("ai");
  });

  // ADR-0070: el Contrato-plantilla propone la vigencia, pero el valor que un
  // Administrador de la Organización dejó configurado manda sobre la propuesta
  // para todas las emisiones futuras.
  it("usa la Vigencia del enlace configurada por la Organización", () => {
    const organizacion = perfilOrganizacion({ defaults: { linkDays: 7 } });
    const plantilla = plantillaSintetica({
      defaults: {
        linkDays: 21,
        requiresVideo: false,
        requiresIne: false,
        reviewPolicy: "none",
      },
    });
    expect(resolveDefaultConfiguration(organizacion, plantilla).linkDays).toBe(7);
  });

  it("conserva INE y video universales y acota sólo AI y vigencia", () => {
    const organizacion = perfilOrganizacion({
      defaults: {
        linkDays: 45,
        requiresVideo: true,
        requiresIne: true,
        reviewPolicy: "ai",
      },
    });
    expect(resolveDefaultConfiguration(organizacion, null)).toEqual({
      linkDays: 30,
      requiresVideo: true,
      requiresIne: true,
      reviewPolicy: "manual",
    });
  });

  // Sin Contrato-plantilla no hay quien eleve la evidencia: la Organización que
  // no pide video ni INE sigue sin pedirlos aunque los tenga habilitados.
  it("sin Contrato-plantilla conserva la evidencia mínima de la Organización", () => {
    const organizacion = perfilOrganizacion({
      capabilities: { evidence_video: true, evidence_ine: true },
      defaults: {
        linkDays: 9,
        requiresVideo: false,
        requiresIne: false,
        reviewPolicy: "none",
      },
    });
    expect(resolveDefaultConfiguration(organizacion, null)).toEqual({
      linkDays: 9,
      requiresVideo: false,
      requiresIne: false,
      reviewPolicy: "none",
    });
  });
});

describe("clampToCapabilities", () => {
  const base: EffectiveConfiguration = {
    linkDays: 7,
    requiresVideo: true,
    requiresIne: true,
    reviewPolicy: "ai",
  };

  it("acota la vigencia a días completos entre 1 y 30", () => {
    const organizacion = perfilOrganizacion();
    const dias = (linkDays: number) =>
      clampToCapabilities(organizacion, { ...base, linkDays }).linkDays;
    expect(dias(0)).toBe(1);
    expect(dias(-9)).toBe(1);
    expect(dias(0.4)).toBe(1);
    expect(dias(7.9)).toBe(7);
    expect(dias(31)).toBe(30);
    expect(dias(365)).toBe(30);
  });

  it("conserva video e INE y degrada únicamente la revisión AI", () => {
    expect(clampToCapabilities(perfilOrganizacion(), base)).toEqual({
      linkDays: 7,
      requiresVideo: true,
      requiresIne: true,
      reviewPolicy: "manual",
    });
  });

  it("conserva las opciones cuando la Organización las tiene habilitadas", () => {
    const organizacion = perfilOrganizacion({
      capabilities: { evidence_video: true, evidence_ine: true, ai_review: true },
    });
    expect(clampToCapabilities(organizacion, base)).toEqual(base);
  });
});

describe("assertCapabilities", () => {
  const habilitada = perfilOrganizacion({
    capabilities: { evidence_video: true, evidence_ine: true, ai_review: true },
  });

  it("acepta una configuración dentro de las capacidades", () => {
    expect(() =>
      assertCapabilities(habilitada, {
        linkDays: 30,
        requiresVideo: true,
        requiresIne: true,
        reviewPolicy: "ai",
      })
    ).not.toThrow();
  });

  it("admite video e INE universales y rechaza AI sin capacidad", () => {
    const organizacion = perfilOrganizacion();
    expect(() =>
      assertCapabilities(organizacion, {
        linkDays: 7,
        requiresVideo: true,
        requiresIne: false,
        reviewPolicy: "none",
      })
    ).not.toThrow();
    expect(() =>
      assertCapabilities(organizacion, {
        linkDays: 7,
        requiresVideo: false,
        requiresIne: true,
        reviewPolicy: "none",
      })
    ).not.toThrow();
    expect(() =>
      assertCapabilities(organizacion, {
        linkDays: 7,
        requiresVideo: false,
        requiresIne: false,
        reviewPolicy: "ai",
      })
    ).toThrow(ConflictError);
  });

  it("rechaza cero, negativos, fracciones y plazos mayores a 30", () => {
    for (const linkDays of [0, -1, 1.5, 31, Number.NaN]) {
      expect(() =>
        assertCapabilities(habilitada, {
          linkDays,
          requiresVideo: false,
          requiresIne: false,
          reviewPolicy: "none",
        })
      ).toThrow(ConflictError);
    }
  });
});

describe("missingRequiredFields y compatibleValues", () => {
  const campos = [
    campo({ key: "objeto", label: "Objeto" }),
    campo({ key: "nota", label: "Nota", required: false }),
    campo({
      key: "modalidad",
      label: "Modalidad",
      dataType: "select",
      options: ["mensual", "anual"],
    }),
  ];

  it("enumera los campos obligatorios sin valor útil", () => {
    expect(missingRequiredFields(campos, { objeto: "   ", modalidad: "anual" })).toEqual(
      ["objeto"]
    );
    expect(
      missingRequiredFields(campos, { objeto: "Servicio", modalidad: "anual" })
    ).toEqual([]);
  });

  it("conserva sólo los valores compatibles y recortados", () => {
    expect(
      compatibleValues(campos, {
        objeto: "  Servicio  ",
        nota: "",
        modalidad: "semanal",
        ajeno: "descartado",
      })
    ).toEqual({ objeto: "Servicio" });
  });

  it("conserva la fecha en formato AAAA-MM-DD y descarta cualquier otro", () => {
    const conFechas = [
      campo({ key: "inicio", label: "Inicio", dataType: "date" }),
      campo({ key: "fin", label: "Fin", dataType: "date", required: false }),
    ];
    expect(
      compatibleValues(conFechas, { inicio: " 2026-03-01 ", fin: "01/03/2026" })
    ).toEqual({ inicio: "2026-03-01" });
  });

  it("normaliza la moneda compatible de un campo money reutilizado", () => {
    const conMonto = [
      campo({
        key: "monto",
        label: "Monto",
        dataType: "money",
        options: ["USD", "MXN"],
      }),
    ];
    expect(
      compatibleValues(conMonto, { monto: " 1500.50 ", monto_moneda: " usd " })
    ).toEqual({ monto: "1500.50", monto_moneda: "USD" });
  });

  /**
   * `select` cierra la entrada a su lista; `suggest` sólo propone. Es la
   * diferencia que justifica que sean dos tipos y no un `text` con opciones.
   */
  it("acepta en `suggest` un valor que no está entre sus sugerencias", () => {
    const conSugerencias = [
      campo({
        key: "origen",
        label: "Origen",
        dataType: "suggest",
        options: ["Guadalajara, Jalisco", "Monterrey, Nuevo León"],
      }),
    ];
    expect(compatibleValues(conSugerencias, { origen: " Tepatitlán " })).toEqual({
      origen: "Tepatitlán",
    });
  });
});

describe("toStringMap", () => {
  it("lee el JSONB contractual siempre como texto", () => {
    expect(
      toStringMap({ a: "uno", b: 2, c: true, d: null, e: { f: 1 } })
    ).toEqual({ a: "uno", b: "2", c: "true" });
  });

  it("devuelve un mapa vacío ante un valor que no es objeto", () => {
    expect(toStringMap(null)).toEqual({});
    expect(toStringMap(["a"])).toEqual({});
    expect(toStringMap("texto")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// createDraft
// ---------------------------------------------------------------------------

describe("createDraft", () => {
  it("hereda los valores predeterminados de la Organización", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { evidence_ine: true },
      defaults: { linkDays: 9, requiresIne: true, reviewPolicy: "manual" },
      templateDefaults: { linkDays: 9 },
    });
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
    });
    const detalle = await getDraft(fixture.context, draftId);
    expect(detalle.configuration).toEqual({
      linkDays: 9,
      requiresVideo: false,
      requiresIne: true,
      reviewPolicy: "manual",
    });
    expect(detalle.defaults).toEqual(detalle.configuration);
    expect(detalle.customized).toBe(false);
  });

  it("eleva la evidencia y la revisión que exige el Contrato-plantilla", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { evidence_video: true, ai_review: true },
      defaults: { requiresVideo: false, reviewPolicy: "none" },
      templateDefaults: { requiresVideo: true, reviewPolicy: "ai", linkDays: 3 },
    });
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
    });
    const detalle = await getDraft(fixture.context, draftId);
    // La evidencia y la revisión se elevan; la vigencia la fija la Organización.
    expect(detalle.configuration).toEqual({
      linkDays: 7,
      requiresVideo: true,
      requiresIne: false,
      reviewPolicy: "ai",
    });
  });

  it("conserva la evidencia universal y acota la revisión AI", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { evidence_video: false, evidence_ine: false, ai_review: false },
      templateDefaults: {
        requiresVideo: true,
        requiresIne: true,
        reviewPolicy: "ai",
      },
    });
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
    });
    const detalle = await getDraft(fixture.context, draftId);
    expect(detalle.configuration).toEqual({
      linkDays: 7,
      requiresVideo: true,
      requiresIne: true,
      reviewPolicy: "manual",
    });
    expect(detalle.blockers).toEqual(
      expect.not.arrayContaining([expect.stringContaining("no está habilitada")])
    );
  });

  it("rechaza un Contrato-plantilla de otra Organización", async () => {
    const propia = await createIssuableOrganization();
    const ajena = await createIssuableOrganization();
    await expect(
      createDraft(propia.context, { templateId: ajena.template.id })
    ).rejects.toBeInstanceOf(NotFoundError);
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::TEXT AS count FROM contract_drafts
    `;
    expect(count).toBe("0");
  });

  it("rechaza un Contrato-plantilla inexistente", async () => {
    const fixture = await createIssuableOrganization();
    await expect(
      createDraft(fixture.context, {
        templateId: "33333333-3333-4333-8333-333333333333",
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("exige el rol Emisor", async () => {
    const fixture = await createIssuableOrganization({ roles: ["administrator"] });
    await expect(
      createDraft(fixture.context, { templateId: fixture.template.id })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("precarga sólo los campos compatibles del `prefill`", async () => {
    const fixture = await createIssuableOrganization({ fields: CAMPOS_VARIADOS });
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
      prefill: {
        objeto: "  Servicio  ",
        modalidad: "semanal",
        nota: "",
        inexistente: "descartado",
      },
    });
    const detalle = await getDraft(fixture.context, draftId);
    expect(detalle.fieldValues).toEqual({ objeto: "Servicio" });
    expect(detalle.missingFields).toEqual(["monto"]);
    expect(detalle.canIssue).toBe(false);
  });

  it("acepta Titular, Firmante y Carpeta iniciales", async () => {
    const fixture = await createIssuableOrganization();
    const carpetaId = await crearCarpeta(fixture.organization.id, "Clientes");
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
      holderId: fixture.holder.id,
      signerId: fixture.signer.id,
      folderId: carpetaId,
    });
    const detalle = await getDraft(fixture.context, draftId);
    expect(detalle.holder?.id).toBe(fixture.holder.id);
    expect(detalle.signer?.id).toBe(fixture.signer.id);
    expect(detalle.folderId).toBe(carpetaId);
    expect(detalle.folderName).toBe("Clientes");
  });

  it("descarta contrapartes desactivadas, ajenas y carpetas de otra Organización", async () => {
    const fixture = await createIssuableOrganization();
    const ajena = await createIssuableOrganization();
    const inactiva = await createCounterpartyRow(fixture.organization.id, {
      active: false,
    });
    const carpetaAjena = await crearCarpeta(ajena.organization.id, "Ajena");
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
      holderId: inactiva.id,
      signerId: ajena.signer.id,
      folderId: carpetaAjena,
    });
    const detalle = await getDraft(fixture.context, draftId);
    expect(detalle.holder).toBeNull();
    expect(detalle.signer).toBeNull();
    expect(detalle.folderId).toBeNull();
    expect(detalle.blockers).toContain("Falta elegir el Titular contractual.");
    expect(detalle.blockers).toContain("Falta elegir el Firmante.");
  });

  it("conserva la Relación técnica de origen y registra la auditoría", async () => {
    const fixture = await createIssuableOrganization();
    const origen = "44444444-4444-4444-8444-444444444444";
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
      originContractId: origen,
      originReason: "duplicate",
    });
    const detalle = await getDraft(fixture.context, draftId);
    expect(detalle.originContractId).toBe(origen);
    expect(detalle.originReason).toBe("duplicate");

    const [auditoria] = await sql<
      { action: string; subject_type: string; subject_id: string; payload: Record<string, unknown> }[]
    >`
      SELECT action, subject_type, subject_id, payload FROM audit_entries
      WHERE action = 'borrador_creado'
    `;
    expect(auditoria.subject_type).toBe("contract_draft");
    expect(auditoria.subject_id).toBe(draftId);
    expect(auditoria.payload).toMatchObject({
      templateId: fixture.template.id,
      originContractId: origen,
      originReason: "duplicate",
    });
  });

  it("deja el motivo de origen en nulo cuando no se indica", async () => {
    const fixture = await createIssuableOrganization();
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
    });
    const detalle = await getDraft(fixture.context, draftId);
    expect(detalle.originReason).toBeNull();
    expect(detalle.originContractId).toBeNull();
    expect(detalle.createdByName).toBe(fixture.account.fullName);
  });
});

// ---------------------------------------------------------------------------
// getDraft y listDrafts
// ---------------------------------------------------------------------------

describe("getDraft y listDrafts", () => {
  it("el Emisor creador ve su Borrador y sus bloqueos", async () => {
    const fixture = await borradorListo({ valores: null, conTitular: false, conFirmante: false });
    const detalle = await getDraft(fixture.context, fixture.draftId);
    expect(detalle.id).toBe(fixture.draftId);
    expect(detalle.canIssue).toBe(false);
    expect(detalle.missingFields).toEqual(["objeto", "monto"]);
    expect(detalle.blockers).toContain("Falta elegir el Titular contractual.");
    expect(detalle.blockers).toContain("Falta elegir el Firmante.");
    expect(detalle.blockers).toContain("Faltan datos obligatorios: Objeto, Monto.");
    expect(await listDrafts(fixture.context)).toHaveLength(1);
  });

  it("un Administrador ve el Borrador de otro Emisor", async () => {
    const fixture = await borradorListo({ roles: ["emitter"] });
    const { contexto } = await miembroNuevo(fixture.organization.id, [
      "administrator",
    ]);
    const detalle = await getDraft(contexto, fixture.draftId);
    expect(detalle.createdBy).toBe(fixture.account.id);
    expect(await listDrafts(contexto)).toHaveLength(1);
  });

  it("otro Emisor no ve el Borrador ajeno", async () => {
    const fixture = await borradorListo({ roles: ["emitter"] });
    const { contexto } = await miembroNuevo(fixture.organization.id, ["emitter"]);
    await expect(getDraft(contexto, fixture.draftId)).rejects.toBeInstanceOf(
      AuthorizationError
    );
    expect(await listDrafts(contexto)).toEqual([]);
  });

  it("un Revisor no ve Borradores", async () => {
    const fixture = await borradorListo();
    const { contexto } = await miembroNuevo(fixture.organization.id, ["reviewer"]);
    await expect(getDraft(contexto, fixture.draftId)).rejects.toBeInstanceOf(
      AuthorizationError
    );
    await expect(listDrafts(contexto)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("no encuentra el Borrador de otra Organización", async () => {
    const fixture = await borradorListo();
    const ajena = await createIssuableOrganization();
    await expect(
      getDraft(ajena.context, fixture.draftId)
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await listDrafts(ajena.context)).toEqual([]);
  });

  it("no encuentra un Borrador inexistente", async () => {
    const fixture = await createIssuableOrganization();
    await expect(
      getDraft(fixture.context, "55555555-5555-4555-8555-555555555555")
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("listDrafts excluye Borradores emitidos y eliminados", async () => {
    const emitido = await borradorListo();
    await issueContract(emitido.context, emitido.draftId);
    const eliminado = await createDraft(emitido.context, {
      templateId: emitido.template.id,
    });
    await deleteDraft(emitido.context, eliminado);
    const pendiente = await createDraft(emitido.context, {
      templateId: emitido.template.id,
    });

    const lista = await listDrafts(emitido.context);
    expect(lista.map((item) => item.id)).toEqual([pendiente]);
  });

  it("anuncia el bloqueo cuando no hay publicación vigente ni Aviso completo", async () => {
    const fixture = await borradorListo();
    await sql`
      UPDATE contract_template_versions SET is_current = FALSE
      WHERE template_id = ${fixture.template.id}
    `;
    await sql`
      UPDATE privacy_notice_versions SET full_markdown = '   '
      WHERE organization_id = ${fixture.organization.id}
    `;
    const detalle = await getDraft(fixture.context, fixture.draftId);
    expect(detalle.blockers).toContain(
      "El contrato-plantilla no tiene una publicación vigente."
    );
    expect(detalle.blockers).toContain("No hay un Aviso de Privacidad vigente completo.");
    expect(detalle.canIssue).toBe(false);
  });

  it("anuncia el bloqueo cuando una parte se desactivó después de elegirla", async () => {
    const fixture = await borradorListo();
    await sql`
      UPDATE counterparties SET active = FALSE WHERE id = ${fixture.signer.id}
    `;
    const detalle = await getDraft(fixture.context, fixture.draftId);
    expect(detalle.signer?.active).toBe(false);
    expect(detalle.blockers).toContain(
      "El Firmante está desactivado en el Directorio."
    );
    expect(detalle.canIssue).toBe(false);
  });

  it("no bloquea evidencia aunque una fila comercial histórica se deshabilite", async () => {
    const fixture = await borradorListo({ capabilities: { evidence_video: true } });
    await saveDraft(fixture.context, fixture.draftId, { requiresVideo: true });
    await sql`
      UPDATE commercial_entitlements SET enabled = FALSE
      WHERE organization_id = ${fixture.organization.id}
        AND capability = 'evidence_video'
    `;
    const contexto = await contextoRecargado(
      fixture.organization.id,
      fixture.account,
      ROLES_COMPLETOS
    );
    const detalle = await getDraft(contexto, fixture.draftId);
    expect(detalle.configuration.requiresVideo).toBe(true);
    expect(detalle.blockers).toEqual([]);
    expect(detalle.canIssue).toBe(true);
  });

  it("anuncia el bloqueo cuando la revisión AI deja de estar habilitada", async () => {
    const fixture = await borradorListo({ capabilities: { ai_review: true } });
    await saveDraft(fixture.context, fixture.draftId, { reviewPolicy: "ai" });
    await sql`
      UPDATE commercial_entitlements SET enabled = FALSE
      WHERE organization_id = ${fixture.organization.id}
        AND capability = 'ai_review'
    `;
    const contexto = await contextoRecargado(
      fixture.organization.id,
      fixture.account,
      ROLES_COMPLETOS
    );
    const detalle = await getDraft(contexto, fixture.draftId);
    expect(detalle.blockers).toContain(
      "La revisión asistida por AI no está habilitada para esta Organización."
    );
    expect(detalle.canIssue).toBe(false);
  });

  it("anuncia el bloqueo cuando el Titular contractual se desactivó", async () => {
    const fixture = await borradorListo();
    await sql`
      UPDATE counterparties SET active = FALSE WHERE id = ${fixture.holder.id}
    `;
    const detalle = await getDraft(fixture.context, fixture.draftId);
    expect(detalle.holder?.active).toBe(false);
    expect(detalle.blockers).toContain(
      "El Titular contractual está desactivado en el Directorio."
    );
    expect(detalle.canIssue).toBe(false);
  });

  it("resuelve partes que quedan fuera de los primeros 200 del Directorio", async () => {
    const fixture = await createIssuableOrganization();
    await sql`
      INSERT INTO counterparties (organization_id, person_kind, name)
      SELECT ${fixture.organization.id}, 'fisica',
             'Aaa relleno ' || lpad(serie::TEXT, 4, '0')
      FROM generate_series(1, 205) AS serie
    `;
    const titular = await createCounterpartyRow(fixture.organization.id, {
      name: "Zzz Titular",
      personKind: "moral",
    });
    const firmante = await createCounterpartyRow(fixture.organization.id, {
      name: "Zzz Firmante",
    });
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
      holderId: titular.id,
      signerId: firmante.id,
    });
    const detalle = await getDraft(fixture.context, draftId);
    expect(detalle.holder?.name).toBe("Zzz Titular");
    expect(detalle.holder?.personKind).toBe("moral");
    expect(detalle.signer?.name).toBe("Zzz Firmante");
    expect(detalle.blockers).not.toContain("Falta elegir el Firmante.");
  });

  it("usa la Configuración predeterminada vigente si la instantánea se borró", async () => {
    const fixture = await borradorListo({ templateDefaults: { linkDays: 11 } });
    await saveDraft(fixture.context, fixture.draftId, { linkDays: 4 });
    await deleteDraft(fixture.context, fixture.draftId);

    const detalle = await getDraft(fixture.context, fixture.draftId);
    expect(detalle.fieldValues).toEqual({});
    expect(detalle.configuration.linkDays).toBe(4);
    expect(detalle.defaults).toEqual({
      linkDays: 7,
      requiresVideo: false,
      requiresIne: false,
      reviewPolicy: "none",
    });
    expect(detalle.originReason).toBeNull();
  });

  it("ignora una instantánea de predeterminados con tipos inservibles", async () => {
    const fixture = await borradorListo({ templateDefaults: { linkDays: 11 } });
    await sql`
      UPDATE contract_drafts SET defaults_snapshot = ${sql.json({
        linkDays: "siete",
        requiresVideo: 1,
        requiresIne: "no",
        reviewPolicy: "otra",
        originReason: "inventado",
      })}
      WHERE id = ${fixture.draftId}
    `;
    const conObjeto = await getDraft(fixture.context, fixture.draftId);
    expect(conObjeto.defaults).toEqual({
      linkDays: 7,
      requiresVideo: false,
      requiresIne: false,
      reviewPolicy: "none",
    });
    expect(conObjeto.originReason).toBeNull();

    await sql`
      UPDATE contract_drafts SET defaults_snapshot = 'null'::JSONB
      WHERE id = ${fixture.draftId}
    `;
    const sinObjeto = await getDraft(fixture.context, fixture.draftId);
    expect(sinObjeto.defaults).toEqual(conObjeto.defaults);
    expect(sinObjeto.originReason).toBeNull();
  });

  it("listDeletedDrafts conserva sólo metadata mínima", async () => {
    const fixture = await borradorListo();
    await deleteDraft(fixture.context, fixture.draftId);
    const eliminados = await listDeletedDrafts(fixture.context);
    expect(eliminados).toHaveLength(1);
    expect(eliminados[0]).toMatchObject({
      id: fixture.draftId,
      templateName: fixture.template.name,
      createdByName: fixture.account.fullName,
    });
    expect(eliminados[0].deletedAt).toBeInstanceOf(Date);
  });

  it("listDeletedDrafts sólo muestra lo propio a un Emisor", async () => {
    const fixture = await borradorListo();
    await deleteDraft(fixture.context, fixture.draftId);
    const { contexto } = await miembroNuevo(fixture.organization.id, ["emitter"]);
    expect(await listDeletedDrafts(contexto)).toEqual([]);
    const { contexto: administrador } = await miembroNuevo(
      fixture.organization.id,
      ["administrator"]
    );
    expect(await listDeletedDrafts(administrador)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// saveDraft
// ---------------------------------------------------------------------------

describe("saveDraft", () => {
  it("guarda automáticamente y recalcula missingFields y canIssue", async () => {
    const fixture = await borradorListo({ valores: null });
    const parcial = await saveDraft(fixture.context, fixture.draftId, {
      fieldValues: { objeto: "Servicio" },
    });
    expect(parcial.missingFields).toEqual(["monto"]);
    expect(parcial.canIssue).toBe(false);

    const completo = await saveDraft(fixture.context, fixture.draftId, {
      fieldValues: { monto: "1500.50" },
    });
    expect(completo.fieldValues).toEqual({ objeto: "Servicio", monto: "1500.50" });
    expect(completo.missingFields).toEqual([]);
    expect(completo.canIssue).toBe(true);
    expect(completo.updatedAt.getTime()).toBeGreaterThanOrEqual(
      completo.createdAt.getTime()
    );
  });

  it("descarta claves de campo desconocidas", async () => {
    const fixture = await borradorListo({ valores: null });
    const detalle = await saveDraft(fixture.context, fixture.draftId, {
      fieldValues: { objeto: "Servicio", intruso: "no debe guardarse" },
    });
    expect(detalle.fieldValues).toEqual({ objeto: "Servicio" });
    expect(Object.keys((await filaBorrador(fixture.draftId)).field_values)).toEqual([
      "objeto",
    ]);
  });

  /**
   * Un valor guardado cuyo campo ya no existe en el Contrato-plantilla no puede
   * validarse contra ningún tipo: la validación lo ignora en vez de romper el
   * guardado automático del resto del Borrador.
   */
  it("ignora en la validación un valor cuyo campo ya no existe", async () => {
    const fixture = await borradorListo({ valores: null });
    await sql`
      UPDATE contract_drafts
      SET field_values = ${JSON.stringify({
        objeto: "Servicio previo",
        campo_retirado: "valor sin campo",
      })}::text::jsonb
      WHERE id = ${fixture.draftId}
    `;

    const detalle = await saveDraft(fixture.context, fixture.draftId, {
      fieldValues: { monto: "1500.50" },
    });

    expect(detalle.fieldValues.monto).toBe("1500.50");
    expect(detalle.fieldValues.campo_retirado).toBe("valor sin campo");
    expect(detalle.missingFields).toEqual([]);
    expect(detalle.canIssue).toBe(true);
  });

  it("valida money, number, date y el catálogo de un select", async () => {
    const fixture = await borradorListo({
      fields: CAMPOS_VARIADOS,
      valores: null,
    });
    const invalidos: Record<string, string>[] = [
      { monto: "no es número" },
      { monto: "1,500" },
      { piezas: "tres" },
      { inicio: "01/03/2026" },
      { modalidad: "semanal" },
      { monto_moneda: "BTC" },
      { monto: "100", monto_moneda: "BTC" },
    ];
    for (const fieldValues of invalidos) {
      await expect(
        saveDraft(fixture.context, fixture.draftId, { fieldValues })
      ).rejects.toBeInstanceOf(ConflictError);
    }
    expect((await filaBorrador(fixture.draftId)).field_values).toEqual({});

    const detalle = await saveDraft(fixture.context, fixture.draftId, {
      fieldValues: {
        objeto: "Servicio",
        monto: "1500.50",
        monto_moneda: "USD",
        piezas: "12",
        inicio: "2026-03-01",
        modalidad: "mensual",
        nota: "Cualquier texto largo.",
      },
    });
    expect(detalle.fieldValues.monto_moneda).toBe("USD");
    expect(detalle.missingFields).toEqual([]);
    expect(detalle.canIssue).toBe(true);
  });

  it("rechaza una moneda legacy incompatible cuando se edita el monto", async () => {
    const fixture = await borradorListo({
      fields: CAMPOS_VARIADOS,
      valores: null,
    });
    await sql`
      UPDATE contract_drafts
      SET field_values = ${sql.json({ monto_moneda: "BTC" })}
      WHERE id = ${fixture.draftId}
    `;

    await expect(
      saveDraft(fixture.context, fixture.draftId, { fieldValues: { monto: "100" } })
    ).rejects.toThrow("«Monto» no admite esa moneda.");
  });

  it("acepta un valor vacío en un campo tipado sin validarlo", async () => {
    const fixture = await borradorListo({ fields: CAMPOS_VARIADOS });
    const detalle = await saveDraft(fixture.context, fixture.draftId, {
      fieldValues: { piezas: "   " },
    });
    expect(detalle.fieldValues.piezas).toBe("   ");
    expect(detalle.canIssue).toBe(true);
  });

  it("acota la Vigencia del enlace a días completos entre 1 y 30", async () => {
    const fixture = await borradorListo();
    for (const linkDays of [0, -3, 31, 1.5, 0.5]) {
      await expect(
        saveDraft(fixture.context, fixture.draftId, { linkDays })
      ).rejects.toBeInstanceOf(ConflictError);
    }
    expect((await filaBorrador(fixture.draftId)).link_days).toBe(7);

    for (const linkDays of [1, 30, 15]) {
      const detalle = await saveDraft(fixture.context, fixture.draftId, { linkDays });
      expect(detalle.configuration.linkDays).toBe(linkDays);
    }
  });

  it("admite INE y video universales y conserva el límite de revisión AI", async () => {
    const fixture = await borradorListo();
    await saveDraft(fixture.context, fixture.draftId, {
      requiresVideo: true,
      requiresIne: true,
    });
    await expect(
      saveDraft(fixture.context, fixture.draftId, { reviewPolicy: "ai" })
    ).rejects.toBeInstanceOf(ConflictError);

    const fila = await filaBorrador(fixture.draftId);
    expect(fila.requires_video).toBe(true);
    expect(fila.requires_ine).toBe(true);
    expect(fila.review_policy).toBe("none");
  });

  it("acepta la revisión manual siempre y la AI sólo con capacidad", async () => {
    const sinAi = await borradorListo();
    const manual = await saveDraft(sinAi.context, sinAi.draftId, {
      reviewPolicy: "manual",
    });
    expect(manual.configuration.reviewPolicy).toBe("manual");

    const conAi = await borradorListo({ capabilities: { ai_review: true } });
    const ai = await saveDraft(conAi.context, conAi.draftId, { reviewPolicy: "ai" });
    expect(ai.configuration.reviewPolicy).toBe("ai");
  });

  it("marca `customized` sólo cuando el Emisor se aparta de los predeterminados", async () => {
    const fixture = await borradorListo({ capabilities: { evidence_ine: true } });
    const soloDatos = await saveDraft(fixture.context, fixture.draftId, {
      fieldValues: { objeto: "Otro servicio" },
    });
    expect(soloDatos.customized).toBe(false);

    const personalizado = await saveDraft(fixture.context, fixture.draftId, {
      linkDays: 3,
      requiresIne: true,
    });
    expect(personalizado.customized).toBe(true);

    const restaurado = await saveDraft(fixture.context, fixture.draftId, {
      linkDays: 7,
      requiresIne: false,
    });
    expect(restaurado.customized).toBe(false);
    expect(restaurado.configuration).toEqual(restaurado.defaults);
  });

  it("conserva los valores previos cuando el parche sólo cambia la configuración", async () => {
    const fixture = await borradorListo();
    const detalle = await saveDraft(fixture.context, fixture.draftId, {
      linkDays: 12,
    });
    expect(detalle.fieldValues).toEqual(VALORES_COMPLETOS);
    expect(detalle.holder?.id).toBe(fixture.holder.id);
    expect(detalle.signer?.id).toBe(fixture.signer.id);
  });

  it("cambia Titular, Firmante y Carpeta, y acepta desasignarlos", async () => {
    const fixture = await borradorListo();
    const carpetaId = await crearCarpeta(fixture.organization.id, "Operación");
    const otro = await createCounterpartyRow(fixture.organization.id);
    const asignado = await saveDraft(fixture.context, fixture.draftId, {
      signerId: otro.id,
      folderId: carpetaId,
    });
    expect(asignado.signer?.id).toBe(otro.id);
    expect(asignado.folderName).toBe("Operación");

    const vaciado = await saveDraft(fixture.context, fixture.draftId, {
      holderId: null,
      folderId: null,
    });
    expect(vaciado.holder).toBeNull();
    expect(vaciado.folderId).toBeNull();
    expect(vaciado.canIssue).toBe(false);
  });

  it("descarta silenciosamente una contraparte desactivada o ajena", async () => {
    const fixture = await borradorListo();
    const ajena = await createIssuableOrganization();
    const inactiva = await createCounterpartyRow(fixture.organization.id, {
      active: false,
    });
    const detalle = await saveDraft(fixture.context, fixture.draftId, {
      holderId: inactiva.id,
      signerId: ajena.signer.id,
    });
    expect(detalle.holder).toBeNull();
    expect(detalle.signer).toBeNull();
  });

  it("no deja editar el Borrador de otro Emisor", async () => {
    const fixture = await borradorListo({ roles: ["emitter"] });
    const { contexto } = await miembroNuevo(fixture.organization.id, ["emitter"]);
    await expect(
      saveDraft(contexto, fixture.draftId, { linkDays: 3 })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("un Administrador sin rol Emisor no edita Borradores", async () => {
    const fixture = await borradorListo({ roles: ["emitter"] });
    const { contexto } = await miembroNuevo(fixture.organization.id, [
      "administrator",
    ]);
    await expect(
      saveDraft(contexto, fixture.draftId, { linkDays: 3 })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("no edita un Borrador eliminado ni uno ya emitido", async () => {
    const eliminado = await borradorListo();
    await deleteDraft(eliminado.context, eliminado.draftId);
    await expect(
      saveDraft(eliminado.context, eliminado.draftId, { linkDays: 3 })
    ).rejects.toBeInstanceOf(ConflictError);

    const emitido = await borradorListo();
    await issueContract(emitido.context, emitido.draftId);
    await expect(
      saveDraft(emitido.context, emitido.draftId, { linkDays: 3 })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("no encuentra el Borrador de otra Organización", async () => {
    const fixture = await borradorListo();
    const ajena = await createIssuableOrganization();
    await expect(
      saveDraft(ajena.context, fixture.draftId, { linkDays: 3 })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

});

// ---------------------------------------------------------------------------
// deleteDraft
// ---------------------------------------------------------------------------

describe("deleteDraft", () => {
  it("sólo un Administrador elimina un Borrador", async () => {
    const fixture = await borradorListo({ roles: ["emitter"] });
    await expect(
      deleteDraft(fixture.context, fixture.draftId)
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect((await filaBorrador(fixture.draftId)).classification).toBe("active");
  });

  it("borra el contenido editable y conserva la metadata mínima", async () => {
    const fixture = await borradorListo({ capabilities: { evidence_ine: true } });
    const carpetaId = await crearCarpeta(fixture.organization.id, "Operación");
    await saveDraft(fixture.context, fixture.draftId, {
      folderId: carpetaId,
      requiresIne: true,
      linkDays: 4,
    });

    await deleteDraft(fixture.context, fixture.draftId);

    const fila = await filaBorrador(fixture.draftId);
    expect(fila.classification).toBe("deleted");
    expect(fila.deleted_at).toBeInstanceOf(Date);
    expect(fila.field_values).toEqual({});
    expect(fila.defaults_snapshot).toEqual({});
    expect(fila.holder_counterparty_id).toBeNull();
    expect(fila.signer_counterparty_id).toBeNull();
    expect(fila.folder_id).toBeNull();
    expect(fila.customized).toBe(false);
    expect(fila.issued_contract_id).toBeNull();

    const [eliminado] = await listDeletedDrafts(fixture.context);
    expect(eliminado.templateName).toBe(fixture.template.name);
    expect(eliminado.createdByName).toBe(fixture.account.fullName);
  });

  it("no crea Contrato ni paquete de custodia", async () => {
    const fixture = await borradorListo();
    await deleteDraft(fixture.context, fixture.draftId);
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("registra la eliminación en la auditoría", async () => {
    const fixture = await borradorListo();
    await deleteDraft(fixture.context, fixture.draftId);
    const [auditoria] = await sql<
      { subject_type: string; subject_id: string; capability: string | null }[]
    >`
      SELECT subject_type, subject_id, capability FROM audit_entries
      WHERE action = 'borrador_eliminado'
    `;
    expect(auditoria.subject_type).toBe("contract_draft");
    expect(auditoria.subject_id).toBe(fixture.draftId);
    expect(auditoria.capability).toBe("administrator+emitter");
  });

  it("no elimina dos veces el mismo Borrador", async () => {
    const fixture = await borradorListo();
    await deleteDraft(fixture.context, fixture.draftId);
    await expect(
      deleteDraft(fixture.context, fixture.draftId)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("no elimina un Borrador ya emitido", async () => {
    const fixture = await borradorListo();
    await issueContract(fixture.context, fixture.draftId);
    await expect(
      deleteDraft(fixture.context, fixture.draftId)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("no encuentra el Borrador de otra Organización", async () => {
    const fixture = await borradorListo();
    const ajena = await createIssuableOrganization();
    await expect(
      deleteDraft(ajena.context, fixture.draftId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// issueContract: falla cerrada
// ---------------------------------------------------------------------------

describe("issueContract falla cerrada y no escribe nada", () => {
  it("exige el rol Emisor", async () => {
    const fixture = await borradorListo({ roles: ["emitter"] });
    const { contexto } = await miembroNuevo(fixture.organization.id, [
      "administrator",
    ]);
    await expect(
      issueContract(contexto, fixture.draftId)
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("no emite el Borrador de otro Emisor", async () => {
    const fixture = await borradorListo({ roles: ["emitter"] });
    const { contexto } = await miembroNuevo(fixture.organization.id, ["emitter"]);
    await expect(
      issueContract(contexto, fixture.draftId)
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("no emite un Borrador de otra Organización ni uno inexistente", async () => {
    const fixture = await borradorListo();
    const ajena = await createIssuableOrganization();
    await expect(
      issueContract(ajena.context, fixture.draftId)
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      issueContract(fixture.context, "66666666-6666-4666-8666-666666666666")
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("no emite un Borrador en Eliminados", async () => {
    const fixture = await borradorListo();
    await deleteDraft(fixture.context, fixture.draftId);
    await expect(
      issueContract(fixture.context, fixture.draftId)
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("falta un dato obligatorio", async () => {
    const fixture = await borradorListo({ valores: { objeto: "Servicio" } });
    await expect(
      issueContract(fixture.context, fixture.draftId)
    ).rejects.toThrow("Faltan datos obligatorios: Monto.");
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
    expect((await filaBorrador(fixture.draftId)).issued_contract_id).toBeNull();
  });

  it("no hay Aviso de Privacidad vigente", async () => {
    const fixture = await borradorListo();
    await sql`
      UPDATE privacy_notice_versions SET full_markdown = ''
      WHERE organization_id = ${fixture.organization.id}
    `;
    await expect(
      issueContract(fixture.context, fixture.draftId)
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("no hay publicación vigente del Contrato-plantilla", async () => {
    const fixture = await borradorListo();
    await sql`
      UPDATE contract_template_versions SET is_current = FALSE
      WHERE template_id = ${fixture.template.id}
    `;
    await expect(
      issueContract(fixture.context, fixture.draftId)
    ).rejects.toThrow("El contrato-plantilla no tiene una publicación vigente.");
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("el Titular contractual elegido está desactivado", async () => {
    const fixture = await borradorListo();
    await sql`
      UPDATE counterparties SET active = FALSE WHERE id = ${fixture.holder.id}
    `;
    await expect(
      issueContract(fixture.context, fixture.draftId)
    ).rejects.toThrow(
      "El Titular contractual está desactivado en el Directorio: elige o crea uno activo."
    );
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("el Firmante elegido está desactivado", async () => {
    const fixture = await borradorListo();
    await sql`
      UPDATE counterparties SET active = FALSE WHERE id = ${fixture.signer.id}
    `;
    await expect(
      issueContract(fixture.context, fixture.draftId)
    ).rejects.toThrow(
      "El Firmante está desactivado en el Directorio: elige o crea uno activo."
    );
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("falta elegir el Titular contractual", async () => {
    const fixture = await borradorListo({ conTitular: false });
    await expect(
      issueContract(fixture.context, fixture.draftId)
    ).rejects.toThrow("Falta elegir el Titular contractual.");
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("falta elegir el Firmante", async () => {
    const fixture = await borradorListo({ conFirmante: false });
    await expect(
      issueContract(fixture.context, fixture.draftId)
    ).rejects.toThrow("Falta elegir el Firmante.");
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("la revisión AI elegida dejó de estar habilitada", async () => {
    const fixture = await borradorListo({ capabilities: { ai_review: true } });
    await saveDraft(fixture.context, fixture.draftId, { reviewPolicy: "ai" });
    await sql`
      UPDATE commercial_entitlements SET enabled = FALSE
      WHERE organization_id = ${fixture.organization.id}
        AND capability = 'ai_review'
    `;
    const contexto = await contextoRecargado(
      fixture.organization.id,
      fixture.account,
      ROLES_COMPLETOS
    );
    await expect(issueContract(contexto, fixture.draftId)).rejects.toThrow(
      "La revisión asistida por AI no está habilitada para esta Organización."
    );
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("un valor capturado dejó de ser compatible con su campo", async () => {
    const fixture = await borradorListo({ fields: CAMPOS_VARIADOS });
    await sql`
      UPDATE contract_field_definitions SET data_type = 'number'
      WHERE template_id = ${fixture.template.id} AND key = 'objeto'
    `;
    await expect(
      issueContract(fixture.context, fixture.draftId)
    ).rejects.toThrow("«Objeto» debe ser un número.");
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("el Borrador ya se emitió", async () => {
    const fixture = await borradorListo();
    await issueContract(fixture.context, fixture.draftId);
    const antes = await huellaDeEmision();
    await expect(
      issueContract(fixture.context, fixture.draftId)
    ).rejects.toThrow("Este Borrador ya se emitió como Contrato.");
    expect(await huellaDeEmision()).toEqual(antes);
    expect(antes.contratos).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// issueContract: emisión correcta
// ---------------------------------------------------------------------------

describe("issueContract emite el Contrato inmutable", () => {
  it("asigna la Referencia AC-YYYYMMDD-NNNN consecutiva por Organización", async () => {
    const fixture = await borradorListo();
    const primero = await issueContract(fixture.context, fixture.draftId);
    expect(primero.reference).toMatch(/^AC-\d{8}-0001$/);
    expect(primero.reference).toBe(formatReference(referenceDay(), 1));

    const segundoBorrador = await createDraft(fixture.context, {
      templateId: fixture.template.id,
      holderId: fixture.holder.id,
      signerId: fixture.signer.id,
      prefill: VALORES_COMPLETOS,
    });
    const segundo = await issueContract(fixture.context, segundoBorrador);
    expect(segundo.reference).toBe(formatReference(referenceDay(), 2));

    const ajena = await borradorListo();
    const otra = await issueContract(ajena.context, ajena.draftId);
    expect(otra.reference).toBe(formatReference(referenceDay(), 1));
  });

  it("deja el Contrato en `Pendiente de aceptación` y activo", async () => {
    const fixture = await borradorListo();
    const resultado = await issueContract(fixture.context, fixture.draftId);
    const contrato = await filaContrato(resultado.contractId);
    expect(contrato.status).toBe("pending");
    expect(contrato.classification).toBe("active");
    expect(contrato.created_by).toBe(fixture.account.id);
    expect(contrato.created_by_name).toBe(fixture.account.fullName);
    expect(contrato.origin_contract_id).toBeNull();
    expect(contrato.origin_reason).toBeNull();
  });

  it("congela el texto ya renderizado, sin marcadores pendientes", async () => {
    const fixture = await borradorListo();
    const resultado = await issueContract(fixture.context, fixture.draftId);
    const contrato = await filaContrato(resultado.contractId);

    expect(contrato.contract_markdown).not.toContain("{{");
    expect(contrato.contract_markdown).not.toContain("}}");
    expect(contrato.contract_markdown).toContain(
      fixture.context.organization.legalName
    );
    expect(contrato.contract_markdown).toContain(fixture.holder.name);
    expect(contrato.contract_markdown).toContain(fixture.signer.name);
    expect(contrato.contract_markdown).toContain("Objeto: Servicio de mantenimiento.");
    expect(contrato.contract_markdown).toContain(formatMoney("1500.50"));
    expect(contrato.contract_markdown).toContain(resultado.reference);
    expect(contrato.contract_markdown).toContain(longDate(contrato.issued_at));
    expect(contrato.acceptance_legend).toContain("Manifiesto mi aceptación");
  });

  it("congela la instantánea de las partes aunque el Directorio cambie después", async () => {
    const fixture = await borradorListo();
    const resultado = await issueContract(fixture.context, fixture.draftId);

    await sql`
      UPDATE counterparties
      SET name = 'Nombre corregido', rfc = 'XAXX010101000',
          email = 'nuevo@example.invalid', active = FALSE
      WHERE organization_id = ${fixture.organization.id}
    `;

    const partes = await sql<
      {
        party_role: string;
        source_counterparty_id: string;
        person_kind: string;
        name: string;
        rfc: string | null;
        email: string | null;
        snapshot: Record<string, string>;
      }[]
    >`
      SELECT party_role, source_counterparty_id, person_kind, name, rfc, email,
             snapshot
      FROM contract_parties WHERE contract_id = ${resultado.contractId}
      ORDER BY party_role
    `;
    expect(partes).toHaveLength(2);
    const titular = partes.find((parte) => parte.party_role === "holder");
    const firmante = partes.find((parte) => parte.party_role === "signer");
    expect(titular?.name).toBe(fixture.holder.name);
    expect(titular?.person_kind).toBe("moral");
    expect(titular?.source_counterparty_id).toBe(fixture.holder.id);
    expect(titular?.rfc).toBeNull();
    expect(titular?.snapshot).toMatchObject({
      nombre: fixture.holder.name,
      tipo: "persona moral",
    });
    expect(firmante?.name).toBe(fixture.signer.name);
    expect(firmante?.snapshot).toMatchObject({ tipo: "persona física" });

    const contrato = await filaContrato(resultado.contractId);
    expect(contrato.contract_markdown).toContain(fixture.holder.name);
    expect(contrato.contract_markdown).not.toContain("Nombre corregido");
  });

  it("registra la publicación exacta de plantilla y Aviso de Privacidad", async () => {
    const fixture = await borradorListo();
    const resultado = await issueContract(fixture.context, fixture.draftId);
    const contrato = await filaContrato(resultado.contractId);
    expect(contrato.template_version_id).toBe(fixture.template.versionId);
    expect(contrato.privacy_notice_version_id).toBe(fixture.noticeId);
    expect(contrato.template_name).toBe(fixture.template.name);
    expect(contrato.template_label).toBe("1.0");
  });

  it("calcula una Huella documental estable y reproducible", async () => {
    const fixture = await borradorListo();
    const resultado = await issueContract(fixture.context, fixture.draftId);
    const contrato = await filaContrato(resultado.contractId);

    const partes = await sql<
      {
        party_role: "holder" | "signer";
        person_kind: string;
        name: string;
        rfc: string | null;
        email: string | null;
        phone: string | null;
        address: string | null;
        position: string | null;
      }[]
    >`
      SELECT party_role, person_kind, name, rfc, email, phone, address, position
      FROM contract_parties WHERE contract_id = ${resultado.contractId}
      ORDER BY CASE party_role WHEN 'holder' THEN 0 ELSE 1 END
    `;

    const esperada = sha256Hex(
      canonicalizeJson({
        markdown: contrato.contract_markdown,
        values: VALORES_COMPLETOS,
        parties: partes.map((parte) => ({
          role: parte.party_role,
          personKind: parte.person_kind,
          name: parte.name,
          rfc: parte.rfc ?? "",
          email: parte.email ?? "",
          phone: parte.phone ?? "",
          address: parte.address ?? "",
          position: parte.position ?? "",
        })),
        configuration: {
          linkDays: 7,
          requiresVideo: false,
          requiresIne: false,
          reviewPolicy: "none",
        },
        reference: resultado.reference,
        templateVersionId: fixture.template.versionId,
        privacyNoticeVersionId: fixture.noticeId,
      })
    );
    expect(contrato.document_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(contrato.document_hash).toBe(esperada);

    await sql`
      UPDATE counterparties SET name = 'Otro nombre'
      WHERE id = ${fixture.holder.id}
    `;
    expect((await filaContrato(resultado.contractId)).document_hash).toBe(esperada);
  });

  it("indexa los valores buscables y nunca las cláusulas", async () => {
    const fixture = await borradorListo();
    const resultado = await issueContract(fixture.context, fixture.draftId);
    const contrato = await filaContrato(resultado.contractId);

    expect(contrato.search_text).toContain(resultado.reference);
    expect(contrato.search_text).toContain(fixture.template.name);
    expect(contrato.search_text).toContain(fixture.holder.name);
    expect(contrato.search_text).toContain(fixture.signer.name);
    expect(contrato.search_text).toContain(fixture.account.fullName);
    expect(contrato.search_text).toContain("Objeto Servicio de mantenimiento");

    expect(contrato.search_text).not.toContain("Celebrado por");
    expect(contrato.search_text).not.toContain("Monto");
    expect(contrato.search_text).not.toContain("1500.50");
    expect(contrato.search_text).not.toContain("Manifiesto mi aceptación");
  });

  it("indexa un campo buscable opcional aunque quede sin capturar", async () => {
    const fixture = await borradorListo({
      fields: [
        { key: "objeto", label: "Objeto", searchable: true },
        { key: "monto", label: "Monto", dataType: "money" },
        {
          key: "folio",
          label: "Folio interno",
          required: false,
          searchable: true,
        },
      ],
    });
    const resultado = await issueContract(fixture.context, fixture.draftId);
    const contrato = await filaContrato(resultado.contractId);
    expect(contrato.search_text).toContain("Objeto Servicio de mantenimiento");
    expect(contrato.search_text).toContain("Folio interno");
    expect(contrato.search_text).not.toMatch(/\s{2,}/);
  });

  it("crea el primer Intento con secuencia 1 y un único enlace opaco", async () => {
    const fixture = await borradorListo();
    await saveDraft(fixture.context, fixture.draftId, { linkDays: 3 });
    const resultado = await issueContract(fixture.context, fixture.draftId);

    const intentos = await sql<
      {
        id: string;
        sequence: number;
        status: string;
        replaces_attempt_id: string | null;
        organization_id: string;
      }[]
    >`
      SELECT id, sequence, status, replaces_attempt_id, organization_id
      FROM acceptance_attempts WHERE contract_id = ${resultado.contractId}
    `;
    expect(intentos).toHaveLength(1);
    expect(intentos[0].sequence).toBe(1);
    expect(intentos[0].status).toBe("open");
    expect(intentos[0].replaces_attempt_id).toBeNull();
    expect(intentos[0].organization_id).toBe(fixture.organization.id);

    const enlaces = await sql<
      {
        attempt_id: string;
        token: string;
        token_hash: string;
        expires_at: Date;
        created_at: Date;
        revoked_at: Date | null;
      }[]
    >`
      SELECT attempt_id, token, token_hash, expires_at, created_at, revoked_at
      FROM contract_links WHERE contract_id = ${resultado.contractId}
    `;
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0].attempt_id).toBe(intentos[0].id);
    expect(enlaces[0].token).toBe(resultado.token);
    expect(enlaces[0].token_hash).toBe(hashToken(resultado.token));
    expect(enlaces[0].revoked_at).toBeNull();
    expect(resultado.url).toBe(`http://localhost:3002/c/${resultado.token}`);

    const vigencia =
      enlaces[0].expires_at.getTime() - enlaces[0].created_at.getTime();
    expect(vigencia).toBeGreaterThan(3 * 86_400_000 - 7_200_000);
    expect(vigencia).toBeLessThan(3 * 86_400_000 + 7_200_000);
    expect((await filaContrato(resultado.contractId)).link_days).toBe(3);
  });

  it("congela la configuración efectiva, sus predeterminados y la personalización", async () => {
    const fixture = await borradorListo({
      capabilities: { evidence_ine: true, ai_review: true },
    });
    await saveDraft(fixture.context, fixture.draftId, {
      linkDays: 10,
      requiresIne: true,
      reviewPolicy: "ai",
    });
    const resultado = await issueContract(fixture.context, fixture.draftId);
    const contrato = await filaContrato(resultado.contractId);
    expect(contrato.link_days).toBe(10);
    expect(contrato.requires_ine).toBe(true);
    expect(contrato.requires_video).toBe(false);
    expect(contrato.review_policy).toBe("ai");
    expect(contrato.customized).toBe(true);
    expect(contrato.defaults_snapshot).toMatchObject({
      linkDays: 7,
      requiresIne: false,
      reviewPolicy: "none",
    });
    expect(contrato.field_values).toEqual(VALORES_COMPLETOS);
  });

  it("normaliza la moneda del monto al emitir aunque el Borrador tenga valor legacy", async () => {
    const fixture = await borradorListo({ fields: CAMPOS_VARIADOS });
    await sql`
      UPDATE contract_drafts
      SET field_values = ${sql.json({
        objeto: "Servicio",
        monto: "1500.50",
        monto_moneda: " usd ",
        piezas: "12",
        inicio: "2026-03-01",
        modalidad: "mensual",
      })}
      WHERE id = ${fixture.draftId}
    `;

    const resultado = await issueContract(fixture.context, fixture.draftId);
    const contrato = await filaContrato(resultado.contractId);

    expect(contrato.field_values.monto_moneda).toBe("USD");
  });

  it("guarda la Declaración audiovisual sólo cuando el perfil exige video", async () => {
    const sinVideo = await borradorListo();
    const primero = await issueContract(sinVideo.context, sinVideo.draftId);
    expect((await filaContrato(primero.contractId)).video_statement).toBe("");

    const conVideo = await borradorListo({
      capabilities: { evidence_video: true },
    });
    await saveDraft(conVideo.context, conVideo.draftId, { requiresVideo: true });
    const segundo = await issueContract(conVideo.context, conVideo.draftId);
    const contrato = await filaContrato(segundo.contractId);
    expect(contrato.requires_video).toBe(true);
    expect(contrato.video_statement).toBe(
      `Soy ${conVideo.signer.name} y acepto el contrato por $1,500.50.`
    );
  });

  it("conserva la Carpeta operativa y la Relación técnica de origen", async () => {
    const base = await borradorListo();
    const anterior = await issueContract(base.context, base.draftId);
    const carpetaId = await crearCarpeta(base.organization.id, "Correcciones");

    const draftId = await createDraft(base.context, {
      templateId: base.template.id,
      holderId: base.holder.id,
      signerId: base.signer.id,
      folderId: carpetaId,
      prefill: VALORES_COMPLETOS,
      originContractId: anterior.contractId,
      originReason: "duplicate",
    });
    const resultado = await issueContract(base.context, draftId);
    const contrato = await filaContrato(resultado.contractId);
    expect(contrato.origin_contract_id).toBe(anterior.contractId);
    expect(contrato.origin_reason).toBe("duplicate");
    const [{ folder_id: carpeta }] = await sql<{ folder_id: string | null }[]>`
      SELECT folder_id FROM contracts WHERE id = ${resultado.contractId}
    `;
    expect(carpeta).toBe(carpetaId);
  });

  it("registra el evento `contrato_emitido` y su entrada de auditoría", async () => {
    const fixture = await borradorListo();
    const resultado = await issueContract(fixture.context, fixture.draftId);

    const eventos = await sql<
      {
        type: string;
        actor_kind: string;
        actor_id: string;
        actor_name: string;
        attempt_id: string | null;
        sensitive: boolean;
        payload: Record<string, unknown>;
      }[]
    >`
      SELECT type, actor_kind, actor_id, actor_name, attempt_id, sensitive, payload
      FROM contract_events WHERE contract_id = ${resultado.contractId}
    `;
    expect(eventos).toHaveLength(1);
    expect(eventos[0].type).toBe("contrato_emitido");
    expect(eventos[0].actor_kind).toBe("member");
    expect(eventos[0].actor_id).toBe(fixture.account.id);
    expect(eventos[0].actor_name).toBe(fixture.account.fullName);
    expect(eventos[0].attempt_id).not.toBeNull();
    expect(eventos[0].sensitive).toBe(false);
    expect(eventos[0].payload).toMatchObject({
      reference: resultado.reference,
      templateName: fixture.template.name,
      templateLabel: "1.0",
      customized: false,
    });

    const auditorias = await sql<
      {
        subject_type: string;
        subject_id: string;
        capability: string | null;
        payload: Record<string, unknown>;
      }[]
    >`
      SELECT subject_type, subject_id, capability, payload FROM audit_entries
      WHERE action = 'contrato_emitido'
    `;
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0].subject_type).toBe("contract");
    expect(auditorias[0].subject_id).toBe(resultado.contractId);
    expect(auditorias[0].capability).toBe("administrator+emitter");
    expect(auditorias[0].payload).toMatchObject({
      reference: resultado.reference,
      draftId: fixture.draftId,
    });
  });

  it("marca el Borrador como emitido y no lo emite dos veces", async () => {
    const fixture = await borradorListo();
    const resultado = await issueContract(fixture.context, fixture.draftId);
    expect((await filaBorrador(fixture.draftId)).issued_contract_id).toBe(
      resultado.contractId
    );

    await expect(
      issueContract(fixture.context, fixture.draftId)
    ).rejects.toBeInstanceOf(ConflictError);

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::TEXT AS count FROM contracts
    `;
    expect(count).toBe("1");
    expect(await listDrafts(fixture.context)).toEqual([]);
  });

  it("emite atómicamente todo el expediente en una sola transacción", async () => {
    const fixture = await borradorListo();
    await issueContract(fixture.context, fixture.draftId);
    expect(await huellaDeEmision()).toEqual({
      ...NADA_EMITIDO,
      contratos: 1,
      partes: 2,
      intentos: 1,
      enlaces: 1,
      eventos: 1,
      secuencias: 1,
      auditoriasDeEmision: 1,
    });
  });
});

describe("issueContract bajo concurrencia", () => {
  it("dos `Generar enlace` simultáneos producen un solo Contrato", async () => {
    const fixture = await borradorListo();
    const resultados = await Promise.allSettled([
      issueContract(fixture.context, fixture.draftId),
      issueContract(fixture.context, fixture.draftId),
    ]);

    const exitosos = resultados.filter(
      (resultado) => resultado.status === "fulfilled"
    );
    const fallidos = resultados.filter(
      (resultado) => resultado.status === "rejected"
    );
    expect(exitosos).toHaveLength(1);
    expect(fallidos).toHaveLength(1);

    expect(await huellaDeEmision()).toEqual({
      ...NADA_EMITIDO,
      contratos: 1,
      partes: 2,
      intentos: 1,
      enlaces: 1,
      eventos: 1,
      secuencias: 1,
      auditoriasDeEmision: 1,
    });
  });

  it("dos Borradores simultáneos reciben Referencias distintas", async () => {
    const fixture = await borradorListo();
    const otroBorrador = await createDraft(fixture.context, {
      templateId: fixture.template.id,
      holderId: fixture.holder.id,
      signerId: fixture.signer.id,
      prefill: VALORES_COMPLETOS,
    });
    const [uno, dos] = await Promise.all([
      issueContract(fixture.context, fixture.draftId),
      issueContract(fixture.context, otroBorrador),
    ]);
    expect(new Set([uno.reference, dos.reference]).size).toBe(2);
    expect([uno.reference, dos.reference].sort()).toEqual([
      formatReference(referenceDay(), 1),
      formatReference(referenceDay(), 2),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Defecto detectado
// ---------------------------------------------------------------------------

describe("coherencia entre `canIssue` y `Generar enlace`", () => {
  /**
   * `compatibleValues` descarta el valor que ya no corresponde al tipo del
   * campo, así que el Borrador pide capturarlo en vez de anunciarse emitible
   * y fallar después en `Generar enlace`.
   */
  it("no anuncia canIssue con un valor precargado inválido", async () => {
    const fixture = await createIssuableOrganization();
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
      holderId: fixture.holder.id,
      signerId: fixture.signer.id,
      prefill: { objeto: "Servicio", monto: "mil quinientos" },
    });
    const detalle = await getDraft(fixture.context, draftId);
    expect(detalle.canIssue).toBe(false);
    expect(detalle.missingFields).toContain("monto");
    expect(detalle.fieldValues.monto).toBeUndefined();
    expect(await huellaDeEmision()).toEqual(NADA_EMITIDO);
  });

  it("conserva el valor precargado cuando sí corresponde al tipo", async () => {
    const fixture = await createIssuableOrganization();
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
      holderId: fixture.holder.id,
      signerId: fixture.signer.id,
      prefill: { objeto: "Servicio", monto: "1500.50" },
    });
    const detalle = await getDraft(fixture.context, draftId);
    expect(detalle.fieldValues.monto).toBe("1500.50");
    expect(detalle.canIssue).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// El Titular que acepta por sí mismo
// ---------------------------------------------------------------------------

describe("una persona física puede ser Titular y Firmante", () => {
  /**
   * Es el caso más común en la operación diaria y la captura lo ofrece como
   * atajo. Emitir con la misma contraparte en los dos papeles debe congelar
   * dos instantáneas de Parte independientes sobre el mismo registro.
   */
  it("emite con la misma contraparte en los dos papeles", async () => {
    const fixture = await createIssuableOrganization();
    const persona = await createCounterpartyRow(fixture.organization.id, {
      name: "Ramón Trujillo Vera",
      personKind: "fisica",
    });
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
      holderId: persona.id,
      signerId: persona.id,
      prefill: VALORES_COMPLETOS,
    });

    const detalle = await getDraft(fixture.context, draftId);
    expect(detalle.holder?.id).toBe(persona.id);
    expect(detalle.signer?.id).toBe(persona.id);
    expect(detalle.canIssue).toBe(true);

    const emitido = await issueContract(fixture.context, draftId);
    const partes = await sql<
      { party_role: string; source_counterparty_id: string; name: string }[]
    >`
      SELECT party_role, source_counterparty_id, name
      FROM contract_parties
      WHERE contract_id = ${emitido.contractId}
      ORDER BY party_role
    `;
    expect(partes).toEqual([
      { party_role: "holder", source_counterparty_id: persona.id, name: persona.name },
      { party_role: "signer", source_counterparty_id: persona.id, name: persona.name },
    ]);
  });

  it("nunca usa una persona moral como quien aceptará", async () => {
    const fixture = await createIssuableOrganization();
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
      holderId: fixture.holder.id,
      signerId: fixture.holder.id,
      prefill: VALORES_COMPLETOS,
    });

    const normalizado = await getDraft(fixture.context, draftId);
    expect(normalizado.signer).toBeNull();
    expect(normalizado.blockers).toContain("Falta elegir el Firmante.");

    // Defensa de última línea: incluso un dato legado o escrito fuera del
    // dominio debe bloquearse antes de formar el Contrato inmutable.
    await sql`
      UPDATE contract_drafts
      SET signer_counterparty_id = ${fixture.holder.id}
      WHERE id = ${draftId}
    `;
    const legado = await getDraft(fixture.context, draftId);
    expect(legado.blockers).toContain(
      "La persona que aceptará debe ser una persona física."
    );
    await expect(issueContract(fixture.context, draftId)).rejects.toThrow(
      "La persona que aceptará debe ser una persona física."
    );
  });
});

// ---------------------------------------------------------------------------
// Aislamiento entre Organizaciones
// ---------------------------------------------------------------------------

describe("aislamiento entre Organizaciones", () => {
  it("cada Organización sólo emite con su propio Contrato-plantilla y Aviso", async () => {
    const primera = await borradorListo();
    const segunda = await borradorListo();
    await createTemplate(segunda.organization.id, { name: "Otro contrato" });

    const uno = await issueContract(primera.context, primera.draftId);
    const dos = await issueContract(segunda.context, segunda.draftId);

    const contratoUno = await filaContrato(uno.contractId);
    const contratoDos = await filaContrato(dos.contractId);
    expect(contratoUno.template_version_id).toBe(primera.template.versionId);
    expect(contratoDos.template_version_id).toBe(segunda.template.versionId);
    expect(contratoUno.privacy_notice_version_id).toBe(primera.noticeId);
    expect(contratoDos.privacy_notice_version_id).toBe(segunda.noticeId);
    expect(contratoUno.document_hash).not.toBe(contratoDos.document_hash);
  });
});
