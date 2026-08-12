"use server";

import { redirect } from "next/navigation";
import {
  createSession,
  destroySession,
  getSessionAccount,
  listMemberships,
  markTotpSatisfied,
} from "@/lib/auth/session";
import {
  authenticate,
  completePasswordReset,
  requestPasswordReset,
  verifyAccountTotp,
} from "@/lib/domain/access";
import type { FormState } from "@/components/ui/form-state";

const MIN_PASSWORD = 8;

/** Respuesta neutra: nunca revela si el correo existe. */
const NEUTRAL_RESET_MESSAGE =
  "Si el correo existe, enviamos un enlace de un solo uso vigente por una hora.";

export async function iniciarSesion(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const email = String(formData.get("correo") ?? "").trim();
  const password = String(formData.get("contrasena") ?? "");
  if (!email || !password) {
    return { ok: false, error: "Captura tu correo y tu contraseña." };
  }

  const result = await authenticate(email, password);
  if (!result.ok) {
    return { ok: false, error: "Correo o contraseña incorrectos." };
  }

  await createSession(result.accountId, !result.needsTotp);
  if (result.needsTotp) redirect("/acceso/totp");

  const account = await getSessionAccount();
  if (account?.isPlatformAdmin) redirect("/plataforma");

  const memberships = account ? await listMemberships(account.accountId) : [];
  if (memberships.length === 0) redirect("/acceso/sin-acceso");
  redirect("/app");
}

export async function verificarTotp(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const account = await getSessionAccount();
  if (!account) redirect("/acceso");
  if (!account.isPlatformAdmin) redirect("/app");

  const code = String(formData.get("codigo") ?? "").replace(/\D/g, "");
  if (code.length !== 6) {
    return { ok: false, error: "Captura los seis dígitos de tu código." };
  }

  const verified = await verifyAccountTotp(account.accountId, code);
  if (!verified) {
    return { ok: false, error: "El código no es válido. Genera uno nuevo e inténtalo otra vez." };
  }

  await markTotpSatisfied(account.sessionId);
  redirect("/plataforma");
}

export async function solicitarRecuperacion(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const email = String(formData.get("correo") ?? "").trim();
  if (!email) return { ok: false, error: "Captura tu correo." };
  await requestPasswordReset(email);
  return { ok: true, message: NEUTRAL_RESET_MESSAGE };
}

export async function establecerContrasena(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("contrasena") ?? "");
  const confirmation = String(formData.get("confirmacion") ?? "");

  if (password.length < MIN_PASSWORD) {
    return {
      ok: false,
      error: `Tu contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`,
    };
  }
  if (password !== confirmation) {
    return { ok: false, error: "Las contraseñas no coinciden." };
  }

  const applied = await completePasswordReset(token, password);
  if (!applied) {
    return {
      ok: false,
      error: "Este enlace ya no es válido. Solicita uno nuevo desde `Olvidé mi contraseña`.",
    };
  }
  redirect("/acceso?restablecida=1");
}

export async function cerrarSesion(): Promise<void> {
  await destroySession();
  redirect("/");
}
