"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import {
  deleteInvitation,
  prepareInvitation,
  removeMember,
  revokeInvitation,
  sendInvitation,
  transferPrimaryAdmin,
  updateInvitationRoles,
  updateMemberRoles,
} from "@/lib/domain/access";
import type { OrganizationRole } from "@/lib/domain/types";
import {
  actionError,
  textField,
  type ActionState,
} from "@/app/app/_lib/action-result";

const ROLES: OrganizationRole[] = ["administrator", "emitter", "reviewer"];

function readRoles(data: FormData): OrganizationRole[] {
  const chosen = data.getAll("roles").map(String);
  return ROLES.filter((role) => chosen.includes(role));
}

function revalidate(): void {
  revalidatePath("/app/accesos");
}

export async function prepararInvitacion(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator");
    await prepareInvitation(context, textField(data, "email"), readRoles(data));
  } catch (error) {
    return actionError(error);
  }
  revalidate();
  return {
    ok: true,
    message:
      "Invitación preparada. Todavía no se envía nada: usa `Enviar invitación` cuando quieras.",
  };
}

/** Enviar y reenviar generan siempre un enlace nuevo de 30 días. */
export async function enviarInvitacion(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator");
    await sendInvitation(context, textField(data, "invitationId"));
  } catch (error) {
    return actionError(error);
  }
  revalidate();
  return {
    ok: true,
    message: "Invitación enviada con un enlace nuevo de 30 días.",
  };
}

export async function editarRolesInvitacion(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator");
    await updateInvitationRoles(
      context,
      textField(data, "invitationId"),
      readRoles(data)
    );
  } catch (error) {
    return actionError(error);
  }
  revalidate();
  return {
    ok: true,
    message:
      "Roles actualizados. La activación asignará los roles vigentes en ese momento, sin reenviar el enlace.",
  };
}

export async function revocarInvitacion(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator");
    await revokeInvitation(context, textField(data, "invitationId"));
  } catch (error) {
    return actionError(error);
  }
  revalidate();
  return { ok: true, message: "Invitación revocada y enlace invalidado." };
}

/** Para un correo equivocado: borra el registro y no conserva historial. */
export async function eliminarInvitacion(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator");
    await deleteInvitation(context, textField(data, "invitationId"));
  } catch (error) {
    return actionError(error);
  }
  revalidate();
  return { ok: true, message: "Invitación eliminada." };
}

export async function cambiarRolesMiembro(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator");
    await updateMemberRoles(context, textField(data, "memberId"), readRoles(data));
  } catch (error) {
    return actionError(error);
  }
  revalidate();
  return { ok: true, message: "Roles actualizados." };
}

/** `Eliminar acceso` se ejecuta de inmediato, sin confirmación ni motivo. */
export async function eliminarAcceso(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator");
    await removeMember(context, textField(data, "memberId"));
  } catch (error) {
    return actionError(error);
  }
  revalidate();
  return { ok: true, message: "Acceso eliminado y Asiento liberado." };
}

export async function transferirAdministradorPrincipal(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  try {
    const context = await requireOrganizationContext();
    requireRole(context, "administrator");
    await transferPrimaryAdmin(context, textField(data, "memberId"));
  } catch (error) {
    return actionError(error);
  }
  revalidate();
  return { ok: true, message: "Condición de Administrador principal transferida." };
}

