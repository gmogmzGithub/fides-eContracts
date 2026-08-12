import type { ReactNode } from "react";

const TONES = {
  warning: "border-[#B45309] bg-[#FEF3C7] text-[#78350F]",
  good: "border-[#3F6212] bg-[#ECFCCB] text-[#365314]",
  plain: "border-[#D6D3D1] bg-[#F5F5F4] text-[#44403C]",
} as const;

export type NoticeTone = keyof typeof TONES;

export function Notice({
  tone = "plain",
  role,
  children,
}: {
  tone?: NoticeTone;
  role?: "alert" | "status";
  children: ReactNode;
}) {
  return (
    <p
      role={role}
      className={`rounded-lg border px-3 py-2 text-sm leading-relaxed ${TONES[tone]}`}
    >
      {children}
    </p>
  );
}
