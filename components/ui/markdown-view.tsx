import { renderMarkdown } from "@/lib/markdown";
import { cx } from "@/components/ui/cx";

export interface MarkdownViewProps {
  markdown: string;
  className?: string;
}

/**
 * El texto digital es el documento primario. `renderMarkdown` ya escapa el
 * contenido: no admite HTML incrustado y no ejecuta lógica.
 */
export function MarkdownView({ markdown, className }: MarkdownViewProps) {
  return (
    <div
      className={cx("prose-contract", className)}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
    />
  );
}
