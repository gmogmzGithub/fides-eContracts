/**
 * Render mínimo de Markdown contractual a HTML.
 * No ejecuta lógica ni admite HTML incrustado: el texto jurídico se muestra tal cual.
 */
export function renderMarkdown(markdown: string): string {
  const blocks = markdown.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks
    .map((block) => renderBlock(block.trim()))
    .filter(Boolean)
    .join("\n");
}

function renderBlock(block: string): string {
  if (!block) return "";
  const heading = /^(#{1,4})\s+(.*)$/.exec(block);
  if (heading) {
    const level = heading[1].length + 1;
    return `<h${level}>${inline(heading[2])}</h${level}>`;
  }
  if (/^([-*])\s+/m.test(block) && block.split("\n").every((line) => /^([-*])\s+/.test(line.trim()))) {
    const items = block
      .split("\n")
      .map((line) => `<li>${inline(line.trim().replace(/^([-*])\s+/, ""))}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  }
  if (block.split("\n").every((line) => /^\d+[.)]\s+/.test(line.trim()))) {
    const items = block
      .split("\n")
      .map((line) => `<li>${inline(line.trim().replace(/^\d+[.)]\s+/, ""))}</li>`)
      .join("");
    return `<ol>${items}</ol>`;
  }
  if (/^>\s?/.test(block)) {
    const quoted = block
      .split("\n")
      .map((line) => line.replace(/^>\s?/, ""))
      .join(" ");
    return `<blockquote>${inline(quoted)}</blockquote>`;
  }
  return `<p>${inline(block).replace(/\n/g, "<br />")}</p>`;
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Texto plano del Markdown, usado por el PDF y por el buscador. */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}
