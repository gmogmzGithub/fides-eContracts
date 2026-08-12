"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { EMPTY_FORM_STATE } from "@/components/ui/form-state";
import { confirmarAltaTotp, iniciarAltaTotp } from "./actions";

export function StartEnrollmentForm({ enrolled }: { enrolled: boolean }) {
  const [state, formAction] = useActionState(iniciarAltaTotp, EMPTY_FORM_STATE);

  return (
    <form action={formAction} className="grid gap-3">
      {enrolled ? (
        <Field
          label="Código actual"
          htmlFor="codigoActual"
          required
          hint="Confirmamos tu segundo factor vigente antes de sustituirlo."
        >
          <TextInput
            id="codigoActual"
            name="codigoActual"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            className="max-w-40 font-mono tracking-widest"
          />
        </Field>
      ) : null}

      <FormMessage state={state} />

      <div>
        <SubmitButton pendingLabel="Generando…">
          {enrolled ? "Volver a dar de alta" : "Generar clave y código QR"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function ConfirmEnrollmentForm() {
  const [state, formAction] = useActionState(
    confirmarAltaTotp,
    EMPTY_FORM_STATE
  );

  return (
    <form action={formAction} className="grid gap-3">
      <Field
        label="Código de seis dígitos"
        htmlFor="codigo"
        required
        hint="El alta termina hasta que la aplicación autenticadora produce un código válido."
      >
        <TextInput
          id="codigo"
          name="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          className="max-w-40 font-mono tracking-widest"
        />
      </Field>

      <FormMessage state={state} />

      <div>
        <SubmitButton pendingLabel="Verificando…">Confirmar alta</SubmitButton>
      </div>
    </form>
  );
}
