import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
} from "pdf-lib";

/**
 * Representación PDF bajo demanda del Contrato emitido (ADR-0059).
 * Nunca contiene el enlace, el token, la INE o el video: sólo el texto
 * contractual y, después de la aceptación, su comprobante.
 */

export type ContractPdfKind = "review" | "accepted";

export interface ContractPdfAcceptance {
  signerName: string;
  acceptedAt: Date;
  legend: string;
  documentHash: string;
  evidenceHash: string;
  attemptSequence: number;
}

export interface ContractPdfInput {
  reference: string;
  organizationName: string;
  templateName: string;
  markdown: string;
  kind: ContractPdfKind;
  acceptance?: ContractPdfAcceptance;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 64;
const MARGIN_TOP = 96;
const MARGIN_BOTTOM = 76;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const INK = rgb(0.11, 0.106, 0.09); // carbón
const MUTED = rgb(0.35, 0.34, 0.32);
const HAIRLINE = rgb(0.82, 0.81, 0.79);
const ACCENT = rgb(0.79, 0.541, 0.016); // acento cálido
const WATERMARK = rgb(0.9, 0.885, 0.86);
const BANNER_BG = rgb(0.976, 0.957, 0.898);

const BODY_SIZE = 10.5;
const BODY_LEADING = 15.5;
const TIME_ZONE = "America/Mexico_City";

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

interface Block {
  kind: "heading" | "paragraph" | "bullet" | "numbered" | "quote";
  level: number;
  marker: string;
  text: string;
}

export async function renderContractPdf(input: ContractPdfInput): Promise<Buffer> {
  const document = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
    italic: await document.embedFont(StandardFonts.HelveticaOblique),
  };

  const reference = clean(input.reference);
  const organizationName = clean(input.organizationName);
  const templateName = clean(input.templateName);
  const isReview = input.kind === "review";

  const pages: PDFPage[] = [];
  let page = newPage();
  let cursor = PAGE_HEIGHT - MARGIN_TOP;

  function newPage(): PDFPage {
    const created = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(created);
    if (isReview) drawWatermark(created, fonts);
    drawHeader(created, fonts, organizationName, reference);
    return created;
  }

  function space(height: number): void {
    if (cursor - height < MARGIN_BOTTOM) {
      page = newPage();
      cursor = PAGE_HEIGHT - MARGIN_TOP;
    }
    cursor -= height;
  }

  function line(
    text: string,
    options: {
      font?: PDFFont;
      size?: number;
      leading?: number;
      color?: ReturnType<typeof rgb>;
      indent?: number;
    } = {}
  ): void {
    /* v8 ignore next 1 -- `line` sólo se invoca desde `paragraph`, que siempre resuelve el tamaño antes de delegar: el respaldo no es alcanzable. */
    const size = options.size ?? BODY_SIZE;
    const leading = options.leading ?? BODY_LEADING;
    space(leading);
    page.drawText(text, {
      /* v8 ignore next 1 -- `line` sólo se invoca desde `paragraph`, que siempre pasa una sangría numérica: el respaldo no es alcanzable. */
      x: MARGIN_X + (options.indent ?? 0),
      y: cursor,
      size,
      /* v8 ignore next 1 -- `line` sólo se invoca desde `paragraph`, que siempre resuelve la fuente antes de delegar: el respaldo no es alcanzable. */
      font: options.font ?? fonts.regular,
      color: options.color ?? INK,
    });
  }

  function paragraph(
    text: string,
    options: {
      font?: PDFFont;
      size?: number;
      leading?: number;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      hangingMarker?: string;
    } = {}
  ): void {
    const font = options.font ?? fonts.regular;
    const size = options.size ?? BODY_SIZE;
    const indent = options.indent ?? 0;
    const marker = options.hangingMarker ?? "";
    const markerWidth = marker ? font.widthOfTextAtSize(`${marker} `, size) : 0;
    const width = CONTENT_WIDTH - indent - markerWidth;
    const rows = wrap(text, font, size, width);
    rows.forEach((row, index) => {
      if (index === 0 && marker) {
        space(options.leading ?? BODY_LEADING);
        page.drawText(marker, {
          x: MARGIN_X + indent,
          y: cursor,
          size,
          font,
          color: options.color ?? INK,
        });
        page.drawText(row, {
          x: MARGIN_X + indent + markerWidth,
          y: cursor,
          size,
          font,
          color: options.color ?? INK,
        });
        return;
      }
      line(row, {
        font,
        size,
        leading: options.leading,
        color: options.color,
        indent: indent + markerWidth,
      });
    });
  }

  // Portada breve: la Organización, el Contrato-plantilla y la Referencia.
  paragraph(templateName || "Contrato", {
    font: fonts.bold,
    size: 17,
    leading: 22,
  });
  space(4);
  paragraph(`${organizationName} · Referencia ${reference}`, {
    font: fonts.regular,
    size: 10,
    leading: 14,
    color: MUTED,
  });
  space(10);

  if (isReview) {
    drawBanner(
      page,
      fonts,
      cursor,
      "PENDIENTE DE ACEPTACIÓN",
      "Copia de revisión del texto contractual. No es comprobante de aceptación " +
        "y no acredita que el Firmante haya aceptado el Contrato."
    );
    cursor -= bannerHeight(
      fonts,
      "Copia de revisión del texto contractual. No es comprobante de aceptación " +
        "y no acredita que el Firmante haya aceptado el Contrato."
    );
    space(14);
  } else {
    drawBanner(
      page,
      fonts,
      cursor,
      "CONTRATO ACEPTADO",
      "Copia contractual aceptada. Reproduce el texto del Contrato emitido y el " +
        "comprobante de aceptación registrado por la plataforma."
    );
    cursor -= bannerHeight(
      fonts,
      "Copia contractual aceptada. Reproduce el texto del Contrato emitido y el " +
        "comprobante de aceptación registrado por la plataforma."
    );
    space(14);
  }

  for (const block of parseBlocks(input.markdown)) {
    switch (block.kind) {
      case "heading": {
        const size = block.level <= 1 ? 14 : block.level === 2 ? 12 : 11;
        space(block.level <= 2 ? 12 : 8);
        paragraph(block.text, { font: fonts.bold, size, leading: size + 5 });
        space(3);
        break;
      }
      case "bullet":
        paragraph(block.text, { indent: 12, hangingMarker: "·" });
        space(3);
        break;
      case "numbered":
        paragraph(block.text, { indent: 12, hangingMarker: block.marker });
        space(3);
        break;
      case "quote":
        paragraph(block.text, { font: fonts.italic, indent: 16, color: MUTED });
        space(8);
        break;
      default:
        paragraph(block.text);
        space(8);
        break;
    }
  }

  if (!isReview && input.acceptance) {
    const acceptance = input.acceptance;
    space(18);
    if (cursor < MARGIN_BOTTOM + 190) {
      page = newPage();
      cursor = PAGE_HEIGHT - MARGIN_TOP;
    }
    space(6);
    page.drawLine({
      start: { x: MARGIN_X, y: cursor + 8 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: cursor + 8 },
      thickness: 1,
      color: ACCENT,
    });
    space(6);
    paragraph("Comprobante de aceptación", {
      font: fonts.bold,
      size: 13,
      leading: 18,
    });
    space(6);

    const rows: [string, string][] = [
      ["Firmante", clean(acceptance.signerName)],
      ["Fecha y hora del servidor", `${formatStamp(acceptance.acceptedAt)} (America/Mexico_City)`],
      ["Intento de aceptación", `Número ${acceptance.attemptSequence}`],
      ["Referencia", reference],
      ["Huella del documento (SHA-256)", clean(acceptance.documentHash)],
      ["Huella de la evidencia (SHA-256)", clean(acceptance.evidenceHash)],
    ];
    const labelWidth = 168;
    for (const [label, value] of rows) {
      const valueRows = wrap(
        value || "—",
        fonts.regular,
        9.5,
        CONTENT_WIDTH - labelWidth
      );
      valueRows.forEach((row, index) => {
        space(13);
        if (index === 0) {
          page.drawText(label, {
            x: MARGIN_X,
            y: cursor,
            size: 9.5,
            font: fonts.bold,
            color: MUTED,
          });
        }
        page.drawText(row, {
          x: MARGIN_X + labelWidth,
          y: cursor,
          size: 9.5,
          font: fonts.regular,
          color: INK,
        });
      });
      space(3);
    }

    space(10);
    paragraph("Leyenda de aceptación mostrada al Firmante", {
      font: fonts.bold,
      size: 9.5,
      leading: 13,
      color: MUTED,
    });
    space(3);
    paragraph(clean(acceptance.legend), {
      font: fonts.italic,
      size: 9.5,
      leading: 13.5,
    });
    space(10);
    paragraph(
      "La plataforma conserva y presenta este contenido; no determina su " +
        "suficiencia jurídica ni sustituye la valoración de una autoridad.",
      { size: 8.5, leading: 12, color: MUTED }
    );
  }

  drawFooters(pages, fonts, reference, isReview);

  if (input.acceptance && !Number.isNaN(input.acceptance.acceptedAt.getTime())) {
    // La Copia contractual aceptada se conserva una sola vez: fijar las fechas
    // internas permite recalcular su hash sin diferencias entre renders. Una
    // fecha inválida se omite para no escribir un documento ilegible.
    document.setCreationDate(input.acceptance.acceptedAt);
    document.setModificationDate(input.acceptance.acceptedAt);
  }
  document.setTitle(`${templateName} · ${reference}`);
  document.setSubject(
    isReview ? "Copia de revisión · Pendiente de aceptación" : "Copia contractual aceptada"
  );
  document.setAuthor(organizationName);
  document.setProducer("Fides");
  document.setCreator("Fides");

  return Buffer.from(await document.save());
}

function drawHeader(
  page: PDFPage,
  fonts: Fonts,
  organizationName: string,
  reference: string
): void {
  const y = PAGE_HEIGHT - 56;
  page.drawText("FIDES", {
    x: MARGIN_X,
    y,
    size: 9,
    font: fonts.bold,
    color: INK,
  });
  page.drawRectangle({
    x: MARGIN_X + fonts.bold.widthOfTextAtSize("FIDES", 9) + 6,
    y: y + 2,
    width: 14,
    height: 1.5,
    color: ACCENT,
  });
  const right = truncate(
    `${organizationName} · ${reference}`,
    fonts.regular,
    9,
    CONTENT_WIDTH - 140
  );
  page.drawText(right, {
    x: PAGE_WIDTH - MARGIN_X - fonts.regular.widthOfTextAtSize(right, 9),
    y,
    size: 9,
    font: fonts.regular,
    color: MUTED,
  });
  page.drawLine({
    start: { x: MARGIN_X, y: y - 10 },
    end: { x: PAGE_WIDTH - MARGIN_X, y: y - 10 },
    thickness: 0.5,
    color: HAIRLINE,
  });
}

function drawFooters(
  pages: PDFPage[],
  fonts: Fonts,
  reference: string,
  isReview: boolean
): void {
  const total = pages.length;
  pages.forEach((page, index) => {
    const y = 46;
    page.drawLine({
      start: { x: MARGIN_X, y: y + 14 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: y + 14 },
      thickness: 0.5,
      color: HAIRLINE,
    });
    const left = isReview
      ? `${reference} · Pendiente de aceptación`
      : `${reference} · Contrato aceptado`;
    page.drawText(left, {
      x: MARGIN_X,
      y,
      size: 8,
      font: fonts.regular,
      color: MUTED,
    });
    const right = `Página ${index + 1} de ${total}`;
    page.drawText(right, {
      x: PAGE_WIDTH - MARGIN_X - fonts.regular.widthOfTextAtSize(right, 8),
      y,
      size: 8,
      font: fonts.regular,
      color: MUTED,
    });
  });
}

function drawWatermark(page: PDFPage, fonts: Fonts): void {
  const text = "PENDIENTE DE ACEPTACIÓN";
  const size = 34;
  const width = fonts.bold.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: PAGE_WIDTH / 2 - (width * Math.SQRT1_2) / 2 - 18,
    y: PAGE_HEIGHT / 2 - (width * Math.SQRT1_2) / 2,
    size,
    font: fonts.bold,
    color: WATERMARK,
    rotate: degrees(45),
  });
}

function bannerHeight(fonts: Fonts, note: string): number {
  const rows = wrap(note, fonts.regular, 9, CONTENT_WIDTH - 28);
  return 26 + rows.length * 12 + 12;
}

function drawBanner(
  page: PDFPage,
  fonts: Fonts,
  top: number,
  title: string,
  note: string
): void {
  const rows = wrap(note, fonts.regular, 9, CONTENT_WIDTH - 28);
  const height = bannerHeight(fonts, note);
  page.drawRectangle({
    x: MARGIN_X,
    y: top - height,
    width: CONTENT_WIDTH,
    height,
    color: BANNER_BG,
  });
  page.drawRectangle({
    x: MARGIN_X,
    y: top - height,
    width: 3,
    height,
    color: ACCENT,
  });
  page.drawText(title, {
    x: MARGIN_X + 14,
    y: top - 22,
    size: 10.5,
    font: fonts.bold,
    color: INK,
  });
  rows.forEach((row, index) => {
    page.drawText(row, {
      x: MARGIN_X + 14,
      y: top - 38 - index * 12,
      size: 9,
      font: fonts.regular,
      color: MUTED,
    });
  });
}

/** Bloques del Markdown contractual: encabezados, párrafos, listas y citas. */
function parseBlocks(markdown: string): Block[] {
  const source = clean(markdown).replace(/\r\n/g, "\n");
  const blocks: Block[] = [];
  for (const raw of source.split(/\n{2,}/)) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const lines = chunk.split("\n").map((entry) => entry.trim());

    if (lines.every((entry) => /^([-*+])\s+/.test(entry))) {
      for (const entry of lines) {
        blocks.push({
          kind: "bullet",
          level: 0,
          marker: "·",
          text: inlineToPlain(entry.replace(/^([-*+])\s+/, "")),
        });
      }
      continue;
    }

    if (lines.every((entry) => /^\d+[.)]\s+/.test(entry))) {
      for (const entry of lines) {
        /* v8 ignore next 1 -- el bloque ya cumplió `/^\d+[.)]\s+/` en cada renglón, así que `exec` siempre acierta y el grupo de dígitos siempre existe. */
        const marker = /^(\d+)[.)]/.exec(entry)?.[1] ?? "";
        blocks.push({
          kind: "numbered",
          level: 0,
          marker: `${marker}.`,
          text: inlineToPlain(entry.replace(/^\d+[.)]\s+/, "")),
        });
      }
      continue;
    }

    if (lines.every((entry) => entry.startsWith(">"))) {
      blocks.push({
        kind: "quote",
        level: 0,
        marker: "",
        text: inlineToPlain(lines.map((entry) => entry.replace(/^>\s?/, "")).join(" ")),
      });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(lines[0]);
    if (heading && lines.length === 1) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        marker: "",
        text: inlineToPlain(heading[2]),
      });
      continue;
    }

    for (const entry of lines) {
      const inner = /^(#{1,6})\s+(.*)$/.exec(entry);
      if (inner) {
        blocks.push({
          kind: "heading",
          level: inner[1].length,
          marker: "",
          text: inlineToPlain(inner[2]),
        });
      } else if (/^([-*+])\s+/.test(entry)) {
        blocks.push({
          kind: "bullet",
          level: 0,
          marker: "·",
          text: inlineToPlain(entry.replace(/^([-*+])\s+/, "")),
        });
      } else if (/^\d+[.)]\s+/.test(entry)) {
        blocks.push({
          kind: "numbered",
          level: 0,
          /* v8 ignore next 1 -- este renglón ya cumplió `/^\d+[.)]\s+/`, así que `exec` siempre acierta y el grupo de dígitos siempre existe. */
          marker: `${/^(\d+)[.)]/.exec(entry)?.[1] ?? ""}.`,
          text: inlineToPlain(entry.replace(/^\d+[.)]\s+/, "")),
        });
      } else {
        blocks.push({ kind: "paragraph", level: 0, marker: "", text: inlineToPlain(entry) });
      }
    }
  }
  return blocks;
}

/** El PDF es texto sobrio: negritas, cursivas y código se muestran en plano. */
function inlineToPlain(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*_]{3,}\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const usable = Math.max(width, 40);
  const rows: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= usable) {
      current = candidate;
      continue;
    }
    if (current) rows.push(current);
    if (font.widthOfTextAtSize(word, size) <= usable) {
      current = word;
      continue;
    }
    let piece = "";
    for (const character of word) {
      if (font.widthOfTextAtSize(piece + character, size) > usable && piece) {
        rows.push(piece);
        piece = "";
      }
      piece += character;
    }
    current = piece;
  }
  if (current) rows.push(current);
  return rows.length > 0 ? rows : [""];
}

function truncate(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > width) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

function formatStamp(value: Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return clean(
    new Intl.DateTimeFormat("es-MX", {
      timeZone: TIME_ZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date)
  );
}

const SUBSTITUTIONS: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "″": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
  "…": "...",
  "•": "-",
  "●": "-",
  "⁃": "-",
  "→": "->",
  "←": "<-",
  "⇒": "=>",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "€": "EUR",
  "™": "(TM)",
  "‰": "0/00",
  "Œ": "OE",
  "œ": "oe",
  "Š": "S",
  "š": "s",
  "Ž": "Z",
  "ž": "z",
  "Ÿ": "Y",
  "‹": "<",
  "›": ">",
  "†": "+",
  "‡": "++",
  "\u00a0": " ",
  "\u202f": " ",
  "\u2007": " ",
  "\u2009": " ",
  "\u200a": " ",
  "\u3000": " ",
  "\t": "    ",
  "\u200b": "",
  "\u200c": "",
  "\u200d": "",
  "\ufeff": "",
};

/**
 * Las fuentes estándar de PDF sólo cubren WinAnsi. Los acentos del español se
 * conservan; cualquier otro signo se sustituye o se descarta en lugar de fallar.
 */
function clean(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  for (const [from, to] of Object.entries(SUBSTITUTIONS)) {
    if (text.includes(from)) text = text.split(from).join(to);
  }
  let output = "";
  for (const character of text) {
    if (character === "\n") {
      output += "\n";
      continue;
    }
    /* v8 ignore next 1 -- `for...of` sobre una cadena sólo entrega caracteres no vacíos, así que `codePointAt(0)` nunca es `undefined`. */
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) {
      output += character;
    } else if (code >= 0xa1 && code <= 0xff) {
      output += character;
    }
    // Emoji y cualquier otro signo fuera de WinAnsi se descartan en silencio.
  }
  return output;
}
