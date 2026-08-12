import { EMPTY_FORM_STATE, type FormState } from "@/components/ui/form-state";
import { toFormError } from "@/lib/action-error";

/** Resultado uniforme de toda Server Action del portal. */
export interface ActionState extends FormState {
  /** Enlace recién generado; sólo se usa donde la pantalla debe copiarlo. */
  url?: string;
  reference?: string;
  contractId?: string;
  suggestedMessage?: string;
}

export const IDLE_STATE: ActionState = EMPTY_FORM_STATE;

/** Traducción de error a resultado de portal; ver `toFormError`. */
export function actionError(error: unknown, fallback?: string): ActionState {
  return toFormError(error, fallback);
}

export function textField(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function optionalField(data: FormData, name: string): string | null {
  const value = textField(data, name);
  return value === "" ? null : value;
}

export function boolField(data: FormData, name: string): boolean {
  const value = data.get(name);
  return value === "on" || value === "true" || value === "1";
}

export function intField(data: FormData, name: string, fallback: number): number {
  const parsed = Number.parseInt(textField(data, name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
