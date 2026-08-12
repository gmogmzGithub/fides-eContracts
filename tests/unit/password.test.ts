import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/crypto/password";

describe("hashPassword", () => {
  it("usa el formato scrypt$costo$sal$derivado", () => {
    const stored = hashPassword("Contraseña#1");
    const [scheme, cost, salt, digest] = stored.split("$");
    expect(scheme).toBe("scrypt");
    expect(cost).toBe("16384");
    expect(salt).toMatch(/^[0-9a-f]{32}$/u);
    expect(digest).toMatch(/^[0-9a-f]{128}$/u);
  });

  it("genera una sal distinta en cada llamada", () => {
    expect(hashPassword("Contraseña#1")).not.toBe(hashPassword("Contraseña#1"));
  });

  it("no guarda la contraseña en claro", () => {
    expect(hashPassword("Contraseña#1")).not.toContain("Contraseña#1");
  });

  it("acepta la contraseña vacía", () => {
    expect(hashPassword("")).toMatch(/^scrypt\$16384\$[0-9a-f]{32}\$[0-9a-f]{128}$/u);
  });
});

describe("verifyPassword", () => {
  it("acepta la contraseña correcta", () => {
    const stored = hashPassword("Contraseña#1");
    expect(verifyPassword("Contraseña#1", stored)).toBe(true);
  });

  it("rechaza una contraseña distinta", () => {
    const stored = hashPassword("Contraseña#1");
    expect(verifyPassword("otra", stored)).toBe(false);
    expect(verifyPassword("contraseña#1", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("acepta la contraseña vacía guardada", () => {
    expect(verifyPassword("", hashPassword(""))).toBe(true);
  });

  it("normaliza a NFKC antes de derivar la clave", () => {
    const stored = hashPassword("Contraseña#1".normalize("NFC"));
    expect(verifyPassword("Contraseña#1".normalize("NFD"), stored)).toBe(true);
  });

  it("no acepta un hash de otra contraseña con la misma sal", () => {
    const stored = hashPassword("Contraseña#1");
    const [, cost, salt] = stored.split("$");
    const otro = hashPassword("Contraseña#2");
    const suplantado = `scrypt$${cost}$${salt}$${otro.split("$")[3]}`;
    expect(verifyPassword("Contraseña#2", suplantado)).toBe(false);
  });
});

describe("verifyPassword con valores almacenados inválidos", () => {
  it("rechaza un esquema distinto de scrypt", () => {
    expect(verifyPassword("x", "bcrypt$16384$sal$digesto")).toBe(false);
  });

  it("rechaza una cadena vacía o sin separadores", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "scrypt")).toBe(false);
  });

  it("rechaza cuando falta el costo, la sal o el derivado", () => {
    expect(verifyPassword("x", "scrypt$$sal$digesto")).toBe(false);
    expect(verifyPassword("x", "scrypt$16384$$digesto")).toBe(false);
    expect(verifyPassword("x", "scrypt$16384$sal$")).toBe(false);
  });

  it("rechaza cuando el derivado no mide 64 bytes", () => {
    const stored = hashPassword("Contraseña#1");
    const [, cost, salt] = stored.split("$");
    expect(verifyPassword("Contraseña#1", `scrypt$${cost}$${salt}$aabb`)).toBe(
      false
    );
  });

  it("propaga el error de scrypt cuando el costo no es un número", () => {
    const stored = `scrypt$abc$sal$${"aa".repeat(64)}`;
    expect(() => verifyPassword("x", stored)).toThrow(RangeError);
  });
});
