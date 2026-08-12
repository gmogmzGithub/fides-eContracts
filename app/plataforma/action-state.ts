import type { FormState } from "@/components/ui/form-state";

/** Advertencia literal exigida por ADR-0079 al repetir la etiqueta vigente. */
export const SAME_VERSION_WARNING =
  "Estás usando la misma versión, ¿es esto correcto?";

/**
 * Publicación de contenido jurídico. Además del resultado uniforme, transporta
 * los marcadores desconocidos que bloquearon la publicación y la confirmación
 * pendiente cuando la etiqueta nueva repite la vigente.
 */
export interface PublishState extends FormState {
  unknownMarkers?: string[];
  needsConfirmation?: boolean;
  confirmLabel?: string;
}

export const IDLE_PUBLISH: PublishState = { ok: true };
