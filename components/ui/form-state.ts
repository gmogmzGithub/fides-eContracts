/** Resultado uniforme de toda Server Action. */
export interface FormState {
  ok: boolean;
  error?: string;
  message?: string;
}

/** Estado inicial neutro para `useActionState`. */
export const EMPTY_FORM_STATE: FormState = { ok: true };
