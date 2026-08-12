import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import type { OrganizationContext } from "@/lib/auth/guards";
import {
  canManageCounterparties,
  createAndAssignDraftCounterparty,
  createCounterparty,
  findPossibleDuplicates,
  getCounterparty,
  listCounterparties,
  setCounterpartyActive,
  updateCounterparty,
} from "@/lib/domain/counterparties";
import type { PersonKind } from "@/lib/domain/counterparties";
import {
  createDraft,
  deleteDraft,
  getDraft,
  saveDraft,
  issueContract,
} from "@/lib/domain/drafts";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/domain/errors";
import {
  addMembership,
  buildContext,
  createAccount,
  createCounterpartyRow,
  createIssuableOrganization,
  createOrganization,
} from "@/tests/helpers/database";
import type { AccountFixture, OrganizationFixture } from "@/tests/helpers/database";

interface Directory {
  organization: OrganizationFixture;
  administrator: OrganizationContext;
  emitter: OrganizationContext;
  reviewer: OrganizationContext;
  otherEmitter: OrganizationContext;
}

async function contextFor(
  organization: OrganizationFixture,
  roles: ("administrator" | "emitter" | "reviewer")[],
  account?: AccountFixture
): Promise<OrganizationContext> {
  const person = account ?? (await createAccount());
  await addMembership(organization.id, person.id, roles);
  return buildContext(organization.id, person, roles);
}

async function buildDirectory(): Promise<Directory> {
  const organization = await createOrganization();
  return {
    organization,
    administrator: await contextFor(organization, ["administrator"]),
    emitter: await contextFor(organization, ["emitter"]),
    reviewer: await contextFor(organization, ["reviewer"]),
    otherEmitter: await contextFor(organization, ["emitter"]),
  };
}

describe("Directorio de contrapartes", () => {
  let directory: Directory;

  beforeEach(async () => {
    directory = await buildDirectory();
  });

  describe("alta y corrección de registros", () => {
    it("permite que un Emisor cree un registro compartido con la Organización", async () => {
      const created = await createCounterparty(directory.emitter, {
        personKind: "moral",
        name: "Transportes Aurora",
        rfc: "TAU210101AB1",
        email: "contacto@aurora.invalid",
        phone: "5555555555",
        address: "Avenida Central 100",
        position: "Apoderado legal",
      });

      expect(created.organizationId).toBe(directory.organization.id);
      expect(created.personKind).toBe("moral");
      expect(created.name).toBe("Transportes Aurora");
      expect(created.active).toBe(true);

      // El registro es del Directorio de la Organización, no de una libreta
      // personal: otro Emisor y el Administrador lo ven igual.
      const visto = await getCounterparty(directory.organization.id, created.id);
      expect(visto?.name).toBe("Transportes Aurora");
      const listado = await listCounterparties(directory.organization.id);
      expect(listado.map((item) => item.id)).toContain(created.id);
    });

    it("permite que un Administrador cree y corrija registros", async () => {
      const created = await createCounterparty(directory.administrator, {
        personKind: "fisica",
        name: "Rosario Méndez",
      });
      const updated = await updateCounterparty(directory.administrator, created.id, {
        personKind: "fisica",
        name: "Rosario Méndez Luna",
        position: "Titular",
      });

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe("Rosario Méndez Luna");
      expect(updated.position).toBe("Titular");
    });

    it("permite que cualquier Emisor autorizado corrija un registro ajeno", async () => {
      const created = await createCounterparty(directory.emitter, {
        personKind: "moral",
        name: "Refacciones del Norte",
      });
      const updated = await updateCounterparty(directory.otherEmitter, created.id, {
        personKind: "moral",
        name: "Refacciones del Norte y Occidente",
      });

      expect(updated.name).toBe("Refacciones del Norte y Occidente");
    });

    it("registra en auditoría al actor y los valores cambiados", async () => {
      const created = await createCounterparty(directory.emitter, {
        personKind: "fisica",
        name: "Ana Prieto",
        phone: "5544332211",
      });
      await updateCounterparty(directory.emitter, created.id, {
        personKind: "fisica",
        name: "Ana Prieto Solís",
        phone: "5544332211",
      });

      const rows = await sql<{ action: string; payload: unknown }[]>`
        SELECT action, payload FROM audit_entries
        WHERE subject_id = ${created.id} ORDER BY created_at
      `;
      expect(rows.map((row) => row.action)).toEqual([
        "contraparte_creada",
        "contraparte_actualizada",
      ]);
      expect(JSON.stringify(rows[1].payload)).toContain("Ana Prieto Solís");
    });

    it("rechaza a una cuenta con el rol Revisor solo", async () => {
      const existing = await createCounterpartyRow(directory.organization.id);

      await expect(
        createCounterparty(directory.reviewer, {
          personKind: "fisica",
          name: "Persona sin permiso",
        })
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        updateCounterparty(directory.reviewer, existing.id, {
          personKind: "fisica",
          name: "Persona sin permiso",
        })
      ).rejects.toBeInstanceOf(AuthorizationError);
      expect(canManageCounterparties(directory.reviewer)).toBe(false);
      expect(canManageCounterparties(directory.emitter)).toBe(true);
      expect(canManageCounterparties(directory.administrator)).toBe(true);
    });
  });

  describe("alta rápida atómica dentro de un Borrador", () => {
    it("crea, asigna y audita Titular o Firmante en una sola operación", async () => {
      const fixture = await createIssuableOrganization();
      const draftId = await createDraft(fixture.context, {
        templateId: fixture.template.id,
      });

      const holder = await createAndAssignDraftCounterparty(
        fixture.context,
        draftId,
        "holder",
        { personKind: "moral", name: "Titular Nuevo" }
      );
      const signer = await createAndAssignDraftCounterparty(
        fixture.context,
        draftId,
        "signer",
        { personKind: "fisica", name: "Firmante Nueva" }
      );

      const draft = await getDraft(fixture.context, draftId);
      expect(draft.holder?.id).toBe(holder.id);
      expect(draft.signer?.id).toBe(signer.id);
      const audits = await sql<
        { subject_id: string; payload: { draftId: string; party: string } }[]
      >`
        SELECT subject_id, payload FROM audit_entries
        WHERE action = 'contraparte_creada' AND subject_id IN (${holder.id}, ${signer.id})
        ORDER BY created_at
      `;
      expect(audits).toEqual([
        {
          subject_id: holder.id,
          payload: expect.objectContaining({ draftId, party: "holder" }),
        },
        {
          subject_id: signer.id,
          payload: expect.objectContaining({ draftId, party: "signer" }),
        },
      ]);
    });

    it("no deja contraparte si el Borrador es ajeno, de otra Organización o la parte es inválida", async () => {
      const fixture = await createIssuableOrganization();
      const draftId = await createDraft(fixture.context, {
        templateId: fixture.template.id,
      });
      const other = await contextFor(fixture.organization, [
        "administrator",
        "emitter",
      ]);
      const foreign = await createIssuableOrganization();

      await expect(
        createAndAssignDraftCounterparty(other, draftId, "holder", {
          personKind: "fisica",
          name: "No debe existir",
        })
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        createAndAssignDraftCounterparty(
          foreign.context,
          draftId,
          "holder",
          { personKind: "fisica", name: "Tampoco debe existir" }
        )
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        createAndAssignDraftCounterparty(
          fixture.context,
          draftId,
          "invalid" as "holder",
          { personKind: "fisica", name: "Parte inválida" }
        )
      ).rejects.toThrow("Elige qué parte contractual quieres registrar.");

      const [rows] = await sql<{ total: string }[]>`
        SELECT COUNT(*)::text AS total FROM counterparties
        WHERE name IN ('No debe existir', 'Tampoco debe existir', 'Parte inválida')
      `;
      expect(rows.total).toBe("0");
    });

    it("no deja contraparte cuando el Borrador ya fue emitido o eliminado", async () => {
      const fixture = await createIssuableOrganization();
      const issuedDraft = await createDraft(fixture.context, {
        templateId: fixture.template.id,
        holderId: fixture.holder.id,
        signerId: fixture.signer.id,
        prefill: { objeto: "Servicio sintético", monto: "1000" },
      });
      await issueContract(fixture.context, issuedDraft);

      await expect(
        createAndAssignDraftCounterparty(
          fixture.context,
          issuedDraft,
          "holder",
          { personKind: "moral", name: "Huérfana emitida" }
        )
      ).rejects.toThrow("Este Borrador ya se emitió como Contrato.");

      const deletedDraft = await createDraft(fixture.context, {
        templateId: fixture.template.id,
      });
      await deleteDraft(fixture.context, deletedDraft);
      await expect(
        createAndAssignDraftCounterparty(
          fixture.context,
          deletedDraft,
          "signer",
          { personKind: "fisica", name: "Huérfana eliminada" }
        )
      ).rejects.toThrow("Este Borrador está en Eliminados.");

      const [rows] = await sql<{ total: string }[]>`
        SELECT COUNT(*)::text AS total FROM counterparties
        WHERE name IN ('Huérfana emitida', 'Huérfana eliminada')
      `;
      expect(rows.total).toBe("0");
      const [audits] = await sql<{ total: string }[]>`
        SELECT COUNT(*)::text AS total FROM audit_entries
        WHERE action = 'contraparte_creada'
          AND payload->>'name' IN ('Huérfana emitida', 'Huérfana eliminada')
      `;
      expect(audits.total).toBe("0");
    });

    it("serializa la carrera con emisión sin dejar una contraparte huérfana", async () => {
      const fixture = await createIssuableOrganization();
      const draftId = await createDraft(fixture.context, {
        templateId: fixture.template.id,
        holderId: fixture.holder.id,
        signerId: fixture.signer.id,
        prefill: { objeto: "Servicio sintético", monto: "1000" },
      });

      const [creation, issuance] = await Promise.allSettled([
        createAndAssignDraftCounterparty(
          fixture.context,
          draftId,
          "signer",
          { personKind: "fisica", name: "Firmante concurrente" }
        ),
        issueContract(fixture.context, draftId),
      ]);
      expect(issuance.status).toBe("fulfilled");

      const [created] = await sql<{ id: string }[]>`
        SELECT id FROM counterparties WHERE name = 'Firmante concurrente'
      `;
      const [contract] = await sql<{ id: string }[]>`
        SELECT issued_contract_id AS id FROM contract_drafts WHERE id = ${draftId}
      `;
      const [frozen] = await sql<{ source: string | null }[]>`
        SELECT source_counterparty_id AS source FROM contract_parties
        WHERE contract_id = ${contract.id} AND party_role = 'signer'
      `;
      if (creation.status === "fulfilled") {
        expect(created.id).toBe(creation.value.id);
        expect(frozen.source).toBe(created.id);
      } else {
        expect(creation.reason).toBeInstanceOf(ConflictError);
        expect(created).toBeUndefined();
        expect(frozen.source).toBe(fixture.signer.id);
      }
    });
  });

  describe("núcleo obligatorio y limpieza de datos", () => {
    it("exige nombre o razón social", async () => {
      await expect(
        createCounterparty(directory.emitter, { personKind: "moral", name: "   " })
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("exige elegir persona física o moral", async () => {
      const kind: string = "indefinida";
      await expect(
        createCounterparty(directory.emitter, {
          personKind: kind as PersonKind,
          name: "Persona sin tipo",
        })
      ).rejects.toThrow("Elige si es persona física o moral.");
    });

    it("rechaza un correo con formato inválido", async () => {
      await expect(
        createCounterparty(directory.emitter, {
          personKind: "fisica",
          name: "Correo Roto",
          email: "correo-sin-arroba",
        })
      ).rejects.toThrow("El correo de la contraparte no es válido.");
    });

    it("recorta el nombre y vacía los campos opcionales en blanco", async () => {
      const created = await createCounterparty(directory.emitter, {
        personKind: "fisica",
        name: "  Beatriz Lara  ",
        rfc: "   ",
        email: "",
        phone: "  5512345678  ",
        address: "\n",
        position: "  Representante  ",
      });

      expect(created.name).toBe("Beatriz Lara");
      expect(created.rfc).toBe("");
      expect(created.email).toBe("");
      expect(created.phone).toBe("5512345678");
      expect(created.address).toBe("");
      expect(created.position).toBe("Representante");

      const [row] = await sql<{ rfc: string | null; address: string | null }[]>`
        SELECT rfc, address FROM counterparties WHERE id = ${created.id}
      `;
      expect(row.rfc).toBeNull();
      expect(row.address).toBeNull();
    });

    it("permite borrar un dato opcional al corregir el registro", async () => {
      const created = await createCounterparty(directory.emitter, {
        personKind: "fisica",
        name: "equipo juridico Vela",
        email: "carlos@example.invalid",
      });
      const updated = await updateCounterparty(directory.emitter, created.id, {
        personKind: "fisica",
        name: "equipo juridico Vela",
        email: "  ",
      });

      expect(updated.email).toBe("");
    });
  });

  describe("aislamiento por Organización", () => {
    it("no encuentra un registro de otra Organización", async () => {
      const otra = await createOrganization();
      const ajena = await createCounterpartyRow(otra.id, { name: "Ajena S.A." });

      expect(await getCounterparty(directory.organization.id, ajena.id)).toBeNull();
      const listado = await listCounterparties(directory.organization.id);
      expect(listado.map((item) => item.id)).not.toContain(ajena.id);
    });

    it("no corrige ni desactiva un registro de otra Organización", async () => {
      const otra = await createOrganization();
      const ajena = await createCounterpartyRow(otra.id, { name: "Ajena S.A." });

      await expect(
        updateCounterparty(directory.administrator, ajena.id, {
          personKind: "moral",
          name: "Intento de cambio",
        })
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        setCounterpartyActive(directory.administrator, ajena.id, false)
      ).rejects.toBeInstanceOf(NotFoundError);

      const [row] = await sql<{ name: string; active: boolean }[]>`
        SELECT name, active FROM counterparties WHERE id = ${ajena.id}
      `;
      expect(row.name).toBe("Ajena S.A.");
      expect(row.active).toBe(true);
    });

    it("no muestra registros similares de otra Organización como posibles duplicados", async () => {
      const otra = await createOrganization();
      await createCounterpartyRow(otra.id, { name: "Transportes Aurora" });

      const duplicados = await findPossibleDuplicates(
        directory.organization.id,
        "Transportes Aurora"
      );
      expect(duplicados).toEqual([]);
    });
  });

  describe("desactivación", () => {
    it("sólo la ejecuta un Administrador", async () => {
      const created = await createCounterpartyRow(directory.organization.id);

      await expect(
        setCounterpartyActive(directory.emitter, created.id, false)
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        setCounterpartyActive(directory.reviewer, created.id, false)
      ).rejects.toBeInstanceOf(AuthorizationError);

      await setCounterpartyActive(directory.administrator, created.id, false);
      const after = await getCounterparty(directory.organization.id, created.id);
      expect(after?.active).toBe(false);
    });

    it("informa cuando el registro no existe", async () => {
      await expect(
        setCounterpartyActive(
          directory.administrator,
          "00000000-0000-4000-8000-000000000001",
          false
        )
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("registra la desactivación y la reactivación en auditoría", async () => {
      const created = await createCounterpartyRow(directory.organization.id);
      await setCounterpartyActive(directory.administrator, created.id, false);
      await setCounterpartyActive(directory.administrator, created.id, true);

      const rows = await sql<{ action: string }[]>`
        SELECT action FROM audit_entries
        WHERE subject_id = ${created.id} ORDER BY created_at
      `;
      expect(rows.map((row) => row.action)).toEqual([
        "contraparte_desactivada",
        "contraparte_reactivada",
      ]);
    });

    it("impide seleccionarlo en emisiones futuras sin alterar la historia", async () => {
      const fixture = await createIssuableOrganization();
      const draftId = await createDraft(fixture.context, {
        templateId: fixture.template.id,
      });
      await saveDraft(fixture.context, draftId, {
        holderId: fixture.holder.id,
        signerId: fixture.signer.id,
        fieldValues: { objeto: "Servicio de traslado", monto: "1500" },
      });
      const issued = await issueContract(fixture.context, draftId);

      await setCounterpartyActive(fixture.context, fixture.holder.id, false);

      // Ya no se ofrece para selección futura.
      const seleccionables = await listCounterparties(fixture.organization.id);
      expect(seleccionables.map((item) => item.id)).not.toContain(
        fixture.holder.id
      );

      // La instantánea del Contrato emitido no cambia.
      const [party] = await sql<{ name: string; source: string | null }[]>`
        SELECT name, source_counterparty_id AS source FROM contract_parties
        WHERE contract_id = ${issued.contractId} AND party_role = 'holder'
      `;
      expect(party.name).toBe(fixture.holder.name);
      expect(party.source).toBe(fixture.holder.id);

      // Un Borrador nuevo ya no puede tomarlo del Directorio.
      const nuevo = await createDraft(fixture.context, {
        templateId: fixture.template.id,
        holderId: fixture.holder.id,
      });
      const detalle = await getDraft(fixture.context, nuevo);
      expect(detalle.holder).toBeNull();
    });
  });

  describe("listado", () => {
    it("ordena por nombre y oculta los registros inactivos", async () => {
      const organizationId = directory.organization.id;
      await createCounterpartyRow(organizationId, { name: "carlos Ruiz" });
      await createCounterpartyRow(organizationId, { name: "Ana Beltrán" });
      await createCounterpartyRow(organizationId, { name: "Berta Ortiz" });
      const inactiva = await createCounterpartyRow(organizationId, {
        name: "Alberto Cruz",
        active: false,
      });

      const activos = await listCounterparties(organizationId);
      expect(activos.map((item) => item.name)).toEqual([
        "Ana Beltrán",
        "Berta Ortiz",
        "carlos Ruiz",
      ]);

      const todos = await listCounterparties(organizationId, {
        includeInactive: true,
      });
      expect(todos).toHaveLength(4);
      expect(todos.at(-1)?.id).toBe(inactiva.id);
    });

    it("filtra por texto en nombre, RFC, correo y teléfono", async () => {
      const organizationId = directory.organization.id;
      await createCounterparty(directory.emitter, {
        personKind: "moral",
        name: "Logística Peninsular",
        rfc: "LPE200202XY9",
        email: "hola@peninsular.invalid",
        phone: "9991112233",
      });
      await createCounterparty(directory.emitter, {
        personKind: "fisica",
        name: "Rodrigo Fuentes",
        rfc: "FURO900101QQ0",
        email: "rodrigo@example.invalid",
        phone: "5551110000",
      });

      const porNombre = await listCounterparties(organizationId, {
        query: "peninsular",
      });
      expect(porNombre.map((item) => item.name)).toEqual(["Logística Peninsular"]);

      const porRfc = await listCounterparties(organizationId, {
        query: "FURO9001",
      });
      expect(porRfc.map((item) => item.name)).toEqual(["Rodrigo Fuentes"]);

      const porCorreo = await listCounterparties(organizationId, {
        query: "hola@peninsular",
      });
      expect(porCorreo).toHaveLength(1);

      const porTelefono = await listCounterparties(organizationId, {
        query: "9991112233",
      });
      expect(porTelefono).toHaveLength(1);

      const sinCoincidencias = await listCounterparties(organizationId, {
        query: "no-existe",
      });
      expect(sinCoincidencias).toEqual([]);
    });

    it("filtra por tipo de persona", async () => {
      const organizationId = directory.organization.id;
      await createCounterpartyRow(organizationId, {
        name: "Persona Moral Uno",
        personKind: "moral",
      });
      await createCounterpartyRow(organizationId, {
        name: "Persona Física Uno",
        personKind: "fisica",
      });

      const morales = await listCounterparties(organizationId, {
        personKind: "moral",
      });
      expect(morales.map((item) => item.name)).toEqual(["Persona Moral Uno"]);

      const fisicas = await listCounterparties(organizationId, {
        personKind: "fisica",
      });
      expect(fisicas.map((item) => item.name)).toEqual(["Persona Física Uno"]);
    });

    it("combina texto, tipo de persona e inactivos", async () => {
      const organizationId = directory.organization.id;
      await createCounterpartyRow(organizationId, {
        name: "Grupo Zafiro",
        personKind: "moral",
        active: false,
      });
      await createCounterpartyRow(organizationId, {
        name: "Zafiro Individual",
        personKind: "fisica",
      });

      const sinInactivos = await listCounterparties(organizationId, {
        query: "zafiro",
        personKind: "moral",
      });
      expect(sinInactivos).toEqual([]);

      const conInactivos = await listCounterparties(organizationId, {
        query: "zafiro",
        personKind: "moral",
        includeInactive: true,
      });
      expect(conInactivos.map((item) => item.name)).toEqual(["Grupo Zafiro"]);
    });

    it("trata los comodines del texto buscado como literales", async () => {
      const organizationId = directory.organization.id;
      await createCounterpartyRow(organizationId, { name: "Cien Por Ciento" });
      await createCounterpartyRow(organizationId, { name: "Descuento 50% Neto" });

      const resultados = await listCounterparties(organizationId, {
        query: "50%",
      });
      expect(resultados.map((item) => item.name)).toEqual(["Descuento 50% Neto"]);
    });
  });

  describe("posibles duplicados", () => {
    it("ignora las diferencias de mayúsculas y acentos", async () => {
      const organizationId = directory.organization.id;
      await createCounterpartyRow(organizationId, {
        name: "Transportes del Bajío",
      });

      const duplicados = await findPossibleDuplicates(
        organizationId,
        "TRANSPORTES DEL BAJIO"
      );
      expect(duplicados.map((item) => item.name)).toEqual([
        "Transportes del Bajío",
      ]);
    });

    it("detecta palabras adicionales y la forma societaria", async () => {
      const organizationId = directory.organization.id;
      await createCounterpartyRow(organizationId, {
        name: "Comercializadora Quetzal",
        personKind: "moral",
      });

      const conSociedad = await findPossibleDuplicates(
        organizationId,
        "Comercializadora Quetzal, S.A. de C.V."
      );
      expect(conSociedad.map((item) => item.name)).toEqual([
        "Comercializadora Quetzal",
      ]);

      const conPalabraExtra = await findPossibleDuplicates(
        organizationId,
        "Comercializadora Quetzal Internacional"
      );
      expect(conPalabraExtra.map((item) => item.name)).toEqual([
        "Comercializadora Quetzal",
      ]);
    });

    /**
     * Defecto detectado: el prefiltro SQL compara la palabra ancla ya sin
     * acentos contra el nombre tal como está guardado. Si el registro
     * almacenado lleva el acento en esa palabra, `ILIKE` no coincide y el
     * posible duplicado nunca se advierte. La comparación inversa (registro
     * sin acento, búsqueda acentuada) sí funciona.
     */
    it("advierte aunque el acento esté en la palabra ancla guardada", async () => {
      const organizationId = directory.organization.id;
      await createCounterpartyRow(organizationId, { name: "Aeródromo Central" });

      const duplicados = await findPossibleDuplicates(
        organizationId,
        "Aerodromo Central"
      );
      expect(duplicados.map((item) => item.name)).toEqual(["Aeródromo Central"]);
    });

    it("no advierte cuando los nombres no se parecen", async () => {
      const organizationId = directory.organization.id;
      await createCounterpartyRow(organizationId, { name: "Panificadora Sol" });

      const duplicados = await findPossibleDuplicates(
        organizationId,
        "Ferretería Industrial Metrópoli"
      );
      expect(duplicados).toEqual([]);
    });

    it("usa el nombre completo como ancla cuando toda palabra es corta", async () => {
      const organizationId = directory.organization.id;
      await createCounterpartyRow(organizationId, { name: "Ab Cd" });

      const duplicados = await findPossibleDuplicates(organizationId, "ab cd");
      expect(duplicados.map((item) => item.name)).toEqual(["Ab Cd"]);
    });

    it("no advierte con nombres demasiado cortos", async () => {
      const organizationId = directory.organization.id;
      await createCounterpartyRow(organizationId, { name: "AB" });

      expect(await findPossibleDuplicates(organizationId, "AB")).toEqual([]);
    });

    it("incluye registros inactivos y limita la advertencia a cinco", async () => {
      const organizationId = directory.organization.id;
      for (let index = 0; index < 7; index += 1) {
        await createCounterpartyRow(organizationId, {
          name: `Constructora Vertiente ${index}`,
          active: index !== 0,
        });
      }

      const duplicados = await findPossibleDuplicates(
        organizationId,
        "Constructora Vertiente"
      );
      expect(duplicados).toHaveLength(5);
    });

    it("sólo advierte: nunca bloquea ni fusiona el registro nuevo", async () => {
      const organizationId = directory.organization.id;
      const original = await createCounterpartyRow(organizationId, {
        name: "Servicios Aéreos Milenio",
        personKind: "moral",
      });

      const advertencia = await findPossibleDuplicates(
        organizationId,
        "Servicios Aereos Milenio"
      );
      expect(advertencia.map((item) => item.id)).toEqual([original.id]);

      // El Emisor puede continuar con un registro nuevo pese a la advertencia.
      const nuevo = await createCounterparty(directory.emitter, {
        personKind: "moral",
        name: "Servicios Aereos Milenio",
      });
      expect(nuevo.id).not.toBe(original.id);

      const listado = await listCounterparties(organizationId, {
        query: "milenio",
      });
      expect(listado).toHaveLength(2);
    });
  });
});
