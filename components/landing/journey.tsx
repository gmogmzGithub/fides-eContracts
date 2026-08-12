const STEPS = [
  {
    step: "01",
    title: "Crea",
    copy: "Su Emisor elige el contrato-plantilla, reutiliza datos de contratos recientes y captura sólo las variables aprobadas. Antes de generar, revisa el texto completo y las opciones activas del Contrato.",
    detail: "Borrador con autoguardado · Resumen previo",
  },
  {
    step: "02",
    title: "Comparte",
    copy: "La plataforma genera un enlace con la vigencia elegida. Quien lo recibe entra sin cuenta, sin contraseña y sin código, recorre el texto completo y aporta la evidencia que ese Contrato solicite.",
    detail: "Enlace opaco · Vigencia por Contrato",
  },
  {
    step: "03",
    title: "Acepta y conserva",
    copy: "Al aceptar, el Contrato queda fijo. La Organización conserva el texto, la evidencia, la línea de tiempo y el paquete contractual, con el PDF disponible cuando lo pida.",
    detail: "Expediente completo · PDF bajo demanda",
  },
];

export function Journey() {
  return (
    <section id="recorrido" className="bg-carbon text-ivory">
      <div className="mx-auto max-w-editorial px-5 py-20 sm:px-8 sm:py-28">
        <div className="max-w-2xl">
          <p className="text-xs font-medium tracking-[0.22em] text-accent uppercase">
            Recorrido
          </p>
          <h2 className="mt-5 font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
            Tres pasos, del borrador al expediente conservado.
          </h2>
        </div>

        <ol className="mt-14 grid gap-10 lg:grid-cols-3 lg:gap-12">
          {STEPS.map((item) => (
            <li key={item.step} className="border-t border-white/15 pt-7">
              <div className="flex items-baseline gap-4">
                <span className="font-display text-sm text-accent">{item.step}</span>
                <h3 className="font-display text-2xl font-semibold">{item.title}</h3>
              </div>
              <p className="mt-5 text-sm leading-relaxed text-ivory/70">{item.copy}</p>
              <p className="mt-5 text-xs tracking-wide text-ivory/45 uppercase">
                {item.detail}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
