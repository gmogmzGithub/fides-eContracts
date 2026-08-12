"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrganizationContext } from "@/lib/auth/guards";
import {
  cancelContract,
  createFromExpired,
  deleteContract,
  duplicateForCorrection,
  moveToFolder,
  setArchived,
} from "@/lib/domain/contracts";
import { concludeAndAccept } from "@/lib/domain/review";
import {
  requestBulkExport,
  requestHistoricalArchive,
} from "@/lib/domain/custody";
import {
  actionError,
  optionalField,
  textField,
  type ActionState,
} from "@/app/app/_lib/action-result";

function filePath(contractId: string): string {
  return `/app/contratos/${contractId}`;
}

/**
 * Cancelar revoca cualquier enlace vigente y cierra sin decisión una revisión
 * abierta. El motivo es opcional y no hay segunda aprobación.
 */
export async function cancelarContrato(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const contractId = textField(data, "contractId");
  try {
    const context = await requireOrganizationContext();
    await cancelContract(context, contractId, optionalField(data, "reason") ?? undefined);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(filePath(contractId));
  revalidatePath("/app/contratos");
  return { ok: true, message: "Contrato cancelado. El enlace dejó de funcionar." };
}

export async function archivarExpediente(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const contractId = textField(data, "contractId");
  const archived = textField(data, "archived") === "true";
  try {
    const context = await requireOrganizationContext();
    await setArchived(context, contractId, archived);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(filePath(contractId));
  revalidatePath("/app/contratos");
  revalidatePath("/app/archivados");
  return {
    ok: true,
    message: archived ? "Expediente archivado." : "Expediente restaurado.",
  };
}

export async function moverACarpeta(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const contractId = textField(data, "contractId");
  try {
    const context = await requireOrganizationContext();
    await moveToFolder(context, contractId, optionalField(data, "folderId"));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(filePath(contractId));
  return { ok: true, message: "Carpeta actualizada." };
}

/** Acepta desde el expediente cuando existe una tarea de revisión abierta. */
export async function aceptarContratoEnRevision(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const contractId = textField(data, "contractId");
  const taskId = textField(data, "taskId");
  try {
    const context = await requireOrganizationContext();
    await concludeAndAccept(context, taskId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(filePath(contractId));
  revalidatePath(`/app/revision/${taskId}`);
  revalidatePath("/app/revision");
  revalidatePath("/app/contratos");
  return { ok: true, message: "Contrato aceptado." };
}

/** `Duplicar para corregir`: crea un Borrador nuevo, nunca edita el Contrato. */
export async function duplicarParaCorregir(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  let draftId: string;
  try {
    const context = await requireOrganizationContext();
    draftId = await duplicateForCorrection(context, textField(data, "contractId"));
  } catch (error) {
    return actionError(error);
  }
  redirect(`/app/contratos/nuevo/${draftId}`);
}

/** `Crear nuevo a partir de este`: usa la publicación vigente de la plantilla. */
export async function crearNuevoDesdeVencido(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  let draftId: string;
  try {
    const context = await requireOrganizationContext();
    draftId = await createFromExpired(context, textField(data, "contractId"));
  } catch (error) {
    return actionError(error);
  }
  redirect(`/app/contratos/nuevo/${draftId}`);
}

/** Sólo Administrador. Una sola confirmación, sin motivo. */
export async function eliminarExpediente(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    await deleteContract(context, textField(data, "contractId"));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/app/contratos");
  revalidatePath("/app/eliminados");
  redirect("/app/eliminados");
}

/** Custodia activa + Administrador: inicia la Preparación de archivo histórico. */
export async function prepararArchivoHistorico(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const contractId = textField(data, "contractId");
  try {
    const context = await requireOrganizationContext();
    await requestHistoricalArchive(context, contractId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(filePath(contractId));
  return {
    ok: true,
    message: "Estamos preparando tu archivo. Estará disponible en un máximo de 48 horas.",
  };
}

export async function exportarExpediente(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const contractId = textField(data, "contractId");
  try {
    const context = await requireOrganizationContext();
    await requestBulkExport(context, [contractId]);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(filePath(contractId));
  return {
    ok: true,
    message:
      "Estamos preparando tu exportación. Estará disponible en un máximo de 48 horas.",
  };
}
