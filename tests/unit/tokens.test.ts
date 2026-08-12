import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOpaqueToken, hashToken, sha256Hex } from "@/lib/crypto/tokens";

describe("createOpaqueToken", () => {
  it("devuelve 32 bytes en base64url por omisión", () => {
    const token = createOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("respeta el número de bytes solicitado", () => {
    expect(Buffer.from(createOpaqueToken(16), "base64url")).toHaveLength(16);
    expect(Buffer.from(createOpaqueToken(64), "base64url")).toHaveLength(64);
  });

  it("no incluye relleno ni caracteres fuera de base64url", () => {
    const token = createOpaqueToken(30);
    expect(token).not.toContain("=");
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
  });

  it("genera valores distintos en cada llamada", () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () => createOpaqueToken())
    );
    expect(tokens.size).toBe(200);
  });

  it("devuelve una cadena vacía si se piden cero bytes", () => {
    expect(createOpaqueToken(0)).toBe("");
  });
});

describe("hashToken", () => {
  it("calcula el SHA-256 hexadecimal del token", () => {
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("es estable para el mismo token", () => {
    const token = createOpaqueToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("nunca revela el token original", () => {
    const token = createOpaqueToken();
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("cambia ante cualquier variación del token", () => {
    expect(hashToken("token")).not.toBe(hashToken("tokeN"));
  });
});

describe("sha256Hex", () => {
  it("acepta texto y coincide con hashToken", () => {
    expect(sha256Hex("abc")).toBe(hashToken("abc"));
  });

  it("acepta un búfer", () => {
    expect(sha256Hex(Buffer.from("abc", "utf8"))).toBe(sha256Hex("abc"));
  });

  it("coincide con el SHA-256 de la biblioteca estándar", () => {
    const valor = "evidencia|contrato";
    expect(sha256Hex(valor)).toBe(
      crypto.createHash("sha256").update(valor).digest("hex")
    );
  });

  it("calcula el hash del valor vacío", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});
