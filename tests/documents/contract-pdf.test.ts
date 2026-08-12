import { runInNewContext } from "node:vm";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  renderContractPdf,
  type ContractPdfAcceptance,
  type ContractPdfInput,
} from "@/lib/pdf/contract-pdf";

/**
 * `lib/pdf/contract-pdf.ts` produce la representación PDF bajo demanda del
 * Contrato emitido (ADR-0059). Nunca debe contener el enlace ni el token.
 */

/** Token de aspecto realista: jamás debe aparecer en el PDF. */
const TOKEN = "tkn_9f4c2b1ea77d4c8fb0e5a6d3c2b1908f";

/**
 * Extrae el texto dibujado: descomprime los flujos de contenido y decodifica
 * los operadores `Tj`. Las fuentes estándar escriben en WinAnsi, que coincide
 * con Latin-1 en todo el rango que `clean()` deja pasar.
 */
function extractLines(pdf: Buffer): string[] {
  const raw = pdf.toString("latin1");
  const rows: string[] = [];
  const marker = /stream\r?\n/g;
  let match = marker.exec(raw);
  while (match !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end > start) {
      let decoded: string;
      try {
        decoded = inflateSync(pdf.subarray(start, end)).toString("latin1");
      } catch {
        decoded = "";
      }
      for (const operator of decoded.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
        rows.push(Buffer.from(operator[1], "hex").toString("latin1"));
      }
    }
    match = marker.exec(raw);
  }
  return rows;
}

/** Texto por renglones, para buscar frases completas. */
function extractText(pdf: Buffer): string {
  return extractLines(pdf).join("\n");
}

/** Texto continuo, para buscar valores que el ajuste de línea parte en dos. */
function extractCompactText(pdf: Buffer): string {
  return extractLines(pdf).join("");
}

/** Texto corrido, para buscar frases que el ajuste de línea reparte en varias. */
function extractFlowText(pdf: Buffer): string {
  return extractLines(pdf).join(" ").replace(/\s+/g, " ");
}

/** Renglones agrupados por página, en el orden en que se escriben. */
function extractPages(pdf: Buffer): string[][] {
  const raw = pdf.toString("latin1");
  const pages: string[][] = [];
  const marker = /stream\r?\n/g;
  let match = marker.exec(raw);
  while (match !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end > start) {
      let decoded: string;
      try {
        decoded = inflateSync(pdf.subarray(start, end)).toString("latin1");
      } catch {
        decoded = "";
      }
      const rows = [...decoded.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((operator) =>
        Buffer.from(operator[1], "hex").toString("latin1")
      );
      if (rows.length > 0) pages.push(rows);
    }
    match = marker.exec(raw);
  }
  return pages;
}

const ACCEPTED_AT = new Date("2026-01-15T18:30:00.000Z");
const DOCUMENT_HASH =
  "3fa1c0d94e7b25836af5109cd2e4b7710a9c8d6f5e4b3a29187654321fedcba0";
const EVIDENCE_HASH =
  "b7d3e5f1029a4c6e8b0d2f4a6c8e0b1d3f5a7c9e1b3d5f7092a4c6e8b0d2f4a6";
const LEGEND =
  "Acepto el Contrato en los términos leídos y manifiesto mi voluntad de obligarme.";

function acceptance(
  overrides: Partial<ContractPdfAcceptance> = {}
): ContractPdfAcceptance {
  return {
    signerName: "Ana Sofía Ruiz Pérez",
    acceptedAt: ACCEPTED_AT,
    legend: LEGEND,
    documentHash: DOCUMENT_HASH,
    evidenceHash: EVIDENCE_HASH,
    attemptSequence: 3,
    ...overrides,
  };
}

function input(overrides: Partial<ContractPdfInput> = {}): ContractPdfInput {
  return {
    reference: "AC-2026-000123",
    organizationName: "Aerolíneas Demostración S.A. de C.V.",
    templateName: "Contrato de prestación de servicios",
    markdown: "# Cláusula primera\n\nEl presente texto es sintético.",
    kind: "review",
    ...overrides,
  };
}

describe("renderContractPdf: estructura del archivo", () => {
  it("genera un PDF con la firma y el cierre esperados", async () => {
    const pdf = await renderContractPdf(input());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const tail = pdf.subarray(-64).toString("latin1");
    expect(tail).toMatch(/startxref\s+\d+\s+%%EOF\s*$/);
  });

  it("se puede volver a abrir y expone los metadatos del documento", async () => {
    const pdf = await renderContractPdf(
      input({ kind: "accepted", acceptance: acceptance() })
    );
    // `updateMetadata: false`: al abrir, pdf-lib reescribiría Producer y fecha.
    const document = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(document.getPageCount()).toBe(1);
    expect(document.getTitle()).toBe(
      "Contrato de prestación de servicios · AC-2026-000123"
    );
    expect(document.getSubject()).toBe("Copia contractual aceptada");
    expect(document.getAuthor()).toBe("Aerolíneas Demostración S.A. de C.V.");
    expect(document.getProducer()).toBe("Fides");
    expect(document.getCreator()).toBe("Fides");
    expect(document.getCreationDate()?.toISOString()).toBe(
      ACCEPTED_AT.toISOString()
    );
    expect(document.getModificationDate()?.toISOString()).toBe(
      ACCEPTED_AT.toISOString()
    );
    const [page] = document.getPages();
    expect(page.getWidth()).toBeCloseTo(595.28, 2);
    expect(page.getHeight()).toBeCloseTo(841.89, 2);
  });

  it("marca la copia de revisión en el asunto del documento", async () => {
    const document = await PDFDocument.load(await renderContractPdf(input()), {
      updateMetadata: false,
    });
    expect(document.getSubject()).toBe(
      "Copia de revisión · Pendiente de aceptación"
    );
  });
});

describe("renderContractPdf: copia de revisión", () => {
  it("muestra el aviso de pendiente de aceptación y su marca de agua", async () => {
    const pdf = await renderContractPdf(input());
    const text = extractText(pdf);
    const avisos = text
      .split("\n")
      .filter((row) => row === "PENDIENTE DE ACEPTACIÓN");
    // Marca de agua y encabezado del aviso.
    expect(avisos).toHaveLength(2);
    expect(extractFlowText(pdf)).toContain(
      "Copia de revisión del texto contractual. No es comprobante de aceptación " +
        "y no acredita que el Firmante haya aceptado el Contrato."
    );
    expect(text).toContain("AC-2026-000123 · Pendiente de aceptación");
    expect(text).toContain("Página 1 de 1");
  });

  it("no incluye el comprobante aunque se pasen datos de aceptación", async () => {
    const pdf = await renderContractPdf(
      input({
        kind: "review",
        acceptance: acceptance({
          signerName: `Firmante ${TOKEN}`,
          legend: `Leyenda ${TOKEN}`,
          documentHash: TOKEN,
          evidenceHash: TOKEN,
        }),
      })
    );
    const compact = extractCompactText(pdf);
    expect(compact).not.toContain(TOKEN);
    expect(compact).not.toContain("Comprobante de aceptación");
    expect(compact).not.toContain("Huella del documento");
    expect(compact).not.toContain("Intento de aceptación");
    expect(pdf.toString("latin1")).not.toContain(TOKEN);
  });

  it("omite el enlace y el token que viajan en los destinos del Markdown", async () => {
    const pdf = await renderContractPdf(
      input({
        markdown: [
          `Consulte el [texto vigente](https://fides.example/f/${TOKEN}).`,
          `![sello](https://fides.example/img/${TOKEN}.png)`,
        ].join("\n\n"),
      })
    );
    const compact = extractCompactText(pdf);
    expect(compact).toContain("Consulte el texto vigente.");
    expect(compact).toContain("sello");
    expect(compact).not.toContain(TOKEN);
    expect(compact).not.toContain("https://");
    expect(compact).not.toContain("fides.example");
    expect(pdf.toString("latin1")).not.toContain(TOKEN);
  });
});

describe("renderContractPdf: copia contractual aceptada", () => {
  it("imprime el comprobante con el Firmante, el intento y ambas huellas", async () => {
    const pdf = await renderContractPdf(
      input({ kind: "accepted", acceptance: acceptance() })
    );
    const text = extractText(pdf);
    const compact = extractCompactText(pdf);

    expect(text).toContain("CONTRATO ACEPTADO");
    expect(extractFlowText(pdf)).toContain(
      "Copia contractual aceptada. Reproduce el texto del Contrato emitido y el " +
        "comprobante de aceptación registrado por la plataforma."
    );
    expect(text).toContain("Comprobante de aceptación");

    expect(text).toContain("Firmante");
    expect(text).toContain("Ana Sofía Ruiz Pérez");

    expect(text).toContain("Intento de aceptación");
    expect(text).toContain("Número 3");

    expect(text).toContain("Referencia");
    expect(text).toContain("AC-2026-000123");

    expect(text).toContain("Huella del documento (SHA-256)");
    expect(text).toContain("Huella de la evidencia (SHA-256)");
    // Las huellas se parten al ajustar la línea: se comprueban sin separadores.
    expect(compact).toContain(DOCUMENT_HASH);
    expect(compact).toContain(EVIDENCE_HASH);

    expect(text).toContain("Leyenda de aceptación mostrada al Firmante");
    expect(compact).toContain(LEGEND);

    expect(text).toContain("AC-2026-000123 · Contrato aceptado");
    expect(text).not.toContain("PENDIENTE DE ACEPTACIÓN");
  });

  it("sella la fecha del servidor en la zona horaria de la Ciudad de México", async () => {
    const text = extractText(
      await renderContractPdf({
        ...input({ kind: "accepted" }),
        acceptance: acceptance(),
      })
    );
    expect(text).toContain("Fecha y hora del servidor");
    expect(text).toContain("15/01/2026, 12:30:00 (America/Mexico_City)");
  });

  it("conserva la advertencia sobre la suficiencia jurídica", async () => {
    const flow = extractFlowText(
      await renderContractPdf(
        input({ kind: "accepted", acceptance: acceptance() })
      )
    );
    expect(flow).toContain(
      "La plataforma conserva y presenta este contenido; no determina su " +
        "suficiencia jurídica ni sustituye la valoración de una autoridad."
    );
  });

  it("omite el comprobante cuando no se entrega la aceptación", async () => {
    const text = extractText(
      await renderContractPdf(input({ kind: "accepted" }))
    );
    expect(text).toContain("CONTRATO ACEPTADO");
    expect(text).not.toContain("Comprobante de aceptación");
    expect(text).toContain("AC-2026-000123 · Contrato aceptado");
  });

  it("mueve el comprobante a una página nueva cuando no cabe al final", async () => {
    const filler = Array.from(
      { length: 12 },
      (_, index) =>
        `Cláusula ${index + 1}. Texto contractual sintético con la extensión ` +
        "necesaria para ocupar el cuerpo de la página completa."
    ).join("\n\n");
    const pdf = await renderContractPdf(
      input({ kind: "accepted", markdown: filler, acceptance: acceptance() })
    );
    const document = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(document.getPageCount()).toBe(2);

    const pages = extractPages(pdf);
    expect(pages).toHaveLength(2);
    const [first, last] = pages;
    expect(first.some((row) => row.startsWith("Cláusula 1."))).toBe(true);
    expect(first.some((row) => row === "Comprobante de aceptación")).toBe(false);
    // La última página lleva sólo el comprobante, sin texto contractual.
    expect(last.some((row) => row === "Comprobante de aceptación")).toBe(true);
    expect(last.some((row) => row.startsWith("Cláusula"))).toBe(false);
    expect(last.join("")).toContain(DOCUMENT_HASH);
    expect(last.join("")).toContain(EVIDENCE_HASH);
  });
});

describe("renderContractPdf: paginación", () => {
  it("reparte el Markdown extenso en varias páginas numeradas", async () => {
    const markdown = Array.from(
      { length: 90 },
      (_, index) =>
        `Párrafo ${index + 1} del Contrato, con texto suficiente para ocupar ` +
        "más de un renglón y forzar el salto automático de página."
    ).join("\n\n");

    const pdf = await renderContractPdf(input({ markdown }));
    const document = await PDFDocument.load(pdf);
    const total = document.getPageCount();
    expect(total).toBeGreaterThan(3);

    const lines = extractLines(pdf);
    const footers = lines.filter((row) => row.startsWith("Página "));
    expect(footers).toEqual(
      Array.from({ length: total }, (_, index) => `Página ${index + 1} de ${total}`)
    );

    // El encabezado y el pie se repiten en todas las páginas.
    expect(lines.filter((row) => row === "FIDES")).toHaveLength(total);
    expect(
      lines.filter((row) => row === "AC-2026-000123 · Pendiente de aceptación")
    ).toHaveLength(total);
    // La marca de agua de revisión también.
    expect(
      lines.filter((row) => row === "PENDIENTE DE ACEPTACIÓN")
    ).toHaveLength(total + 1);

    expect(extractCompactText(pdf)).toContain("Párrafo 90 del Contrato");
  });

  it("mantiene una sola página con un Contrato breve", async () => {
    const document = await PDFDocument.load(
      await renderContractPdf(input({ markdown: "Texto breve." }))
    );
    expect(document.getPageCount()).toBe(1);
  });
});

describe("renderContractPdf: Markdown admitido", () => {
  it("aplana encabezados, listas, citas, énfasis, código y enlaces", async () => {
    const markdown = [
      "# Encabezado de primer nivel",
      "## Encabezado de segundo nivel",
      "### Encabezado de tercer nivel",
      "###### Encabezado de sexto nivel",
      "Texto con **negrita**, *cursiva*, ***ambas***, __otra negrita__ y `código`.",
      "- viñeta con guion\n- segunda viñeta",
      "* viñeta con asterisco",
      "+ viñeta con más",
      "1. primera numerada\n2. segunda numerada",
      "3) numerada con paréntesis",
      "> Cita contractual\n> continuada en otro renglón",
      "---",
      "## Encabezado seguido\nde un párrafo en el mismo bloque\n- y una viñeta\n4. y una numerada",
      "Párrafo final del Contrato.",
    ].join("\n\n");

    const pdf = await renderContractPdf(input({ markdown }));
    const lines = extractLines(pdf);
    const text = lines.join("\n");

    expect(text).toContain("Encabezado de primer nivel");
    expect(text).toContain("Encabezado de segundo nivel");
    expect(text).toContain("Encabezado de tercer nivel");
    expect(text).toContain("Encabezado de sexto nivel");

    expect(text).toContain(
      "Texto con negrita, cursiva, ambas, otra negrita y código."
    );
    expect(text).not.toContain("**");
    expect(text).not.toContain("`");
    expect(text).not.toContain("__");

    expect(text).toContain("viñeta con guion");
    expect(text).toContain("segunda viñeta");
    expect(text).toContain("viñeta con asterisco");
    expect(text).toContain("viñeta con más");
    // Cada viñeta se dibuja con su marca colgante.
    expect(lines.filter((row) => row === "·")).toHaveLength(5);

    expect(text).toContain("primera numerada");
    expect(text).toContain("segunda numerada");
    expect(text).toContain("numerada con paréntesis");
    expect(lines).toContain("1.");
    expect(lines).toContain("2.");
    expect(lines).toContain("3.");
    expect(lines).toContain("4.");

    expect(text).toContain("Cita contractual continuada en otro renglón");

    expect(text).toContain("Encabezado seguido");
    expect(text).toContain("de un párrafo en el mismo bloque");
    expect(text).toContain("y una viñeta");
    expect(text).toContain("y una numerada");

    expect(text).toContain("Párrafo final del Contrato.");
    // La regla horizontal se aplana a un renglón vacío, no a guiones sueltos.
    expect(lines).toContain("");
    expect(lines).not.toContain("---");
  });

  it("acepta un Markdown vacío o sólo con espacios", async () => {
    for (const markdown of ["", "   \n\n  \n", "\r\n\r\n"]) {
      const pdf = await renderContractPdf(input({ markdown }));
      const document = await PDFDocument.load(pdf);
      expect(document.getPageCount()).toBe(1);
      expect(extractText(pdf)).toContain("PENDIENTE DE ACEPTACIÓN");
    }
  });

  it("normaliza los finales de línea de Windows", async () => {
    const compact = extractCompactText(
      await renderContractPdf(
        input({ markdown: "# Título\r\n\r\nPrimer párrafo.\r\n\r\nSegundo párrafo." })
      )
    );
    expect(compact).toContain("Título");
    expect(compact).toContain("Primer párrafo.");
    expect(compact).toContain("Segundo párrafo.");
    expect(compact).not.toContain("\r");
  });

  it("parte las palabras más anchas que la caja de texto", async () => {
    const palabra = "A".repeat(400);
    const pdf = await renderContractPdf(input({ markdown: palabra }));
    const lines = extractLines(pdf);
    const trozos = lines.filter((row) => /^A+$/.test(row));
    expect(trozos.length).toBeGreaterThan(1);
    expect(trozos.join("")).toBe(palabra);
  });

  it("recorta el encabezado cuando la Organización y la Referencia no caben", async () => {
    const lines = extractLines(
      await renderContractPdf(
        input({
          organizationName: "Organización con un nombre desmedidamente largo ".repeat(4),
          reference: "AC-2026-000123",
        })
      )
    );
    const encabezado = lines.find((row) => row.startsWith("Organización con"));
    expect(encabezado).toBeDefined();
    expect(encabezado?.endsWith("...")).toBe(true);
  });

  it("usa «Contrato» cuando el Contrato-plantilla no tiene nombre", async () => {
    const text = extractText(await renderContractPdf(input({ templateName: "" })));
    expect(text).toContain("Contrato");
  });
});

describe("renderContractPdf: saneamiento WinAnsi", () => {
  it("sustituye o descarta los signos fuera de WinAnsi sin fallar", async () => {
    const markdown = [
      "Comillas “tipográficas” y ‘simples’ y ‚bajas‛.",
      "Guiones – medio — largo ― barra −.",
      "Puntos suspensivos… y viñetas • ● ⁃.",
      "Flechas → ← ⇒ y comparaciones ≤ ≥ ≠.",
      "Símbolos € ™ ‰ Œ œ Š š Ž ž Ÿ ‹ › † ‡.",
      "Emoji 🚀 y 😀 y bandera 🇲🇽.",
      "Espacios\u00a0duros\u202fy\u2009finos\u3000anchos.",
      "Invisibles\u200bcero\u200cancho\ufeffbom.",
      "Tabulación\ty tras ella.",
      "Acentos conservados: áéíóú ÁÉÍÓÚ ñÑ üÜ ¿¡ ° ª º.",
    ].join("\n\n");

    const pdf = await renderContractPdf(
      input({
        markdown,
        templateName: "Contrato “especial” — versión…",
        organizationName: "Aerolíneas 🚀 Demo",
        reference: "AC-2026-→-000123",
      })
    );
    const compact = extractCompactText(pdf);
    const text = extractText(pdf);

    expect(text).toContain('Comillas "tipográficas" y \'simples\' y \'bajas\'.');
    expect(text).toContain("Guiones - medio - largo - barra -.");
    expect(text).toContain("Puntos suspensivos... y viñetas - - -.");
    expect(text).toContain("Flechas -> <- => y comparaciones <= >= !=.");
    expect(text).toContain("Símbolos EUR (TM) 0/00 OE oe S s Z z Y < > + ++.");
    expect(text).toContain("Acentos conservados: áéíóú ÁÉÍÓÚ ñÑ üÜ ¿¡ ° ª º.");
    expect(compact).toContain("Contrato \"especial\" - versión...");
    expect(compact).toContain("AC-2026-->-000123");

    // Los emoji y los invisibles desaparecen sin dejar sustituto.
    expect(compact).not.toMatch(/[\u{1f000}-\u{1ffff}]/u);
    expect(compact).toContain("Emoji y y bandera");
    expect(compact).toContain("Aerolíneas Demo");
    expect(compact).toContain("Invisiblesceroanchobom");
    expect(compact).toContain("Espacios duros y finos anchos.");
    expect(compact).toContain("Tabulación y tras ella.");

    // Todo lo escrito cabe en WinAnsi: nada fuera de Latin-1 imprimible.
    for (const row of extractLines(pdf)) {
      for (const character of row) {
        const code = character.codePointAt(0) ?? 0;
        expect(code === 0x97 || (code >= 0x20 && code <= 0x7e) || code >= 0xa1).toBe(
          true
        );
        expect(code).toBeLessThanOrEqual(0xff);
      }
    }
  });

  it("no falla con signos fuera de WinAnsi en los campos del comprobante", async () => {
    const pdf = await renderContractPdf(
      input({
        kind: "accepted",
        acceptance: acceptance({
          signerName: "Ana 🚀 Ruiz — “La Firmante”",
          legend: "Acepto… → sin reservas.",
        }),
      })
    );
    const compact = extractCompactText(pdf);
    expect(compact).toContain('Ana Ruiz - "La Firmante"');
    expect(compact).toContain("Acepto... -> sin reservas.");
  });
});

describe("renderContractPdf: reproducibilidad", () => {
  it("produce un archivo idéntico con la misma entrada y la misma fecha", async () => {
    const payload = input({ kind: "accepted", acceptance: acceptance() });
    const first = await renderContractPdf(payload);
    const second = await renderContractPdf(payload);
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it("cambia el archivo cuando cambia la fecha de aceptación", async () => {
    const first = await renderContractPdf(
      input({ kind: "accepted", acceptance: acceptance() })
    );
    const second = await renderContractPdf(
      input({
        kind: "accepted",
        acceptance: acceptance({ acceptedAt: new Date("2026-02-20T18:30:00.000Z") }),
      })
    );
    expect(Buffer.compare(first, second)).not.toBe(0);
  });

  it("cambia el archivo cuando cambia el número de intento", async () => {
    const first = await renderContractPdf(
      input({ kind: "accepted", acceptance: acceptance() })
    );
    const second = await renderContractPdf(
      input({ kind: "accepted", acceptance: acceptance({ attemptSequence: 4 }) })
    );
    expect(Buffer.compare(first, second)).not.toBe(0);
  });
});

describe("renderContractPdf: valores límite", () => {
  it("escribe un guion cuando el comprobante trae campos vacíos", async () => {
    const pdf = await renderContractPdf(
      input({
        markdown: "",
        kind: "accepted",
        acceptance: acceptance({
          signerName: "",
          legend: "",
          documentHash: "",
          evidenceHash: "",
          attemptSequence: 1,
        }),
      })
    );
    const lines = extractLines(pdf);
    // El guion largo va en WinAnsi (0x97) y sustituye al valor ausente en el
    // Firmante, la huella del documento y la huella de la evidencia.
    expect(lines.filter((row) => row === "\u0097")).toHaveLength(3);
    // La leyenda vacía se dibuja como un renglón en blanco.
    expect(lines).toContain("");
    expect(lines).toContain("Comprobante de aceptación");
    expect(lines).toContain("Número 1");
  });

  it("trata como vacío un campo del Contrato ausente en tiempo de ejecución", async () => {
    // `ContractPdfInput` declara los campos como `string`, pero el saneador
    // admite `null` y `undefined` porque nacen de columnas y de consultas
    // opcionales. El doble `as` reproduce ese valor ausente sin relajar el
    // tipo público del módulo.
    const ausentes = [undefined, null] as unknown as string[];
    for (const ausente of ausentes) {
      const pdf = await renderContractPdf(input({ templateName: ausente }));
      const document = await PDFDocument.load(pdf, { updateMetadata: false });
      expect(document.getPageCount()).toBe(1);
      // Sin nombre de Contrato-plantilla, la portada usa el título genérico.
      expect(extractLines(pdf)).toContain("Contrato");
      expect(document.getTitle()).toBe(" · AC-2026-000123");
      expect(extractText(pdf)).toContain("AC-2026-000123 · Pendiente de aceptación");
    }
  });

  it("tolera una fecha de aceptación creada en otro contexto de ejecución", async () => {
    // Una fecha reconstruida fuera de este realm no es `instanceof Date`.
    const ajena = runInNewContext("new Date(NaN)") as unknown as Date;
    expect(ajena instanceof Date).toBe(false);
    expect(Number.isNaN(ajena.getTime())).toBe(true);

    const pdf = await renderContractPdf(
      input({ kind: "accepted", acceptance: acceptance({ acceptedAt: ajena }) })
    );
    const lines = extractLines(pdf);
    expect(lines).toContain("Fecha y hora del servidor");
    // Sin fecha legible, el comprobante escribe el guion largo de WinAnsi.
    expect(lines).toContain("\u0097 (America/Mexico_City)");
    expect(lines).toContain("Comprobante de aceptación");
    await expect(PDFDocument.load(pdf)).resolves.toBeDefined();
  });

  // Falla a propósito: documenta un defecto pendiente de corregir en `lib/`.
  it("mantiene el documento legible con una fecha de aceptación inválida", async () => {
    const pdf = await renderContractPdf(
      input({
        kind: "accepted",
        acceptance: acceptance({ acceptedAt: new Date("no-es-una-fecha") }),
      })
    );
    expect(extractText(pdf)).toContain("Fecha y hora del servidor");
    // BUG: `setCreationDate` recibe la fecha inválida y escribe
    // `D:0NaNNaNNaNNaNNaNNaNZ`, por lo que el PDF ya no se puede volver a leer.
    const document = await PDFDocument.load(pdf);
    expect(() => document.getCreationDate()).not.toThrow();
  });
});
