import Image from "next/image";
import { cx } from "@/components/ui/cx";

export interface WordmarkProps {
  /** `light` sobre carbón, `dark` sobre marfil. */
  tone?: "light" | "dark";
  className?: string;
  compact?: boolean;
}

/** Marca visible de Fides. */
export function Wordmark({ tone = "dark", className, compact }: WordmarkProps) {
  const ink = tone === "light" ? "text-ivory" : "text-carbon";
  return (
    <span className={cx("inline-flex items-center gap-2.5", ink, className)}>
      <Image
        src="/images/fides-goddess-mark.png"
        alt=""
        width={36}
        height={36}
        sizes="36px"
        className="size-9 shrink-0 rounded-[0.55rem]"
      />
      {compact ? null : (
        <span className="font-display text-xl leading-none font-semibold tracking-tight">
          Fides
        </span>
      )}
    </span>
  );
}
