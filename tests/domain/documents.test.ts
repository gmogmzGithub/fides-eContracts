import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { DEFAULT_DATABASE_URL, sql } from "@/lib/db";
import type { Sql, Transaction } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto/tokens";
import { getObjectStorage } from "@/lib/storage";
import { cancelContract, deleteContract } from "@/lib/domain/contracts";
import {
  buildContractPdf,
  buildContractPdfForToken,
} from "@/lib/domain/documents";
import type { ContractPdfResult } from "@/lib/domain/documents";
import { createDraft, issueContract, saveDraft } from "@/lib/domain/drafts";
import type { IssuedContractResult, SaveDraftPatch } from "@/lib/domain/drafts";
import { NotFoundError } from "@/lib/domain/errors";
import { acceptContract, markContractWalked } from "@/lib/domain/signer";
import {
  createIssuableOrganization,
  createOrganization,
} from "@/tests/helpers/database";

type Fixture = Awaited<ReturnType<typeof createIssuableOrganization>>;

const PDF_MAGIC = "%PDF-";

async function emitir(
  fixture: Fixture,
  patch: SaveDraftPatch = {}
): Promise<IssuedContractResult> {
  const draftId = await createDraft(fixture.context, {
    templateId: fixture.template.id,
  });
  await saveDraft(fixture.context, draftId, {
    fieldValues: { objeto: "Servicio sintético", monto: "1000" },
    holderId: fixture.holder.id,
    signerId: fixture.signer.id,
    ...patch,
  });
  return issueContract(fixture.context, draftId);
}

/** Recorrido real del Firmante hasta `Aceptado`. */
async function aceptar(token: string): Promise<void> {
  await markContractWalked(token);
  await acceptContract(token, {
    legendAccepted: true,
    declaredName: "Firmante sintético",
    userAgent: "vitest",
  });
}

async function countAcceptedObjects(contractId: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total FROM contract_objects
    WHERE contract_id = ${contractId} AND kind = 'accepted_pdf'
  `;
  return Number(row.total);
}

/**
 * Segunda conexión, independiente del pool de la aplicación: permite sostener
 * una transacción abierta mientras el dominio corre en la conexión normal.
 */
function nuevaConexion(): Sql {
  return postgres(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, {
    max: 1,
    onnotice: () => undefined,
    transform: { undefined: null },
    connection: { search_path: "fides,public" },
  });
}

/** Espera a que otra sesión de esta misma base quede detenida en un candado. */
async function esperarSesionEnEspera(tx: Transaction): Promise<void> {
  const limite = Date.now() + 20_000;
  while (Date.now() < limite) {
    const [fila] = await tx<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
    `;
    if (Number(fila.total) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Ninguna sesión quedó esperando el candado.");
}

describe("PDF contractual bajo demanda", () => {
  describe("buildContractPdf antes de la aceptación", () => {
    it("entrega una Copia de revisión efímera del Contrato pendiente", async () => {
      const fixture = await createIssuableOrganization();
      const issued = await emitir(fixture);

      const result = await buildContractPdf(
        fixture.organization.id,
        issued.contractId
      );

      expect(result.fileName).toBe(`${issued.reference}.pdf`);
      expect(result.buffer.subarray(0, 5).toString("utf8")).toBe(PDF_MAGIC);
      expect(result.buffer.byteLength).toBeGreaterThan(500);
      // La Copia de revisión nunca ingresa al inventario canónico (ADR-0059).
      expect(await countAcceptedObjects(issued.contractId)).toBe(0);
    });

    it("entrega la Copia de revisión también mientras el Contrato está a revisión", async () => {
      const fixture = await createIssuableOrganization({
        roles: ["administrator", "emitter", "reviewer"],
      });
      const issued = await emitir(fixture, { reviewPolicy: "manual" });
      await aceptar(issued.token);

      const [contract] = await sql<{ status: string }[]>`
        SELECT status FROM contracts WHERE id = ${issued.contractId}
      `;
      expect(contract.status).toBe("in_review");

      await buildContractPdf(fixture.organization.id, issued.contractId);
      expect(await countAcceptedObjects(issued.contractId)).toBe(0);
    });

    it("entrega la Copia de revisión de un Contrato cancelado sin conservarla", async () => {
      const fixture = await createIssuableOrganization();
      const issued = await emitir(fixture);
      await cancelContract(fixture.context, issued.contractId, "Monto corregido");

      const result = await buildContractPdf(
        fixture.organization.id,
        issued.contractId
      );
      expect(result.buffer.subarray(0, 5).toString("utf8")).toBe(PDF_MAGIC);
      expect(await countAcceptedObjects(issued.contractId)).toBe(0);
    });
  });

  describe("buildContractPdf después de la aceptación", () => {
    it("conserva una sola Copia contractual aceptada y la devuelve idéntica", async () => {
      const fixture = await createIssuableOrganization();
      const issued = await emitir(fixture);
      await aceptar(issued.token);

      const primera = await buildContractPdf(
        fixture.organization.id,
        issued.contractId
      );
      const segunda = await buildContractPdf(
        fixture.organization.id,
        issued.contractId
      );

      expect(segunda.buffer.equals(primera.buffer)).toBe(true);
      expect(segunda.fileName).toBe(primera.fileName);
      expect(await countAcceptedObjects(issued.contractId)).toBe(1);

      const [object] = await sql<
        {
          object_key: string;
          content_type: string;
          byte_size: number;
          sha256: string;
          tier: string;
          organization_id: string;
        }[]
      >`
        SELECT object_key, content_type, byte_size, sha256, tier, organization_id
        FROM contract_objects
        WHERE contract_id = ${issued.contractId} AND kind = 'accepted_pdf'
      `;
      expect(object.organization_id).toBe(fixture.organization.id);
      expect(object.content_type).toBe("application/pdf");
      expect(object.byte_size).toBe(primera.buffer.byteLength);
      expect(object.sha256).toBe(sha256Hex(primera.buffer));
      expect(object.tier).toBe("immediate");

      // La segunda entrega proviene del objeto conservado, no de otro render.
      const stored = await getObjectStorage().get(object.object_key);
      expect(stored.body.equals(primera.buffer)).toBe(true);
    });

    it("distingue la Copia de revisión de la Copia contractual aceptada", async () => {
      const fixture = await createIssuableOrganization();
      const issued = await emitir(fixture);

      const revision = await buildContractPdf(
        fixture.organization.id,
        issued.contractId
      );
      const revisionDocument = await PDFDocument.load(revision.buffer);
      expect(revisionDocument.getSubject()).toBe(
        "Copia de revisión · Pendiente de aceptación"
      );

      await aceptar(issued.token);
      const [contract] = await sql<{ status: string }[]>`
        SELECT status FROM contracts WHERE id = ${issued.contractId}
      `;
      expect(contract.status).toBe("accepted");

      const aceptada = await buildContractPdf(
        fixture.organization.id,
        issued.contractId
      );
      const aceptadaDocument = await PDFDocument.load(aceptada.buffer);
      expect(aceptadaDocument.getSubject()).toBe("Copia contractual aceptada");
      expect(aceptadaDocument.getTitle()).toContain(issued.reference);
      // El PDF nunca lleva el token ni el Enlace contractual (ADR-0059).
      expect(aceptada.buffer.toString("latin1")).not.toContain(issued.token);
    });
  });

  describe("resistencia de la copia aceptada", () => {
    /**
     * Estado imposible por la ruta real, pero el render tiene ramas defensivas:
     * sin Firmante instantáneo y sin Intento la copia debe producirse igual y
     * conservarse una sola vez. `accepted_at` no se toca: la restricción
     * `contracts_accepted_needs_timestamp` impide que un Contrato aceptado la
     * pierda.
     */
    it("conserva la copia aunque falten datos accesorios del comprobante", async () => {
      const fixture = await createIssuableOrganization();
      const issued = await emitir(fixture);
      await aceptar(issued.token);

      await sql`
        DELETE FROM acceptance_attempts WHERE contract_id = ${issued.contractId}
      `;
      await sql`
        DELETE FROM contract_parties
        WHERE contract_id = ${issued.contractId} AND party_role = 'signer'
      `;
      const result = await buildContractPdf(
        fixture.organization.id,
        issued.contractId
      );
      expect(result.buffer.subarray(0, 5).toString("utf8")).toBe(PDF_MAGIC);
      expect(await countAcceptedObjects(issued.contractId)).toBe(1);

      const repetida = await buildContractPdf(
        fixture.organization.id,
        issued.contractId
      );
      expect(repetida.buffer.equals(result.buffer)).toBe(true);
    });
  });

  describe("`Ver PDF` simultáneo sobre el mismo Contrato aceptado", () => {
    it("dos llamadas a la vez conservan una sola Copia contractual idéntica", async () => {
      const fixture = await createIssuableOrganization();
      const issued = await emitir(fixture);
      await aceptar(issued.token);

      const [primera, segunda] = await Promise.all([
        buildContractPdf(fixture.organization.id, issued.contractId),
        buildContractPdf(fixture.organization.id, issued.contractId),
      ]);

      expect(segunda.buffer.equals(primera.buffer)).toBe(true);
      expect(segunda.fileName).toBe(primera.fileName);
      expect(await countAcceptedObjects(issued.contractId)).toBe(1);

      const [object] = await sql<{ object_key: string; sha256: string }[]>`
        SELECT object_key, sha256 FROM contract_objects
        WHERE contract_id = ${issued.contractId} AND kind = 'accepted_pdf'
      `;
      expect(object.sha256).toBe(sha256Hex(primera.buffer));
      const stored = await getObjectStorage().get(object.object_key);
      expect(stored.body.equals(primera.buffer)).toBe(true);
    });

    /**
     * La llamada que pierde el candado nunca escribe una segunda copia: vuelve
     * a entregar exactamente el objeto que ya quedó conservado, aunque su
     * localizador no sea el que ella misma habría usado.
     */
    it("quien pierde el candado devuelve el objeto ya conservado", async () => {
      const fixture = await createIssuableOrganization();
      const issued = await emitir(fixture);
      await aceptar(issued.token);

      const claveAjena = `organizaciones/${fixture.organization.id}/contratos/${issued.contractId}/copia-conservada.pdf`;
      const cuerpoAjeno = Buffer.from(
        "%PDF-1.7\n% copia conservada sintética\n%%EOF\n",
        "utf8"
      );
      await getObjectStorage().put({
        key: claveAjena,
        body: cuerpoAjeno,
        contentType: "application/pdf",
      });

      let arrancar: () => void = () => undefined;
      const permiso = new Promise<void>((resolve) => {
        arrancar = resolve;
      });
      const perdedor = permiso.then(() =>
        buildContractPdf(fixture.organization.id, issued.contractId)
      );

      const extra = nuevaConexion();
      try {
        await extra.begin(async (tx) => {
          await tx`
            SELECT pg_advisory_xact_lock(
              hashtext(${"accepted_pdf"}), hashtext(${issued.contractId})
            )
          `;
          arrancar();
          await esperarSesionEnEspera(tx);
          await tx`
            INSERT INTO contract_objects (
              contract_id, organization_id, kind, object_key, content_type,
              byte_size, sha256, tier
            ) VALUES (
              ${issued.contractId}, ${fixture.organization.id}, 'accepted_pdf',
              ${claveAjena}, 'application/pdf', ${cuerpoAjeno.byteLength},
              ${sha256Hex(cuerpoAjeno)}, 'immediate'
            )
          `;
        });
      } finally {
        await perdedor.catch(() => undefined);
        await extra.end({ timeout: 5 });
      }

      const entregado: ContractPdfResult = await perdedor;
      expect(entregado.fileName).toBe(`${issued.reference}.pdf`);
      expect(entregado.buffer.equals(cuerpoAjeno)).toBe(true);
      expect(await countAcceptedObjects(issued.contractId)).toBe(1);

      const [object] = await sql<{ object_key: string }[]>`
        SELECT object_key FROM contract_objects
        WHERE contract_id = ${issued.contractId} AND kind = 'accepted_pdf'
      `;
      expect(object.object_key).toBe(claveAjena);

      // Una consulta posterior ya resuelve por el objeto conservado.
      const posterior = await buildContractPdf(
        fixture.organization.id,
        issued.contractId
      );
      expect(posterior.buffer.equals(cuerpoAjeno)).toBe(true);
    });
  });

  describe("aislamiento del expediente", () => {
    it("no encuentra un expediente eliminado", async () => {
      const fixture = await createIssuableOrganization();
      const issued = await emitir(fixture);
      await aceptar(issued.token);
      await deleteContract(fixture.context, issued.contractId);

      await expect(
        buildContractPdf(fixture.organization.id, issued.contractId)
      ).rejects.toThrow(NotFoundError);
      await expect(
        buildContractPdf(fixture.organization.id, issued.contractId)
      ).rejects.toThrow("El expediente ya no está disponible en el portal.");
    });

    it("no encuentra el Contrato desde otra Organización", async () => {
      const fixture = await createIssuableOrganization();
      const otra = await createOrganization();
      const issued = await emitir(fixture);

      await expect(
        buildContractPdf(otra.id, issued.contractId)
      ).rejects.toThrow(NotFoundError);
      await expect(
        buildContractPdf(otra.id, issued.contractId)
      ).rejects.toThrow("No encontramos el Contrato.");
    });

    it("no encuentra un Contrato inexistente", async () => {
      const fixture = await createIssuableOrganization();
      await expect(
        buildContractPdf(fixture.organization.id, crypto.randomUUID())
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("buildContractPdfForToken", () => {
    it("resuelve la Copia de revisión desde el token del enlace", async () => {
      const fixture = await createIssuableOrganization();
      const issued = await emitir(fixture);

      const result = await buildContractPdfForToken(issued.token);
      expect(result.fileName).toBe(`${issued.reference}.pdf`);
      expect(result.buffer.subarray(0, 5).toString("utf8")).toBe(PDF_MAGIC);
      expect(await countAcceptedObjects(issued.contractId)).toBe(0);
    });

    it("entrega el mismo artefacto que ve la Organización después de aceptar", async () => {
      const fixture = await createIssuableOrganization();
      const issued = await emitir(fixture);
      await aceptar(issued.token);

      const portal = await buildContractPdf(
        fixture.organization.id,
        issued.contractId
      );
      const firmante = await buildContractPdfForToken(issued.token);

      expect(firmante.buffer.equals(portal.buffer)).toBe(true);
      expect(firmante.fileName).toBe(portal.fileName);
      expect(await countAcceptedObjects(issued.contractId)).toBe(1);
    });

    it("no entrega el PDF al Firmante cuando venció el token ya aceptado", async () => {
      const fixture = await createIssuableOrganization();
      const issued = await emitir(fixture);
      await aceptar(issued.token);
      await sql`
        UPDATE contract_links SET expires_at = NOW() - INTERVAL '1 minute'
        WHERE contract_id = ${issued.contractId}
      `;

      await expect(buildContractPdfForToken(issued.token)).rejects.toThrow(
        NotFoundError
      );
    });

    it("no encuentra el Contrato con un token desconocido", async () => {
      await createIssuableOrganization();
      await expect(
        buildContractPdfForToken("token-que-no-existe")
      ).rejects.toThrow(NotFoundError);
      await expect(buildContractPdfForToken("")).rejects.toThrow(NotFoundError);
    });
  });
});
