import { renderMarkdown } from "@/lib/markdown";
import { PROSE } from "./styles";

/**
 * `renderMarkdown` escapa el HTML de entrada: el texto jurídico se muestra
 * tal cual, sin ejecutar nada del contenido publicado.
 */
export function MarkdownBlock({
  markdown,
  className = "",
}: {
  markdown: string;
  className?: string;
}) {
  return (
    <div
      className={`${PROSE} ${className}`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
    />
  );
}
