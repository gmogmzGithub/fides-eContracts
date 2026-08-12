"use client";

import { useActionState } from "react";
import { solicitarRecuperacion } from "@/app/acceso/actions";
import { SubmitButton } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { EMPTY_FORM_STATE } from "@/components/ui/form-state";

export function RecuperarForm() {
  const [state, formAction] = useActionState(
    solicitarRecuperacion,
    EMPTY_FORM_STATE
  );

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <FormMessage state={state} />

      <Field label="Correo" htmlFor="correo" required>
        <TextInput
          id="correo"
          name="correo"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          placeholder="nombre@organizacion.com"
        />
      </Field>

      <SubmitButton pendingLabel="Enviando…" className="w-full">
        Enviar enlace
      </SubmitButton>
    </form>
  );
}
