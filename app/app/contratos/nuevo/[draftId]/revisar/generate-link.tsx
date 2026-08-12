"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { CopyButton } from "@/components/ui/copy-button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/field";
import { IDLE_STATE } from "@/app/app/_lib/action-result";
import { generarEnlace } from "./actions";

/**
 * Después de emitir, la plataforma muestra únicamente la Referencia y
 * `Copiar enlace`. No prepara mensajes ni abre WhatsApp o correo.
 */
export function GenerateLink({
  draftId,
  disabled,
}: {
  draftId: string;
  disabled: boolean;
}) {
  const [state, formAction] = useActionState(generarEnlace, IDLE_STATE);

  if (state.ok && state.url && state.reference) {
    return (
      <Card>
        <CardHeader
          title="Contrato emitido"
          description="Comparte el enlace por el medio que ya usas con la persona que aceptará."
        />
        <CardBody>
          <div className="grid gap-4">
            <div>
              <p className="text-xs tracking-wide text-muted uppercase">
                Referencia contractual
              </p>
              <p className="font-display text-2xl text-carbon">{state.reference}</p>
            </div>
            <div>
              <CopyButton
                value={state.url}
                label="Copiar enlace"
                copiedLabel="Enlace copiado"
              />
            </div>
            {state.contractId ? (
              <Link
                href={`/app/contratos/${state.contractId}`}
                className="cursor-pointer text-sm text-carbon-soft underline-offset-4 transition-colors duration-200 hover:text-carbon hover:underline"
              >
                Ver el expediente
              </Link>
            ) : null}
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="draftId" value={draftId} />
      <FormMessage state={state} />
      <Checkbox
        name="favorite"
        label="Guardar como Favorito"
        hint="Aparecerá primero en tu lista personal de Recientes para crear otro Borrador."
      />
      <div>
        <SubmitButton disabled={disabled} pendingLabel="Generando Contrato…">
          Generar Contrato
        </SubmitButton>
      </div>
    </form>
  );
}
