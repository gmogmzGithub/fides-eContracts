"use client";

import { useActionState } from "react";
import { verificarTotp } from "@/app/acceso/actions";
import { SubmitButton } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { EMPTY_FORM_STATE } from "@/components/ui/form-state";

export function TotpForm() {
  const [state, formAction] = useActionState(verificarTotp, EMPTY_FORM_STATE);

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <FormMessage state={state} />

      <Field
        label="Código de seis dígitos"
        htmlFor="codigo"
        hint="Lo genera tu aplicación autenticadora y cambia cada 30 segundos."
        required
      >
        <TextInput
          id="codigo"
          name="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoFocus
          className="text-center font-display text-2xl tracking-[0.5em]"
          placeholder="000000"
        />
      </Field>

      <SubmitButton pendingLabel="Verificando…" className="w-full">
        Continuar
      </SubmitButton>
    </form>
  );
}
