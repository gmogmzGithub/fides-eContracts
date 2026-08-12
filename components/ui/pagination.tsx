import Link from "next/link";
import { cx } from "@/components/ui/cx";

export interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  basePath: string;
  params?: Record<string, string | undefined>;
  className?: string;
}

function hrefFor(
  basePath: string,
  params: Record<string, string | undefined> | undefined,
  page: number
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  if (page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

const LINK =
  "inline-flex cursor-pointer items-center rounded-lg border border-carbon/25 px-3 py-1.5 " +
  "text-sm font-medium text-carbon transition-colors duration-200 hover:border-carbon hover:bg-carbon/5 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const DISABLED =
  "inline-flex items-center rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-muted";

export function Pagination({
  page,
  pages,
  total,
  basePath,
  params,
  className,
}: PaginationProps) {
  const safePages = Math.max(1, pages);
  const safePage = Math.min(Math.max(1, page), safePages);
  return (
    <nav
      aria-label="Paginación"
      className={cx(
        "flex flex-wrap items-center justify-between gap-3 pt-1",
        className
      )}
    >
      <p className="text-sm text-carbon-soft">
        Página {safePage} de {safePages} ({total}{" "}
        {total === 1 ? "resultado" : "resultados"})
      </p>
      <div className="flex items-center gap-2">
        {safePage > 1 ? (
          <Link className={LINK} href={hrefFor(basePath, params, safePage - 1)} rel="prev">
            Anterior
          </Link>
        ) : (
          <span className={DISABLED} aria-disabled="true">
            Anterior
          </span>
        )}
        {safePage < safePages ? (
          <Link className={LINK} href={hrefFor(basePath, params, safePage + 1)} rel="next">
            Siguiente
          </Link>
        ) : (
          <span className={DISABLED} aria-disabled="true">
            Siguiente
          </span>
        )}
      </div>
    </nav>
  );
}
