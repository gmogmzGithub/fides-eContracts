import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { AuthorizationError, NotFoundError } from "@/lib/domain/errors";
import { readEvidenceFile } from "@/lib/domain/evidence";
import { createDraft, issueContract, saveDraft } from "@/lib/domain/drafts";
import type { IssuedContractResult } from "@/lib/domain/drafts";
import { deleteContract } from "@/lib/domain/contracts";
import { markContractWalked, storeEvidence } from "@/lib/domain/signer";
import {
  addMembership,
  buildContext,
  createAccount,
  createIssuableOrganization,
} from "@/tests/helpers/database";

type Fixture = Awaited<ReturnType<typeof createIssuableOrganization>>;

const IMAGEN = Buffer.from("contenido sintetico de una captura de INE");

async function organizacionConIne(): Promise<Fixture> {
  return createIssuableOrganization({
    capabilities: { evidence_ine: true },
    defaults: { requiresIne: true },
  });
}

async function emitirConIne(fixture: Fixture): Promise<IssuedContractResult> {
  const draftId = await createDraft(fixture.context, {
    templateId: fixture.template.id,
  });
  await saveDraft(fixture.context, draftId, {
    fieldValues: { objeto: "Servicio sintético", monto: "1000" },
    holderId: fixture.holder.id,
    signerId: fixture.signer.id,
    requiresIne: true,
  });
  return issueContract(fixture.context, draftId);
}

async function capturarIne(token: string): Promise<void> {
  await markContractWalked(token);
  for (const kind of ["ine_front", "ine_back"] as const) {
    await storeEvidence(token, kind, {
      buffer: IMAGEN,
      contentType: "image/jpeg",
      fileName: `${kind}.jpg`,
    });
  }
}

async function idDeEvidencia(contractId: string, kind: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM evidence_items
    WHERE contract_id = ${contractId} AND kind = ${kind}
  `;
  return row.id;
}

describe("readEvidenceFile", () => {
  it("entrega el archivo a un Administrador con su nombre y tipo", async () => {
    const fixture = await organizacionConIne();
    const issued = await emitirConIne(fixture);
    await capturarIne(issued.token);

    const file = await readEvidenceFile(
      fixture.context,
      await idDeEvidencia(issued.contractId, "ine_front")
    );

    expect(file.kind).toBe("ine_front");
    expect(file.contentType).toBe("image/jpeg");
    expect(file.body.equals(IMAGEN)).toBe(true);
    expect(file.fileName).toBe(`${issued.reference}-ine_front.jpg`);
    expect(file.sha256).toHaveLength(64);
  });

  it("deja constancia de cada consulta de evidencia", async () => {
    const fixture = await organizacionConIne();
    const issued = await emitirConIne(fixture);
    await capturarIne(issued.token);
    const evidenceId = await idDeEvidencia(issued.contractId, "ine_back");

    await readEvidenceFile(fixture.context, evidenceId);

    const [audit] = await sql<
      { action: string; subject_id: string; payload: Record<string, unknown> }[]
    >`
      SELECT action, subject_id, payload FROM audit_entries
      WHERE action = 'evidencia_consultada'
    `;
    expect(audit.subject_id).toBe(evidenceId);
    expect(audit.payload.tipo).toBe("ine_back");
    expect(audit.payload.referencia).toBe(issued.reference);
  });

  it("no abre la evidencia a un Emisor sin rol de Administrador o Revisor", async () => {
    const fixture = await organizacionConIne();
    const issued = await emitirConIne(fixture);
    await capturarIne(issued.token);
    const evidenceId = await idDeEvidencia(issued.contractId, "ine_front");

    const emisor = await createAccount();
    await addMembership(fixture.organization.id, emisor.id, ["emitter"]);
    const contexto = await buildContext(fixture.organization.id, emisor, [
      "emitter",
    ]);

    await expect(readEvidenceFile(contexto, evidenceId)).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it("abre al Revisor sólo la evidencia asociada a una tarea de revisión", async () => {
    const fixture = await organizacionConIne();
    const issued = await emitirConIne(fixture);
    await capturarIne(issued.token);
    const evidenceId = await idDeEvidencia(issued.contractId, "ine_front");

    const revisor = await createAccount();
    await addMembership(fixture.organization.id, revisor.id, ["reviewer"]);
    const contexto = await buildContext(fixture.organization.id, revisor, [
      "reviewer",
    ]);

    await expect(readEvidenceFile(contexto, evidenceId)).rejects.toBeInstanceOf(
      AuthorizationError
    );

    const [attempt] = await sql<{ id: string }[]>`
      SELECT id FROM acceptance_attempts WHERE contract_id = ${issued.contractId}
    `;
    await sql`
      INSERT INTO review_tasks (attempt_id, contract_id, organization_id)
      VALUES (${attempt.id}, ${issued.contractId}, ${fixture.organization.id})
    `;

    const file = await readEvidenceFile(contexto, evidenceId);
    expect(file.body.equals(IMAGEN)).toBe(true);
  });

  it("no entrega la evidencia de otra Organización", async () => {
    const primera = await organizacionConIne();
    const issued = await emitirConIne(primera);
    await capturarIne(issued.token);
    const evidenceId = await idDeEvidencia(issued.contractId, "ine_front");

    const segunda = await organizacionConIne();
    await expect(
      readEvidenceFile(segunda.context, evidenceId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("no encuentra una evidencia inexistente", async () => {
    const fixture = await organizacionConIne();
    await expect(
      readEvidenceFile(fixture.context, crypto.randomUUID())
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deja de entregar la evidencia de un expediente eliminado", async () => {
    const fixture = await organizacionConIne();
    const issued = await emitirConIne(fixture);
    await capturarIne(issued.token);
    const evidenceId = await idDeEvidencia(issued.contractId, "ine_front");

    await deleteContract(fixture.context, issued.contractId);

    await expect(
      readEvidenceFile(fixture.context, evidenceId)
    ).rejects.toThrow("El expediente ya no está disponible en el portal.");
  });

  // La restricción `evidence_items_object_key_by_kind` impide dejarlo en NULL,
  // así que el caso alcanzable es un localizador vacío.
  it("no entrega una evidencia sin archivo conservado", async () => {
    const fixture = await organizacionConIne();
    const issued = await emitirConIne(fixture);
    await capturarIne(issued.token);
    const evidenceId = await idDeEvidencia(issued.contractId, "ine_front");
    await sql`UPDATE evidence_items SET object_key = '' WHERE id = ${evidenceId}`;

    await expect(
      readEvidenceFile(fixture.context, evidenceId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("nombra el archivo según el tipo de contenido conservado", async () => {
    const fixture = await organizacionConIne();
    const issued = await emitirConIne(fixture);
    await capturarIne(issued.token);
    const evidenceId = await idDeEvidencia(issued.contractId, "ine_front");

    // Misma tabla que usa el paquete frío: el archivo suelto y el que va dentro
    // del ZIP se llaman igual, y un tipo desconocido cae en `.bin`.
    const extensiones: [string, string][] = [
      ["image/png", ".png"],
      ["image/webp", ".webp"],
      ["image/heic", ".heic"],
      ["video/mp4", ".mp4"],
      ["video/webm", ".webm"],
      ["application/octet-stream", ".bin"],
    ];
    for (const [contentType, extension] of extensiones) {
      await sql`
        UPDATE evidence_items SET content_type = ${contentType} WHERE id = ${evidenceId}
      `;
      const file = await readEvidenceFile(fixture.context, evidenceId);
      expect(file.fileName).toBe(`${issued.reference}-ine_front${extension}`);
    }
  });
});
