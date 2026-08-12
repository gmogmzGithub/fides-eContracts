"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { toFormError } from "@/lib/action-error";
import {
  getCurrentPrivacyNotice,
  publishPrivacyNotice,
} from "@/lib/domain/templates";
import type { PublishState } from "@/app/plataforma/action-state";
import { organizationExists } from "@/app/plataforma/queries";

/** Publica el Aviso de Privacidad bajo una etiqueta manual. */
export async function publicarAviso(
  _previous: PublishState,
  formData: FormData
): Promise<PublishState> {
  const account = await requirePlatformAdmin();
  const organizationId = String(formData.get("organizationId") ?? "");
  const label = String(formData.get("versionNueva") ?? "").trim();
  const fullMarkdown = String(
    formData.get("aviso") ?? formData.get("integral") ?? ""
  );
  const confirmed = formData.get("confirmacion") === "si";

  try {
    if (!account.isLegalPublisher) {
      return {
        ok: false,
        error:
          "Tu cuenta global puede consultar el Aviso de Privacidad para soporte, pero sólo el Publicador de contenido jurídico puede publicarlo.",
        unknownMarkers: [],
      };
    }

    if (!organizationId || !(await organizationExists(organizationId))) {
      return {
        ok: false,
        error: "No encontramos la Organización.",
        unknownMarkers: [],
      };
    }

    if (!label) {
      return {
        ok: false,
        error: "Escribe la Versión nueva antes de publicar.",
        unknownMarkers: [],
      };
    }

    if (!fullMarkdown.trim()) {
      return {
        ok: false,
        error: "La publicación necesita el Aviso de Privacidad.",
        unknownMarkers: [],
      };
    }

    const current = await getCurrentPrivacyNotice(organizationId);
    if (current && current.label === label && !confirmed) {
      return { ok: false, needsConfirmation: true, confirmLabel: label };
    }

    const notice = await publishPrivacyNotice({
      organizationId,
      label,
      fullMarkdown,
      publishedBy: account.accountId,
      publishedByName: account.fullName,
    });

    revalidatePath(`/plataforma/avisos/${organizationId}`);
    revalidatePath(`/plataforma/organizaciones/${organizationId}`);
    revalidatePath("/plataforma");

    return {
      ok: true,
      message: `Publicaste la versión ${notice.label}. Aplica sólo a Contratos nuevos; los ya emitidos conservan el aviso con el que se emitieron.`,
    };
  } catch (error) {
    return {
      ...toFormError(error, "No pudimos publicar el Aviso de Privacidad."),
      unknownMarkers: [],
    };
  }
}
