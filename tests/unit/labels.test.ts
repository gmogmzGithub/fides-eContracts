import { describe, expect, it } from "vitest";
import {
  actorLabel,
  ATTEMPT_STATUS_LABELS,
  AI_RECOMMENDATION_LABELS,
  DECISION_LABELS,
  eventLabel,
} from "@/lib/domain/labels";
import {
  CONTRACT_STATUS_LABELS,
  REPEAT_REASON_LABELS,
  type AttemptStatus,
  type ReviewDecisionKind,
} from "@/lib/domain/types";

describe("etiquetas compartidas", () => {
  it("nombra los seis estados del Intento de aceptación", () => {
    const estados: AttemptStatus[] = [
      "open",
      "in_review",
      "accepted",
      "repeated",
      "expired",
      "cancelled",
    ];
    for (const estado of estados) {
      expect(ATTEMPT_STATUS_LABELS[estado]).toBeTruthy();
    }
    expect(Object.keys(ATTEMPT_STATUS_LABELS)).toHaveLength(estados.length);
  });

  it("nombra exactamente las tres decisiones del Revisor", () => {
    const decisiones: ReviewDecisionKind[] = ["conclude", "skip", "repeat"];
    expect(Object.keys(DECISION_LABELS).sort()).toEqual([...decisiones].sort());
    expect(DECISION_LABELS.skip).toContain("SKIP");
  });

  it("presenta la recomendación del agente como recomendación", () => {
    for (const etiqueta of Object.values(AI_RECOMMENDATION_LABELS)) {
      expect(etiqueta.toLowerCase()).toMatch(/recomienda|sin recomendación/);
    }
  });

  it("nunca habla de firma ni de rechazo", () => {
    const todas = [
      ...Object.values(ATTEMPT_STATUS_LABELS),
      ...Object.values(DECISION_LABELS),
      ...Object.values(AI_RECOMMENDATION_LABELS),
      ...Object.values(CONTRACT_STATUS_LABELS),
      ...Object.values(REPEAT_REASON_LABELS),
    ].join(" ");
    expect(todas).not.toMatch(/\bfirmad|\bfirmar\b|rechazad/i);
  });
});

describe("eventLabel", () => {
  it("traduce los eventos conocidos del expediente", () => {
    expect(eventLabel("contrato_emitido")).toBe("Contrato emitido");
    expect(eventLabel("contrato_recorrido")).toBe("Contrato recorrido");
    expect(eventLabel("revision_omitida")).toBe("Revisión omitida (SKIP)");
  });

  it("presenta legible un evento que todavía no tiene etiqueta", () => {
    expect(eventLabel("algo_nuevo_ocurrio")).toBe("Algo nuevo ocurrio");
    expect(eventLabel("")).toBe("");
  });
});

describe("actorLabel", () => {
  it("prefiere el nombre conservado del actor", () => {
    expect(actorLabel("member", "Ana Ruiz")).toBe("Ana Ruiz");
    expect(actorLabel("signer", "Luis Mora")).toBe("Luis Mora");
  });

  it("describe al actor sin nombre según su tipo", () => {
    expect(actorLabel("signer", "")).toBe("Firmante");
    expect(actorLabel("platform", "")).toBe("Plataforma");
    expect(actorLabel("system", "")).toBe("Sistema");
    expect(actorLabel("member", "")).toBe("Miembro");
    expect(actorLabel("desconocido", "")).toBe("Miembro");
  });
});
