"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { toFormError } from "@/lib/action-error";
import {
  getTemplate,
  publishTemplateVersion,
  unknownPlaceholders,
} from "@/lib/domain/templates";
import type { PublishState } from "@/app/plataforma/action-state";

/**
 * Publica una versión nueva del Contrato-plantilla (ADR-0079).
 * Falla cerrada ante cualquier marcador desconocido y exige una confirmación
 * explícita cuando la etiqueta nueva repite la vigente.
 */
export async function publicarPlantilla(
  _previous: PublishState,
  formData: FormData
): Promise<PublishState> {
  const account = await requirePlatformAdmin();
  const templateId = String(formData.get("templateId") ?? "");
  const label = String(formData.get("versionNueva") ?? "").trim();
  const markdown = String(formData.get("markdown") ?? "");
  const confirmed = formData.get("confirmacion") === "si";

  try {
    // Sólo el Publicador de contenido jurídico aprueba y publica.
    if (!account.isLegalPublisher) {
      return {
        ok: false,
        error:
          "Tu cuenta global puede consultar todo para soporte, pero sólo el Publicador de contenido jurídico puede publicar una versión.",
        unknownMarkers: [],
      };
    }

    const template = await getTemplate(templateId);
    if (!template) {
      return {
        ok: false,
        error: "No encontramos el Contrato-plantilla.",
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

    if (!markdown.trim()) {
      return {
        ok: false,
        error: "El texto del Contrato-plantilla está vacío.",
        unknownMarkers: [],
      };
    }

    // Falla cerrada: se listan TODOS los marcadores sin campo programado.
    const unknown = unknownPlaceholders(markdown, template.fields);
    if (unknown.length > 0) {
      return {
        ok: false,
        error:
          "No publicamos: el texto usa marcadores que no existen en el Esquema programado de campos. Programa primero los campos y vuelve a publicar. La versión vigente quedó intacta.",
        unknownMarkers: unknown,
      };
    }

    const current = template.currentVersion;
    if (current && current.label === label && !confirmed) {
      return { ok: false, needsConfirmation: true, confirmLabel: label };
    }

    const version = await publishTemplateVersion({
      templateId,
      label,
      markdown,
      publishedBy: account.accountId,
      publishedByName: account.fullName,
    });

    revalidatePath(`/plataforma/plantillas/${templateId}`);
    revalidatePath(`/plataforma/organizaciones/${template.organizationId}`);
    revalidatePath("/plataforma");

    return {
      ok: true,
      message: `Publicaste la versión ${version.label}. Quedó vigente para los Contratos nuevos; las publicaciones anteriores se conservan.`,
    };
  } catch (error) {
    return {
      ...toFormError(error, "No pudimos publicar la versión."),
      unknownMarkers: [],
    };
  }
}
