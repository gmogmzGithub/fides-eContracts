import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        "grid justify-items-center gap-3 rounded-xl border border-dashed border-line bg-white px-6 py-14 text-center",
        className
      )}
    >
      <span className="ca-rule w-16" aria-hidden="true" />
      <h2 className="font-display text-xl font-semibold text-carbon">{title}</h2>
      {description ? (
        <p className="max-w-md text-sm leading-relaxed text-carbon-soft">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
