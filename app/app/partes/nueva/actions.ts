"use server";

import { redirect } from "next/navigation";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import {
  createAndAssignDraftCounterparty,
  type DraftParty,
  type PersonKind,
} from "@/lib/domain/counterparties";
import {
  actionError,
  textField,
  type ActionState,
} from "@/app/app/_lib/action-result";

export async function agregarParte(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const draftId = textField(data, "draftId");
  const party = textField(data, "party") === "signer" ? "signer" : "holder";
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "emitter");
    await createAndAssignDraftCounterparty(
      context,
      draftId,
      party as DraftParty,
      {
        personKind: (party === "signer"
          ? "fisica"
          : textField(data, "personKind") === "moral"
            ? "moral"
            : "fisica") as PersonKind,
        name: textField(data, "name"),
        rfc: textField(data, "rfc"),
        email: textField(data, "email"),
        phone: textField(data, "phone"),
        address: textField(data, "address"),
        position: textField(data, "position"),
      }
    );
  } catch (error) {
    return actionError(error);
  }
  redirect(`/app/contratos/nuevo/${draftId}`);
}
