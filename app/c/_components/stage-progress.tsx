"use client";

import { usePathname } from "next/navigation";

type StageKey = "contract" | "evidence" | "accept";

const STAGES: { key: StageKey; label: string }[] = [
  { key: "contract", label: "Contrato" },
  { key: "evidence", label: "Evidencia" },
  { key: "accept", label: "Aceptar" },
];

/**
 * `Evidencia` conserva su lugar aunque el Perfil efectivo no pida evidencia
 * adicional; en ese caso nunca se muestra una pantalla vacía, sólo queda
 * marcado como cubierto.
 */
export function StageProgress({
  base,
  walked,
  evidenceReady,
  finished,
}: {
  base: string;
  walked: boolean;
  evidenceReady: boolean;
  finished: boolean;
}) {
  const pathname = usePathname() ?? base;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";

  let current: StageKey = "contract";
  if (rest.startsWith("/evidencia")) current = "evidence";
  else if (rest.startsWith("/aceptar") || rest.startsWith("/listo")) {
    current = "accept";
  }

  const done: Record<StageKey, boolean> = {
    contract: walked || finished,
    evidence: (walked && evidenceReady) || finished,
    accept: finished,
  };

  return (
    <ol
      className="flex items-center gap-1 text-[11px] font-medium tracking-wide uppercase sm:text-xs"
      aria-label="Progreso del recorrido"
    >
      {STAGES.map((stage, index) => {
        const isCurrent = stage.key === current && !finished;
        const isDone = done[stage.key];
        const tone = isCurrent
          ? "text-[#E8D9A8]"
          : isDone
            ? "text-[#D6D3D1]"
            : "text-[#A8A29E]";
        return (
          <li key={stage.key} className="flex items-center gap-1">
            {index > 0 ? (
              <span aria-hidden="true" className="px-0.5 text-[#57534E]">
                ─
              </span>
            ) : null}
            <span className={tone} aria-current={isCurrent ? "step" : undefined}>
              {stage.label}
              {isDone ? <span className="sr-only"> (completado)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
