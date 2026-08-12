"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { issueContract } from "@/lib/domain/drafts";
import {
  actionError,
  boolField,
  textField,
  type ActionState,
} from "@/app/app/_lib/action-result";

/**
 * `Generar Contrato`: una sola acción crea el Contrato inmutable, su Referencia,
 * el primer Intento y el Enlace contractual. No hay aprobación intermedia.
 */
export async function generarEnlace(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "emitter");
    const issued = await issueContract(context, textField(data, "draftId"), {
      markFavorite: boolField(data, "favorite"),
    });
    revalidatePath("/app/contratos");
    revalidatePath("/app/contratos/nuevo");
    return {
      ok: true,
      url: issued.url,
      reference: issued.reference,
      contractId: issued.contractId,
    };
  } catch (error) {
    return actionError(error);
  }
}
