// Los límites los define `lib/evidence-limits.ts`: el servidor los aplica y esta
// superficie los muestra, siempre desde el mismo valor.
export {
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_LABEL,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LABEL,
} from "@/lib/evidence-limits";

/** Duración máxima de la grabación guiada, para mantener el archivo manejable. */
export const MAX_RECORDING_SECONDS = 90;

/**
 * Marcadores del entorno local sintético. El doble controlado del proveedor AI
 * elige su resultado leyendo el nombre del archivo de la grabación.
 */
export const SYNTHETIC_MARKERS = [
  { value: "aceptar", label: "Recomendación de aceptar (predeterminado)" },
  { value: "repetir", label: "Recomendación de repetir" },
  { value: "dudoso", label: "Resultado dudoso" },
  { value: "falla", label: "Falla del proveedor" },
] as const;

export type SyntheticMarker = (typeof SYNTHETIC_MARKERS)[number]["value"];

export function isSyntheticMarker(value: string): value is SyntheticMarker {
  return SYNTHETIC_MARKERS.some((marker) => marker.value === value);
}
