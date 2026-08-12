"use client";

import Link from "next/link";
import { useActionState } from "react";
import { iniciarSesion } from "@/app/acceso/actions";
import { SubmitButton } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { EMPTY_FORM_STATE } from "@/components/ui/form-state";

export function LoginForm() {
  const [state, formAction] = useActionState(iniciarSesion, EMPTY_FORM_STATE);

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

      <Field label="Contraseña" htmlFor="contrasena" required>
        <TextInput
          id="contrasena"
          name="contrasena"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <div className="flex items-center justify-between gap-3">
        <Link
          href="/acceso/recuperar"
          className="cursor-pointer text-sm font-medium text-carbon-soft underline underline-offset-4 transition-colors duration-200 hover:text-carbon"
        >
          Olvidé mi contraseña
        </Link>
        <SubmitButton pendingLabel="Entrando…">Iniciar sesión</SubmitButton>
      </div>
    </form>
  );
}
