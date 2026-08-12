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
import { publicarPlantilla } from "./actions";

/** Misma sintaxis que el dominio: `{{clave}}`. La comprobación real es de servidor. */
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

function findMarkers(markdown: string): string[] {
  const found: string[] = [];
  for (const match of markdown.matchAll(PLACEHOLDER_PATTERN)) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

const TEXTAREA_CLASS =
  "block w-full rounded-lg border border-line bg-white px-3.5 py-2.5 font-mono text-sm leading-6 text-ink " +
  "transition-colors duration-200 focus:border-carbon focus:outline-2 focus:outline-offset-2 focus:outline-accent";

interface Props {
  templateId: string;
  currentLabel: string | null;
  initialMarkdown: string;
  knownKeys: string[];
  canPublish: boolean;
}

export function TemplateEditor({
  templateId,
  currentLabel,
  initialMarkdown,
  knownKeys,
  canPublish,
}: Props) {
  const [state, formAction, pending] = useActionState(
    publicarPlantilla,
    IDLE_PUBLISH
  );
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [label, setLabel] = useState(currentLabel ?? "1.0");
  const [dismissed, setDismissed] = useState(false);

  const known = useMemo(() => new Set(knownKeys), [knownKeys]);
  const markers = useMemo(() => findMarkers(markdown), [markdown]);
  const unknownLive = markers.filter((key) => !known.has(key));
  const preview = useMemo(() => renderMarkdown(markdown), [markdown]);

  const showConfirm = Boolean(state.needsConfirmation) && !dismissed;

  return (
    <form
      action={formAction}
      onSubmit={() => setDismissed(false)}
      className="grid gap-5"
    >
      <input type="hidden" name="templateId" value={templateId} />

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
          htmlFor="versionNueva"
          hint={
            currentLabel
              ? "Escríbela manualmente. Puede repetir la actual; la plataforma no la calcula."
              : "La primera publicación es 1.0."
          }
        >
          <TextInput
            id="versionNueva"
            name="versionNueva"
            required
            autoComplete="off"
            className="font-mono"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="markdown" className="cursor-pointer">
          <span className="text-sm font-medium text-carbon">
            Markdown del Contrato-plantilla
          </span>
        </label>
        <textarea
          id="markdown"
          name="markdown"
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          spellCheck={false}
          rows={26}
          className={TEXTAREA_CLASS}
        />
      </div>

      <div className="rounded-xl border border-line bg-white p-4">
        <p className="text-sm font-medium text-carbon">Marcadores usados</p>
        {markers.length === 0 ? (
          <p className="mt-2 text-sm text-muted">El texto no usa marcadores.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {markers.map((marker) => {
              const isUnknown = !known.has(marker);
              return (
                <code
                  key={marker}
                  className={
                    isUnknown
                      ? "rounded bg-danger-soft px-2 py-1 text-xs text-danger ring-1 ring-danger/30"
                      : "rounded bg-[#f5f5f4] px-2 py-1 text-xs text-carbon-soft"
                  }
                >
                  {`{{${marker}}}`}
                </code>
              );
            })}
          </div>
        )}
        {unknownLive.length > 0 ? (
          <p className="mt-3 text-sm font-medium text-danger">
            Hay {unknownLive.length} marcador(es) sin campo programado. La
            publicación se bloqueará hasta que existan en el Esquema programado
            de campos.
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-line bg-white p-4">
        <p className="text-sm font-medium text-carbon">
          Vista previa del texto
        </p>
        <div
          className="prose-contract mt-3"
          // `renderMarkdown` escapa el contenido y no admite HTML incrustado.
          dangerouslySetInnerHTML={{ __html: preview }}
        />
        <p className="mt-3 text-xs text-muted">
          Los marcadores se sustituyen al emitir cada Contrato con los valores
          capturados; aquí se muestran tal cual.
        </p>
      </div>

      {!state.ok && state.error ? (
        <Alert tone="danger" title="No publicamos la versión">
          <p>{state.error}</p>
          {state.unknownMarkers && state.unknownMarkers.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {state.unknownMarkers.map((marker) => (
                <li key={marker}>
                  <code className="rounded bg-white px-2 py-1 text-xs ring-1 ring-danger/30">
                    {`{{${marker}}}`}
                  </code>
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      {showConfirm ? (
        <Alert tone="warn" title={SAME_VERSION_WARNING}>
          <p>
            Publicarás otro registro con la etiqueta{" "}
            <code className="font-mono">{state.confirmLabel}</code>. El historial
            los distinguirá por fecha y hora.
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
          {pending ? "Publicando…" : "Publicar versión"}
        </Button>
        {!canPublish ? (
          <span className="text-sm text-carbon-soft">
            Tu cuenta global puede consultar el editor, pero sólo el Publicador
            de contenido jurídico puede publicar.
          </span>
        ) : null}
      </div>
    </form>
  );
}
