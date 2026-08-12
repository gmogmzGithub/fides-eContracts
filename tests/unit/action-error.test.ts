import { describe, expect, it } from "vitest";
import { isNavigationSignal, toFormError } from "@/lib/action-error";
import { ConflictError } from "@/lib/domain/errors";

describe("errores de Server Actions", () => {
  it("reconoce únicamente las señales de navegación de Next", () => {
    expect(isNavigationSignal(null)).toBe(false);
    expect(isNavigationSignal("NEXT_REDIRECT")).toBe(false);
    expect(isNavigationSignal({})).toBe(false);
    expect(isNavigationSignal({ digest: 7 })).toBe(false);
    expect(isNavigationSignal({ digest: "OTRA_SEÑAL" })).toBe(false);
    expect(isNavigationSignal({ digest: "NEXT_REDIRECT;replace;/app;307;" })).toBe(
      true
    );
    expect(isNavigationSignal({ digest: "NEXT_NOT_FOUND" })).toBe(true);
  });

  it("deja subir la navegación y convierte errores de dominio", () => {
    const navigation = { digest: "NEXT_REDIRECT;push;/app;307;" };
    let thrown: unknown;
    try {
      toFormError(navigation);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(navigation);
    expect(toFormError(new ConflictError("Dato inválido"))).toEqual({
      ok: false,
      error: "Dato inválido",
    });
  });

  it("oculta errores técnicos con el mensaje predeterminado o solicitado", () => {
    expect(toFormError(new Error("secreto técnico"))).toEqual({
      ok: false,
      error: "No pudimos completar la operación. Inténtalo de nuevo.",
    });
    expect(toFormError(42, "Vuelve a intentarlo.")).toEqual({
      ok: false,
      error: "Vuelve a intentarlo.",
    });
  });
});
