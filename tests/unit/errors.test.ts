import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  ConflictError,
  DomainError,
  NotFoundError,
} from "@/lib/domain/errors";

describe("DomainError", () => {
  it("conserva el mensaje mostrable y usa el código por omisión", () => {
    const error = new DomainError("El contrato ya venció.");
    expect(error.message).toBe("El contrato ya venció.");
    expect(error.code).toBe("domain_error");
    expect(error.name).toBe("DomainError");
  });

  it("acepta un código específico", () => {
    expect(new DomainError("Sin cupo.", "sin_cupo").code).toBe("sin_cupo");
  });

  it("es un Error de JavaScript con traza", () => {
    const error = new DomainError("x");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(typeof error.stack).toBe("string");
  });

  it("puede lanzarse y capturarse por tipo", () => {
    expect(() => {
      throw new DomainError("falla de dominio");
    }).toThrow(DomainError);
    expect(() => {
      throw new DomainError("falla de dominio");
    }).toThrow("falla de dominio");
  });

  it("no es una instancia de sus subclases", () => {
    const error = new DomainError("x");
    expect(error).not.toBeInstanceOf(AuthorizationError);
    expect(error).not.toBeInstanceOf(NotFoundError);
    expect(error).not.toBeInstanceOf(ConflictError);
  });
});

describe("AuthorizationError", () => {
  it("usa el mensaje y el código de acceso denegado por omisión", () => {
    const error = new AuthorizationError();
    expect(error.message).toBe("No tienes acceso a esta operación.");
    expect(error.code).toBe("forbidden");
    expect(error.name).toBe("AuthorizationError");
  });

  it("permite un mensaje propio conservando el código", () => {
    const error = new AuthorizationError("Sólo el Administrador puede hacerlo.");
    expect(error.message).toBe("Sólo el Administrador puede hacerlo.");
    expect(error.code).toBe("forbidden");
  });

  it("hereda de DomainError y de Error", () => {
    const error = new AuthorizationError();
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe("NotFoundError", () => {
  it("usa el mensaje y el código de registro inexistente por omisión", () => {
    const error = new NotFoundError();
    expect(error.message).toBe("No encontramos el registro solicitado.");
    expect(error.code).toBe("not_found");
    expect(error.name).toBe("NotFoundError");
  });

  it("permite un mensaje propio conservando el código", () => {
    const error = new NotFoundError("No encontramos el Contrato.");
    expect(error.message).toBe("No encontramos el Contrato.");
    expect(error.code).toBe("not_found");
  });

  it("hereda de DomainError", () => {
    expect(new NotFoundError()).toBeInstanceOf(DomainError);
  });
});

describe("ConflictError", () => {
  it("exige un mensaje y fija el código de conflicto", () => {
    const error = new ConflictError("El enlace ya fue usado.");
    expect(error.message).toBe("El enlace ya fue usado.");
    expect(error.code).toBe("conflict");
    expect(error.name).toBe("ConflictError");
  });

  it("hereda de DomainError", () => {
    expect(new ConflictError("x")).toBeInstanceOf(DomainError);
  });
});

describe("distinción entre errores de dominio", () => {
  it("cada subclase se distingue de las demás al capturarla", () => {
    expect(new AuthorizationError()).not.toBeInstanceOf(NotFoundError);
    expect(new NotFoundError()).not.toBeInstanceOf(ConflictError);
    expect(new ConflictError("x")).not.toBeInstanceOf(AuthorizationError);
  });

  it("expone códigos estables para la capa de presentación", () => {
    const codigos = [
      new DomainError("x").code,
      new AuthorizationError().code,
      new NotFoundError().code,
      new ConflictError("x").code,
    ];
    expect(codigos).toEqual([
      "domain_error",
      "forbidden",
      "not_found",
      "conflict",
    ]);
  });

  it("todas las subclases son capturables como DomainError", () => {
    const errores: DomainError[] = [
      new AuthorizationError(),
      new NotFoundError(),
      new ConflictError("x"),
    ];
    for (const error of errores) {
      expect(error).toBeInstanceOf(DomainError);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});
