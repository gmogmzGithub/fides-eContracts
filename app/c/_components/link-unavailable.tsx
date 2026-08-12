import { CARD, HEADING, MUTED } from "./styles";

/**
 * Una sola pantalla para cualquier motivo (desconocido, vencido, revocado,
 * cancelado, intento cerrado o aviso vigente incompleto). El texto es idéntico
 * en todos los casos para no revelar si existe un Contrato detrás del enlace.
 */
export function LinkUnavailable() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12 sm:py-16">
      <section className={CARD}>
        <h1 className={HEADING}>Este enlace no está disponible</h1>
        <p className={`${MUTED} mt-4`}>
          No podemos continuar con este enlace en este momento.
        </p>
        <p className={`${MUTED} mt-3`}>
          Si esperabas revisar un contrato, comunícate directamente con la
          Organización que te lo compartió. Ella puede confirmarte la situación
          y, si corresponde, enviarte un enlace nuevo.
        </p>
        <p className={`${MUTED} mt-3`}>
          Desde esta pantalla no es posible recuperar el acceso ni crear una
          cuenta.
        </p>
      </section>
    </main>
  );
}
