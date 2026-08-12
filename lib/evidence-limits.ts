/**
 * Límites técnicos de la captura de evidencia. Viven fuera del dominio para que
 * el servidor los aplique y la interfaz del Firmante los muestre desde el mismo
 * valor, sin que el cliente importe un módulo `server-only`.
 */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_IMAGE_LABEL = "15 MB";
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
/** Tope de la subida completa, por debajo del límite de video del dominio. */
export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;
export const MAX_EVIDENCE_LABEL = "25 MB";

/**
 * La grabación sintética de prueba sólo existe para recorrer el producto en un
 * equipo sin cámara. Es una facilidad del entorno local sintético: fuera de él
 * la evidencia de video debe nacer dentro de la sesión (ADR-0062).
 */
export function syntheticEvidenceEnabled(): boolean {
  return process.env.FIDES_ALLOW_SYNTHETIC_EVIDENCE === "true";
}
