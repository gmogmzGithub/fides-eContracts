import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  markdownToPlainText,
  renderMarkdown,
} from "@/lib/markdown";

describe("escapeHtml", () => {
  it("escapa los cinco caracteres sensibles de HTML", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;"
    );
  });

  it("escapa el ampersand antes que las demás entidades", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("devuelve el texto sin cambios cuando no hay caracteres sensibles", () => {
    expect(escapeHtml("Cláusula décima: pago en MXN")).toBe(
      "Cláusula décima: pago en MXN"
    );
  });

  it("devuelve cadena vacía para entrada vacía", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("renderMarkdown con encabezados", () => {
  it("desplaza los niveles de # a #### hacia h2 a h5", () => {
    expect(renderMarkdown("# Título")).toBe("<h2>Título</h2>");
    expect(renderMarkdown("## Sub")).toBe("<h3>Sub</h3>");
    expect(renderMarkdown("### Tres")).toBe("<h4>Tres</h4>");
    expect(renderMarkdown("#### Cuatro")).toBe("<h5>Cuatro</h5>");
  });

  it("no reconoce cinco almohadillas y las deja como párrafo", () => {
    expect(renderMarkdown("##### Cinco")).toBe("<p>##### Cinco</p>");
  });

  it("aplica el formato en línea dentro del encabezado", () => {
    expect(renderMarkdown("# Contrato **maestro**")).toBe(
      "<h2>Contrato <strong>maestro</strong></h2>"
    );
  });
});

describe("renderMarkdown con listas", () => {
  it("agrupa guiones y asteriscos en una sola lista sin orden", () => {
    expect(renderMarkdown("- uno\n- dos\n* tres")).toBe(
      "<ul><li>uno</li><li>dos</li><li>tres</li></ul>"
    );
  });

  it("acepta numeración con punto y con paréntesis en la lista ordenada", () => {
    expect(renderMarkdown("1. uno\n2) dos\n3. tres")).toBe(
      "<ol><li>uno</li><li>dos</li><li>tres</li></ol>"
    );
  });

  it("no produce lista cuando alguna línea del bloque no es un elemento", () => {
    expect(renderMarkdown("- uno\ntexto")).toBe("<p>- uno<br />texto</p>");
  });

  it("aplica el formato en línea dentro de cada elemento", () => {
    expect(renderMarkdown("- **a**\n- `b`")).toBe(
      "<ul><li><strong>a</strong></li><li><code>b</code></li></ul>"
    );
  });
});

describe("renderMarkdown con citas", () => {
  it("une las líneas de la cita en un solo blockquote", () => {
    expect(renderMarkdown("> cita uno\n> cita dos")).toBe(
      "<blockquote>cita uno cita dos</blockquote>"
    );
  });

  it("acepta el marcador de cita sin espacio", () => {
    expect(renderMarkdown(">sin espacio")).toBe(
      "<blockquote>sin espacio</blockquote>"
    );
  });

  it("basta con que la primera línea sea cita para tomar el bloque completo", () => {
    expect(renderMarkdown("> uno\nsegunda")).toBe(
      "<blockquote>uno segunda</blockquote>"
    );
  });
});

describe("renderMarkdown con párrafos y formato en línea", () => {
  it("convierte el salto de línea simple en un salto visual", () => {
    expect(renderMarkdown("linea uno\nlinea dos")).toBe(
      "<p>linea uno<br />linea dos</p>"
    );
  });

  it("reconoce negrita, énfasis y código", () => {
    expect(renderMarkdown("**fuerte** y *enfasis* y `codigo`")).toBe(
      "<p><strong>fuerte</strong> y <em>enfasis</em> y <code>codigo</code></p>"
    );
  });

  it("reconoce el énfasis al inicio del bloque y repetido", () => {
    expect(renderMarkdown("*inicio* medio *final*")).toBe(
      "<p><em>inicio</em> medio <em>final</em></p>"
    );
  });

  it("deja intacto un asterisco suelto", () => {
    expect(renderMarkdown("texto con * suelto")).toBe(
      "<p>texto con * suelto</p>"
    );
  });

  it("separa los bloques con una línea en blanco y conserva el orden", () => {
    expect(renderMarkdown("Cláusula 1\n\n- a\n- b\n\n> nota")).toBe(
      "<p>Cláusula 1</p>\n<ul><li>a</li><li>b</li></ul>\n<blockquote>nota</blockquote>"
    );
  });

  it("normaliza los finales de línea CRLF", () => {
    expect(renderMarkdown("uno\r\n\r\ndos")).toBe("<p>uno</p>\n<p>dos</p>");
  });

  it("devuelve cadena vacía para texto vacío o sólo espacios", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("\n\n\n")).toBe("");
    expect(renderMarkdown("  \n  ")).toBe("");
  });
});

describe("renderMarkdown y el HTML del origen", () => {
  it("escapa el HTML incrustado en lugar de ejecutarlo", () => {
    expect(renderMarkdown("<script>alert('x')</script>")).toBe(
      "<p>&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;</p>"
    );
  });

  it("escapa comillas y ampersand dentro del párrafo", () => {
    expect(renderMarkdown('Cliente & "proveedor"')).toBe(
      "<p>Cliente &amp; &quot;proveedor&quot;</p>"
    );
  });

  it("escapa el HTML también dentro de código en línea", () => {
    expect(renderMarkdown("`<b>x</b>`")).toBe(
      "<p><code>&lt;b&gt;x&lt;/b&gt;</code></p>"
    );
  });

  it("escapa el HTML dentro de encabezados, listas y citas", () => {
    expect(renderMarkdown("# <img src=x>")).toBe(
      "<h2>&lt;img src=x&gt;</h2>"
    );
    expect(renderMarkdown("- <img src=x>")).toBe(
      "<ul><li>&lt;img src=x&gt;</li></ul>"
    );
    expect(renderMarkdown("> <img src=x>")).toBe(
      "<blockquote>&lt;img src=x&gt;</blockquote>"
    );
  });
});

describe("markdownToPlainText", () => {
  it("quita encabezados, citas y marcas de formato", () => {
    expect(
      markdownToPlainText("# Título\n\n> cita\n\n**a** *b* `c`")
    ).toBe("Título\n\ncita\n\na b c");
  });

  it("quita encabezados de hasta seis almohadillas", () => {
    expect(markdownToPlainText("###### seis")).toBe("seis");
  });

  it("normaliza CRLF y recorta los extremos", () => {
    expect(markdownToPlainText("\r\n  uno\r\ndos  \n")).toBe("uno\ndos");
  });

  it("conserva los marcadores de lista porque el texto plano no los interpreta", () => {
    expect(markdownToPlainText("- uno\n- dos")).toBe("- uno\n- dos");
  });

  it("no altera el HTML del origen porque no lo escapa ni lo ejecuta", () => {
    expect(markdownToPlainText("<b>hola</b>")).toBe("<b>hola</b>");
  });

  it("devuelve cadena vacía para texto vacío", () => {
    expect(markdownToPlainText("")).toBe("");
  });
});
