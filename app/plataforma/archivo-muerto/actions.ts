"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { toFormError } from "@/lib/action-error";
import { platformRecoverPackage } from "@/lib/domain/custody";
import { recordAudit } from "@/lib/domain/operations";
import type { FormState } from "@/components/ui/form-state";
import { getColdPackageContext } from "@/app/plataforma/queries";

/**
 * `Recuperar contenido` de la Vista interna de Archivo Muerto (ADR-0040/0081).
 * El nivel no se elige: `standard` con Custodia activa y `bulk` sin ella.
 * Por sí sola sólo habilita la inspección interna; publicar el resultado deja
 * el ZIP exacto dentro del expediente ordinario de la Organización.
 */
export async function recuperarContenido(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const account = await requirePlatformAdmin();
  const contractId = String(formData.get("contractId") ?? "");
  const publish = formData.get("publicar") === "on";

  try {
    const context = await getColdPackageContext(contractId);
    if (!context) {
      return { ok: false, error: "No encontramos el Contrato del paquete." };
    }

    const tier = context.activeCustody ? "standard" : "bulk";
    await platformRecoverPackage(account.accountId, contractId, publish);

    await recordAudit({
      organizationId: context.organizationId,
      accountId: account.accountId,
      actorName: account.fullName,
      actorKind: "platform",
      capability: "platform_admin",
      action: "archivo_muerto_recuperar_contenido",
      subjectType: "cold_contract_package",
      subjectId: contractId,
      payload: {
        referencia: context.reference,
        nivel: tier,
        publicado_en_expediente: publish,
      },
    });

    revalidatePath("/plataforma/archivo-muerto");

    const plazo =
      tier === "standard"
        ? "Con Custodia activa la recuperación usa el nivel `standard`, bajo el compromiso máximo de 48 horas."
        : "Sin Custodia activa la recuperación usa el nivel `bulk`, con un plazo operativo de hasta siete días hábiles.";

    return {
      ok: true,
      message: publish
        ? `Publicamos el ZIP exacto dentro del expediente de ${context.reference}; estará disponible tres días completos y sólo un Administrador activo podrá descargarlo. ${plazo}`
        : `Recuperamos el paquete de ${context.reference} para inspección interna; no se publicó nada en el expediente de la Organización. ${plazo}`,
    };
  } catch (error) {
    return toFormError(
      error,
      "No se pudo preparar el archivo. Puedes reintentar la recuperación; no hay reintento automático."
    );
  }
}
