"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { setArchived } from "@/lib/domain/contracts";
import {
  actionError,
  textField,
  type ActionState,
} from "@/app/app/_lib/action-result";

/** `Restaurar` devuelve el expediente a `Contratos` sin tocar su Estado. */
export async function restaurarExpediente(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator", "emitter");
    await setArchived(context, textField(data, "contractId"), false);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/app/archivados");
  revalidatePath("/app/contratos");
  return { ok: true, message: "Expediente restaurado." };
}
