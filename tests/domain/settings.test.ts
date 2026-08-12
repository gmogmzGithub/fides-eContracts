import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import type { OrganizationContext } from "@/lib/auth/guards";
import { ConflictError } from "@/lib/domain/errors";
import { createDraft, issueContract, saveDraft } from "@/lib/domain/drafts";
import {
  getContractAlertPreferences,
  updateContractAlertPreferences,
  updateOrganizationDefaults,
  type ContractAlertPreferences,
  type OrganizationDefaultsPatch,
} from "@/lib/domain/settings";
import type { ReviewPolicy } from "@/lib/domain/types";
import {
  buildContext,
  createIssuableOrganization,
} from "@/tests/helpers/database";

type Fixture = Awaited<ReturnType<typeof createIssuableOrganization>>;

interface SettingsRow {
  operational_version: number;
  default_link_days: number;
  default_requires_video: boolean;
  default_requires_ine: boolean;
  default_review_policy: ReviewPolicy;
  updated_by: string | null;
}

interface ContractConfigurationRow {
  link_days: number;
  requires_video: boolean;
  requires_ine: boolean;
  review_policy: ReviewPolicy;
}

const BASE_PATCH: OrganizationDefaultsPatch = {
  linkDays: 7,
  requiresVideo: false,
  requiresIne: false,
  reviewPolicy: "none",
};

const ALERTS_DISABLED: ContractAlertPreferences = {
  emailEnabled: false,
  emailRecipient: "",
  whatsappEnabled: false,
  whatsappRecipient: "",
};

async function readSettings(organizationId: string): Promise<SettingsRow> {
  const [row] = await sql<SettingsRow[]>`
    SELECT operational_version, default_link_days, default_requires_video,
           default_requires_ine, default_review_policy, updated_by
    FROM organization_settings WHERE organization_id = ${organizationId}
  `;
  return row;
}

async function countAudit(organizationId: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total FROM audit_entries
    WHERE organization_id = ${organizationId}
      AND action = 'configuracion_emision_actualizada'
  `;
  return Number(row.total);
}

/** Emite un Contrato completo con la configuración vigente del contexto. */
async function emitirContrato(
  context: OrganizationContext,
  fixture: Fixture
): Promise<string> {
  const draftId = await createDraft(context, {
    templateId: fixture.template.id,
  });
  await saveDraft(context, draftId, {
    fieldValues: { objeto: "Servicio sintético", monto: "1000" },
    holderId: fixture.holder.id,
    signerId: fixture.signer.id,
  });
  const issued = await issueContract(context, draftId);
  return issued.contractId;
}

async function readContractConfiguration(
  contractId: string
): Promise<ContractConfigurationRow> {
  const [row] = await sql<ContractConfigurationRow[]>`
    SELECT link_days, requires_video, requires_ine, review_policy
    FROM contracts WHERE id = ${contractId}
  `;
  return row;
}

describe("configuración predeterminada de emisión", () => {
  describe("alertas contractuales", () => {
    it("parte deshabilitada y tolera que aún no exista la configuración", async () => {
      const fixture = await createIssuableOrganization();
      expect(await getContractAlertPreferences(fixture.organization.id)).toEqual(
        ALERTS_DISABLED
      );

      await sql`
        DELETE FROM organization_settings
        WHERE organization_id = ${fixture.organization.id}
      `;
      expect(await getContractAlertPreferences(fixture.organization.id)).toEqual(
        ALERTS_DISABLED
      );
      await expect(
        updateContractAlertPreferences(fixture.context, ALERTS_DISABLED)
      ).rejects.toThrow("No encontramos la configuración de esta Organización.");
    });

    it("guarda correo y WhatsApp normalizado y audita sólo la configuración", async () => {
      const fixture = await createIssuableOrganization();
      await updateContractAlertPreferences(fixture.context, {
        emailEnabled: true,
        emailRecipient: "  avisos@example.test ",
        whatsappEnabled: true,
        whatsappRecipient: " +52 (33) 1234-5678 ",
      });

      expect(await getContractAlertPreferences(fixture.organization.id)).toEqual({
        emailEnabled: true,
        emailRecipient: "avisos@example.test",
        whatsappEnabled: true,
        whatsappRecipient: "+523312345678",
      });
      const [entry] = await sql<
        { account_id: string; actor_name: string; payload: Record<string, unknown> }[]
      >`
        SELECT account_id, actor_name, payload FROM audit_entries
        WHERE organization_id = ${fixture.organization.id}
          AND action = 'alertas_contractuales_actualizadas'
      `;
      expect(entry.account_id).toBe(fixture.account.id);
      expect(entry.actor_name).toBe(fixture.account.fullName);
      expect(entry.payload).toEqual({
        emailEnabled: true,
        whatsappEnabled: true,
      });
    });

    it("valida los destinos únicamente cuando el canal está habilitado", async () => {
      const fixture = await createIssuableOrganization();
      await expect(
        updateContractAlertPreferences(fixture.context, {
          ...ALERTS_DISABLED,
          emailEnabled: true,
          emailRecipient: "correo-incompleto",
        })
      ).rejects.toThrow("Escribe un correo válido");
      await expect(
        updateContractAlertPreferences(fixture.context, {
          ...ALERTS_DISABLED,
          whatsappEnabled: true,
          whatsappRecipient: "3312345678",
        })
      ).rejects.toThrow("Escribe el número de WhatsApp");

      await updateContractAlertPreferences(fixture.context, {
        ...ALERTS_DISABLED,
        emailRecipient: "no-es-correo",
        whatsappRecipient: "sincodigodepais",
      });
      expect(await getContractAlertPreferences(fixture.organization.id)).toEqual({
        ...ALERTS_DISABLED,
        emailRecipient: "no-es-correo",
        whatsappRecipient: "sincodigodepais",
      });
    });
  });

  describe("validación de la vigencia del enlace", () => {
    it("rechaza una vigencia fuera de 1 a 30 días completos", async () => {
      const fixture = await createIssuableOrganization();
      const antes = await readSettings(fixture.organization.id);

      for (const linkDays of [0, -1, 31, 365]) {
        await expect(
          updateOrganizationDefaults(fixture.context, { ...BASE_PATCH, linkDays })
        ).rejects.toThrow(ConflictError);
      }

      const despues = await readSettings(fixture.organization.id);
      expect(despues.operational_version).toBe(antes.operational_version);
      expect(despues.default_link_days).toBe(antes.default_link_days);
      expect(await countAudit(fixture.organization.id)).toBe(0);
    });

    it("rechaza una vigencia que no es un número entero de días", async () => {
      const fixture = await createIssuableOrganization();
      await expect(
        updateOrganizationDefaults(fixture.context, {
          ...BASE_PATCH,
          linkDays: 7.5,
        })
      ).rejects.toThrow("La vigencia del enlace debe ser de 1 a 30 días.");
      expect(await countAudit(fixture.organization.id)).toBe(0);
    });

    it("acepta los extremos de 1 y 30 días completos", async () => {
      const fixture = await createIssuableOrganization();

      await updateOrganizationDefaults(fixture.context, {
        ...BASE_PATCH,
        linkDays: 1,
      });
      expect((await readSettings(fixture.organization.id)).default_link_days).toBe(1);

      await updateOrganizationDefaults(fixture.context, {
        ...BASE_PATCH,
        linkDays: 30,
      });
      expect((await readSettings(fixture.organization.id)).default_link_days).toBe(30);
    });
  });

  describe("capacidades comerciales", () => {
    it("permite video para toda Organización", async () => {
      const fixture = await createIssuableOrganization();
      await updateOrganizationDefaults(fixture.context, {
        ...BASE_PATCH,
        requiresVideo: true,
      });
      expect((await readSettings(fixture.organization.id)).default_requires_video).toBe(
        true
      );
    });

    it("permite INE para toda Organización", async () => {
      const fixture = await createIssuableOrganization();
      await updateOrganizationDefaults(fixture.context, {
        ...BASE_PATCH,
        requiresIne: true,
      });
      expect((await readSettings(fixture.organization.id)).default_requires_ine).toBe(
        true
      );
    });

    it("rechaza la revisión por AI cuando no está habilitada", async () => {
      const fixture = await createIssuableOrganization();
      await expect(
        updateOrganizationDefaults(fixture.context, {
          ...BASE_PATCH,
          reviewPolicy: "ai",
        })
      ).rejects.toThrow("La revisión por AI no está habilitada.");
      expect(
        (await readSettings(fixture.organization.id)).default_review_policy
      ).toBe("none");
      expect(await countAudit(fixture.organization.id)).toBe(0);
    });

    it("admite la revisión manual sin capacidad adicional", async () => {
      const fixture = await createIssuableOrganization();
      await updateOrganizationDefaults(fixture.context, {
        ...BASE_PATCH,
        reviewPolicy: "manual",
      });
      expect(
        (await readSettings(fixture.organization.id)).default_review_policy
      ).toBe("manual");
    });

    it("guarda todas las opciones cuando la Organización sí las tiene", async () => {
      const fixture = await createIssuableOrganization({
        capabilities: {
          ai_review: true,
          evidence_ine: true,
          evidence_video: true,
        },
      });
      await updateOrganizationDefaults(fixture.context, {
        linkDays: 21,
        requiresVideo: true,
        requiresIne: true,
        reviewPolicy: "ai",
      });

      const settings = await readSettings(fixture.organization.id);
      expect(settings.default_link_days).toBe(21);
      expect(settings.default_requires_video).toBe(true);
      expect(settings.default_requires_ine).toBe(true);
      expect(settings.default_review_policy).toBe("ai");
      expect(settings.updated_by).toBe(fixture.account.id);
    });
  });

  describe("versión operativa y auditoría", () => {
    it("crea una versión operativa nueva en cada cambio", async () => {
      const fixture = await createIssuableOrganization();
      const inicial = (await readSettings(fixture.organization.id))
        .operational_version;

      await updateOrganizationDefaults(fixture.context, {
        ...BASE_PATCH,
        linkDays: 10,
      });
      await updateOrganizationDefaults(fixture.context, {
        ...BASE_PATCH,
        linkDays: 11,
      });

      expect(
        (await readSettings(fixture.organization.id)).operational_version
      ).toBe(inicial + 2);
    });

    it("registra una entrada de auditoría con el cambio solicitado", async () => {
      const fixture = await createIssuableOrganization({
        capabilities: { evidence_ine: true },
      });
      const patch: OrganizationDefaultsPatch = {
        linkDays: 12,
        requiresVideo: false,
        requiresIne: true,
        reviewPolicy: "manual",
      };
      await updateOrganizationDefaults(fixture.context, patch);

      const [entry] = await sql<
        {
          account_id: string;
          actor_name: string;
          subject_type: string;
          subject_id: string;
          payload: OrganizationDefaultsPatch;
        }[]
      >`
        SELECT account_id, actor_name, subject_type, subject_id, payload
        FROM audit_entries
        WHERE organization_id = ${fixture.organization.id}
          AND action = 'configuracion_emision_actualizada'
      `;
      expect(entry.account_id).toBe(fixture.account.id);
      expect(entry.actor_name).toBe(fixture.account.fullName);
      expect(entry.subject_type).toBe("organization_settings");
      expect(entry.subject_id).toBe(fixture.organization.id);
      expect(entry.payload).toEqual(patch);
    });
  });

  describe("alcance del cambio", () => {
    it("sólo afecta a las emisiones futuras", async () => {
      const fixture = await createIssuableOrganization({
        capabilities: { evidence_ine: true },
      });
      const anterior = await emitirContrato(fixture.context, fixture);
      const antes = await readContractConfiguration(anterior);
      expect(antes.requires_ine).toBe(false);
      expect(antes.review_policy).toBe("none");

      await updateOrganizationDefaults(fixture.context, {
        linkDays: 14,
        requiresVideo: false,
        requiresIne: true,
        reviewPolicy: "manual",
      });

      // El contexto se resuelve de nuevo, igual que en una petición posterior.
      const contexto = await buildContext(
        fixture.organization.id,
        fixture.account,
        ["administrator", "emitter"],
        { isPrimaryAdmin: true }
      );
      const posterior = await emitirContrato(contexto, fixture);

      const nuevo = await readContractConfiguration(posterior);
      expect(nuevo.requires_ine).toBe(true);
      expect(nuevo.review_policy).toBe("manual");

      // El Contrato ya emitido es una instantánea inmutable.
      expect(await readContractConfiguration(anterior)).toEqual(antes);
    });

    /**
     * ADR-0070: «Un Administrador de la Organización podrá cambiar ese valor
     * predeterminado para emisiones futuras». Hoy `resolveDefaultConfiguration`
     * prefiere siempre `template.defaults.linkDays`, que nunca es nulo, así que
     * el cambio de la Organización jamás alcanza a un Contrato nuevo.
     */
    it(
      "la vigencia predeterminada nueva alcanza a las emisiones futuras",
      async () => {
        const fixture = await createIssuableOrganization();
        await updateOrganizationDefaults(fixture.context, {
          ...BASE_PATCH,
          linkDays: 14,
        });
        const contexto = await buildContext(
          fixture.organization.id,
          fixture.account,
          ["administrator", "emitter"],
          { isPrimaryAdmin: true }
        );
        const contractId = await emitirContrato(contexto, fixture);
        expect((await readContractConfiguration(contractId)).link_days).toBe(14);
      }
    );
  });
});
