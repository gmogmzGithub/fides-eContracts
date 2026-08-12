"use client";

import { useActionState } from "react";
import { establecerContrasena } from "@/app/acceso/actions";
import { SubmitButton } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { EMPTY_FORM_STATE } from "@/components/ui/form-state";

export function NuevaContrasenaForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(
    establecerContrasena,
    EMPTY_FORM_STATE
  );

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} />

      <Field
        label="Contraseña nueva"
        htmlFor="contrasena"
        hint="Mínimo ocho caracteres."
        required
      >
        <TextInput
          id="contrasena"
          name="contrasena"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>

      <Field label="Confirma la contraseña" htmlFor="confirmacion" required>
        <TextInput
          id="confirmacion"
          name="confirmacion"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>

      <SubmitButton pendingLabel="Guardando…" className="w-full">
        Guardar contraseña
      </SubmitButton>
    </form>
  );
}
