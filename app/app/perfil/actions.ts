"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/guards";
import { updateProfileName } from "@/lib/domain/access";
import {
  actionError,
  textField,
  type ActionState,
} from "@/app/app/_lib/action-result";

/** Sólo la propia persona corrige su nombre; nadie más puede hacerlo. */
export async function guardarNombre(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const account = await requireAccount();
    await updateProfileName(account.accountId, textField(data, "fullName"));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Nombre actualizado." };
}

