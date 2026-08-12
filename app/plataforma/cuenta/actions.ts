"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { markTotpSatisfied } from "@/lib/auth/session";
import { createTotpSecret, verifyTotp } from "@/lib/crypto/totp";
import { recordAudit } from "@/lib/domain/operations";
import type { FormState } from "@/components/ui/form-state";
import {
  getAccountTotpState,
  readAccountTotpSecret,
  storeConfirmedTotpSecret,
} from "@/app/plataforma/queries";

/**
 * El secreto candidato vive en una cookie `httpOnly` mientras dura el alta:
 * no se guarda en la cuenta hasta que un código válido lo confirma, para que
 * una sesión a medias nunca quede fuera de su propio segundo factor.
 */
const PENDING_COOKIE = "fides_totp_pending";
const PENDING_MINUTES = 15;

async function setPendingSecret(secret: string): Promise<void> {
  const store = await cookies();
  store.set(PENDING_COOKIE, secret, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" &&
      process.env.FIDES_INSECURE_COOKIES !== "true",
    path: "/",
    maxAge: PENDING_MINUTES * 60,
  });
}

export async function iniciarAltaTotp(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const account = await requirePlatformAdmin();
  const state = await getAccountTotpState(account.accountId);

  // Volver a dar de alta exige un código vigente del segundo factor actual.
  if (state.enrolled) {
    const code = String(formData.get("codigoActual") ?? "").replace(/\D/g, "");
    if (code.length !== 6) {
      return {
        ok: false,
        error: "Captura los seis dígitos de tu código actual para continuar.",
      };
    }
    const secret = await readAccountTotpSecret(account.accountId);
    if (!secret || !verifyTotp(secret, code)) {
      return { ok: false, error: "El código actual no es válido." };
    }
  }

  await setPendingSecret(createTotpSecret());
  await recordAudit({
    accountId: account.accountId,
    actorName: account.fullName,
    actorKind: "platform",
    capability: "platform_admin",
    action: state.enrolled ? "totp_realta_iniciada" : "totp_alta_iniciada",
    subjectType: "account",
    subjectId: account.accountId,
  });

  revalidatePath("/plataforma/cuenta");
  return {
    ok: true,
    message:
      "Escanea el código QR con tu aplicación autenticadora y confirma con un código de seis dígitos.",
  };
}

export async function confirmarAltaTotp(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const account = await requirePlatformAdmin();
  const store = await cookies();
  const secret = store.get(PENDING_COOKIE)?.value;
  if (!secret) {
    return {
      ok: false,
      error: "El alta expiró. Genera una clave nueva y vuelve a intentarlo.",
    };
  }

  const code = String(formData.get("codigo") ?? "").replace(/\D/g, "");
  if (code.length !== 6) {
    return { ok: false, error: "Captura los seis dígitos de tu código." };
  }
  if (!verifyTotp(secret, code)) {
    return {
      ok: false,
      error: "El código no coincide. Espera al siguiente e inténtalo otra vez.",
    };
  }

  await storeConfirmedTotpSecret(account.accountId, secret);
  await markTotpSatisfied(account.sessionId);
  store.delete(PENDING_COOKIE);

  await recordAudit({
    accountId: account.accountId,
    actorName: account.fullName,
    actorKind: "platform",
    capability: "platform_admin",
    action: "totp_confirmado",
    subjectType: "account",
    subjectId: account.accountId,
  });

  revalidatePath("/plataforma/cuenta");
  return {
    ok: true,
    message:
      "Tu segundo factor quedó confirmado. Lo pediremos después de tu correo y contraseña.",
  };
}

export async function cancelarAltaTotp(): Promise<void> {
  await requirePlatformAdmin();
  const store = await cookies();
  store.delete(PENDING_COOKIE);
  revalidatePath("/plataforma/cuenta");
}
