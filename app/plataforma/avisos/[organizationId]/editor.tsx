"use client";

import { useActionState, useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { renderMarkdown } from "@/lib/markdown";
import {
  IDLE_PUBLISH,
  SAME_VERSION_WARNING,
} from "@/app/plataforma/action-state";
import { publicarAviso } from "./actions";

const TEXTAREA_CLASS =
  "block w-full rounded-lg border border-line bg-white px-3.5 py-2.5 font-mono text-sm leading-6 text-ink " +
  "transition-colors duration-200 focus:border-carbon focus:outline-2 focus:outline-offset-2 focus:outline-accent";

interface Props {
  organizationId: string;
  currentLabel: string | null;
  initialFull: string;
  canPublish: boolean;
}

export function PrivacyNoticeEditor({
  organizationId,
  currentLabel,
  initialFull,
  canPublish,
}: Props) {
  const [state, formAction, pending] = useActionState(
    publicarAviso,
    IDLE_PUBLISH
  );
  const [full, setFull] = useState(initialFull);
  const [label, setLabel] = useState(currentLabel ?? "1.0");
  const [dismissed, setDismissed] = useState(false);

  const fullPreview = useMemo(() => renderMarkdown(full), [full]);
  const showConfirm = Boolean(state.needsConfirmation) && !dismissed;

  return (
    <form
      action={formAction}
      onSubmit={() => setDismissed(false)}
      className="grid gap-5"
    >
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <span className="text-sm font-medium text-carbon">Versión actual</span>
          <p className="rounded-lg border border-line bg-[#f5f5f4] px-3.5 py-2.5 font-mono text-sm text-carbon-soft">
            {currentLabel ?? "Sin publicación previa"}
          </p>
        </div>
        <Field
          label="Versión nueva"
          required
          htmlFor="versionNuevaAviso"
          hint={
            currentLabel
              ? "Puede repetir la actual; la plataforma no la calcula ni exige unicidad."
              : "La primera publicación es 1.0."
          }
        >
          <TextInput
            id="versionNuevaAviso"
            name="versionNueva"
            required
            autoComplete="off"
            className="font-mono"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor="aviso" className="cursor-pointer">
            <span className="text-sm font-medium text-carbon">
              Aviso de Privacidad
            </span>
          </label>
          <p className="text-xs text-muted">
            Se muestra al inicio de `Contrato` en el recorrido del Firmante.
          </p>
          <textarea
            id="aviso"
            name="aviso"
            value={full}
            onChange={(event) => setFull(event.target.value)}
            spellCheck={false}
            rows={16}
            className={TEXTAREA_CLASS}
          />
        </div>

        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-sm font-medium text-carbon">
            Vista previa
          </p>
          <div
            className="prose-contract mt-3"
            dangerouslySetInnerHTML={{ __html: fullPreview }}
          />
        </div>
      </div>

      {!state.ok && state.error ? (
        <Alert tone="danger" title="No publicamos el Aviso de Privacidad">
          {state.error}
        </Alert>
      ) : null}

      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      {showConfirm ? (
        <Alert tone="warn" title={SAME_VERSION_WARNING}>
          <p>
            Publicarás otro Aviso de Privacidad con la etiqueta{" "}
            <code className="font-mono">{state.confirmLabel}</code>. El historial
            las distinguirá por fecha y hora.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="submit"
              name="confirmacion"
              value="si"
              size="sm"
              disabled={pending}
            >
              Sí, publicar con la misma versión
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDismissed(true)}
            >
              Cancelar y volver al editor
            </Button>
          </div>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!canPublish || pending}>
          {pending ? "Publicando…" : "Publicar Aviso de Privacidad"}
        </Button>
        {!canPublish ? (
          <span className="text-sm text-carbon-soft">
            Sólo el Publicador de contenido jurídico puede publicar.
          </span>
        ) : null}
      </div>
    </form>
  );
}
