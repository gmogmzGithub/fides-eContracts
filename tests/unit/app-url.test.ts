import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appUrl, signerUrl } from "@/lib/app-url";

const ORIGINAL = process.env.FIDES_APP_URL;

beforeEach(() => {
  delete process.env.FIDES_APP_URL;
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.FIDES_APP_URL;
  } else {
    process.env.FIDES_APP_URL = ORIGINAL;
  }
});

describe("appUrl", () => {
  it("usa el puerto local 3002 cuando no hay variable de entorno", () => {
    expect(appUrl()).toBe("http://localhost:3002");
  });

  it("usa el puerto local 3002 cuando la variable está vacía", () => {
    process.env.FIDES_APP_URL = "";
    expect(appUrl()).toBe("http://localhost:3002");
  });

  it("ignora una variable con sólo espacios", () => {
    process.env.FIDES_APP_URL = "   ";
    expect(appUrl()).toBe("http://localhost:3002");
  });

  it("sólo quita la última diagonal cuando hay dos", () => {
    process.env.FIDES_APP_URL = "https://ejemplo.mx//";
    expect(appUrl()).toBe("https://ejemplo.mx/");
  });

  it("usa la variable de entorno cuando está definida", () => {
    process.env.FIDES_APP_URL = "https://fides.ejemplo.mx";
    expect(appUrl()).toBe("https://fides.ejemplo.mx");
  });

  it("elimina una sola diagonal final", () => {
    process.env.FIDES_APP_URL = "https://fides.ejemplo.mx/";
    expect(appUrl()).toBe("https://fides.ejemplo.mx");
  });

  it("conserva la ruta base y sólo quita la diagonal del extremo", () => {
    process.env.FIDES_APP_URL = "https://ejemplo.mx/app/";
    expect(appUrl()).toBe("https://ejemplo.mx/app");
  });

  it("lee la variable en cada llamada y no la memoriza", () => {
    process.env.FIDES_APP_URL = "https://uno.mx";
    expect(appUrl()).toBe("https://uno.mx");
    process.env.FIDES_APP_URL = "https://dos.mx";
    expect(appUrl()).toBe("https://dos.mx");
  });
});

describe("signerUrl", () => {
  it("arma el enlace del firmante sobre la base local", () => {
    expect(signerUrl("tok3n")).toBe("http://localhost:3002/c/tok3n");
  });

  it("arma el enlace del firmante sobre la base configurada", () => {
    process.env.FIDES_APP_URL = "https://fides.ejemplo.mx/";
    expect(signerUrl("tok3n")).toBe("https://fides.ejemplo.mx/c/tok3n");
  });

  it("no duplica diagonales cuando la base termina en diagonal", () => {
    process.env.FIDES_APP_URL = "https://ejemplo.mx/";
    expect(signerUrl("abc")).not.toContain("//c/");
  });

  it("inserta el token tal cual, sin escaparlo", () => {
    process.env.FIDES_APP_URL = "https://ejemplo.mx";
    expect(signerUrl("a-b_c")).toBe("https://ejemplo.mx/c/a-b_c");
  });
});
