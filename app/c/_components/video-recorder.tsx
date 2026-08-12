"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_LABEL,
  MAX_RECORDING_SECONDS,
  SYNTHETIC_MARKERS,
  type SyntheticMarker,
} from "@/app/c/_lib/limits";
import { Notice } from "./notice";
import {
  DISABLED_ACTION,
  FOCUS_RING,
  MUTED,
  PRIMARY_ACTION,
  QUIET_ACTION,
  SECONDARY_ACTION,
  SUBHEADING,
  TINY,
} from "./styles";
import { postEvidence } from "./upload-client";

type Phase =
  | "idle"
  | "preparing"
  | "countdown"
  | "recording"
  | "review"
  | "uploading"
  | "stored"
  | "blocked";

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return undefined;
}

let cachedSupport: boolean | null = null;

/** Grabar en sesión exige `getUserMedia`, `MediaRecorder` y un formato útil. */
function detectSupport(): boolean {
  if (cachedSupport === null) {
    cachedSupport =
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined" &&
      pickMimeType() !== undefined;
  }
  return cachedSupport;
}

const NO_SUBSCRIPTION = () => () => {};

function extensionFor(mimeType: string): string {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Grabación guiada dentro de la sesión contractual. No se aceptan archivos
 * grabados previamente. La captura no transcribe, no reconoce rostros o voz y
 * no verifica identidad.
 */
export function VideoRecorder({
  uploadUrl,
  statement,
  nextHref,
  alreadyStored,
  allowSynthetic,
}: {
  uploadUrl: string;
  statement: string;
  nextHref: string;
  alreadyStored: boolean;
  /** El doble sintético sólo existe en el entorno local. */
  allowSynthetic: boolean;
}) {
  const router = useRouter();
  const liveRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewRef = useRef<string | null>(null);
  const secondsRef = useRef(0);

  const [phase, setPhase] = useState<Phase>(alreadyStored ? "stored" : "idle");
  const supported = useSyncExternalStore(
    NO_SUBSCRIPTION,
    detectSupport,
    () => false
  );
  const [seconds, setSeconds] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [recorded, setRecorded] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marker, setMarker] = useState<SyntheticMarker>("aceptar");
  const [fallbackOpen, setFallbackOpen] = useState(false);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (liveRef.current) liveRef.current.srcObject = null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, [clearTimer]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    clearTimer();
  }, [clearTimer]);

  async function startRecording() {
    setError(null);
    setPhase("preparing");
    const mimeType = pickMimeType();
    if (!mimeType) {
      setPhase("blocked");
      setFallbackOpen(true);
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 } },
        audio: true,
      });
    } catch {
      setPhase("blocked");
      setFallbackOpen(true);
      return;
    }

    streamRef.current = stream;
    if (liveRef.current) {
      liveRef.current.srcObject = stream;
      try {
        await liveRef.current.play();
      } catch {
        // Algunos navegadores rechazan `play()` silenciosamente; no es fatal.
      }
    }

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 900_000,
      audioBitsPerSecond: 64_000,
    });
    recorderRef.current = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stopTracks();
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const url = URL.createObjectURL(blob);
      previewRef.current = url;
      setRecorded(blob);
      setPreview(url);
      setPhase("review");
    };

    secondsRef.current = 0;
    setSeconds(0);
    setCountdown(3);
    setPhase("countdown");
    clearTimer();
    let remaining = 3;
    timerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }
      clearTimer();
      recorder.start(1000);
      setPhase("recording");
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
        if (secondsRef.current >= MAX_RECORDING_SECONDS) stopRecording();
      }, 1000);
    }, 1000);
  }

  function cancelCamera() {
    clearTimer();
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    stopTracks();
    setCountdown(3);
    setPhase("idle");
  }

  function discard() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreview(null);
    setRecorded(null);
    secondsRef.current = 0;
    setSeconds(0);
    setError(null);
    setPhase("idle");
  }

  async function send() {
    if (!recorded) return;
    if (recorded.size < 1024) {
      setError(
        "La grabación quedó vacía o demasiado corta. Repítela leyendo la declaración completa."
      );
      return;
    }
    if (recorded.size > MAX_EVIDENCE_BYTES) {
      setError(
        `La grabación supera ${MAX_EVIDENCE_LABEL}. Repítela de forma más breve.`
      );
      return;
    }
    setError(null);
    setPhase("uploading");
    const body = new FormData();
    body.append("tipo", "video");
    body.append("declaracion", statement);
    body.append(
      "archivo",
      recorded,
      `video-guiado.${extensionFor(recorded.type || "video/webm")}`
    );
    const outcome = await postEvidence(uploadUrl, body);
    if (!outcome.ok) {
      setError(outcome.error);
      setPhase("review");
      return;
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPhase("stored");
    router.refresh();
  }

  async function sendSynthetic() {
    setError(null);
    setPhase("uploading");
    const body = new FormData();
    body.append("tipo", "video");
    body.append("sintetico", "1");
    body.append("marcador", marker);
    body.append("declaracion", statement);
    const outcome = await postEvidence(uploadUrl, body);
    if (!outcome.ok) {
      setError(outcome.error);
      setPhase("blocked");
      return;
    }
    setPhase("stored");
    router.refresh();
  }

  if (phase === "stored") {
    return (
      <div className="mt-6 space-y-4">
        <Notice tone="good" role="status">
          Recibimos tu grabación.
        </Notice>
        <Link className={PRIMARY_ACTION} href={nextHref} prefetch={false}>
          Continuar
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-5">
      <section
        className="rounded-xl border-2 border-[#CA8A04] bg-[#FFFBEB] p-4"
        aria-labelledby="declaracion-titulo"
      >
        <h3 id="declaracion-titulo" className={SUBHEADING}>
          Declaración que debes leer
        </h3>
        <p className="mt-2 text-base leading-7 whitespace-pre-line text-[#1C1917]">
          {statement}
        </p>
      </section>

      <div
        className={
          phase === "recording" || phase === "preparing" || phase === "countdown"
            ? "relative overflow-hidden rounded-xl border border-[#1C1917] bg-black"
            : "hidden"
        }
      >
        <video
          ref={liveRef}
          className="aspect-video w-full scale-[1.04] object-cover opacity-60 blur-[7px]"
          muted
          playsInline
          autoPlay
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/25 px-5 py-6 text-center text-white">
          {phase === "countdown" ? (
            <div aria-live="assertive">
              <p className="text-xs font-semibold tracking-[0.2em] uppercase">
                La grabación comienza en
              </p>
              <p className="mt-1 text-6xl font-semibold tabular-nums">{countdown}</p>
            </div>
          ) : null}
          {phase === "preparing" ? (
            <p className="text-sm font-semibold">Preparando cámara…</p>
          ) : null}
          {phase === "recording" ? (
            <p className="text-xs font-semibold tracking-[0.18em] text-[#FDE68A] uppercase">
              Grabando · {formatSeconds(seconds)}
            </p>
          ) : null}
          <div className="max-h-44 max-w-2xl overflow-y-auto rounded-xl bg-black/55 px-4 py-3 shadow-lg backdrop-blur-sm">
            <p className="text-xs font-semibold tracking-wide text-[#FDE68A] uppercase">
              Lee en voz alta
            </p>
            <p className="mt-1 text-sm leading-6 whitespace-pre-line sm:text-base">
              {statement}
            </p>
          </div>
          <p className="text-xs text-white/80">
            máximo {formatSeconds(MAX_RECORDING_SECONDS)}
          </p>
        </div>
      </div>

      {phase === "review" && preview ? (
        <div className="overflow-hidden rounded-xl border border-[#E7E5E4] bg-black">
          {/* Revisión local de la grabación recién hecha: no existe un
              archivo de subtítulos que acompañe a este medio. */}
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={preview}
            className="aspect-video w-full object-contain"
            controls
            playsInline
            aria-label="Revisión de tu grabación"
          />
        </div>
      ) : null}

      {error ? (
        <Notice tone="warning" role="alert">
          {error}
        </Notice>
      ) : null}

      {phase === "idle" ? (
        <>
          <p className={MUTED}>
            La grabación se realiza aquí mismo, con cámara y micrófono. No se
            aceptan videos grabados antes. Podrás revisarla y repetirla antes de
            enviarla.
          </p>
          {supported === false ? (
            <Notice tone="warning">
              Este navegador no permite grabar dentro de la sesión. Sin la
              evidencia de video requerida no es posible completar la
              aceptación.
            </Notice>
          ) : null}
          <button
            type="button"
            className={supported === false ? DISABLED_ACTION : PRIMARY_ACTION}
            disabled={supported === false}
            onClick={() => void startRecording()}
          >
            Permitir cámara y comenzar
          </button>
        </>
      ) : null}

      {phase === "preparing" ? (
        <button type="button" className={DISABLED_ACTION} disabled>
          Preparando cámara…
        </button>
      ) : null}

      {phase === "countdown" ? (
        <button type="button" className={SECONDARY_ACTION} onClick={cancelCamera}>
          Cancelar
        </button>
      ) : null}

      {phase === "recording" ? (
        <button type="button" className={PRIMARY_ACTION} onClick={stopRecording}>
          Detener grabación
        </button>
      ) : null}

      {phase === "review" ? (
        <div className="space-y-3">
          <p className={MUTED}>
            Revisa la grabación. Si no se escucha o no se ve completa, repítela.
          </p>
          <button
            type="button"
            className={PRIMARY_ACTION}
            onClick={() => void send()}
          >
            Enviar grabación
          </button>
          <button
            type="button"
            className={SECONDARY_ACTION}
            onClick={() => void startRecording()}
          >
            Repetir grabación
          </button>
          <button type="button" className={QUIET_ACTION} onClick={discard}>
            Descartar
          </button>
        </div>
      ) : null}

      {phase === "uploading" ? (
        <button type="button" className={DISABLED_ACTION} disabled>
          Enviando…
        </button>
      ) : null}

      {phase === "blocked" ? (
        <Notice tone="warning" role="alert">
          No pudimos usar la cámara y el micrófono. Revisa los permisos del
          navegador e inténtalo otra vez. Sin la evidencia de video requerida no
          es posible completar la aceptación de este contrato.
        </Notice>
      ) : null}

      {phase === "blocked" ? (
        <button
          type="button"
          className={SECONDARY_ACTION}
          onClick={() => void startRecording()}
        >
          Intentar de nuevo
        </button>
      ) : null}

      {/* Respaldo exclusivo del entorno local sintético. */}
      {allowSynthetic ? (
      <details
        className="rounded-xl border border-dashed border-[#A8A29E] bg-[#F5F5F4]"
        open={fallbackOpen}
      >
        <summary
          className={`cursor-pointer list-none rounded-xl px-4 py-3 text-sm font-semibold text-[#44403C] ${FOCUS_RING}`}
        >
          Grabación sintética de prueba (sólo entorno local)
        </summary>
        <div className="space-y-3 border-t border-[#D6D3D1] px-4 py-4">
          <p className={TINY}>
            Este entorno es sintético. Si la máquina no tiene cámara, envía una
            grabación de prueba claramente marcada como tal. No es una
            grabación real y no representa una declaración de nadie.
          </p>
          <p className={TINY}>
            El nombre del archivo lleva el marcador elegido —
            <code>repetir</code>, <code>falla</code> o <code>dudoso</code>—
            para dirigir al doble local de AI; sin marcador recomienda aceptar.
          </p>
          <label
            className="block text-sm font-medium text-[#1C1917]"
            htmlFor="marcador-sintetico"
          >
            Marcador para el doble local de AI
          </label>
          <select
            id="marcador-sintetico"
            className={`w-full cursor-pointer rounded-lg border border-[#D6D3D1] bg-white px-3 py-3 text-base text-[#1C1917] ${FOCUS_RING}`}
            value={marker}
            onChange={(event) => {
              const value = event.target.value;
              const found = SYNTHETIC_MARKERS.find(
                (item) => item.value === value
              );
              if (found) setMarker(found.value);
            }}
          >
            {SYNTHETIC_MARKERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={phase === "uploading" ? DISABLED_ACTION : QUIET_ACTION}
            disabled={phase === "uploading"}
            onClick={() => void sendSynthetic()}
          >
            Enviar grabación sintética de prueba
          </button>
        </div>
      </details>
      ) : null}

      <noscript>
        <Notice tone="warning">
          La grabación guiada necesita JavaScript, cámara y micrófono. Puedes
          leer el contrato sin JavaScript, pero no completar la aceptación.
        </Notice>
      </noscript>
    </div>
  );
}
