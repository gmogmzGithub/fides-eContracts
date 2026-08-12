"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { acceptContract, markContractWalked } from "@/lib/domain/signer";
import { DomainError } from "@/lib/domain/errors";
import { basePath, evidenceComplete, loadView } from "@/app/c/_lib/view";
import {
  SIGNER_GENERIC_ERROR,
  type SignerActionResult,
} from "@/app/c/_lib/result";

/**
 * `Contrato recorrido` documenta únicamente que la interfaz alcanzó el final
 * del texto. No es prueba de lectura, comprensión, identidad o conformidad.
 */
export async function markWalkedAction(
  token: string
): Promise<SignerActionResult> {
  const view = await loadView(token);
  if (!view.ok) return { ok: false, error: SIGNER_GENERIC_ERROR };

  try {
    await markContractWalked(token);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof DomainError ? error.message : SIGNER_GENERIC_ERROR,
    };
  }

  revalidatePath(basePath(token), "layout");
  return { ok: true };
}

export async function acceptAction(
  token: string,
  _previous: SignerActionResult,
  formData: FormData
): Promise<SignerActionResult> {
  const legendAccepted = formData.get("aceptacion") === "si";
  if (!legendAccepted) {
    return {
      ok: false,
      error: "Marca la casilla para poder aceptar el contrato.",
    };
  }

  // El enlace y el avance real se revalidan en servidor en cada intento.
  const view = await loadView(token);
  if (!view.ok) return { ok: false, error: SIGNER_GENERIC_ERROR };
  if (!view.walked) {
    return { ok: false, error: "Primero recorre el contrato completo." };
  }
  if (!evidenceComplete(view)) {
    return {
      ok: false,
      error: "Falta enviar la evidencia solicitada para este contrato.",
    };
  }

  const requestHeaders = await headers();

  try {
    await acceptContract(token, {
      legendAccepted: true,
      userAgent: requestHeaders.get("user-agent") ?? undefined,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof DomainError ? error.message : SIGNER_GENERIC_ERROR,
    };
  }

  const base = basePath(token);
  revalidatePath(base, "layout");
  redirect(`${base}/listo`);
}
