import type { ReactNode } from "react";
import { CONTRACT_STATUS_LABELS, type ContractStatus } from "@/lib/domain/types";
import { cx } from "@/components/ui/cx";

export type BadgeTone = "neutral" | "info" | "success" | "warn" | "danger";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-line bg-[#f5f5f4] text-carbon-soft",
  info: "border-info/25 bg-info-soft text-info",
  success: "border-success/25 bg-success-soft text-success",
  warn: "border-warn/25 bg-warn-soft text-warn",
  danger: "border-danger/25 bg-danger-soft text-danger",
};

export interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone, children, className }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONES: Record<ContractStatus, BadgeTone> = {
  pending: "info",
  in_review: "warn",
  accepted: "success",
  expired: "neutral",
  cancelled: "danger",
};

export interface StatusBadgeProps {
  status: ContractStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <Badge tone={STATUS_TONES[status]} className={className}>
      {CONTRACT_STATUS_LABELS[status]}
    </Badge>
  );
}
