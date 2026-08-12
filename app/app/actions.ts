"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/guards";
import { listMemberships, setActiveOrganization } from "@/lib/auth/session";
import {
  actionError,
  textField,
  type ActionState,
} from "@/app/app/_lib/action-result";

/**
 * Cambia la Organización activa. La pertenencia se vuelve a comprobar en
 * servidor: el navegador nunca decide a qué Organización entra la sesión.
 */
export async function cambiarOrganizacion(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const organizationId = textField(data, "organizationId");
  try {
    const account = await requireAccount();
    const memberships = await listMemberships(account.accountId);
    if (!memberships.some((item) => item.organizationId === organizationId)) {
      return { ok: false, error: "No tienes acceso a esa Organización." };
    }
    await setActiveOrganization(account.sessionId, organizationId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/app", "layout");
  redirect("/app/contratos");
}
