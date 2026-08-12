"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import {
  concludeAndAccept,
  recordExternalContact,
  repeatProcess,
  skipAndAccept,
} from "@/lib/domain/review";
import {
  REPEAT_REASON_LABELS,
  type RepeatReasonCode,
} from "@/lib/domain/types";
import {
  actionError,
  optionalField,
  textField,
  type ActionState,
} from "@/app/app/_lib/action-result";

/**
 * `Aceptar contrato` y `Omitir revisión y aceptar (SKIP)` son acciones
 * directas: sin casilla, modal o segunda confirmación.
 */
export async function resolverRevision(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const taskId = textField(data, "taskId");
  const decision = textField(data, "decision");
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "reviewer");
    if (decision === "skip") {
      await skipAndAccept(context, taskId, optionalField(data, "note") ?? undefined);
    } else {
      await concludeAndAccept(context, taskId);
    }
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/revision/${taskId}`);
  revalidatePath("/app/revision");
  return {
    ok: true,
    message:
      decision === "skip"
        ? "Se aceptó el Contrato y quedó registrado que no hubo revisión manual."
        : "Revisión concluida y Contrato aceptado.",
  };
}

/**
 * `Repetir proceso` cierra el intento, revoca su enlace y crea el sucesor.
 * La plataforma no contacta al Firmante: entrega el enlace y un mensaje
 * sugerido para que la Organización lo comparta fuera del producto.
 */
export async function repetirProceso(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const taskId = textField(data, "taskId");
  const reasonCode = textField(data, "reasonCode");
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "reviewer");
    if (!(reasonCode in REPEAT_REASON_LABELS)) {
      return { ok: false, error: "Elige un motivo de la lista." };
    }
    const result = await repeatProcess(
      context,
      taskId,
      reasonCode as RepeatReasonCode,
      optionalField(data, "reasonText") ?? undefined
    );
    revalidatePath(`/app/revision/${taskId}`);
    revalidatePath("/app/revision");
    return {
      ok: true,
      url: result.url,
      suggestedMessage: result.suggestedMessage,
      message: "Se creó un intento nuevo con su propio enlace.",
    };
  } catch (error) {
    return actionError(error);
  }
}

/** Registro posterior del contacto externo. No es prueba de entrega. */
export async function registrarContactoExterno(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const contractId = textField(data, "contractId");
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "reviewer");
    await recordExternalContact(
      context,
      contractId,
      textField(data, "channel"),
      optionalField(data, "note") ?? undefined
    );
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/contratos/${contractId}`);
  return { ok: true, message: "Contacto registrado." };
}
