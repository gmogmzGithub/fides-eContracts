import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_EVIDENCE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  syntheticEvidenceEnabled,
} from "@/lib/evidence-limits";

const original = process.env.FIDES_ALLOW_SYNTHETIC_EVIDENCE;

afterEach(() => {
  if (original === undefined) delete process.env.FIDES_ALLOW_SYNTHETIC_EVIDENCE;
  else process.env.FIDES_ALLOW_SYNTHETIC_EVIDENCE = original;
});

describe("límites de evidencia", () => {
  it("mantiene la subida por debajo del límite de video del dominio", () => {
    expect(MAX_EVIDENCE_BYTES).toBeLessThan(MAX_VIDEO_BYTES);
    expect(MAX_IMAGE_BYTES).toBeLessThan(MAX_EVIDENCE_BYTES);
  });
});

describe("syntheticEvidenceEnabled", () => {
  it("sólo se habilita con el valor exacto del entorno local", () => {
    process.env.FIDES_ALLOW_SYNTHETIC_EVIDENCE = "true";
    expect(syntheticEvidenceEnabled()).toBe(true);
  });

  it("permanece apagado ante cualquier otro valor", () => {
    process.env.FIDES_ALLOW_SYNTHETIC_EVIDENCE = "false";
    expect(syntheticEvidenceEnabled()).toBe(false);
    process.env.FIDES_ALLOW_SYNTHETIC_EVIDENCE = "1";
    expect(syntheticEvidenceEnabled()).toBe(false);
    delete process.env.FIDES_ALLOW_SYNTHETIC_EVIDENCE;
    expect(syntheticEvidenceEnabled()).toBe(false);
  });
});
