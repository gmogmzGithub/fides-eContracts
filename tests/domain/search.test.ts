import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import type { OrganizationContext } from "@/lib/auth/guards";
import {
  cancelContract,
  createFolder,
  deleteContract,
  listFolders,
  moveToFolder,
  setArchived,
} from "@/lib/domain/contracts";
import { createDraft, issueContract, saveDraft } from "@/lib/domain/drafts";
import { AuthorizationError } from "@/lib/domain/errors";
import {
  MAX_HIGHLIGHTED_FIELDS,
  countContracts,
  listEmitters,
  searchContracts,
} from "@/lib/domain/search";
import type { ContractRow } from "@/lib/domain/search";
import { acceptContract, markContractWalked } from "@/lib/domain/signer";
import type { ReviewPolicy } from "@/lib/domain/types";
import {
  addMembership,
  buildContext,
  createAccount,
  createCounterpartyRow,
  createIssuableOrganization,
  createOrganization,
  createPrivacyNotice,
  createTemplate,
} from "@/tests/helpers/database";
import type { FieldSeed, OrganizationFixture } from "@/tests/helpers/database";

interface IssueOptions {
  values?: Record<string, string>;
  folderId?: string | null;
  reviewPolicy?: ReviewPolicy;
}

interface IssuedFixture {
  contractId: string;
  reference: string;
  token: string;
}

/**
 * Emite un Contrato por el camino real del producto: Borrador, captura y
 * `Generar enlace`. Nunca inserta filas de `contracts` a mano.
 */
async function emitir(
  context: OrganizationContext,
  templateId: string,
  holderId: string,
  signerId: string,
  options: IssueOptions = {}
): Promise<IssuedFixture> {
  const draftId = await createDraft(context, { templateId });
  await saveDraft(context, draftId, {
    holderId,
    signerId,
    folderId: options.folderId ?? null,
    reviewPolicy: options.reviewPolicy,
    fieldValues: options.values ?? { objeto: "Servicio sintético", monto: "1000" },
  });
  const issued = await issueContract(context, draftId);
  return {
    contractId: issued.contractId,
    reference: issued.reference,
    token: issued.token,
  };
}

/** Recorrido del Firmante hasta `Aceptar contrato`. */
async function aceptar(token: string): Promise<"accepted" | "in_review"> {
  await markContractWalked(token);
  const { result } = await acceptContract(token, { legendAccepted: true });
  return result;
}

async function emitterContext(
  organization: OrganizationFixture,
  fullName: string
): Promise<OrganizationContext> {
  const account = await createAccount({ fullName });
  await addMembership(organization.id, account.id, ["emitter"]);
  return buildContext(organization.id, account, ["emitter"]);
}

async function reviewerContext(
  organization: OrganizationFixture
): Promise<OrganizationContext> {
  const account = await createAccount();
  await addMembership(organization.id, account.id, ["reviewer"]);
  return buildContext(organization.id, account, ["reviewer"]);
}

/** Organización completa con una plantilla a la medida de cada prueba. */
async function organizacionConPlantilla(options: {
  templateName?: string;
  fields: FieldSeed[];
  markdown: string;
  holderName?: string;
  signerName?: string;
}) {
  const organization = await createOrganization();
  const account = await createAccount();
  await addMembership(organization.id, account.id, ["administrator", "emitter"]);
  const context = await buildContext(organization.id, account, [
    "administrator",
    "emitter",
  ]);
  const template = await createTemplate(organization.id, {
    name: options.templateName,
    fields: options.fields,
    markdown: options.markdown,
  });
  await createPrivacyNotice(organization.id);
  const holder = await createCounterpartyRow(organization.id, {
    name: options.holderName ?? "Titular Sintético",
    personKind: "moral",
  });
  const signer = await createCounterpartyRow(organization.id, {
    name: options.signerName ?? "Firmante Sintético",
  });
  return { organization, account, context, template, holder, signer };
}

function ids(rows: ContractRow[]): string[] {
  return rows.map((row) => row.id);
}

describe("Buscador contractual", () => {
  describe("paginación", () => {
    it("entrega páginas de 20 con total y número de páginas correctos", async () => {
      const fixture = await createIssuableOrganization();
      const emitidos: string[] = [];
      for (let index = 0; index < 21; index += 1) {
        const issued = await emitir(
          fixture.context,
          fixture.template.id,
          fixture.holder.id,
          fixture.signer.id,
          { values: { objeto: `Servicio ${index}`, monto: `${100 + index}` } }
        );
        emitidos.push(issued.contractId);
      }

      const primera = await searchContracts(fixture.context, {
        classification: "active",
      });
      expect(primera.rows).toHaveLength(20);
      expect(primera.total).toBe(21);
      expect(primera.page).toBe(1);
      expect(primera.pages).toBe(2);

      const segunda = await searchContracts(fixture.context, {
        classification: "active",
        page: 2,
      });
      expect(segunda.rows).toHaveLength(1);
      expect(segunda.total).toBe(21);
      expect(segunda.pages).toBe(2);

      // Ninguna página repite un Expediente y juntas cubren el total.
      const primeros = new Set(ids(primera.rows));
      const segundos = ids(segunda.rows);
      expect(segundos.some((id) => primeros.has(id))).toBe(false);
      expect(new Set([...primeros, ...segundos]).size).toBe(21);
      // La página 1 muestra los 20 más recientes y deja el más antiguo al final.
      expect(segundos).toEqual([emitidos[0]]);
    });

    it("normaliza una página inválida a la primera", async () => {
      const fixture = await createIssuableOrganization();
      await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );

      const cero = await searchContracts(fixture.context, {
        classification: "active",
        page: 0,
      });
      expect(cero.page).toBe(1);
      expect(cero.rows).toHaveLength(1);

      const negativa = await searchContracts(fixture.context, {
        classification: "active",
        page: -3,
      });
      expect(negativa.page).toBe(1);
      expect(negativa.rows).toHaveLength(1);
    });

    it("devuelve una lista vacía cuando no hay Contratos", async () => {
      const fixture = await createIssuableOrganization();
      const resultado = await searchContracts(fixture.context, {
        classification: "active",
      });
      expect(resultado.rows).toEqual([]);
      expect(resultado.total).toBe(0);
      expect(resultado.pages).toBe(1);
    });
  });

  describe("orden por actividad más reciente", () => {
    it("ordena de la actividad más reciente a la más antigua", async () => {
      const fixture = await createIssuableOrganization();
      const primero = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );
      const segundo = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );
      const tercero = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );

      const recienEmitidos = await searchContracts(fixture.context, {
        classification: "active",
      });
      expect(ids(recienEmitidos.rows)).toEqual([
        tercero.contractId,
        segundo.contractId,
        primero.contractId,
      ]);

      // Una actividad posterior sobre el más antiguo lo devuelve al principio.
      await createFolder(fixture.context, "Operación diaria");
      const [carpeta] = await listFolders(fixture.organization.id);
      await moveToFolder(fixture.context, primero.contractId, carpeta.id);
      await sql`
        UPDATE contracts
        SET updated_at = clock_timestamp() + INTERVAL '1 second'
        WHERE id = ${primero.contractId}
      `;

      const conActividad = await searchContracts(fixture.context, {
        classification: "active",
      });
      expect(ids(conActividad.rows)).toEqual([
        primero.contractId,
        tercero.contractId,
        segundo.contractId,
      ]);
    });
  });

  describe("búsqueda de texto libre", () => {
    async function escenario() {
      const base = await organizacionConPlantilla({
        templateName: "Traslado programado",
        holderName: "Aerolinea Quetzal del Sureste",
        signerName: "Marisol Iturbide",
        fields: [
          { key: "placas", label: "Placas", searchable: true, highlighted: true },
          {
            key: "notas",
            label: "Notas internas",
            dataType: "longtext",
            searchable: false,
            required: false,
          },
        ],
        markdown: [
          "# Traslado programado",
          "",
          "Clausula decima. La rescision anticipada genera pena convencional",
          "y la responsabilidad solidaria de los obligados.",
          "",
          "Unidad con placas {{placas}}.",
          "",
          "Anotaciones {{notas}}.",
        ].join("\n"),
      });
      const issued = await emitir(
        base.context,
        base.template.id,
        base.holder.id,
        base.signer.id,
        { values: { placas: "XZ-4471", notas: "asuntoconfidencialomega" } }
      );
      return { ...base, issued };
    }

    async function buscar(
      context: OrganizationContext,
      query: string
    ): Promise<string[]> {
      const resultado = await searchContracts(context, {
        classification: "active",
        query,
      });
      return ids(resultado.rows);
    }

    it("encuentra por Referencia contractual", async () => {
      const escena = await escenario();
      expect(await buscar(escena.context, escena.issued.reference)).toEqual([
        escena.issued.contractId,
      ]);
      expect(
        await buscar(escena.context, escena.issued.reference.toLowerCase())
      ).toEqual([escena.issued.contractId]);
    });

    it("encuentra por Titular contractual y por Firmante", async () => {
      const escena = await escenario();
      expect(await buscar(escena.context, "quetzal")).toEqual([
        escena.issued.contractId,
      ]);
      expect(await buscar(escena.context, "Iturbide")).toEqual([
        escena.issued.contractId,
      ]);
    });

    it("encuentra por el valor de un Campo contractual buscable", async () => {
      const escena = await escenario();
      expect(await buscar(escena.context, "XZ-4471")).toEqual([
        escena.issued.contractId,
      ]);
    });

    it("no indexa cláusulas jurídicas ni el Markdown del Contrato", async () => {
      const escena = await escenario();
      const [row] = await sql<{ markdown: string }[]>`
        SELECT contract_markdown AS markdown FROM contracts
        WHERE id = ${escena.issued.contractId}
      `;
      expect(row.markdown).toContain("rescision anticipada");

      expect(await buscar(escena.context, "rescision anticipada")).toEqual([]);
      expect(await buscar(escena.context, "responsabilidad solidaria")).toEqual([]);
    });

    it("no indexa el valor de un Campo contractual no buscable", async () => {
      const escena = await escenario();
      const [row] = await sql<{ values: Record<string, string> }[]>`
        SELECT field_values AS values FROM contracts
        WHERE id = ${escena.issued.contractId}
      `;
      expect(row.values.notas).toBe("asuntoconfidencialomega");

      expect(await buscar(escena.context, "asuntoconfidencialomega")).toEqual([]);
    });

    it("no devuelve nada cuando el texto no coincide", async () => {
      const escena = await escenario();
      expect(await buscar(escena.context, "texto-que-no-existe")).toEqual([]);
    });

    it("ignora un texto compuesto sólo de espacios", async () => {
      const escena = await escenario();
      expect(await buscar(escena.context, "   ")).toEqual([
        escena.issued.contractId,
      ]);
    });

    it("trata los comodines como literales", async () => {
      const escena = await escenario();
      expect(await buscar(escena.context, "%")).toEqual([]);
      expect(await buscar(escena.context, "_")).toEqual([]);
    });
  });

  describe("filtros", () => {
    async function escenarioFiltros() {
      const organization = await createOrganization();
      const account = await createAccount({ fullName: "Emisora Principal" });
      await addMembership(organization.id, account.id, [
        "administrator",
        "emitter",
      ]);
      const principal = await buildContext(organization.id, account, [
        "administrator",
        "emitter",
      ]);
      const secundaria = await emitterContext(organization, "Emisor Secundario");
      const plantillaA = await createTemplate(organization.id, {
        name: "Plantilla A",
      });
      const plantillaB = await createTemplate(organization.id, {
        name: "Plantilla B",
      });
      await createPrivacyNotice(organization.id);
      const holder = await createCounterpartyRow(organization.id, {
        personKind: "moral",
      });
      const signer = await createCounterpartyRow(organization.id);

      await createFolder(principal, "Carpeta Uno");
      const [carpeta] = await listFolders(organization.id);

      const enCarpeta = await emitir(
        principal,
        plantillaA.id,
        holder.id,
        signer.id,
        { folderId: carpeta.id }
      );
      const cancelado = await emitir(
        principal,
        plantillaB.id,
        holder.id,
        signer.id
      );
      const deOtroEmisor = await emitir(
        secundaria,
        plantillaA.id,
        holder.id,
        signer.id
      );
      await cancelContract(principal, cancelado.contractId, "Prueba");

      return {
        organization,
        principal,
        secundaria,
        plantillaA,
        plantillaB,
        carpeta,
        enCarpeta,
        cancelado,
        deOtroEmisor,
      };
    }

    it("filtra por Estado contractual", async () => {
      const escena = await escenarioFiltros();

      const pendientes = await searchContracts(escena.principal, {
        classification: "active",
        status: "pending",
      });
      expect(new Set(ids(pendientes.rows))).toEqual(
        new Set([escena.enCarpeta.contractId, escena.deOtroEmisor.contractId])
      );
      expect(pendientes.total).toBe(2);

      const cancelados = await searchContracts(escena.principal, {
        classification: "active",
        status: "cancelled",
      });
      expect(ids(cancelados.rows)).toEqual([escena.cancelado.contractId]);
    });

    it("filtra por Contrato-plantilla", async () => {
      const escena = await escenarioFiltros();

      const deA = await searchContracts(escena.principal, {
        classification: "active",
        templateId: escena.plantillaA.id,
      });
      expect(new Set(ids(deA.rows))).toEqual(
        new Set([escena.enCarpeta.contractId, escena.deOtroEmisor.contractId])
      );
      expect(deA.rows.every((row) => row.templateName === "Plantilla A")).toBe(
        true
      );

      const deB = await searchContracts(escena.principal, {
        classification: "active",
        templateId: escena.plantillaB.id,
      });
      expect(ids(deB.rows)).toEqual([escena.cancelado.contractId]);
    });

    it("filtra por Carpeta operativa", async () => {
      const escena = await escenarioFiltros();

      const enCarpeta = await searchContracts(escena.principal, {
        classification: "active",
        folderId: escena.carpeta.id,
      });
      expect(ids(enCarpeta.rows)).toEqual([escena.enCarpeta.contractId]);
      expect(enCarpeta.rows[0].folderName).toBe("Carpeta Uno");

      const sinFiltro = await searchContracts(escena.principal, {
        classification: "active",
      });
      expect(
        sinFiltro.rows.filter((row) => row.folderId === null)
      ).toHaveLength(2);
    });

    it("filtra por Emisor", async () => {
      const escena = await escenarioFiltros();
      const emisores = await listEmitters(escena.principal);
      const secundario = emisores.find(
        (item) => item.name === "Emisor Secundario"
      );

      const resultado = await searchContracts(escena.principal, {
        classification: "active",
        emitterId: secundario?.id,
      });
      expect(ids(resultado.rows)).toEqual([escena.deOtroEmisor.contractId]);
      expect(resultado.rows[0].emitterName).toBe("Emisor Secundario");
    });

    it("filtra por rango de fechas de emisión", async () => {
      const escena = await escenarioFiltros();
      // Un Contrato antiguo no puede emitirse hacia atrás desde el producto:
      // se envejece su fecha de emisión para poder acotar el rango.
      await sql`
        UPDATE contracts
        SET issued_at = NOW() - INTERVAL '10 days',
            updated_at = NOW() - INTERVAL '10 days'
        WHERE id = ${escena.deOtroEmisor.contractId}
      `;
      const [fechas] = await sql<{ hoy: string; hace5: string }[]>`
        SELECT CURRENT_DATE::TEXT AS hoy, (CURRENT_DATE - 5)::TEXT AS hace5
      `;

      const desdeHoy = await searchContracts(escena.principal, {
        classification: "active",
        from: fechas.hoy,
      });
      expect(new Set(ids(desdeHoy.rows))).toEqual(
        new Set([escena.enCarpeta.contractId, escena.cancelado.contractId])
      );

      const hastaHace5 = await searchContracts(escena.principal, {
        classification: "active",
        to: fechas.hace5,
      });
      expect(ids(hastaHace5.rows)).toEqual([escena.deOtroEmisor.contractId]);

      // El día `to` se incluye completo.
      const hastaHoy = await searchContracts(escena.principal, {
        classification: "active",
        to: fechas.hoy,
      });
      expect(hastaHoy.total).toBe(3);

      const rangoCerrado = await searchContracts(escena.principal, {
        classification: "active",
        from: fechas.hace5,
        to: fechas.hoy,
      });
      expect(rangoCerrado.total).toBe(2);
    });

    it("ignora fechas con un formato distinto de AAAA-MM-DD", async () => {
      const escena = await escenarioFiltros();
      const resultado = await searchContracts(escena.principal, {
        classification: "active",
        from: "01/08/2026",
        to: "ayer",
      });
      expect(resultado.total).toBe(3);
    });

    it("combina varios filtros con el texto libre", async () => {
      const escena = await escenarioFiltros();

      const combinado = await searchContracts(escena.principal, {
        classification: "active",
        status: "pending",
        templateId: escena.plantillaA.id,
        folderId: escena.carpeta.id,
      });
      expect(ids(combinado.rows)).toEqual([escena.enCarpeta.contractId]);

      const conTexto = await searchContracts(escena.principal, {
        classification: "active",
        status: "pending",
        templateId: escena.plantillaA.id,
        query: escena.deOtroEmisor.reference,
      });
      expect(ids(conTexto.rows)).toEqual([escena.deOtroEmisor.contractId]);

      const incompatible = await searchContracts(escena.principal, {
        classification: "active",
        status: "cancelled",
        templateId: escena.plantillaA.id,
      });
      expect(incompatible.rows).toEqual([]);
      expect(incompatible.total).toBe(0);
    });
  });

  describe("clasificación operativa", () => {
    it("separa activos, archivados y eliminados", async () => {
      const fixture = await createIssuableOrganization();
      const activo = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );
      const archivado = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );
      const eliminado = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );
      await setArchived(fixture.context, archivado.contractId, true);
      await deleteContract(fixture.context, eliminado.contractId);

      const activos = await searchContracts(fixture.context, {
        classification: "active",
      });
      expect(ids(activos.rows)).toEqual([activo.contractId]);

      const archivados = await searchContracts(fixture.context, {
        classification: "archived",
      });
      expect(ids(archivados.rows)).toEqual([archivado.contractId]);
      expect(archivados.rows[0].classification).toBe("archived");

      const eliminados = await searchContracts(fixture.context, {
        classification: "deleted",
      });
      expect(ids(eliminados.rows)).toEqual([eliminado.contractId]);
      expect(eliminados.rows[0].classification).toBe("deleted");

      // `Restaurar` devuelve el Expediente a `Contratos`.
      await setArchived(fixture.context, archivado.contractId, false);
      const restaurados = await searchContracts(fixture.context, {
        classification: "active",
      });
      expect(new Set(ids(restaurados.rows))).toEqual(
        new Set([activo.contractId, archivado.contractId])
      );
    });

    it("conserva los filtros dentro de `Archivados` y `Eliminados`", async () => {
      const fixture = await createIssuableOrganization();
      const uno = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id,
        { values: { objeto: "Traslado alfa", monto: "100" } }
      );
      const dos = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id,
        { values: { objeto: "Traslado beta", monto: "200" } }
      );
      await setArchived(fixture.context, uno.contractId, true);
      await setArchived(fixture.context, dos.contractId, true);

      const resultado = await searchContracts(fixture.context, {
        classification: "archived",
        query: uno.reference,
      });
      expect(ids(resultado.rows)).toEqual([uno.contractId]);
    });
  });

  describe("Campos contractuales destacados", () => {
    it("muestra como máximo tres valores por Expediente", async () => {
      const escena = await organizacionConPlantilla({
        fields: [
          { key: "ruta", label: "Ruta", highlighted: true },
          { key: "monto", label: "Monto", dataType: "money", highlighted: true },
          { key: "inicio", label: "Inicio", dataType: "date", highlighted: true },
          { key: "folio", label: "Folio", highlighted: true },
          { key: "placas", label: "Placas", searchable: true },
        ],
        markdown: [
          "# Servicio",
          "",
          "Ruta {{ruta}} por {{monto}} desde {{inicio}}.",
          "",
          "Folio {{folio}} y placas {{placas}}.",
        ].join("\n"),
      });
      await emitir(
        escena.context,
        escena.template.id,
        escena.holder.id,
        escena.signer.id,
        {
          values: {
            ruta: "Toluca - Querétaro",
            monto: "12500.5",
            inicio: "2026-03-15",
            folio: "F-9001",
            placas: "AB-1234",
          },
        }
      );

      const resultado = await searchContracts(escena.context, {
        classification: "active",
      });
      const destacados = resultado.rows[0].highlighted;
      expect(destacados).toHaveLength(MAX_HIGHLIGHTED_FIELDS);
      expect(destacados.map((item) => item.label)).toEqual([
        "Ruta",
        "Monto",
        "Inicio",
      ]);
      expect(destacados[0].value).toBe("Toluca - Querétaro");
      expect(destacados[1].value).toContain("12,500.5");
      expect(destacados[2].value).toBe("15 de marzo de 2026");
      // Un campo buscable no destacado nunca aparece en los destacados.
      expect(destacados.map((item) => item.label)).not.toContain("Placas");
    });

    it("omite un valor destacado vacío y no destaca nada sin campos marcados", async () => {
      const conVacio = await organizacionConPlantilla({
        fields: [
          { key: "ruta", label: "Ruta", highlighted: true },
          {
            key: "observacion",
            label: "Observación",
            highlighted: true,
            required: false,
          },
        ],
        markdown: "# Servicio\n\nRuta {{ruta}}. Observación {{observacion}}.",
      });
      await emitir(
        conVacio.context,
        conVacio.template.id,
        conVacio.holder.id,
        conVacio.signer.id,
        { values: { ruta: "Puebla - Veracruz" } }
      );
      const conVacioResultado = await searchContracts(conVacio.context, {
        classification: "active",
      });
      expect(conVacioResultado.rows[0].highlighted).toEqual([
        { label: "Ruta", value: "Puebla - Veracruz" },
      ]);

      const sinDestacados = await organizacionConPlantilla({
        fields: [{ key: "ruta", label: "Ruta", searchable: true }],
        markdown: "# Servicio\n\nRuta {{ruta}}.",
      });
      await emitir(
        sinDestacados.context,
        sinDestacados.template.id,
        sinDestacados.holder.id,
        sinDestacados.signer.id,
        { values: { ruta: "Mérida - Campeche" } }
      );
      const sinDestacadosResultado = await searchContracts(
        sinDestacados.context,
        { classification: "active" }
      );
      expect(sinDestacadosResultado.rows[0].highlighted).toEqual([]);
    });

    it("sigue destacando aunque las opciones guardadas no sean una lista de textos", async () => {
      const escena = await organizacionConPlantilla({
        fields: [
          {
            key: "ruta",
            label: "Ruta",
            dataType: "suggest",
            highlighted: true,
            options: ["Norte"],
          },
          {
            key: "zona",
            label: "Zona",
            dataType: "suggest",
            highlighted: true,
            options: ["Centro"],
          },
          { key: "folio", label: "Folio", highlighted: true },
        ],
        markdown: "# Servicio\n\nRuta {{ruta}}, zona {{zona}}, folio {{folio}}.",
      });
      await emitir(
        escena.context,
        escena.template.id,
        escena.holder.id,
        escena.signer.id,
        { values: { ruta: "Norte", zona: "Centro", folio: "F-77" } }
      );

      // Estado sintético: JSONB que no respeta la forma esperada de `options`.
      // El Buscador nunca debe romperse por un dato de catálogo malformado.
      await sql`
        UPDATE contract_field_definitions
        SET options = '{"lista": ["Norte", "Sur"]}'::jsonb
        WHERE template_id = ${escena.template.id} AND key = 'ruta'
      `;
      await sql`
        UPDATE contract_field_definitions
        SET options = '["Centro", 7, null, true, "Sur"]'::jsonb
        WHERE template_id = ${escena.template.id} AND key = 'zona'
      `;

      const resultado = await searchContracts(escena.context, {
        classification: "active",
      });
      expect(resultado.rows[0].highlighted).toEqual([
        { label: "Ruta", value: "Norte" },
        { label: "Zona", value: "Centro" },
        { label: "Folio", value: "F-77" },
      ]);
    });
  });

  describe("expedientes con datos incompletos", () => {
    it("devuelve cadenas vacías cuando el Expediente no tiene contrapartes registradas", async () => {
      const fixture = await createIssuableOrganization();
      const issued = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );

      // Estado sintético: un Expediente sin filas de contraparte. El Buscador
      // debe seguir listándolo en lugar de fallar.
      await sql`
        DELETE FROM contract_parties WHERE contract_id = ${issued.contractId}
      `;

      const resultado = await searchContracts(fixture.context, {
        classification: "active",
      });
      expect(ids(resultado.rows)).toEqual([issued.contractId]);
      expect(resultado.rows[0].holderName).toBe("");
      expect(resultado.rows[0].signerName).toBe("");
      expect(resultado.rows[0].reference).toBe(issued.reference);
    });
  });

  describe("alcance por Organización", () => {
    it("nunca devuelve Expedientes de otra Organización", async () => {
      const propia = await createIssuableOrganization();
      const ajena = await organizacionConPlantilla({
        templateName: "Plantilla ajena",
        holderName: "Titular Ajeno Inconfundible",
        fields: [{ key: "objeto", label: "Objeto", searchable: true }],
        markdown: "# Ajena\n\nObjeto {{objeto}}.",
      });
      const mio = await emitir(
        propia.context,
        propia.template.id,
        propia.holder.id,
        propia.signer.id
      );
      const suyo = await emitir(
        ajena.context,
        ajena.template.id,
        ajena.holder.id,
        ajena.signer.id,
        { values: { objeto: "Servicio ajeno" } }
      );

      const resultado = await searchContracts(propia.context, {
        classification: "active",
      });
      expect(ids(resultado.rows)).toEqual([mio.contractId]);
      expect(resultado.total).toBe(1);

      const porTitularAjeno = await searchContracts(propia.context, {
        classification: "active",
        query: "Titular Ajeno Inconfundible",
      });
      expect(porTitularAjeno.rows).toEqual([]);

      // Las Referencias se repiten entre Organizaciones y aun así no se cruzan.
      expect(suyo.reference).toBe(mio.reference);
      const porReferencia = await searchContracts(propia.context, {
        classification: "active",
        query: suyo.reference,
      });
      expect(ids(porReferencia.rows)).toEqual([mio.contractId]);
    });

    it("no cruza Contratos aunque se envíe el identificador de otra Organización", async () => {
      const propia = await createIssuableOrganization();
      const ajena = await organizacionConPlantilla({
        fields: [{ key: "objeto", label: "Objeto", searchable: true }],
        markdown: "# Ajena\n\nObjeto {{objeto}}.",
      });
      await emitir(
        ajena.context,
        ajena.template.id,
        ajena.holder.id,
        ajena.signer.id,
        { values: { objeto: "Servicio ajeno" } }
      );

      const resultado = await searchContracts(propia.context, {
        classification: "active",
        templateId: ajena.template.id,
      });
      expect(resultado.rows).toEqual([]);
      expect(await countContracts(propia.context)).toEqual({
        active: 0,
        archived: 0,
        deleted: 0,
        pending: 0,
        inReview: 0,
      });
      expect(await listEmitters(propia.context)).toEqual([]);
    });
  });

  describe("permisos por rol", () => {
    it("un Emisor encuentra los Contratos emitidos por otro Emisor", async () => {
      const fixture = await createIssuableOrganization();
      const otra = await emitterContext(fixture.organization, "Emisor Visitante");
      const ajeno = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );

      const resultado = await searchContracts(otra, { classification: "active" });
      expect(ids(resultado.rows)).toEqual([ajeno.contractId]);
    });

    it("el rol Revisor no recibe el buscador general de Contratos", async () => {
      const fixture = await createIssuableOrganization();
      const revisor = await reviewerContext(fixture.organization);
      await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );

      await expect(
        searchContracts(revisor, { classification: "active" })
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        searchContracts(revisor, { classification: "archived" })
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        searchContracts(revisor, { classification: "deleted" })
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("los roles acumulados suman capacidades sobre `Eliminados`", async () => {
      const fixture = await createIssuableOrganization();
      const account = await createAccount();
      await addMembership(fixture.organization.id, account.id, [
        "reviewer",
        "emitter",
      ]);
      const acumulado = await buildContext(fixture.organization.id, account, [
        "reviewer",
        "emitter",
      ]);
      const contrato = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );
      await deleteContract(fixture.context, contrato.contractId);

      const eliminados = await searchContracts(acumulado, {
        classification: "deleted",
      });
      expect(ids(eliminados.rows)).toEqual([contrato.contractId]);
    });
  });

  describe("opciones y conteos", () => {
    it("lista los Emisores con Contratos emitidos, ordenados por nombre", async () => {
      const organization = await createOrganization();
      const zoraida = await emitterContext(organization, "Zoraida Palacios");
      const abril = await emitterContext(organization, "Abril Camacho");
      const sinContratos = await emitterContext(organization, "Bruno Sin Emision");
      const template = await createTemplate(organization.id);
      await createPrivacyNotice(organization.id);
      const holder = await createCounterpartyRow(organization.id, {
        personKind: "moral",
      });
      const signer = await createCounterpartyRow(organization.id);

      await emitir(zoraida, template.id, holder.id, signer.id);
      await emitir(abril, template.id, holder.id, signer.id);
      await emitir(abril, template.id, holder.id, signer.id);

      const emisores = await listEmitters(zoraida);
      expect(emisores.map((item) => item.name)).toEqual([
        "Abril Camacho",
        "Zoraida Palacios",
      ]);
      expect(emisores.map((item) => item.name)).not.toContain(
        sinContratos.account.fullName
      );
    });

    it("cuenta los Expedientes por clasificación y estado", async () => {
      const fixture = await createIssuableOrganization();
      const pendiente = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );
      const aceptado = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );
      const enRevision = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id,
        { reviewPolicy: "manual" }
      );
      const archivado = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );
      const eliminado = await emitir(
        fixture.context,
        fixture.template.id,
        fixture.holder.id,
        fixture.signer.id
      );

      expect(await aceptar(aceptado.token)).toBe("accepted");
      expect(await aceptar(enRevision.token)).toBe("in_review");
      await setArchived(fixture.context, archivado.contractId, true);
      await deleteContract(fixture.context, eliminado.contractId);

      expect(await countContracts(fixture.context)).toEqual({
        active: 3,
        archived: 1,
        deleted: 1,
        pending: 2,
        inReview: 1,
      });

      // El Estado contractual sigue siendo filtrable después de aceptar.
      const aceptados = await searchContracts(fixture.context, {
        classification: "active",
        status: "accepted",
      });
      expect(ids(aceptados.rows)).toEqual([aceptado.contractId]);

      const enRevisionResultado = await searchContracts(fixture.context, {
        classification: "active",
        status: "in_review",
      });
      expect(ids(enRevisionResultado.rows)).toEqual([enRevision.contractId]);

      const pendientes = await searchContracts(fixture.context, {
        classification: "active",
        status: "pending",
      });
      expect(ids(pendientes.rows)).toEqual([pendiente.contractId]);
    });

    it("reserva Emisores y conteos a Administradores o Emisores", async () => {
      const fixture = await createIssuableOrganization();
      const revisor = await reviewerContext(fixture.organization);

      await expect(listEmitters(revisor)).rejects.toBeInstanceOf(
        AuthorizationError
      );
      await expect(countContracts(revisor)).rejects.toBeInstanceOf(
        AuthorizationError
      );
    });
  });
});
