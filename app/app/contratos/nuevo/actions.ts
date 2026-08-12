"use server";

import { redirect } from "next/navigation";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { createDraft } from "@/lib/domain/drafts";
import {
  actionError,
  textField,
  type ActionState,
} from "@/app/app/_lib/action-result";

/** Paso 1: crea el Borrador y lleva al Emisor a `Capturar datos`. */
export async function iniciarBorrador(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  let draftId: string;
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "emitter");
    draftId = await createDraft(context, {
      templateId: textField(data, "templateId"),
    });
  } catch (error) {
    return actionError(error);
  }
  redirect(`/app/contratos/nuevo/${draftId}`);
}
