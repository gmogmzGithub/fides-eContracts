import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cx(
        "flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5",
        className
      )}
    >
      <div className="grid gap-2">
        <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight text-carbon sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-carbon-soft">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
