import "server-only";
import { sql } from "@/lib/db";
import { recordAudit } from "@/lib/domain/operations";
import { ConflictError } from "@/lib/domain/errors";
import type { OrganizationContext } from "@/lib/auth/guards";
import type { ReviewPolicy } from "@/lib/domain/types";

/**
 * Configuración predeterminada de emisión de una Organización. Un Administrador
 * la cambia dentro de las capacidades habilitadas y sólo afecta emisiones
 * futuras: cada cambio crea una versión operativa nueva.
 */

export interface OrganizationDefaultsPatch {
  linkDays: number;
  requiresVideo: boolean;
  requiresIne: boolean;
  reviewPolicy: ReviewPolicy;
}

export interface ContractAlertPreferences {
  emailEnabled: boolean;
  emailRecipient: string;
  whatsappEnabled: boolean;
  whatsappRecipient: string;
}

export async function getContractAlertPreferences(
  organizationId: string
): Promise<ContractAlertPreferences> {
  const [row] = await sql<
    {
      alert_email_enabled: boolean;
      alert_email_recipient: string | null;
      alert_whatsapp_enabled: boolean;
      alert_whatsapp_recipient: string | null;
    }[]
  >`
    SELECT alert_email_enabled, alert_email_recipient,
           alert_whatsapp_enabled, alert_whatsapp_recipient
    FROM organization_settings
    WHERE organization_id = ${organizationId}
  `;
  return {
    emailEnabled: row?.alert_email_enabled ?? false,
    emailRecipient: row?.alert_email_recipient ?? "",
    whatsappEnabled: row?.alert_whatsapp_enabled ?? false,
    whatsappRecipient: row?.alert_whatsapp_recipient ?? "",
  };
}

export async function updateContractAlertPreferences(
  context: OrganizationContext,
  preferences: ContractAlertPreferences
): Promise<void> {
  const emailRecipient = preferences.emailRecipient.trim();
  const whatsappRecipient = preferences.whatsappRecipient
    .trim()
    .replace(/[\s()-]/g, "");

  if (preferences.emailEnabled) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRecipient)) {
      throw new ConflictError("Escribe un correo válido para recibir alertas.");
    }
  }
  if (preferences.whatsappEnabled) {
    if (!/^\+[1-9]\d{9,14}$/.test(whatsappRecipient)) {
      throw new ConflictError(
        "Escribe el número de WhatsApp con código de país, por ejemplo +523312345678."
      );
    }
  }

  await sql.begin(async (tx) => {
    const result = await tx`
      UPDATE organization_settings
      SET alert_email_enabled = ${preferences.emailEnabled},
          alert_email_recipient = ${emailRecipient || null},
          alert_whatsapp_enabled = ${preferences.whatsappEnabled},
          alert_whatsapp_recipient = ${whatsappRecipient || null},
          updated_at = NOW(),
          updated_by = ${context.account.accountId}
      WHERE organization_id = ${context.organization.id}
    `;
    if (result.count === 0) {
      throw new ConflictError("No encontramos la configuración de esta Organización.");
    }
    await recordAudit(
      {
        organizationId: context.organization.id,
        accountId: context.account.accountId,
        actorName: context.account.fullName,
        action: "alertas_contractuales_actualizadas",
        subjectType: "organization_settings",
        subjectId: context.organization.id,
        payload: {
          emailEnabled: preferences.emailEnabled,
          whatsappEnabled: preferences.whatsappEnabled,
        },
      },
      tx
    );
  });
}

/**
 * Cambia los valores predeterminados de emisión. Sólo aplica a Contratos
 * futuros. INE y video son universales; sólo la revisión AI conserva una
 * capacidad comercial independiente.
 */
export async function updateOrganizationDefaults(
  context: OrganizationContext,
  patch: OrganizationDefaultsPatch
): Promise<void> {
  if (!Number.isInteger(patch.linkDays) || patch.linkDays < 1 || patch.linkDays > 30) {
    throw new ConflictError("La vigencia del enlace debe ser de 1 a 30 días.");
  }
  const capabilities = context.organization.capabilities;
  if (patch.reviewPolicy === "ai" && !capabilities.ai_review) {
    throw new ConflictError("La revisión por AI no está habilitada.");
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE organization_settings
      SET operational_version = operational_version + 1,
          default_link_days = ${patch.linkDays},
          default_requires_video = ${patch.requiresVideo},
          default_requires_ine = ${patch.requiresIne},
          default_review_policy = ${patch.reviewPolicy},
          updated_at = NOW(),
          updated_by = ${context.account.accountId}
      WHERE organization_id = ${context.organization.id}
    `;
    await recordAudit(
      {
        organizationId: context.organization.id,
        accountId: context.account.accountId,
        actorName: context.account.fullName,
        action: "configuracion_emision_actualizada",
        subjectType: "organization_settings",
        subjectId: context.organization.id,
        payload: { ...patch },
      },
      tx
    );
  });
}
