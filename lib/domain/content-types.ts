/**
 * Extensión de archivo por tipo de contenido. Es la única tabla: el nombre con
 * el que se descarga una evidencia suelta y el nombre que lleva dentro del
 * paquete frío deben coincidir siempre.
 */
const EXTENSIONS: Record<string, string> = {
  "application/json": ".json",
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/x-matroska": ".mkv",
};

export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType.toLowerCase()] ?? ".bin";
}
