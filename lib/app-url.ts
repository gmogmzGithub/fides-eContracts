export function appUrl(): string {
  // Una variable vacía debe caer al valor local: un enlace relativo no sirve
  // en el mensaje que la Organización comparte con el Firmante.
  const configured = process.env.FIDES_APP_URL?.trim().replace(/\/$/, "");
  return configured || "http://localhost:3002";
}

export function signerUrl(token: string): string {
  return `${appUrl()}/c/${token}`;
}
