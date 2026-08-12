"use server";

import { redirect } from "next/navigation";
import { requireOrganizationContext } from "@/lib/auth/guards";
import { createFromPrevious } from "@/lib/domain/contracts";
import { actionError, textField, type ActionState } from "@/app/app/_lib/action-result";

/**
 * Crea un Borrador con los datos capturados de un Contrato anterior. La usan
 * `Recientes` y los `Favoritos` de `Crear contrato`, así que vive fuera de las
 * dos rutas en lugar de que una importe las acciones de la otra.
 */
export async function crearDesdeContrato(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  let draftId: string;
  try {
    const context = await requireOrganizationContext();
    draftId = await createFromPrevious(context, textField(data, "contractId"));
  } catch (error) {
    return actionError(error);
  }
  redirect(`/app/contratos/nuevo/${draftId}`);
}
