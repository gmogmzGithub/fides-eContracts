"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import type { ReviewPolicy } from "@/lib/domain/types";
import { updateOrganizationDefaults } from "@/app/app/_lib/portal-queries";
import { updateContractAlertPreferences } from "@/lib/domain/settings";
import {
  actionError,
  boolField,
  intField,
  textField,
  type ActionState,
} from "@/app/app/_lib/action-result";

function readPolicy(value: string): ReviewPolicy {
  if (value === "manual" || value === "ai") return value;
  return "none";
}

/**
 * Cambiar los valores predeterminados crea una versión operativa nueva que
 * sólo aplica a emisiones futuras: ningún Contrato emitido se modifica.
 */
export async function guardarConfiguracion(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator");
    await updateOrganizationDefaults(context, {
      linkDays: intField(data, "linkDays", context.organization.defaults.linkDays),
      requiresVideo: boolField(data, "requiresVideo"),
      requiresIne: boolField(data, "requiresIne"),
      reviewPolicy: readPolicy(textField(data, "reviewPolicy")),
    });
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/app/configuracion");
  return {
    ok: true,
    message:
      "Configuración guardada. Sólo aplica a los Contratos que emitas a partir de ahora.",
  };
}

export async function guardarAlertas(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator");
    await updateContractAlertPreferences(context, {
      emailEnabled: boolField(data, "emailEnabled"),
      emailRecipient: textField(data, "emailRecipient"),
      whatsappEnabled: boolField(data, "whatsappEnabled"),
      whatsappRecipient: textField(data, "whatsappRecipient"),
    });
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/app/configuracion");
  revalidatePath("/app/contratos");
  return { ok: true, message: "Alertas guardadas." };
}
