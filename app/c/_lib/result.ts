/** Resultado uniforme de las Server Actions del recorrido. */
export type SignerActionResult = { ok: true } | { ok: false; error: string };

export const SIGNER_GENERIC_ERROR =
  "No pudimos completar la operación. Comunícate con la Organización que te compartió el enlace.";
