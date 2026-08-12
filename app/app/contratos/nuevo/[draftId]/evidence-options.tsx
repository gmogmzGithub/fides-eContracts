"use client";

import { useRef, useState } from "react";
import { Checkbox } from "@/components/ui/field";
import { guardarEvidencia } from "./actions";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface EvidenceSelection {
  requiresIne: boolean;
  requiresVideo: boolean;
}

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "La selección se guarda automáticamente.",
  saving: "Guardando evidencia…",
  saved: "Evidencia guardada para este contrato.",
  error: "No pudimos guardar la selección.",
};

/**
 * Decisiones visibles por Contrato. INE y video forman parte del servicio base
 * para todas las Organizaciones; la aceptación electrónica siempre se exige.
 */
export function EvidenceOptions({
  draftId,
  initialRequiresIne,
  initialRequiresVideo,
}: {
  draftId: string;
  initialRequiresIne: boolean;
  initialRequiresVideo: boolean;
}) {
  const [selection, setSelection] = useState<EvidenceSelection>({
    requiresIne: initialRequiresIne,
    requiresVideo: initialRequiresVideo,
  });
  const saved = useRef(selection);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  async function change(key: keyof EvidenceSelection, checked: boolean) {
    const next = { ...selection, [key]: checked };
    setSelection(next);
    setStatus("saving");
    setError("");
    const result = await guardarEvidencia({ draftId, ...next });
    if (result.ok) {
      saved.current = next;
      setStatus("saved");
      return;
    }
    setSelection(saved.current);
    setStatus("error");
    setError(result.error ?? STATUS_LABEL.error);
  }

  const disabled = status === "saving";

  return (
    <fieldset className="grid gap-3">
      <legend className="sr-only">Evidencia requerida para este contrato</legend>
      <p className="text-sm leading-relaxed text-carbon-soft">
        Selecciona lo que deberá entregar la persona antes de aceptar. La
        aceptación electrónica siempre permanece activa.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div
          className={`rounded-xl border p-4 transition-colors duration-200 ${
            selection.requiresIne
              ? "border-accent bg-accent-soft"
              : "border-line bg-white"
          }`}
        >
          <Checkbox
            name="requiresIne"
            checked={selection.requiresIne}
            disabled={disabled}
            onChange={(event) => {
              void change("requiresIne", event.target.checked);
            }}
            label="Requerir INE"
            hint="Solicita una fotografía del frente y otra del reverso. No verifica oficialmente la identidad."
          />
        </div>
        <div
          className={`rounded-xl border p-4 transition-colors duration-200 ${
            selection.requiresVideo
              ? "border-accent bg-accent-soft"
              : "border-line bg-white"
          }`}
        >
          <Checkbox
            name="requiresVideo"
            checked={selection.requiresVideo}
            disabled={disabled}
            onChange={(event) => {
              void change("requiresVideo", event.target.checked);
            }}
            label="Requerir video"
            hint="Solicita un video selfie leyendo el resumen aprobado de este contrato."
          />
        </div>
      </div>
      <p
        className={`text-xs ${status === "error" ? "font-medium text-danger" : "text-muted"}`}
        aria-live="polite"
      >
        {error || STATUS_LABEL[status]}
      </p>
    </fieldset>
  );
}
