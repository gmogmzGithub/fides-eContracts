import { cx } from "@/components/ui/cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "success" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border font-body font-medium " +
  "transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-carbon text-ivory hover:bg-carbon-soft active:bg-carbon-deep",
  secondary:
    "border-carbon/25 bg-transparent text-carbon hover:border-carbon hover:bg-carbon/5",
  ghost:
    "border-transparent bg-transparent text-carbon-soft hover:bg-carbon/5 hover:text-carbon",
  success:
    "border-transparent bg-success text-white hover:bg-[#166534] active:bg-[#14532d]",
  danger:
    "border-transparent bg-danger text-white hover:bg-[#991b1b] active:bg-[#7f1d1d]",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-5 py-2.5 text-[0.9375rem]",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string
): string {
  return cx(BASE, VARIANTS[variant], SIZES[size], className);
}
