import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

export interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <section
      className={cx(
        "overflow-hidden rounded-xl border border-line bg-white shadow-sm",
        className
      )}
    >
      {children}
    </section>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: CardHeaderProps) {
  return (
    <header
      className={cx(
        "flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4",
        className
      )}
    >
      <div className="grid gap-1">
        <h2 className="font-display text-lg leading-tight font-semibold text-carbon">
          {title}
        </h2>
        {description ? (
          <p className="text-sm leading-relaxed text-carbon-soft">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

export function CardBody({ children, className }: CardProps) {
  return <div className={cx("px-5 py-4", className)}>{children}</div>;
}
