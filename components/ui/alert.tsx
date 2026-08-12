import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { cx } from "@/components/ui/cx";

export type AlertTone = "info" | "success" | "warn" | "danger";

const TONES: Record<AlertTone, string> = {
  info: "border-info/25 bg-info-soft text-info",
  success: "border-success/25 bg-success-soft text-success",
  warn: "border-warn/25 bg-warn-soft text-warn",
  danger: "border-danger/25 bg-danger-soft text-danger",
};

const ICONS: Record<AlertTone, ComponentType<{ className?: string }>> = {
  info: Info,
  success: CircleCheck,
  warn: TriangleAlert,
  danger: CircleAlert,
};

export interface AlertProps {
  tone: AlertTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}

export function Alert({ tone, title, children, className }: AlertProps) {
  const Icon = ICONS[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed",
        TONES[tone],
        className
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="grid gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-carbon-soft">{children}</div> : null}
      </div>
    </div>
  );
}
