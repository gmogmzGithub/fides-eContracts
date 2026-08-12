import type { ReactNode } from "react";
import { CARD, HEADING, MUTED, TINY } from "./styles";

/** Marco común de cada pantalla de evidencia: una sola cosa a la vez. */
export function EvidenceFrame({
  title,
  stepIndex,
  stepCount,
  intro,
  footnote,
  children,
}: {
  title: string;
  stepIndex: number;
  stepCount: number;
  intro: string;
  footnote: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-6 pb-16">
      <p className="text-xs font-semibold tracking-wide text-[#A16207] uppercase">
        Evidencia · paso {stepIndex} de {stepCount}
      </p>
      <h1 className={`${HEADING} mt-1`}>{title}</h1>
      <div className={`${CARD} mt-5`}>
        <p className={MUTED}>{intro}</p>
        {children}
      </div>
      <p className={`${TINY} mt-5`}>{footnote}</p>
    </main>
  );
}
