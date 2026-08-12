"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { createFolder, deleteFolder, renameFolder } from "@/lib/domain/contracts";
import {
  actionError,
  textField,
  type ActionState,
} from "@/app/app/_lib/action-result";

function revalidate(): void {
  revalidatePath("/app/carpetas");
  revalidatePath("/app/contratos");
  revalidatePath("/app/archivados");
}

export async function crearCarpeta(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator", "emitter");
    await createFolder(context, textField(data, "name"));
  } catch (error) {
    return actionError(error);
  }
  revalidate();
  return { ok: true, message: "Carpeta creada." };
}

export async function renombrarCarpeta(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator", "emitter");
    await renameFolder(context, textField(data, "folderId"), textField(data, "name"));
  } catch (error) {
    return actionError(error);
  }
  revalidate();
  return { ok: true, message: "Carpeta renombrada." };
}

/** Eliminar una carpeta deja sus expedientes sin carpeta; nunca los borra. */
export async function eliminarCarpeta(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator", "emitter");
    await deleteFolder(context, textField(data, "folderId"));
  } catch (error) {
    return actionError(error);
  }
  revalidate();
  return { ok: true, message: "Carpeta eliminada." };
}

