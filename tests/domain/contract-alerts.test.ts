import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { listRecentContractAlerts } from "@/lib/domain/contract-alerts";
import { createDraft, issueContract, saveDraft } from "@/lib/domain/drafts";
import { recordContractEvent } from "@/lib/domain/operations";
import {
  buildContext,
  createAccount,
  createIssuableOrganization,
} from "@/tests/helpers/database";

async function issueFixture() {
  const fixture = await createIssuableOrganization();
  const draftId = await createDraft(fixture.context, {
    templateId: fixture.template.id,
  });
  await saveDraft(fixture.context, draftId, {
    holderId: fixture.holder.id,
    signerId: fixture.signer.id,
    fieldValues: { objeto: "Alertas", monto: "100" },
  });
  const issued = await issueContract(fixture.context, draftId);
  return { fixture, issued };
}

describe("actividad reciente de Contratos", () => {
  it("muestra sólo actividad que se comunica como alerta", async () => {
    const { fixture, issued } = await issueFixture();
    await recordContractEvent({
      contractId: issued.contractId,
      organizationId: fixture.organization.id,
      type: "enlace_abierto",
      actorKind: "signer",
    });
    await recordContractEvent({
      contractId: issued.contractId,
      organizationId: fixture.organization.id,
      type: "evento_interno_sin_alerta",
      actorKind: "system",
    });

    const rows = await listRecentContractAlerts(fixture.context);
    expect(rows.map((row) => row.message)).toEqual([
      "Fue abierto",
      "Quedó pendiente de aceptación",
    ]);
    expect(rows[0]).toMatchObject({
      contractId: issued.contractId,
      reference: issued.reference,
      eventType: "enlace_abierto",
    });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("acota el límite y excluye Eliminados", async () => {
    const { fixture, issued } = await issueFixture();
    for (let index = 0; index < 14; index += 1) {
      await recordContractEvent({
        contractId: issued.contractId,
        organizationId: fixture.organization.id,
        type: "contrato_recorrido",
        actorKind: "signer",
        payload: { index },
      });
    }
    expect(await listRecentContractAlerts(fixture.context, 99)).toHaveLength(12);
    expect(await listRecentContractAlerts(fixture.context, 0)).toHaveLength(1);

    await sql`
      UPDATE contracts
      SET classification = 'deleted', deleted_at = NOW()
      WHERE id = ${issued.contractId}
    `;
    expect(await listRecentContractAlerts(fixture.context)).toEqual([]);
  });

  it("exige un rol que opere Contratos", async () => {
    const { fixture } = await issueFixture();
    const reviewerAccount = await createAccount();
    const reviewer = await buildContext(
      fixture.organization.id,
      reviewerAccount,
      ["reviewer"]
    );
    await expect(listRecentContractAlerts(reviewer)).rejects.toThrow();
  });
});
