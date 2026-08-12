import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { AuthorizationError, NotFoundError } from "@/lib/domain/errors";
import { createFromPrevious } from "@/lib/domain/contracts";
import { createDraft, getDraft, issueContract, saveDraft } from "@/lib/domain/drafts";
import {
  listRecentContracts,
  setContractFavorite,
} from "@/lib/domain/recent-contracts";
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
    fieldValues: { objeto: "Servicio reutilizable", monto: "2500" },
  });
  const issued = await issueContract(fixture.context, draftId);
  return { fixture, issued };
}

describe("Recientes y Favoritos", () => {
  it("lista, busca y reutiliza un Contrato sin copiar su estado", async () => {
    const { fixture, issued } = await issueFixture();
    const rows = await listRecentContracts(fixture.context);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: issued.contractId,
      reference: issued.reference,
      favorite: false,
      status: "pending",
    });
    expect(rows[0].holderName).toBe(fixture.holder.name);
    expect(rows[0].signerName).toBe(fixture.signer.name);
    expect(rows[0].issuedAt).toBeInstanceOf(Date);
    expect(rows[0].updatedAt).toBeInstanceOf(Date);

    expect(await listRecentContracts(fixture.context, "reutilizable")).toHaveLength(1);
    expect(await listRecentContracts(fixture.context, "sin coincidencias")).toEqual([]);

    const reusedId = await createFromPrevious(fixture.context, issued.contractId);
    const reused = await getDraft(fixture.context, reusedId);
    expect(reused.fieldValues).toEqual({ objeto: "Servicio reutilizable", monto: "2500" });
    expect(reused.holder?.id).toBe(fixture.holder.id);
    expect(reused.signer?.id).toBe(fixture.signer.id);
    expect(reused.originReason).toBe("reuse");
    expect(reused.configuration).toEqual(reused.defaults);
  });

  it("ordena Favoritos primero y permite marcar y desmarcar idempotentemente", async () => {
    const { fixture, issued } = await issueFixture();
    const secondDraft = await createDraft(fixture.context, {
      templateId: fixture.template.id,
    });
    await saveDraft(fixture.context, secondDraft, {
      holderId: fixture.holder.id,
      signerId: fixture.signer.id,
      fieldValues: { objeto: "Mas reciente", monto: "3000" },
    });
    const second = await issueContract(fixture.context, secondDraft);

    await setContractFavorite(fixture.context, issued.contractId, true);
    await setContractFavorite(fixture.context, issued.contractId, true);
    let rows = await listRecentContracts(fixture.context);
    expect(rows.map((row) => row.id)).toEqual([issued.contractId, second.contractId]);
    expect(rows[0].favorite).toBe(true);

    await setContractFavorite(fixture.context, issued.contractId, false);
    await setContractFavorite(fixture.context, issued.contractId, false);
    rows = await listRecentContracts(fixture.context);
    expect(rows.every((row) => !row.favorite)).toBe(true);

    const actions = await sql<{ action: string }[]>`
      SELECT action FROM audit_entries
      WHERE subject_id = ${issued.contractId}
        AND action LIKE 'contrato_%favorito'
      ORDER BY created_at
    `;
    expect(actions.map((row) => row.action)).toEqual([
      "contrato_marcado_favorito",
      "contrato_marcado_favorito",
      "contrato_desmarcado_favorito",
      "contrato_desmarcado_favorito",
    ]);
  });

  it("puede guardar como Favorito al generar el Contrato", async () => {
    const fixture = await createIssuableOrganization();
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
    });
    await saveDraft(fixture.context, draftId, {
      holderId: fixture.holder.id,
      signerId: fixture.signer.id,
      fieldValues: { objeto: "Servicio favorito", monto: "2500" },
    });

    const issued = await issueContract(fixture.context, draftId, {
      markFavorite: true,
    });

    const rows = await listRecentContracts(fixture.context, "", {
      onlyFavorites: true,
    });
    expect(rows.map((row) => row.id)).toEqual([issued.contractId]);

    const companeroAccount = await createAccount();
    const companero = await buildContext(
      fixture.organization.id,
      companeroAccount,
      ["emitter"]
    );
    expect(
      await listRecentContracts(companero, "", { onlyFavorites: true })
    ).toEqual([]);
  });

  it("acota la lista a los Favoritos personales de quien consulta", async () => {
    const { fixture, issued } = await issueFixture();
    const otroDraft = await createDraft(fixture.context, {
      templateId: fixture.template.id,
    });
    await saveDraft(fixture.context, otroDraft, {
      holderId: fixture.holder.id,
      signerId: fixture.signer.id,
      fieldValues: { objeto: "Sin marcar", monto: "1000" },
    });
    await issueContract(fixture.context, otroDraft);

    expect(
      await listRecentContracts(fixture.context, "", { onlyFavorites: true })
    ).toEqual([]);

    await setContractFavorite(fixture.context, issued.contractId, true);
    const favoritos = await listRecentContracts(fixture.context, "", {
      onlyFavorites: true,
    });
    expect(favoritos.map((row) => row.id)).toEqual([issued.contractId]);

    // El Favorito es de la persona, no de la Organización.
    const companeroAccount = await createAccount();
    const companero = await buildContext(
      fixture.organization.id,
      companeroAccount,
      ["emitter"]
    );
    expect(
      await listRecentContracts(companero, "", { onlyFavorites: true })
    ).toEqual([]);
    expect(await listRecentContracts(companero)).toHaveLength(2);

    expect(
      await listRecentContracts(fixture.context, "", {
        onlyFavorites: true,
        limit: 1,
      })
    ).toHaveLength(1);
  });

  it("no cruza Organizaciones, Eliminados ni permisos", async () => {
    const { fixture, issued } = await issueFixture();
    const other = await createIssuableOrganization();
    await expect(
      setContractFavorite(other.context, issued.contractId, true)
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setContractFavorite(other.context, issued.contractId, false)
    ).rejects.toBeInstanceOf(NotFoundError);

    const reviewerAccount = await createAccount();
    const reviewer = await buildContext(
      fixture.organization.id,
      reviewerAccount,
      ["reviewer"]
    );
    await expect(listRecentContracts(reviewer)).rejects.toBeInstanceOf(
      AuthorizationError
    );
    await expect(
      setContractFavorite(reviewer, issued.contractId, true)
    ).rejects.toBeInstanceOf(AuthorizationError);

    await sql`
      UPDATE contracts
      SET classification = 'deleted', deleted_at = NOW()
      WHERE id = ${issued.contractId}
    `;
    expect(await listRecentContracts(fixture.context)).toEqual([]);
    await expect(
      createFromPrevious(fixture.context, issued.contractId)
    ).rejects.toThrow("Este Contrato está en Eliminados.");
  });

  it("tolera un Contrato sin filas de Partes al presentar Recientes", async () => {
    const { fixture, issued } = await issueFixture();
    await sql`DELETE FROM contract_parties WHERE contract_id = ${issued.contractId}`;
    const [row] = await listRecentContracts(fixture.context);
    expect(row.holderName).toBe("");
    expect(row.signerName).toBe("");
  });

  it("la base impide Favoritos cruzados y los borra al revocar el Acceso", async () => {
    const { fixture, issued } = await issueFixture();
    const other = await createIssuableOrganization();

    await expect(
      sql`
        INSERT INTO contract_favorites (organization_id, contract_id, account_id)
        VALUES (
          ${other.organization.id}, ${issued.contractId}, ${fixture.account.id}
        )
      `
    ).rejects.toThrow();

    await setContractFavorite(fixture.context, issued.contractId, true);
    await sql`
      DELETE FROM organization_members
      WHERE organization_id = ${fixture.organization.id}
        AND account_id = ${fixture.account.id}
    `;
    const [remaining] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM contract_favorites
      WHERE contract_id = ${issued.contractId}
    `;
    expect(remaining.total).toBe("0");
  });
});
