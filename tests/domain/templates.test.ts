import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { canonicalizeJson } from "@/lib/canonical-json";
import { sha256Hex } from "@/lib/crypto/tokens";
import { ConflictError, NotFoundError } from "@/lib/domain/errors";
import {
  CONTEXT_PLACEHOLDERS,
  extractPlaceholders,
  formatFieldValue,
  getCurrentPrivacyNotice,
  getTemplate,
  listTemplateOptions,
  listPrivacyNotices,
  listTemplateVersions,
  listTemplates,
  longDate,
  normalizeCurrency,
  privacyNoticeHash,
  publishPrivacyNotice,
  publishTemplateVersion,
  renderTemplateMarkdown,
  renderVideoStatement,
  toStringMap,
  unknownPlaceholders,
} from "@/lib/domain/templates";
import type {
  FieldDefinition,
  RenderContext,
  TemplateRecord,
} from "@/lib/domain/templates";
import {
  createAccount,
  createOrganization,
  createPrivacyNotice,
  createTemplate,
} from "@/tests/helpers/database";

// ---------------------------------------------------------------------------
// Apoyos locales
// ---------------------------------------------------------------------------

function buildField(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    key: "objeto",
    label: "Objeto",
    helpText: "",
    dataType: "text",
    required: true,
    options: [],
    searchable: false,
    highlighted: false,
    position: 1,
    ...overrides,
  };
}

function buildRenderContext(
  overrides: Partial<RenderContext> = {}
): RenderContext {
  return {
    organization: {
      name: "Aerolíneas Sintéticas",
      legalName: "Aerolíneas Sintéticas, S.A. de C.V.",
    },
    holder: {
      nombre: "Titular Sintético, S.A. de C.V.",
      rfc: "TSI010203AB1",
      domicilio: "Avenida Sintética 100, Ciudad de México",
      correo: "titular@example.invalid",
      telefono: "5555555555",
    },
    signer: { nombre: "Firmante Sintética" },
    reference: "AC-20260801-0001",
    // 1 de agosto de 2026 a las 12:00 en Ciudad de México (UTC-6).
    issuedAt: new Date("2026-08-01T18:00:00.000Z"),
    ...overrides,
  };
}

/** Espera breve para que dos publicaciones no compartan `published_at`. */
function pause(milliseconds = 10): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function insertUnpublishedTemplate(
  organizationId: string,
  name: string
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO contract_templates (
      organization_id, name, acceptance_legend, video_statement_template
    ) VALUES (
      ${organizationId}, ${name}, ${"Acepto el contrato."},
      ${"Soy {{firmante.nombre}}."}
    )
    RETURNING id
  `;
  return row.id;
}

async function countVersions(templateId: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT count(*)::TEXT AS total
    FROM contract_template_versions
    WHERE template_id = ${templateId}
  `;
  return Number(row.total);
}

// ---------------------------------------------------------------------------
// Marcadores
// ---------------------------------------------------------------------------

describe("marcadores del contenido jurídico", () => {
  it("extrae cada marcador una sola vez y conserva el orden de aparición", () => {
    const markdown = [
      "Contrato de {{organizacion.razon_social}} con {{titular.nombre}}.",
      "Objeto: {{objeto}}; se repite el objeto {{objeto}}.",
      "Referencia {{ contrato.referencia }} del {{contrato.fecha}}.",
    ].join("\n");

    expect(extractPlaceholders(markdown)).toEqual([
      "organizacion.razon_social",
      "titular.nombre",
      "objeto",
      "contrato.referencia",
      "contrato.fecha",
    ]);
  });

  it("no encuentra marcadores en un texto sin llaves", () => {
    expect(extractPlaceholders("Texto jurídico sin marcadores.")).toEqual([]);
  });

  it("ignora las llaves malformadas", () => {
    const markdown = [
      "{objeto}",
      "{{objeto",
      "objeto}}",
      "{{}}",
      "{{ }}",
      "{{ objeto con espacios }}",
      "{{objeto-guion}}",
      "{{ objeto\ncon salto }}",
    ].join("\n");

    expect(extractPlaceholders(markdown)).toEqual([]);
  });

  it("acepta como conocidas todas las claves de contexto canónicas", () => {
    const markdown = CONTEXT_PLACEHOLDERS.map((key) => `{{${key}}}`).join(" ");

    expect(extractPlaceholders(markdown)).toEqual([...CONTEXT_PLACEHOLDERS]);
    expect(unknownPlaceholders(markdown, [])).toEqual([]);
  });

  it("acepta las claves del Esquema programado de campos", () => {
    const fields = [
      buildField({ key: "objeto" }),
      buildField({ key: "monto", dataType: "money" }),
    ];

    expect(
      unknownPlaceholders("Objeto {{objeto}} por {{monto}}.", fields)
    ).toEqual([]);
  });

  it("reporta todos los marcadores desconocidos sin repetirlos", () => {
    const markdown = [
      "{{objeto}} {{clausula_extra}} {{organizacion.nombre}}",
      "{{clausula_extra}} {{organizacion.inventada}} {{penalizacion}}",
    ].join("\n");

    expect(unknownPlaceholders(markdown, [buildField({ key: "objeto" })])).toEqual(
      ["clausula_extra", "organizacion.inventada", "penalizacion"]
    );
  });

  it("no considera conocido un campo de otro Contrato-plantilla", () => {
    expect(unknownPlaceholders("{{monto}}", [buildField({ key: "objeto" })]))
      .toEqual(["monto"]);
  });
});

// ---------------------------------------------------------------------------
// Presentación de valores
// ---------------------------------------------------------------------------

describe("presentación de valores contractuales", () => {
  it("da formato de moneda a un campo `money`", () => {
    const field = buildField({ key: "monto", dataType: "money" });
    expect(formatFieldValue(field, "1234.5")).toBe("$1,234.50");
    expect(formatFieldValue(field, " 0 ")).toBe("$0.00");
  });

  it("usa la moneda capturada cuando un campo `money` la tiene", () => {
    const field = buildField({
      key: "monto",
      dataType: "money",
      options: ["USD", "MXN"],
    });
    expect(formatFieldValue(field, "1234.5", { monto_moneda: "USD" })).toMatch(
      /^USD\s1,234\.50$/u
    );
  });

  it("normaliza a la primera moneda permitida si no existe MXN", () => {
    const field = buildField({
      key: "monto",
      dataType: "money",
      options: ["EUR"],
    });
    expect(normalizeCurrency(field, undefined)).toBe("EUR");
  });

  it("conserva el texto de un `money` que no es numérico", () => {
    const field = buildField({ key: "monto", dataType: "money" });
    expect(formatFieldValue(field, "a convenir")).toBe("a convenir");
  });

  it("agrupa millares en un campo `number`", () => {
    const field = buildField({ key: "asientos", dataType: "number" });
    expect(formatFieldValue(field, "1234567.89")).toBe("1,234,567.89");
    expect(formatFieldValue(field, "12")).toBe("12");
  });

  it("conserva el texto de un `number` que no es numérico", () => {
    const field = buildField({ key: "asientos", dataType: "number" });
    expect(formatFieldValue(field, "doce")).toBe("doce");
  });

  it("presenta un campo `date` como fecha civil, sin convertir a UTC", () => {
    const field = buildField({ key: "inicio", dataType: "date" });
    expect(formatFieldValue(field, "2026-01-01")).toBe("1 de enero de 2026");
    expect(formatFieldValue(field, "2026-12-31")).toBe(
      "31 de diciembre de 2026"
    );
  });

  it("conserva el texto de un `date` con formato distinto", () => {
    const field = buildField({ key: "inicio", dataType: "date" });
    expect(formatFieldValue(field, "01/01/2026")).toBe("01/01/2026");
    expect(formatFieldValue(field, "2026-01-01T06:00:00Z")).toBe(
      "2026-01-01T06:00:00Z"
    );
  });

  it("entrega tal cual los campos `text`, `longtext` y `select`", () => {
    expect(
      formatFieldValue(buildField({ dataType: "text" }), "  Traslado  ")
    ).toBe("Traslado");
    expect(
      formatFieldValue(
        buildField({ key: "notas", dataType: "longtext" }),
        "Primera línea\nSegunda línea"
      )
    ).toBe("Primera línea\nSegunda línea");
    expect(
      formatFieldValue(
        buildField({ key: "modalidad", dataType: "select", options: ["A", "B"] }),
        "B"
      )
    ).toBe("B");
  });

  it("devuelve vacío cuando el JSONB no trae la clave del campo", () => {
    // Los valores llegan de JSONB: una clave ausente no debe romper el texto.
    const ausente = undefined as unknown as string;
    expect(formatFieldValue(buildField({ dataType: "money" }), ausente)).toBe("");
    expect(formatFieldValue(buildField({ dataType: "text" }), ausente)).toBe("");
  });

  it("devuelve vacío cuando el valor está ausente o sólo tiene espacios", () => {
    for (const dataType of [
      "text",
      "longtext",
      "number",
      "money",
      "date",
      "select",
    ] as const) {
      expect(formatFieldValue(buildField({ dataType }), "")).toBe("");
      expect(formatFieldValue(buildField({ dataType }), "   ")).toBe("");
    }
  });

  it("escribe la fecha larga en español en la zona del piloto", () => {
    expect(longDate(new Date("2026-08-01T18:00:00.000Z"))).toBe(
      "1 de agosto de 2026"
    );
    // 06:00 UTC del 1 de agosto es todavía 31 de julio en Ciudad de México.
    expect(longDate(new Date("2026-08-01T04:00:00.000Z"))).toBe(
      "31 de julio de 2026"
    );
    expect(longDate(new Date("2026-03-09T12:00:00.000Z"))).toBe(
      "9 de marzo de 2026"
    );
  });

  it("normaliza a texto los valores contractuales guardados como JSONB", () => {
    expect(
      toStringMap({ objeto: "Traslado", asientos: 12, urgente: true })
    ).toEqual({ objeto: "Traslado", asientos: "12", urgente: "true" });
  });

  it("descarta valores JSONB que no son escalares", () => {
    expect(
      toStringMap({ lista: ["a"], anidado: { a: 1 }, nulo: null, ok: "sí" })
    ).toEqual({ ok: "sí" });
  });

  it("devuelve un mapa vacío cuando el JSONB no es un objeto", () => {
    expect(toStringMap(null)).toEqual({});
    expect(toStringMap(undefined)).toEqual({});
    expect(toStringMap("texto")).toEqual({});
    expect(toStringMap(["a", "b"])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Formación del texto
// ---------------------------------------------------------------------------

describe("formación del texto contractual", () => {
  const fields = [
    buildField({ key: "objeto", dataType: "text", position: 1 }),
    buildField({
      id: "00000000-0000-4000-8000-000000000002",
      key: "monto",
      dataType: "money",
      position: 2,
    }),
    buildField({
      id: "00000000-0000-4000-8000-000000000003",
      key: "inicio",
      dataType: "date",
      position: 3,
    }),
    buildField({
      id: "00000000-0000-4000-8000-000000000004",
      key: "asientos",
      dataType: "number",
      position: 4,
    }),
    buildField({
      id: "00000000-0000-4000-8000-000000000005",
      key: "modalidad",
      dataType: "select",
      options: ["Chárter", "Regular"],
      position: 5,
    }),
    buildField({
      id: "00000000-0000-4000-8000-000000000006",
      key: "notas",
      dataType: "longtext",
      required: false,
      position: 6,
    }),
  ];

  it("sustituye cada clave de contexto canónica", () => {
    const markdown = CONTEXT_PLACEHOLDERS.map((key) => `${key}={{${key}}}`).join(
      "\n"
    );

    expect(renderTemplateMarkdown(markdown, [], {}, buildRenderContext())).toBe(
      [
        "organizacion.nombre=Aerolíneas Sintéticas",
        "organizacion.razon_social=Aerolíneas Sintéticas, S.A. de C.V.",
        "titular.nombre=Titular Sintético, S.A. de C.V.",
        "titular.rfc=TSI010203AB1",
        "titular.domicilio=Avenida Sintética 100, Ciudad de México",
        "titular.correo=titular@example.invalid",
        "titular.telefono=5555555555",
        "firmante.nombre=Firmante Sintética",
        "contrato.referencia=AC-20260801-0001",
        "contrato.fecha=1 de agosto de 2026",
        "contrato.monto_principal=",
      ].join("\n")
    );
  });

  it("sustituye los valores contractuales con el formato de su tipo", () => {
    const markdown = [
      "Objeto: {{objeto}}",
      "Monto: {{monto}}",
      "Inicio: {{inicio}}",
      "Asientos: {{asientos}}",
      "Modalidad: {{modalidad}}",
    ].join("\n");

    expect(
      renderTemplateMarkdown(
        markdown,
        fields,
        {
          objeto: "Traslado ejecutivo",
          monto: "125000",
          inicio: "2026-09-15",
          asientos: "12000",
          modalidad: "Chárter",
        },
        buildRenderContext()
      )
    ).toBe(
      [
        "Objeto: Traslado ejecutivo",
        "Monto: $125,000.00",
        "Inicio: 15 de septiembre de 2026",
        "Asientos: 12,000",
        "Modalidad: Chárter",
      ].join("\n")
    );
  });

  it("deja vacío un campo opcional sin valor", () => {
    expect(
      renderTemplateMarkdown("Notas: [{{notas}}]", fields, {}, buildRenderContext())
    ).toBe("Notas: []");
  });

  it("deja vacío un dato de contexto que la Organización no capturó", () => {
    const context = buildRenderContext({
      holder: { nombre: "Sólo Nombre" },
      signer: {},
    });
    expect(
      renderTemplateMarkdown(
        "RFC [{{titular.rfc}}] Firmante [{{firmante.nombre}}]",
        [],
        {},
        context
      )
    ).toBe("RFC [] Firmante []");
  });

  it("deja intacto un marcador desconocido: nunca inventa contenido", () => {
    expect(
      renderTemplateMarkdown(
        "{{clausula_extra}} y {{organizacion.inventada}}",
        fields,
        {},
        buildRenderContext()
      )
    ).toBe("{{clausula_extra}} y {{organizacion.inventada}}");
  });

  it("acepta espacios alrededor de la clave del marcador", () => {
    expect(
      renderTemplateMarkdown(
        "{{  objeto  }}",
        fields,
        { objeto: "Traslado" },
        buildRenderContext()
      )
    ).toBe("Traslado");
  });

  it("no sustituye de forma recursiva un valor que contiene otro marcador", () => {
    expect(
      renderTemplateMarkdown(
        "Objeto: {{objeto}}.",
        fields,
        { objeto: "Traslado {{monto}} y {{otra}}", monto: "999" },
        buildRenderContext()
      )
    ).toBe("Objeto: Traslado {{monto}} y {{otra}}.");
  });

  it("no interpreta como patrón de reemplazo un valor con `$&`", () => {
    expect(
      renderTemplateMarkdown(
        "Objeto: {{objeto}}.",
        fields,
        { objeto: "$& $1 $`" },
        buildRenderContext()
      )
    ).toBe("Objeto: $& $1 $`.");
  });

  it("forma la declaración del video y recorta los extremos", () => {
    expect(
      renderVideoStatement(
        "\n  Soy {{firmante.nombre}} y acepto por {{contrato.monto_principal}}.  \n",
        fields,
        { monto: "5000" },
        buildRenderContext()
      )
    ).toBe("Soy Firmante Sintética y acepto por $5,000.00.");
  });

  it("elige el monto destacado como monto principal", () => {
    expect(
      renderVideoStatement(
        "Acepto por {{contrato.monto_principal}}.",
        [
          buildField({ key: "anticipo", label: "Anticipo", dataType: "money" }),
          buildField({
            key: "total",
            label: "Total",
            dataType: "money",
            highlighted: true,
          }),
        ],
        { anticipo: "100", total: "2500" },
        buildRenderContext()
      )
    ).toBe("Acepto por $2,500.00.");
  });

  it("omite un monto destacado vacío y usa el siguiente monto capturado", () => {
    expect(
      renderVideoStatement(
        "Acepto por {{contrato.monto_principal}}.",
        [
          buildField({
            key: "total",
            label: "Total",
            dataType: "money",
            highlighted: true,
          }),
          buildField({ key: "anticipo", label: "Anticipo", dataType: "money" }),
        ],
        { anticipo: "100" },
        buildRenderContext()
      )
    ).toBe("Acepto por $100.00.");
  });

  it("deriva el monto principal desde una frase dirigida de texto libre", () => {
    expect(
      renderVideoStatement(
        "Hoy {{contrato.fecha}} acepto el contrato por {{contrato.monto_principal}}.",
        [
          buildField({
            key: "cantidad_credito",
            dataType: "suggest",
            highlighted: true,
          }),
        ],
        { cantidad_credito: "litros de diesel por 5000 MXN" },
        buildRenderContext()
      )
    ).toBe("Hoy 1 de agosto de 2026 acepto el contrato por $5,000.00.");
  });

  it("deriva el monto principal desde texto libre no destacado", () => {
    expect(
      renderVideoStatement(
        "Acepto por {{contrato.monto_principal}}.",
        [buildField({ key: "descripcion", dataType: "longtext" })],
        { descripcion: "servicio integral por 1250,75" },
        buildRenderContext()
      )
    ).toBe("Acepto por $1,250.75.");
  });

  it("deja vacío el monto principal cuando no hay dinero capturable", () => {
    expect(
      renderVideoStatement(
        "Acepto por {{contrato.monto_principal}}.",
        [buildField({ key: "descripcion", dataType: "longtext" })],
        { descripcion: "servicio sin monto definido" },
        buildRenderContext()
      )
    ).toBe("Acepto por .");
  });

  it("deja vacío el monto principal cuando los campos candidatos no tienen valor", () => {
    expect(
      renderVideoStatement(
        "Acepto por {{contrato.monto_principal}}.",
        [buildField({ key: "descripcion", dataType: "longtext", highlighted: true })],
        {},
        buildRenderContext()
      )
    ).toBe("Acepto por .");
  });

  it("entrega una declaración vacía cuando la plantilla de video está vacía", () => {
    expect(renderVideoStatement("   ", [], {}, buildRenderContext())).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Lectura de Contratos-plantilla
// ---------------------------------------------------------------------------

describe("lectura de Contratos-plantilla", () => {
  it("sólo entrega los Contratos-plantilla de la Organización", async () => {
    const primera = await createOrganization();
    const segunda = await createOrganization();
    await createTemplate(primera.id, { name: "Fletamento" });
    await createTemplate(segunda.id, { name: "Mantenimiento" });

    const propios = await listTemplates(primera.id);
    expect(propios.map((template) => template.name)).toEqual(["Fletamento"]);
    expect(propios[0].organizationId).toBe(primera.id);
    expect(propios[0].organizationName).toBe(primera.name);

    const ajenos = await listTemplates(segunda.id);
    expect(ajenos.map((template) => template.name)).toEqual(["Mantenimiento"]);
  });

  it("entrega una lista vacía cuando la Organización no tiene plantillas", async () => {
    const organization = await createOrganization();
    expect(await listTemplates(organization.id)).toEqual([]);
  });

  it("acota por identificadores conocidos y evita consultar una lista vacía", async () => {
    const organization = await createOrganization();
    const incluida = await createTemplate(organization.id, { name: "Incluida" });
    await createTemplate(organization.id, { name: "Omitida" });

    expect(await listTemplates(organization.id, sql, [])).toEqual([]);
    expect(
      (await listTemplates(organization.id, sql, [incluida.id])).map(
        (template) => template.name
      )
    ).toEqual(["Incluida"]);
  });

  it("ordena los Contratos-plantilla por nombre", async () => {
    const organization = await createOrganization();
    await createTemplate(organization.id, { name: "Zeta" });
    await createTemplate(organization.id, { name: "Alfa" });
    await createTemplate(organization.id, { name: "Media" });

    expect((await listTemplates(organization.id)).map((t) => t.name)).toEqual([
      "Alfa",
      "Media",
      "Zeta",
    ]);
  });

  it("entrega opciones ligeras para el buscador con raíz o transacción", async () => {
    const organization = await createOrganization();
    const zeta = await createTemplate(organization.id, { name: "Zeta" });
    const alfa = await createTemplate(organization.id, { name: "Alfa" });
    await createTemplate((await createOrganization()).id, { name: "Ajena" });

    expect(await listTemplateOptions(organization.id)).toEqual([
      { id: alfa.id, name: "Alfa" },
      { id: zeta.id, name: "Zeta" },
    ]);
    await sql.begin(async (tx) => {
      expect(await listTemplateOptions(organization.id, tx)).toHaveLength(2);
      return true;
    });
  });

  it("ordena los campos por `position`, no por su clave", async () => {
    const organization = await createOrganization();
    const template = await createTemplate(organization.id, {
      markdown: "{{zeta}} {{alfa}} {{media}}",
      fields: [
        { key: "zeta", label: "Zeta" },
        { key: "alfa", label: "Alfa" },
        { key: "media", label: "Media" },
      ],
    });

    const [listed] = await listTemplates(organization.id);
    expect(listed.fields.map((field) => field.key)).toEqual([
      "zeta",
      "alfa",
      "media",
    ]);
    expect(listed.fields.map((field) => field.position)).toEqual([1, 2, 3]);

    const fetched = await getTemplate(template.id);
    expect(fetched?.fields.map((field) => field.key)).toEqual([
      "zeta",
      "alfa",
      "media",
    ]);
  });

  it("expone los atributos completos del campo", async () => {
    const organization = await createOrganization();
    const template = await createTemplate(organization.id, {
      markdown: "{{modalidad}}",
      fields: [
        {
          key: "modalidad",
          label: "Modalidad",
          dataType: "select",
          required: false,
          options: ["Chárter", "Regular"],
          searchable: true,
          highlighted: true,
        },
      ],
    });

    const fetched = await getTemplate(template.id);
    expect(fetched?.fields[0]).toMatchObject({
      key: "modalidad",
      label: "Modalidad",
      helpText: "",
      dataType: "select",
      required: false,
      options: ["Chárter", "Regular"],
      searchable: true,
      highlighted: true,
      position: 1,
    });
  });

  it("descarta opciones JSONB que no son una lista de textos", async () => {
    const organization = await createOrganization();
    const template = await createTemplate(organization.id, {
      markdown: "{{modalidad}} {{extra}}",
      fields: [
        { key: "modalidad", label: "Modalidad", dataType: "select" },
        { key: "extra", label: "Extra", dataType: "select" },
      ],
    });
    await sql`
      UPDATE contract_field_definitions
      SET options = '["Chárter", 7, null, "Regular"]'::jsonb
      WHERE template_id = ${template.id} AND key = 'modalidad'
    `;
    await sql`
      UPDATE contract_field_definitions
      SET options = '{"no": "es una lista"}'::jsonb
      WHERE template_id = ${template.id} AND key = 'extra'
    `;

    const fetched = await getTemplate(template.id);
    expect(fetched?.fields[0].options).toEqual(["Chárter", "Regular"]);
    expect(fetched?.fields[1].options).toEqual([]);
  });

  it("expone los valores predeterminados del Contrato-plantilla", async () => {
    const organization = await createOrganization();
    const template = await createTemplate(organization.id, {
      defaults: {
        linkDays: 14,
        requiresVideo: true,
        requiresIne: true,
        reviewPolicy: "manual",
      },
    });

    const fetched = await getTemplate(template.id);
    expect(fetched?.defaults).toEqual({
      linkDays: 14,
      requiresVideo: true,
      requiresIne: true,
      reviewPolicy: "manual",
    });
  });

  it("entrega `currentVersion` nula cuando no hay ninguna publicación", async () => {
    const organization = await createOrganization();
    const templateId = await insertUnpublishedTemplate(
      organization.id,
      "Sin publicar"
    );

    expect((await getTemplate(templateId))?.currentVersion).toBeNull();
    const [listed] = await listTemplates(organization.id);
    expect(listed.currentVersion).toBeNull();
    expect(await listTemplateVersions(templateId)).toEqual([]);
  });

  it("entrega `currentVersion` nula cuando ninguna publicación está vigente", async () => {
    const organization = await createOrganization();
    const template = await createTemplate(organization.id);
    await sql`
      UPDATE contract_template_versions SET is_current = FALSE
      WHERE template_id = ${template.id}
    `;

    expect((await getTemplate(template.id))?.currentVersion).toBeNull();
    expect((await listTemplates(organization.id))[0].currentVersion).toBeNull();
    expect(await listTemplateVersions(template.id)).toHaveLength(1);
  });

  it("entrega null cuando el Contrato-plantilla no existe", async () => {
    expect(
      await getTemplate("00000000-0000-4000-8000-0000000000ff")
    ).toBeNull();
  });

  it("deja sin nombre a quien publicó cuando no hay cuenta ligada", async () => {
    const organization = await createOrganization();
    const template = await createTemplate(organization.id);

    const fetched = await getTemplate(template.id);
    expect(fetched?.currentVersion?.publishedByName).toBeNull();
    expect(fetched?.currentVersion?.isCurrent).toBe(true);
    expect(fetched?.currentVersion?.label).toBe("1.0");
  });

  it("resuelve el nombre de quien publicó a partir de la cuenta", async () => {
    const organization = await createOrganization();
    const publisher = await createAccount({ isLegalPublisher: true });
    const template = await createTemplate(organization.id, {
      publishedBy: publisher.id,
    });

    const [listed] = await listTemplates(organization.id);
    expect(listed.currentVersion?.publishedByName).toBe(publisher.fullName);
    const [version] = await listTemplateVersions(template.id);
    expect(version.publishedByName).toBe(publisher.fullName);
  });

  it("acepta un ejecutor de transacción y ve las filas aún no confirmadas", async () => {
    const organization = await createOrganization();
    await createPrivacyNotice(organization.id);

    const observado = await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO contract_templates (
          organization_id, name, acceptance_legend
        ) VALUES (
          ${organization.id}, ${"Dentro de la transacción"}, ${"Acepto."}
        )
        RETURNING id
      `;

      const dentro = await listTemplates(organization.id, tx);
      const porId = await getTemplate(row.id, tx);
      const aviso = await getCurrentPrivacyNotice(organization.id, tx);
      // La conexión de fuera no ve la fila mientras la transacción sigue abierta.
      const fuera = await getTemplate(row.id);

      return {
        nombres: dentro.map((template) => template.name),
        porIdNombre: porId?.name ?? null,
        avisoVigente: aviso !== null,
        fueraEsNulo: fuera === null,
      };
    });

    expect(observado.nombres).toEqual(["Dentro de la transacción"]);
    expect(observado.porIdNombre).toBe("Dentro de la transacción");
    expect(observado.avisoVigente).toBe(true);
    expect(observado.fueraEsNulo).toBe(true);
    expect((await listTemplates(organization.id)).map((t) => t.name)).toEqual([
      "Dentro de la transacción",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Publicación del Contrato-plantilla
// ---------------------------------------------------------------------------

describe("publicación del Contrato-plantilla", () => {
  async function scenario() {
    const organization = await createOrganization();
    const publisher = await createAccount({ isLegalPublisher: true });
    return { organization, publisher };
  }

  it("crea la primera publicación como `1.0` y la deja vigente", async () => {
    const { organization, publisher } = await scenario();
    const templateId = await insertUnpublishedTemplate(
      organization.id,
      "Fletamento"
    );

    const version = await publishTemplateVersion({
      templateId,
      label: "1.0",
      markdown: "Contrato de {{organizacion.razon_social}}.",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });

    expect(version.label).toBe("1.0");
    expect(version.isCurrent).toBe(true);
    expect(version.publishedByName).toBe(publisher.fullName);
    expect(await countVersions(templateId)).toBe(1);
    expect((await getTemplate(templateId))?.currentVersion?.id).toBe(version.id);
  });

  it("normaliza el Markdown: recorta extremos y convierte CRLF", async () => {
    const { organization, publisher } = await scenario();
    const templateId = await insertUnpublishedTemplate(organization.id, "Fletamento");

    const version = await publishTemplateVersion({
      templateId,
      label: " 1.0 ",
      markdown: "\r\n  Primera línea\r\nSegunda línea  \r\n",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });

    expect(version.label).toBe("1.0");
    expect(version.markdown).toBe("Primera línea\nSegunda línea");
  });

  it("guarda en `markdown_hash` el sha256 del Markdown normalizado", async () => {
    const { organization, publisher } = await scenario();
    const templateId = await insertUnpublishedTemplate(organization.id, "Fletamento");
    const markdown = "Contrato de {{organizacion.nombre}} con {{titular.nombre}}.";

    const version = await publishTemplateVersion({
      templateId,
      label: "1.0",
      markdown: `\r\n${markdown}\r\n`,
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });

    expect(version.markdownHash).toBe(sha256Hex(markdown));
    const [stored] = await sql<{ markdown_hash: string }[]>`
      SELECT markdown_hash FROM contract_template_versions
      WHERE id = ${version.id}
    `;
    expect(stored.markdown_hash).toBe(sha256Hex(markdown));
  });

  it("deja exactamente una vigente y conserva la anterior como historial", async () => {
    const { organization, publisher } = await scenario();
    const template = await createTemplate(organization.id, {
      markdown: "Versión inicial de {{organizacion.nombre}}.",
      label: "1.0",
      fields: [],
    });

    const nueva = await publishTemplateVersion({
      templateId: template.id,
      label: "1.1",
      markdown: "Versión corregida de {{organizacion.nombre}}.",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });

    const historial = await listTemplateVersions(template.id);
    expect(historial).toHaveLength(2);
    expect(historial.map((version) => version.label)).toEqual(["1.1", "1.0"]);
    expect(historial.filter((version) => version.isCurrent)).toHaveLength(1);
    expect(historial[0].id).toBe(nueva.id);
    expect(historial[1].isCurrent).toBe(false);
    expect(historial[1].markdown).toBe("Versión inicial de {{organizacion.nombre}}.");
    expect((await getTemplate(template.id))?.currentVersion?.label).toBe("1.1");
  });

  it("permite repetir la etiqueta vigente y crea un registro distinto", async () => {
    const { organization, publisher } = await scenario();
    const templateId = await insertUnpublishedTemplate(organization.id, "Fletamento");

    const primera = await publishTemplateVersion({
      templateId,
      label: "1.1",
      markdown: "Primer texto de {{organizacion.nombre}}.",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });
    await pause();
    const segunda = await publishTemplateVersion({
      templateId,
      label: "1.1",
      markdown: "Segundo texto de {{organizacion.nombre}}.",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });

    expect(segunda.id).not.toBe(primera.id);
    expect(segunda.label).toBe(primera.label);
    // El historial distingue publicaciones homónimas por su fecha y hora.
    expect(segunda.publishedAt.getTime()).toBeGreaterThan(
      primera.publishedAt.getTime()
    );

    const historial = await listTemplateVersions(templateId);
    expect(historial.map((version) => version.label)).toEqual(["1.1", "1.1"]);
    expect(historial.map((version) => version.isCurrent)).toEqual([true, false]);
    expect(new Set(historial.map((version) => version.id)).size).toBe(2);
  });

  it("ordena el historial de la publicación más reciente a la más antigua", async () => {
    const { organization, publisher } = await scenario();
    const templateId = await insertUnpublishedTemplate(organization.id, "Fletamento");

    for (const label of ["1.0", "1.1", "2.0"]) {
      await publishTemplateVersion({
        templateId,
        label,
        markdown: `Texto ${label} de {{organizacion.nombre}}.`,
        publishedBy: publisher.id,
        publishedByName: publisher.fullName,
      });
      await pause();
    }

    expect((await listTemplateVersions(templateId)).map((v) => v.label)).toEqual([
      "2.0",
      "1.1",
      "1.0",
    ]);
  });

  it("bloquea la publicación con marcadores desconocidos y los lista todos", async () => {
    const { organization, publisher } = await scenario();
    const template = await createTemplate(organization.id, {
      markdown: "Objeto {{objeto}}.",
      label: "1.0",
      fields: [{ key: "objeto", label: "Objeto" }],
    });
    const anterior = await getTemplate(template.id);

    const intento = publishTemplateVersion({
      templateId: template.id,
      label: "2.0",
      markdown:
        "{{objeto}} {{clausula_extra}} {{penalizacion}} {{clausula_extra}}",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });

    await expect(intento).rejects.toBeInstanceOf(ConflictError);
    await expect(intento).rejects.toThrow(/clausula_extra/);
    await expect(intento).rejects.toThrow(/penalizacion/);
    await expect(intento).rejects.toThrow(
      "Hay marcadores sin campo definido: clausula_extra, penalizacion."
    );

    // Ni registro parcial ni cambio de la publicación vigente.
    expect(await countVersions(template.id)).toBe(1);
    const actual = await getTemplate(template.id);
    expect(actual?.currentVersion?.id).toBe(anterior?.currentVersion?.id);
    expect(actual?.currentVersion?.markdown).toBe("Objeto {{objeto}}.");
    expect(actual?.currentVersion?.label).toBe("1.0");
  });

  it("rechaza una etiqueta vacía", async () => {
    const { organization, publisher } = await scenario();
    const templateId = await insertUnpublishedTemplate(organization.id, "Fletamento");

    await expect(
      publishTemplateVersion({
        templateId,
        label: "   ",
        markdown: "Texto de {{organizacion.nombre}}.",
        publishedBy: publisher.id,
        publishedByName: publisher.fullName,
      })
    ).rejects.toThrow("La publicación necesita una etiqueta.");
    expect(await countVersions(templateId)).toBe(0);
  });

  it("rechaza un Markdown vacío", async () => {
    const { organization, publisher } = await scenario();
    const templateId = await insertUnpublishedTemplate(organization.id, "Fletamento");

    await expect(
      publishTemplateVersion({
        templateId,
        label: "1.0",
        markdown: "\r\n   \r\n",
        publishedBy: publisher.id,
        publishedByName: publisher.fullName,
      })
    ).rejects.toThrow("El texto de la plantilla está vacío.");
    expect(await countVersions(templateId)).toBe(0);
  });

  it("rechaza publicar en un Contrato-plantilla inexistente", async () => {
    const { publisher } = await scenario();

    await expect(
      publishTemplateVersion({
        templateId: "00000000-0000-4000-8000-0000000000ff",
        label: "1.0",
        markdown: "Texto.",
        publishedBy: publisher.id,
        publishedByName: publisher.fullName,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("registra la publicación en la bitácora de la Organización", async () => {
    const { organization, publisher } = await scenario();
    const templateId = await insertUnpublishedTemplate(organization.id, "Fletamento");

    const version = await publishTemplateVersion({
      templateId,
      label: "1.0",
      markdown: "Texto de {{organizacion.nombre}}.",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });

    const entries = await sql<
      {
        organization_id: string;
        actor_kind: string;
        actor_name: string;
        subject_type: string;
        subject_id: string;
        payload: { versionId: string; label: string; markdownHash: string };
      }[]
    >`
      SELECT organization_id, actor_kind, actor_name, subject_type, subject_id,
             payload
      FROM audit_entries
      WHERE action = 'plantilla_publicada'
    `;
    expect(entries).toHaveLength(1);
    expect(entries[0].organization_id).toBe(organization.id);
    expect(entries[0].actor_kind).toBe("platform");
    expect(entries[0].actor_name).toBe(publisher.fullName);
    expect(entries[0].subject_type).toBe("contract_template");
    expect(entries[0].subject_id).toBe(templateId);
    expect(entries[0].payload).toEqual({
      versionId: version.id,
      label: "1.0",
      markdownHash: version.markdownHash,
    });
  });

  it("acepta un Markdown que sólo usa claves de contexto y campos definidos", async () => {
    const { organization, publisher } = await scenario();
    const template = await createTemplate(organization.id, {
      markdown: "Inicial.",
      fields: [
        { key: "objeto", label: "Objeto" },
        { key: "monto", label: "Monto", dataType: "money" },
      ],
    });

    const version = await publishTemplateVersion({
      templateId: template.id,
      label: "2.0",
      markdown: [
        "{{organizacion.razon_social}} y {{titular.nombre}}",
        "{{objeto}} por {{monto}}",
        "{{contrato.referencia}} — {{contrato.fecha}} — {{firmante.nombre}}",
      ].join("\n"),
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });

    expect(version.isCurrent).toBe(true);

    const stored: TemplateRecord | null = await getTemplate(template.id);
    expect(
      unknownPlaceholders(stored?.currentVersion?.markdown ?? "", stored?.fields ?? [])
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Aviso de Privacidad
// ---------------------------------------------------------------------------

describe("Aviso de Privacidad", () => {
  it("calcula la huella con JSON canónico de claves ordenadas", () => {
    const hash = privacyNoticeHash("Aviso de Privacidad.");

    expect(hash).toBe(
      sha256Hex(
        canonicalizeJson({
          fullMarkdown: "Aviso de Privacidad.",
        })
      )
    );
    expect(privacyNoticeHash("Otro aviso.")).not.toBe(hash);
  });

  it("publica el Aviso de Privacidad y lo deja vigente con su huella", async () => {
    const organization = await createOrganization();
    const publisher = await createAccount({ isLegalPublisher: true });

    const notice = await publishPrivacyNotice({
      organizationId: organization.id,
      label: " 1.0 ",
      fullMarkdown: "\r\n  Aviso de Privacidad.  \r\n",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });

    expect(notice.label).toBe("1.0");
    expect(notice.isCurrent).toBe(true);
    expect(notice.fullMarkdown).toBe("Aviso de Privacidad.");
    expect(notice.simplifiedMarkdown).toBe("Aviso de Privacidad.");
    expect(notice.noticeHash).toBe(privacyNoticeHash("Aviso de Privacidad."));
    expect(notice.organizationId).toBe(organization.id);

    const vigente = await getCurrentPrivacyNotice(organization.id);
    expect(vigente?.id).toBe(notice.id);
  });

  it("usa el Aviso de Privacidad completo cuando no se envía versión simplificada", async () => {
    const organization = await createOrganization();
    const publisher = await createAccount({ isLegalPublisher: true });

    const notice = await publishPrivacyNotice({
      organizationId: organization.id,
      label: "1.0",
      fullMarkdown: "Aviso completo.",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });

    expect(notice.simplifiedMarkdown).toBe("Aviso completo.");
  });

  it("recorta la versión simplificada explícita del Aviso de Privacidad", async () => {
    const organization = await createOrganization();
    const publisher = await createAccount({ isLegalPublisher: true });

    const notice = await publishPrivacyNotice({
      organizationId: organization.id,
      label: "1.0",
      simplifiedMarkdown: "  Resumen breve.\r\n",
      fullMarkdown: "Aviso completo.",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });

    expect(notice.simplifiedMarkdown).toBe("Resumen breve.");
  });

  it("conserva exactamente una publicación vigente por Organización", async () => {
    const organization = await createOrganization();
    const publisher = await createAccount({ isLegalPublisher: true });

    const primera = await publishPrivacyNotice({
      organizationId: organization.id,
      label: "1.0",
      fullMarkdown: "Aviso inicial.",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });
    await pause();
    const segunda = await publishPrivacyNotice({
      organizationId: organization.id,
      label: "1.1",
      fullMarkdown: "Aviso corregido.",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });

    const historial = await listPrivacyNotices(organization.id);
    expect(historial).toHaveLength(2);
    expect(historial.map((notice) => notice.label)).toEqual(["1.1", "1.0"]);
    expect(historial.filter((notice) => notice.isCurrent)).toHaveLength(1);
    expect(historial[0].id).toBe(segunda.id);
    expect(historial[1].id).toBe(primera.id);
    // El aviso anterior conserva su texto y su huella sin sobrescribirse.
    expect(historial[1].fullMarkdown).toBe("Aviso inicial.");
    expect(historial[1].noticeHash).toBe(primera.noticeHash);

    const vigente = await getCurrentPrivacyNotice(organization.id);
    expect(vigente?.id).toBe(segunda.id);
  });

  it("permite repetir la etiqueta vigente en el Aviso de Privacidad", async () => {
    const organization = await createOrganization();
    const publisher = await createAccount({ isLegalPublisher: true });
    const comun = {
      organizationId: organization.id,
      label: "1.0",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    };

    const primera = await publishPrivacyNotice({
      ...comun,
      fullMarkdown: "Aviso uno.",
    });
    await pause();
    const segunda = await publishPrivacyNotice({
      ...comun,
      fullMarkdown: "Aviso dos.",
    });

    expect(segunda.id).not.toBe(primera.id);
    expect(segunda.publishedAt.getTime()).toBeGreaterThan(
      primera.publishedAt.getTime()
    );
    expect(await listPrivacyNotices(organization.id)).toHaveLength(2);
  });

  it("aísla el Aviso de Privacidad por Organización", async () => {
    const primera = await createOrganization();
    const segunda = await createOrganization();
    await createPrivacyNotice(primera.id, { label: "1.0" });

    expect(await listPrivacyNotices(segunda.id)).toEqual([]);
    expect(await getCurrentPrivacyNotice(segunda.id)).toBeNull();
    expect(await listPrivacyNotices(primera.id)).toHaveLength(1);
  });

  it("no entrega aviso vigente cuando la Organización no ha publicado", async () => {
    const organization = await createOrganization();
    expect(await getCurrentPrivacyNotice(organization.id)).toBeNull();
  });

  it("no entrega aviso vigente cuando falta el Aviso de Privacidad", async () => {
    const organization = await createOrganization();
    await createPrivacyNotice(organization.id, { full: "   " });

    expect(await getCurrentPrivacyNotice(organization.id)).toBeNull();
    expect(await listPrivacyNotices(organization.id)).toHaveLength(1);
  });

  it("entrega aviso vigente aunque la columna simplificada legacy esté vacía", async () => {
    const organization = await createOrganization();
    await createPrivacyNotice(organization.id, { simplified: "" });

    expect((await getCurrentPrivacyNotice(organization.id))?.fullMarkdown).toBe(
      "Aviso de Privacidad sintético con finalidades."
    );
  });

  it("no entrega aviso vigente cuando la única publicación es histórica", async () => {
    const organization = await createOrganization();
    await createPrivacyNotice(organization.id);
    await sql`
      UPDATE privacy_notice_versions SET is_current = FALSE
      WHERE organization_id = ${organization.id}
    `;

    expect(await getCurrentPrivacyNotice(organization.id)).toBeNull();
    expect(await listPrivacyNotices(organization.id)).toHaveLength(1);
  });

  it("rechaza publicar sin etiqueta", async () => {
    const organization = await createOrganization();
    const publisher = await createAccount({ isLegalPublisher: true });

    await expect(
      publishPrivacyNotice({
        organizationId: organization.id,
        label: "  ",
        fullMarkdown: "Aviso.",
        publishedBy: publisher.id,
        publishedByName: publisher.fullName,
      })
    ).rejects.toThrow("La publicación necesita una etiqueta.");
    expect(await listPrivacyNotices(organization.id)).toEqual([]);
  });

  it("rechaza publicar un Aviso de Privacidad vacío", async () => {
    const organization = await createOrganization();
    const publisher = await createAccount({ isLegalPublisher: true });
    const comun = {
      organizationId: organization.id,
      label: "1.0",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    };

    await expect(
      publishPrivacyNotice({
        ...comun,
        fullMarkdown: "\r\n  \r\n",
      })
    ).rejects.toThrow("El Aviso de Privacidad necesita contenido.");
    expect(await listPrivacyNotices(organization.id)).toEqual([]);
  });

  it("registra la publicación del Aviso en la bitácora", async () => {
    const organization = await createOrganization();
    const publisher = await createAccount({ isLegalPublisher: true });

    const notice = await publishPrivacyNotice({
      organizationId: organization.id,
      label: "1.0",
      fullMarkdown: "Aviso.",
      publishedBy: publisher.id,
      publishedByName: publisher.fullName,
    });

    const entries = await sql<
      {
        organization_id: string;
        actor_kind: string;
        subject_type: string;
        subject_id: string;
        payload: { label: string; noticeHash: string };
      }[]
    >`
      SELECT organization_id, actor_kind, subject_type, subject_id, payload
      FROM audit_entries
      WHERE action = 'aviso_privacidad_publicado'
    `;
    expect(entries).toHaveLength(1);
    expect(entries[0].organization_id).toBe(organization.id);
    expect(entries[0].actor_kind).toBe("platform");
    expect(entries[0].subject_type).toBe("privacy_notice_version");
    expect(entries[0].subject_id).toBe(notice.id);
    expect(entries[0].payload).toEqual({
      label: "1.0",
      noticeHash: notice.noticeHash,
    });
  });
});
