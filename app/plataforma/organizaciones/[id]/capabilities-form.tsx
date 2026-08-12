"use client";

import { useActionState } from "react";
import { Checkbox } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { EMPTY_FORM_STATE } from "@/components/ui/form-state";
import { SubmitButton } from "@/components/ui/button";
import { CAPABILITY_LABELS, type Capability } from "@/lib/domain/types";
import { guardarCapacidades } from "./actions";

const CAPABILITY_HELP: Record<Capability, string> = {
  ai_review:
    "Habilita la política de revisión asistida. El agente recomienda; una persona con rol Revisor decide.",
  active_custody:
    "Cambia el acceso y el servicio de recuperación. La conservación existe con o sin ella.",
  evidence_video:
    "Permite pedir video guiado con declaración aprobada dentro del Perfil de evidencia.",
  evidence_ine:
    "Permite pedir captura de INE. La plataforma conserva la imagen; no verifica identidad.",
};

interface Props {
  organizationId: string;
  capabilities: Record<Capability, boolean>;
  order: Capability[];
}

export function CapabilitiesForm({ organizationId, capabilities, order }: Props) {
  const [state, formAction] = useActionState(
    guardarCapacidades,
    EMPTY_FORM_STATE
  );

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="grid gap-3 sm:grid-cols-2">
        {order.map((capability) => (
          <div key={capability} className="rounded-lg border border-line p-3">
            <Checkbox
              name={`capacidad_${capability}`}
              label={CAPABILITY_LABELS[capability]}
              hint={CAPABILITY_HELP[capability]}
              defaultChecked={capabilities[capability]}
            />
          </div>
        ))}
      </div>

      <FormMessage state={state} />

      <div>
        <SubmitButton pendingLabel="Guardando…">
          Guardar capacidades
        </SubmitButton>
      </div>
    </form>
  );
}
