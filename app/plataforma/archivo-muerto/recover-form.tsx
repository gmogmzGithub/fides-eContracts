"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { EMPTY_FORM_STATE } from "@/components/ui/form-state";
import { recuperarContenido } from "./actions";

interface Props {
  contractId: string;
  reference: string;
  retrievalTier: "standard" | "bulk";
  /** Una operación en curso o una copia vigente impiden iniciar otra. */
  blocked: boolean;
  blockedReason?: string;
  failed: boolean;
}

export function RecoverForm({
  contractId,
  reference,
  retrievalTier,
  blocked,
  blockedReason,
  failed,
}: Props) {
  const [state, formAction] = useActionState(
    recuperarContenido,
    EMPTY_FORM_STATE
  );

  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="contractId" value={contractId} />

      <Checkbox
        name="publicar"
        label="Publicar el resultado en el expediente de la Organización"
        hint="Sólo cuando corresponda a una solicitud externa validada. El ZIP exacto aparece como archivo ordinario durante tres días completos y sólo lo descarga un Administrador activo."
        disabled={blocked}
      />

      <FormMessage state={state} />

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          variant={failed ? "secondary" : "primary"}
          size="sm"
          disabled={blocked}
          pendingLabel="Recuperando…"
        >
          {failed ? "Reintentar recuperación" : "Recuperar contenido"}
        </SubmitButton>
        <span className="text-xs text-muted">
          {retrievalTier === "standard"
            ? "Nivel `standard` (Custodia activa)"
            : "Nivel `bulk` (Custodia fría base)"}
          {blocked && blockedReason ? ` · ${blockedReason}` : ""}
        </span>
      </div>

      <span className="sr-only">Paquete {reference}</span>
    </form>
  );
}
