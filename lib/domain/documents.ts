import "server-only";
import { sql } from "@/lib/db";
import { canonicalizeJson } from "@/lib/canonical-json";
import { sha256Hex } from "@/lib/crypto/tokens";
import { renderContractPdf } from "@/lib/pdf/contract-pdf";
import { getObjectStorage } from "@/lib/storage";
import { NotFoundError } from "@/lib/domain/errors";
import { loadSignerView } from "@/lib/domain/signer";
import type { ContractStatus } from "@/lib/domain/types";

/**
 * `Ver PDF` bajo demanda, compartido por el portal y el recorrido del Firmante.
 * Antes de la aceptación entrega una Copia de revisión efímera; después conserva
 * una sola Copia contractual aceptada y vuelve a entregar exactamente ese
 * archivo. El PDF nunca contiene el token ni el Enlace contractual.
 */

interface ContractPdfRow {
  id: string;
  reference: string;
  status: ContractStatus;
  classification: string;
  template_name: string;
  organization_name: string;
  contract_markdown: string;
  acceptance_legend: string;
  document_hash: string;
  accepted_at: Date | null;
}

export interface ContractPdfResult {
  buffer: Buffer;
  fileName: string;
}

const ACCEPTED_PDF_KIND = "accepted_pdf";

/**
 * Huella del conjunto de evidencia de un Intento. La usan por igual la Copia
 * contractual aceptada y el Paquete contractual frío, para que las dos
 * representaciones del mismo Contrato impriman el mismo valor.
 */
export function evidencePackageHash(
  evidence: { kind: string; sha256: string }[]
): string {
  return sha256Hex(
    canonicalizeJson(
      [...evidence]
        .sort((a, b) => a.kind.localeCompare(b.kind))
        .map((item) => ({ kind: item.kind, sha256: item.sha256 }))
    )
  );
}

/**
 * `Ver PDF` bajo demanda. Antes de la aceptación produce la representación de
 * revisión; después conserva una sola copia aceptada y la vuelve a entregar
 * idéntica. El PDF nunca contiene el token ni el Enlace contractual.
 */
export async function buildContractPdf(
  organizationId: string,
  contractId: string
): Promise<ContractPdfResult> {
  const [contract] = await sql<ContractPdfRow[]>`
    SELECT c.id, c.reference, c.status, c.classification, c.template_name,
           o.name AS organization_name, c.contract_markdown,
           c.acceptance_legend, c.document_hash, c.accepted_at
    FROM contracts c
    JOIN organizations o ON o.id = c.organization_id
    WHERE c.id = ${contractId} AND c.organization_id = ${organizationId}
  `;
  if (!contract) throw new NotFoundError("No encontramos el Contrato.");
  if (contract.classification === "deleted") {
    throw new NotFoundError("El expediente ya no está disponible en el portal.");
  }

  const fileName = `${contract.reference}.pdf`;

  if (contract.status !== "accepted") {
    const buffer = await renderContractPdf({
      reference: contract.reference,
      organizationName: contract.organization_name,
      templateName: contract.template_name,
      markdown: contract.contract_markdown,
      kind: "review",
    });
    return { buffer, fileName };
  }

  const storage = getObjectStorage();
  const [existing] = await sql<{ object_key: string }[]>`
    SELECT object_key FROM contract_objects
    WHERE contract_id = ${contractId} AND kind = ${ACCEPTED_PDF_KIND}
    ORDER BY created_at
    LIMIT 1
  `;
  if (existing) {
    const stored = await storage.get(existing.object_key);
    return { buffer: stored.body, fileName };
  }

  const [signer] = await sql<{ name: string }[]>`
    SELECT name FROM contract_parties
    WHERE contract_id = ${contractId} AND party_role = 'signer'
  `;
  const [attempt] = await sql<{ id: string; sequence: number }[]>`
    SELECT id, sequence FROM acceptance_attempts
    WHERE contract_id = ${contractId} AND status = 'accepted'
    ORDER BY sequence DESC
    LIMIT 1
  `;
  const evidence = attempt
    ? await sql<{ kind: string; sha256: string }[]>`
        SELECT kind, sha256 FROM evidence_items
        WHERE attempt_id = ${attempt.id}
        ORDER BY kind
      `
    : [];
  const evidenceHash = evidencePackageHash(evidence);

  const buffer = await renderContractPdf({
    reference: contract.reference,
    organizationName: contract.organization_name,
    templateName: contract.template_name,
    markdown: contract.contract_markdown,
    kind: "accepted",
    acceptance: {
      signerName: signer?.name ?? "",
      /* v8 ignore next -- el CHECK `contracts_accepted_needs_timestamp` impide que un Contrato `Aceptado` se quede sin `accepted_at` */
      acceptedAt: contract.accepted_at ?? new Date(),
      legend: contract.acceptance_legend,
      documentHash: contract.document_hash,
      evidenceHash,
      attemptSequence: attempt?.sequence ?? 1,
    },
  });

  const objectKey = `organizaciones/${organizationId}/contratos/${contractId}/contrato-aceptado.pdf`;

  // Una sola copia aceptada: el primer proceso que tome el candado la escribe
  // y los demás vuelven a entregar exactamente ese objeto.
  const stored = await sql.begin(async (tx) => {
    // Dos enteros: el primero reserva el espacio de llaves de `Ver PDF` para
    // que un `hashtext` de otro uso no colisione con el de un Contrato.
    await tx`
      SELECT pg_advisory_xact_lock(
        hashtext(${ACCEPTED_PDF_KIND}), hashtext(${contractId})
      )
    `;
    const [row] = await tx<{ object_key: string }[]>`
      SELECT object_key FROM contract_objects
      WHERE contract_id = ${contractId} AND kind = ${ACCEPTED_PDF_KIND}
      LIMIT 1
    `;
    if (row) return row.object_key;
    await storage.put({
      key: objectKey,
      body: buffer,
      contentType: "application/pdf",
    });
    await tx`
      INSERT INTO contract_objects (
        contract_id, organization_id, kind, object_key, content_type,
        byte_size, sha256, tier
      ) VALUES (
        ${contractId}, ${organizationId}, ${ACCEPTED_PDF_KIND}, ${objectKey},
        'application/pdf', ${buffer.byteLength},
        ${sha256Hex(buffer)}, 'immediate'
      )
    `;
    return objectKey;
  });

  if (stored !== objectKey) {
    const previous = await storage.get(stored);
    return { buffer: previous.body, fileName };
  }
  return { buffer, fileName };
}

/**
 * El Firmante pide su PDF con el token del enlace. Falla cerrada con las mismas
 * reglas del recorrido —enlace vivo, Contrato vigente y Aviso completo— sin
 * depender de que la ruta las haya comprobado antes.
 */
export async function buildContractPdfForToken(
  token: string
): Promise<ContractPdfResult> {
  const view = await loadSignerView(token);
  if (!view.ok) throw new NotFoundError("Este enlace no está disponible.");

  const [contract] = await sql<{ organization_id: string }[]>`
    SELECT organization_id FROM contracts WHERE id = ${view.contractId}
  `;
  /* v8 ignore next 1 -- `loadSignerView` ya resolvió el Contrato por llave foránea */
  if (!contract) throw new NotFoundError("No encontramos el Contrato.");
  return buildContractPdf(contract.organization_id, view.contractId);
}
