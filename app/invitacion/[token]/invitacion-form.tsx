"use client";

import { useActionState } from "react";
import { activarInvitacion } from "@/app/invitacion/[token]/actions";
import { SubmitButton } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { EMPTY_FORM_STATE } from "@/components/ui/form-state";

export interface InvitacionFormProps {
  token: string;
  /** El correo todavía no identifica una Cuenta individual. */
  isNewAccount: boolean;
  accountName: string | null;
}

export function InvitacionForm({
  token,
  isNewAccount,
  accountName,
}: InvitacionFormProps) {
  const [state, formAction] = useActionState(activarInvitacion, EMPTY_FORM_STATE);

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="cuenta_nueva" value={isNewAccount ? "1" : "0"} />
      <FormMessage state={state} />

      {isNewAccount ? (
        <>
          <Field
            label="Nombre completo"
            htmlFor="nombre"
            hint="Así aparecerás en los Contratos y eventos que registres."
            required
          >
            <TextInput
              id="nombre"
              name="nombre"
              autoComplete="name"
              required
              placeholder="Nombre y apellidos"
            />
          </Field>

          <Field
            label="Contraseña"
            htmlFor="contrasena"
            hint="Mínimo ocho caracteres. Nadie más puede verla o elegirla."
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
        </>
      ) : (
        <Field
          label="Contraseña de tu cuenta"
          htmlFor="contrasena"
          hint={
            accountName
              ? `Ya tienes una Cuenta individual a nombre de ${accountName}. Úsala para aceptar esta membresía.`
              : "Usa la contraseña de tu Cuenta individual."
          }
          required
        >
          <TextInput
            id="contrasena"
            name="contrasena"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
      )}

      <SubmitButton pendingLabel="Activando…" className="w-full">
        {isNewAccount ? "Crear mi cuenta y entrar" : "Aceptar membresía y entrar"}
      </SubmitButton>
    </form>
  );
}
