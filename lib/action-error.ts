import type { FormState } from "@/components/ui/form-state";
import { DomainError } from "@/lib/domain/errors";

/**
 * `redirect()` y `notFound()` señalan su efecto lanzando: Next necesita ese
 * error para navegar, así que nunca se convierte en un mensaje de pantalla.
 */
export function isNavigationSignal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    /^NEXT_(REDIRECT|NOT_FOUND)/.test((error as { digest: string }).digest)
  );
}

/**
 * Una Server Action nunca lanza al cliente: traduce el error de dominio a un
 * mensaje mostrable y oculta cualquier detalle técnico. La única excepción es
 * la señal de navegación, que debe seguir subiendo para que Next redirija.
 */
export function toFormError(
  error: unknown,
  fallback = "No pudimos completar la operación. Inténtalo de nuevo."
): FormState {
  if (isNavigationSignal(error)) throw error;
  if (error instanceof DomainError) return { ok: false, error: error.message };
  return { ok: false, error: fallback };
}
