import {
  AuthorizationError,
  DomainError,
  NotFoundError,
} from "@/lib/domain/errors";

interface PrivateFile {
  body: Buffer | Uint8Array;
  contentType: string;
  fileName: string;
  /** `inline` se muestra en el navegador; `attachment` siempre descarga. */
  disposition: "inline" | "attachment";
}

/**
 * Toda entrega de archivo privado —PDF, evidencia, paquete contractual y
 * exportación— comparte la misma postura: nunca se cachea y nunca se indexa.
 * Vive en un solo lugar para que endurecerla alcance a las cuatro rutas.
 */
export function privateFileResponse(file: PrivateFile): Response {
  return new Response(new Uint8Array(file.body), {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `${file.disposition}; filename="${file.fileName}"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

/**
 * Traduce el error de dominio al estado HTTP. Un error desconocido vuelve a
 * subir: la ruta no inventa un mensaje para algo que no entiende.
 */
export function downloadError(error: unknown): Response {
  if (error instanceof NotFoundError) {
    return new Response(error.message, { status: 404 });
  }
  if (error instanceof AuthorizationError) {
    return new Response(error.message, { status: 403 });
  }
  if (error instanceof DomainError) {
    return new Response(error.message, { status: 409 });
  }
  throw error;
}
