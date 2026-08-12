/** Dirección de contacto de la landing; configurable por entorno. */
export function contactEmail(): string {
  return process.env.FIDES_CONTACT_EMAIL ?? "contacto@fides.local";
}

export function contactMailto(
  subject = "Fides — quiero conocer la plataforma"
): string {
  return `mailto:${contactEmail()}?subject=${encodeURIComponent(subject)}`;
}
