import { describe, expect, it } from "vitest";
import {
  CAPABILITY_LABELS,
  CONTRACT_STATUS_LABELS,
  EVIDENCE_LABELS,
  PAGE_SIZE,
  REPEAT_REASON_LABELS,
  REVIEW_POLICY_LABELS,
  ROLE_LABELS,
  additionalEvidence,
  evidenceSummary,
} from "@/lib/domain/types";
import type {
  AttemptStatus,
  Capability,
  Classification,
  ContractStatus,
  EffectiveConfiguration,
  EvidenceKind,
  OrganizationRole,
  RepeatReasonCode,
  ReviewDecisionKind,
  ReviewPolicy,
} from "@/lib/domain/types";

/**
 * Comprueba que el mapa de etiquetas cubre exactamente las claves esperadas.
 * El tipo `Record<K, string>` obliga al mapa a tener toda la unión, así que
 * cualquier miembro nuevo aparece aquí como clave sobrante.
 */
function esperarClavesExactas<K extends string>(
  labels: Record<K, string>,
  keys: readonly K[]
): void {
  expect(Object.keys(labels).sort()).toEqual([...keys].sort());
}

describe("ROLE_LABELS", () => {
  const roles: readonly OrganizationRole[] = [
    "administrator",
    "emitter",
    "reviewer",
  ];

  it("cubre los tres roles del dominio", () => {
    esperarClavesExactas(ROLE_LABELS, roles);
  });

  it("usa el vocabulario de producto en español", () => {
    expect(ROLE_LABELS).toEqual({
      administrator: "Administrador",
      emitter: "Emisor",
      reviewer: "Revisor",
    });
  });
});

describe("CONTRACT_STATUS_LABELS", () => {
  const estados: readonly ContractStatus[] = [
    "pending",
    "in_review",
    "accepted",
    "expired",
    "cancelled",
  ];

  it("cubre los cinco estados visibles del Contrato emitido", () => {
    esperarClavesExactas(CONTRACT_STATUS_LABELS, estados);
  });

  it("usa el vocabulario de producto en español", () => {
    expect(CONTRACT_STATUS_LABELS).toEqual({
      pending: "Pendiente de aceptación",
      in_review: "A revisión",
      accepted: "Aceptado",
      expired: "Vencido",
      cancelled: "Cancelado",
    });
  });

  it("no incluye un estado Rechazado ni el Borrador", () => {
    expect(Object.keys(CONTRACT_STATUS_LABELS)).not.toContain("rejected");
    expect(Object.keys(CONTRACT_STATUS_LABELS)).not.toContain("draft");
  });

  it("no confunde los estados con las clasificaciones operativas", () => {
    const clasificaciones: readonly Classification[] = [
      "active",
      "archived",
      "deleted",
    ];
    for (const clasificacion of clasificaciones) {
      expect(Object.keys(CONTRACT_STATUS_LABELS)).not.toContain(clasificacion);
    }
  });
});

describe("REVIEW_POLICY_LABELS", () => {
  const politicas: readonly ReviewPolicy[] = ["none", "manual", "ai"];

  it("cubre las tres políticas de revisión", () => {
    esperarClavesExactas(REVIEW_POLICY_LABELS, politicas);
  });

  it("usa el vocabulario de producto en español", () => {
    expect(REVIEW_POLICY_LABELS).toEqual({
      none: "Sin revisión",
      manual: "Revisión manual",
      ai: "Revisión por AI",
    });
  });
});

describe("REPEAT_REASON_LABELS", () => {
  const motivos: readonly RepeatReasonCode[] = [
    "video_incompleto",
    "declaracion_incorrecta",
    "ine_ilegible",
    "ine_incompleta",
    "evidencia_faltante",
    "otro",
  ];

  it("cubre los seis motivos de repetición", () => {
    esperarClavesExactas(REPEAT_REASON_LABELS, motivos);
  });

  it("usa el vocabulario de producto en español", () => {
    expect(REPEAT_REASON_LABELS).toEqual({
      video_incompleto: "Video incompleto o sin audio",
      declaracion_incorrecta: "Declaración incorrecta",
      ine_ilegible: "INE ilegible",
      ine_incompleta: "INE incompleta o equivocada",
      evidencia_faltante: "Evidencia requerida faltante",
      otro: "Otro",
    });
  });
});

describe("EVIDENCE_LABELS", () => {
  const evidencias: readonly EvidenceKind[] = [
    "acceptance",
    "ine_front",
    "ine_back",
    "video",
  ];

  it("cubre los cuatro tipos de evidencia", () => {
    esperarClavesExactas(EVIDENCE_LABELS, evidencias);
  });

  it("usa el vocabulario de producto en español", () => {
    expect(EVIDENCE_LABELS).toEqual({
      acceptance: "Aceptación electrónica",
      ine_front: "INE (frente)",
      ine_back: "INE (reverso)",
      video: "Video guiado",
    });
  });
});

describe("CAPABILITY_LABELS", () => {
  const capacidades: readonly Capability[] = [
    "ai_review",
    "active_custody",
    "evidence_video",
    "evidence_ine",
  ];

  it("cubre las cuatro capacidades contratables", () => {
    esperarClavesExactas(CAPABILITY_LABELS, capacidades);
  });

  it("usa el vocabulario de producto en español", () => {
    expect(CAPABILITY_LABELS).toEqual({
      ai_review: "Revisión por AI",
      active_custody: "Custodia activa",
      evidence_video: "Evidencia de video",
      evidence_ine: "Evidencia de INE",
    });
  });
});

describe("etiquetas en general", () => {
  it("ningún mapa tiene etiquetas vacías", () => {
    const mapas: Record<string, string>[] = [
      ROLE_LABELS,
      CONTRACT_STATUS_LABELS,
      REVIEW_POLICY_LABELS,
      REPEAT_REASON_LABELS,
      EVIDENCE_LABELS,
      CAPABILITY_LABELS,
    ];
    for (const mapa of mapas) {
      for (const etiqueta of Object.values(mapa)) {
        expect(etiqueta.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("no promete validez legal ni equivalencia con la firma avanzada", () => {
    const todas = [
      ...Object.values(ROLE_LABELS),
      ...Object.values(CONTRACT_STATUS_LABELS),
      ...Object.values(REVIEW_POLICY_LABELS),
      ...Object.values(REPEAT_REASON_LABELS),
      ...Object.values(EVIDENCE_LABELS),
      ...Object.values(CAPABILITY_LABELS),
    ].join(" ");
    expect(todas).not.toMatch(/NOM-151|no repudi|inmutab|válido legalmente/iu);
  });
});

describe("uniones sin mapa de etiquetas", () => {
  it("los estados del intento agregan repetido a los del Contrato", () => {
    const intentos: readonly AttemptStatus[] = [
      "open",
      "in_review",
      "accepted",
      "repeated",
      "expired",
      "cancelled",
    ];
    expect(new Set(intentos).size).toBe(6);
    expect(intentos).toContain("repeated");
  });

  it("la decisión de revisión concluye, omite o repite", () => {
    const decisiones: readonly ReviewDecisionKind[] = [
      "conclude",
      "skip",
      "repeat",
    ];
    expect(new Set(decisiones).size).toBe(3);
  });
});

describe("EffectiveConfiguration", () => {
  it("describe los días del enlace, las evidencias y la política de revisión", () => {
    const configuracion: EffectiveConfiguration = {
      linkDays: 7,
      requiresVideo: false,
      requiresIne: true,
      reviewPolicy: "manual",
    };
    expect(Object.keys(configuracion).sort()).toEqual([
      "linkDays",
      "requiresIne",
      "requiresVideo",
      "reviewPolicy",
    ]);
    expect(REVIEW_POLICY_LABELS[configuracion.reviewPolicy]).toBe(
      "Revisión manual"
    );
  });
});

describe("PAGE_SIZE", () => {
  it("pagina de veinte en veinte", () => {
    expect(PAGE_SIZE).toBe(20);
  });
});

describe("resumen del Perfil de evidencia", () => {
  it("siempre incluye aceptación y agrega sólo las evidencias habilitadas", () => {
    expect(additionalEvidence({ requiresIne: false, requiresVideo: false })).toEqual(
      []
    );
    expect(additionalEvidence({ requiresIne: true, requiresVideo: false })).toEqual([
      "INE",
    ]);
    expect(additionalEvidence({ requiresIne: false, requiresVideo: true })).toEqual([
      EVIDENCE_LABELS.video,
    ]);
    expect(
      evidenceSummary({ requiresIne: true, requiresVideo: true })
    ).toEqual([EVIDENCE_LABELS.acceptance, "INE", EVIDENCE_LABELS.video]);
  });
});
