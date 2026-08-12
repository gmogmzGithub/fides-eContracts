export type UploadOutcome = { ok: true } | { ok: false; error: string };

const FALLBACK_ERROR = "No pudimos enviar la evidencia. Inténtalo de nuevo.";

interface JsonPayload {
  ok?: unknown;
  error?: unknown;
}

async function readJson(response: Response): Promise<JsonPayload | null> {
  try {
    const value: unknown = await response.json();
    if (value !== null && typeof value === "object") return value as JsonPayload;
    return null;
  } catch {
    return null;
  }
}

/** Envía un archivo de evidencia al route handler del propio enlace. */
export async function postEvidence(
  url: string,
  body: FormData
): Promise<UploadOutcome> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", body });
  } catch {
    return {
      ok: false,
      error: "No pudimos enviar la evidencia. Revisa tu conexión e inténtalo de nuevo.",
    };
  }

  const payload = await readJson(response);
  if (response.ok && payload?.ok === true) return { ok: true };
  return {
    ok: false,
    error: typeof payload?.error === "string" ? payload.error : FALLBACK_ERROR,
  };
}
