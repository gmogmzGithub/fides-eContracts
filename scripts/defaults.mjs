/**
 * Valores por omisión del entorno local, compartidos por los scripts `.mjs`.
 *
 * El lado TypeScript tiene los suyos en `lib/db.ts` (`DEFAULT_DATABASE_URL`) y
 * `lib/app-url.ts`: los scripts no pueden importar TS, así que este archivo es
 * su equivalente. Si cambia el puerto local, cambian ambos lados.
 */

export const DEFAULT_DATABASE_URL =
  "postgres://fides:fides_local_only@127.0.0.1:54329/fides";

export const DEFAULT_APP_URL = "http://localhost:3002";

/** Dirección de la aplicación sin diagonal final. */
export function appUrl() {
  return (process.env.FIDES_APP_URL ?? DEFAULT_APP_URL).replace(/\/$/, "");
}
