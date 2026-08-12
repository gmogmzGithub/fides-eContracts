"use server";

import { revalidatePath } from "next/cache";
import { loadOrganizationProfile, requirePlatformAdmin } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/domain/operations";
import { CAPABILITY_LABELS, type Capability } from "@/lib/domain/types";
import { toFormError } from "@/lib/action-error";
import type { FormState } from "@/components/ui/form-state";
import {
  CAPABILITY_ORDER,
  organizationExists,
  setCapability,
} from "@/app/plataforma/queries";

/**
 * Habilita o deshabilita las capacidades contratadas. Es configuración
 * comercial del Proveedor: no toca contenido jurídico ni Contratos emitidos.
 */
export async function guardarCapacidades(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const account = await requirePlatformAdmin();
  const organizationId = String(formData.get("organizationId") ?? "");

  try {
    if (!organizationId || !(await organizationExists(organizationId))) {
      return { ok: false, error: "No encontramos la Organización." };
    }

    const profile = await loadOrganizationProfile(organizationId);
    const changes: { capability: Capability; before: boolean; after: boolean }[] =
      [];

    for (const capability of CAPABILITY_ORDER) {
      const after = formData.get(`capacidad_${capability}`) === "on";
      const before = profile.capabilities[capability];
      if (after !== before) {
        await setCapability(organizationId, capability, after);
        changes.push({ capability, before, after });
      }
    }

    if (changes.length === 0) {
      return { ok: true, message: "No hubo cambios que guardar." };
    }

    await recordAudit({
      organizationId,
      accountId: account.accountId,
      actorName: account.fullName,
      actorKind: "platform",
      capability: "platform_admin",
      action: "capacidades_actualizadas",
      subjectType: "organization",
      subjectId: organizationId,
      payload: {
        cambios: changes.map((change) => ({
          capacidad: change.capability,
          antes: change.before,
          despues: change.after,
        })),
      },
    });

    revalidatePath("/plataforma");
    revalidatePath(`/plataforma/organizaciones/${organizationId}`);

    const resumen = changes
      .map(
        (change) =>
          `${CAPABILITY_LABELS[change.capability]}: ${
            change.after ? "habilitada" : "deshabilitada"
          }`
      )
      .join("; ");
    return { ok: true, message: `Guardamos los cambios. ${resumen}.` };
  } catch (error) {
    return toFormError(error, "No pudimos guardar las capacidades contratadas.");
  }
}
