import type { MetadataRoute } from "next";

/** Manifiesto instalable de la misma aplicación web responsiva (ADR-0023). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fides",
    short_name: "Fides",
    description:
      "Plataforma contractual administrada para emitir, aceptar y conservar contratos.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAFAF9",
    theme_color: "#1C1917",
    lang: "es-MX",
    icons: [
      {
        src: "/icons/fides-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/fides-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/fides-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
