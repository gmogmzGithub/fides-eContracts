"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import {
  clampToCapabilities,
  deleteDraft,
  getDraft,
  saveDraft,
} from "@/lib/domain/drafts";
import {
  createAndAssignDraftCounterparty,
  type PersonKind,
} from "@/lib/domain/counterparties";
import type { ReviewPolicy } from "@/lib/domain/types";
import {
  actionError,
  intField,
  optionalField,
  textField,
  type ActionState,
} from "@/app/app/_lib/action-result";

function draftPath(draftId: string): string {
  return `/app/contratos/nuevo/${draftId}`;
}

/**
 * Autoguardado del Borrador. No revalida la ruta para no interrumpir la
 * captura; la pantalla ya refleja lo que la persona está escribiendo.
 */
export async function guardarCampos(input: {
  draftId: string;
  fieldValues: Record<string, string>;
  holderId?: string | null;
  signerId?: string | null;
}): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "emitter");
    await saveDraft(context, input.draftId, {
      fieldValues: input.fieldValues,
      holderId: input.holderId,
      signerId: input.signerId,
    });
    return { ok: true, message: "Guardado" };
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Alta mínima desde el selector de Titular: crea el contacto compartido y lo
 * deja asignado al Borrador sin sacar al Emisor de la captura.
 */
export async function agregarTitularRapido(input: {
  draftId: string;
  personKind: PersonKind;
  name: string;
  rfc?: string;
}): Promise<
  ActionState & {
    holder?: { id: string; label: string; personKind: PersonKind };
  }
> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "emitter");
    const holder = await createAndAssignDraftCounterparty(context, input.draftId, "holder", {
      personKind: input.personKind,
      name: input.name,
      rfc: input.rfc,
    });
    revalidatePath(draftPath(input.draftId));
    return {
      ok: true,
      message: "Contacto agregado al Directorio.",
      holder: {
        id: holder.id,
        label: holder.rfc ? `${holder.name} · ${holder.rfc}` : holder.name,
        personKind: holder.personKind,
      },
    };
  } catch (error) {
    return actionError(error);
  }
}

/** INE y video se eligen de forma visible y se guardan por Contrato. */
export async function guardarEvidencia(input: {
  draftId: string;
  requiresIne: boolean;
  requiresVideo: boolean;
}): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "emitter");
    await saveDraft(context, input.draftId, {
      requiresIne: input.requiresIne,
      requiresVideo: input.requiresVideo,
    });
    return { ok: true, message: "Evidencia guardada." };
  } catch (error) {
    return actionError(error);
  }
}

export async function guardarCarpeta(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const draftId = textField(data, "draftId");
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "emitter");
    await saveDraft(context, draftId, { folderId: optionalField(data, "folderId") });
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(draftPath(draftId));
  return { ok: true, message: "Carpeta actualizada." };
}

/**
 * `Personalizar este contrato`: conserva las decisiones visibles de evidencia
 * y modifica únicamente vigencia y revisión.
 */
export async function personalizarContrato(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const draftId = textField(data, "draftId");
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "emitter");
    const policy = textField(data, "reviewPolicy");
    const draft = await getDraft(context, draftId);
    await saveDraft(
      context,
      draftId,
      clampToCapabilities(context.organization, {
        linkDays: intField(data, "linkDays", context.organization.defaults.linkDays),
        requiresVideo: draft.configuration.requiresVideo,
        requiresIne: draft.configuration.requiresIne,
        reviewPolicy: (policy === "manual" || policy === "ai"
          ? policy
          : "none") as ReviewPolicy,
      })
    );
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(draftPath(draftId));
  return { ok: true, message: "Configuración de este contrato actualizada." };
}

/** `Eliminar` un Borrador destruye su contenido editable (sólo Administrador). */
export async function eliminarBorrador(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    await deleteDraft(context, textField(data, "draftId"));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/app/contratos");
  redirect("/app/contratos");
}
