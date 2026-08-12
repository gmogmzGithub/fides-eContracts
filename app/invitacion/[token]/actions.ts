"use server";

import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth/session";
import { activateInvitation } from "@/lib/domain/access";
import type { FormState } from "@/components/ui/form-state";

const MIN_PASSWORD = 8;

export async function activarInvitacion(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const isNewAccount = formData.get("cuenta_nueva") === "1";
  const fullName = String(formData.get("nombre") ?? "").trim();
  const password = String(formData.get("contrasena") ?? "");

  if (isNewAccount) {
    if (fullName.length < 3) {
      return { ok: false, error: "Captura tu nombre completo." };
    }
    if (password.length < MIN_PASSWORD) {
      return {
        ok: false,
        error: `Tu contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`,
      };
    }
    if (password !== String(formData.get("confirmacion") ?? "")) {
      return { ok: false, error: "Las contraseñas no coinciden." };
    }
  } else if (!password) {
    return { ok: false, error: "Captura tu contraseña para aceptar la membresía." };
  }

  const result = await activateInvitation(token, { fullName, password });
  if (!result.ok) return { ok: false, error: result.error };

  await createSession(result.accountId, !result.needsTotp);
  if (result.needsTotp) redirect("/acceso/totp");
  redirect("/app");
}
