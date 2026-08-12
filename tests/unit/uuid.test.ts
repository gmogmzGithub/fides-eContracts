import { describe, expect, it } from "vitest";
import { asUuid, isUuid } from "@/lib/uuid";

describe("isUuid", () => {
  it("acepta un identificador con el formato canónico", () => {
    expect(isUuid("7f3c1a2b-9d4e-4f10-8a55-6b2c9d0e1f34")).toBe(true);
    expect(isUuid("7F3C1A2B-9D4E-4F10-8A55-6B2C9D0E1F34")).toBe(true);
  });

  it("rechaza cualquier cosa que PostgreSQL no aceptaría como uuid", () => {
    expect(isUuid("abc")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("7f3c1a2b9d4e4f108a556b2c9d0e1f34")).toBe(false);
    expect(isUuid("7f3c1a2b-9d4e-4f10-8a55-6b2c9d0e1f3")).toBe(false);
    expect(isUuid("7f3c1a2b-9d4e-4f10-8a55-6b2c9d0e1f34x")).toBe(false);
    expect(isUuid("zzzzzzzz-9d4e-4f10-8a55-6b2c9d0e1f34")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("asUuid", () => {
  it("deja pasar el identificador válido", () => {
    const value = "7f3c1a2b-9d4e-4f10-8a55-6b2c9d0e1f34";
    expect(asUuid(value)).toBe(value);
  });

  it("descarta el valor inservible en vez de llevarlo a la consulta", () => {
    expect(asUuid("abc")).toBeUndefined();
    expect(asUuid("")).toBeUndefined();
    expect(asUuid(undefined)).toBeUndefined();
    expect(asUuid(null)).toBeUndefined();
  });
});
