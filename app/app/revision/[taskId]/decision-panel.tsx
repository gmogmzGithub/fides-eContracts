"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { CopyButton } from "@/components/ui/copy-button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, RadioGroup, TextArea, TextInput } from "@/components/ui/field";
import { REPEAT_REASON_LABELS } from "@/lib/domain/types";
import { IDLE_STATE } from "@/app/app/_lib/action-result";
import { ActionForm } from "@/app/app/_components/action-form";
import {
  registrarContactoExterno,
  repetirProceso,
  resolverRevision,
} from "./actions";

/**
 * Exactamente tres decisiones. `Aceptar contrato` y `SKIP` son directas;
 * `Repetir proceso` pide un motivo de la lista cerrada y sólo exige texto
 * cuando el Revisor elige `Otro`.
 */
export function DecisionPanel({
  taskId,
  contractId,
}: {
  taskId: string;
  contractId: string;
}) {
  const [resolveState, resolveAction] = useActionState(
    resolverRevision,
    IDLE_STATE
  );
  const [repeatState, repeatAction] = useActionState(repetirProceso, IDLE_STATE);

  if (repeatState.ok && repeatState.url) {
    return (
      <div className="grid gap-4">
        <Card>
          <CardHeader
            title="Intento nuevo creado"
            description="Comparte el enlace con el Firmante por el medio que ya usas. La plataforma no envía mensajes."
          />
          <CardBody>
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <CopyButton
                  value={repeatState.url}
                  label="Copiar enlace"
                  copiedLabel="Enlace copiado"
                />
                {repeatState.suggestedMessage ? (
                  <CopyButton
                    value={repeatState.suggestedMessage}
                    label="Copiar mensaje sugerido"
                    copiedLabel="Mensaje copiado"
                  />
                ) : null}
              </div>
              {repeatState.suggestedMessage ? (
                <p className="rounded-lg border border-line bg-[#fcfcfb] px-4 py-3 text-sm text-carbon-soft">
                  {repeatState.suggestedMessage}
                </p>
              ) : null}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Registrar contacto externo (opcional)"
            description="Queda como registro operativo; no constituye prueba de entrega."
          />
          <CardBody>
            <ActionForm
              action={registrarContactoExterno}
              submitLabel="Registrar contacto"
              variant="secondary"
              size="sm"
              hidden={{ contractId }}
            >
              <Field label="Canal utilizado" htmlFor="channel" required>
                <TextInput
                  id="channel"
                  name="channel"
                  required
                  placeholder="WhatsApp, correo, llamada…"
                />
              </Field>
              <Field label="Nota (opcional)" htmlFor="note">
                <TextArea id="note" name="note" rows={3} />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="Acciones sobre el Contrato"
          description="Decide con la evidencia recibida en este intento."
        />
        <CardBody>
          <div className="grid gap-6">
            <form action={resolveAction} className="grid gap-3">
              <input type="hidden" name="taskId" value={taskId} />
              <FormMessage state={resolveState} />
              <div className="flex flex-wrap gap-3">
                <SubmitButton
                  name="decision"
                  value="conclude"
                  variant="success"
                  pendingLabel="Registrando…"
                >
                  Aceptar contrato
                </SubmitButton>
                <SubmitButton
                  name="decision"
                  value="skip"
                  variant="secondary"
                  pendingLabel="Registrando…"
                >
                  Omitir revisión y aceptar (SKIP)
                </SubmitButton>
              </div>
              <p className="text-xs text-muted">
                `Omitir revisión y aceptar` acepta el Contrato con la evidencia
                disponible sin afirmar que fue revisada. Queda en el historial con
                tu nombre y la fecha.
              </p>
            </form>

            <form
              action={repeatAction}
              className="grid gap-4 border-t border-line pt-6"
            >
              <input type="hidden" name="taskId" value={taskId} />
              <RadioGroup
                name="reasonCode"
                legend="Motivo para repetir el proceso"
                required
                options={Object.entries(REPEAT_REASON_LABELS).map(
                  ([value, label]) => ({ value, label })
                )}
              />
              <Field
                label="Explicación (sólo si elegiste `Otro`)"
                htmlFor="reasonText"
              >
                <TextArea id="reasonText" name="reasonText" rows={3} />
              </Field>
              <FormMessage state={repeatState} />
              <div>
                <SubmitButton variant="danger" pendingLabel="Creando intento…">
                  Repetir proceso
                </SubmitButton>
              </div>
              <p className="text-xs text-muted">
                Se cerrará este intento, se revocará su enlace y comenzará uno nuevo
                desde el inicio con toda la evidencia exigida.
              </p>
            </form>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
