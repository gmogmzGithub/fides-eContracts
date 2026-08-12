"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MAX_IMAGE_BYTES, MAX_IMAGE_LABEL } from "@/app/c/_lib/limits";
import { Notice } from "./notice";
import {
  DISABLED_ACTION,
  MUTED,
  PRIMARY_ACTION,
  QUIET_ACTION,
  SECONDARY_ACTION,
  TINY,
} from "./styles";
import { postEvidence } from "./upload-client";

type Phase = "idle" | "chosen" | "uploading" | "stored";

/**
 * Captura de evidencia de la credencial para votar. La plataforma conserva la
 * imagen; no consulta al INE, no valida autenticidad o vigencia y no compara
 * rostros. No es verificación de identidad.
 */
export function IneCapture({
  uploadUrl,
  kind,
  side,
  nextHref,
  alreadyStored,
}: {
  uploadUrl: string;
  kind: "ine_front" | "ine_back";
  side: "frente" | "reverso";
  nextHref: string;
  alreadyStored: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<Phase>(alreadyStored ? "stored" : "idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function reset() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFileName("");
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Elige una fotografía. El archivo seleccionado no es una imagen.");
      reset();
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`La imagen supera ${MAX_IMAGE_LABEL}. Toma la foto de nuevo.`);
      reset();
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setFileName(file.name);
    setPhase("chosen");
  }

  async function send() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Primero toma o elige la fotografía.");
      return;
    }
    setError(null);
    setPhase("uploading");
    const body = new FormData();
    body.append("tipo", kind);
    body.append("archivo", file, file.name || `ine-${side}.jpg`);
    const outcome = await postEvidence(uploadUrl, body);
    if (!outcome.ok) {
      setError(outcome.error);
      setPhase("chosen");
      return;
    }
    setPhase("stored");
    router.refresh();
  }

  if (phase === "stored") {
    return (
      <div className="mt-6 space-y-4">
        <Notice tone="good" role="status">
          Recibimos la fotografía del {side} de tu credencial.
        </Notice>
        <Link className={PRIMARY_ACTION} href={nextHref} prefetch={false}>
          Continuar
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <input
        ref={inputRef}
        id={`archivo-${kind}`}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPick}
      />

      <label
        htmlFor={`archivo-${kind}`}
        className={phase === "uploading" ? DISABLED_ACTION : SECONDARY_ACTION}
      >
        {preview ? "Tomar otra fotografía" : `Tomar fotografía del ${side}`}
      </label>

      {preview ? (
        <figure className="overflow-hidden rounded-xl border border-[#E7E5E4] bg-[#F5F5F4]">
          {/* Vista previa local; la imagen no se ha enviado todavía. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt={`Vista previa del ${side} de la credencial`}
            className="max-h-80 w-full object-contain"
          />
          <figcaption className={`${TINY} truncate px-3 py-2`}>
            {fileName || "Fotografía seleccionada"} · aún no enviada
          </figcaption>
        </figure>
      ) : (
        <p className={MUTED}>
          Coloca la credencial sobre una superficie plana, con buena luz y sin
          reflejos. Verás la fotografía antes de enviarla.
        </p>
      )}

      {error ? (
        <Notice tone="warning" role="alert">
          {error}
        </Notice>
      ) : null}

      {preview ? (
        <div className="space-y-3">
          <button
            type="button"
            className={phase === "uploading" ? DISABLED_ACTION : PRIMARY_ACTION}
            disabled={phase === "uploading"}
            onClick={() => void send()}
          >
            {phase === "uploading" ? "Enviando…" : "Enviar fotografía"}
          </button>
          <button
            type="button"
            className={QUIET_ACTION}
            disabled={phase === "uploading"}
            onClick={reset}
          >
            Descartar
          </button>
        </div>
      ) : (
        <button type="button" className={DISABLED_ACTION} disabled>
          Continuar
        </button>
      )}

      <noscript>
        <Notice tone="warning">
          Esta pantalla necesita JavaScript activado para tomar y enviar la
          fotografía. Sin evidencia no es posible completar la aceptación.
        </Notice>
      </noscript>
    </div>
  );
}
