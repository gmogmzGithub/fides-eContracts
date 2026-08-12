import Image from "next/image";

export function Origin() {
  return (
    <section aria-labelledby="origen-fides" className="overflow-hidden bg-[#eeebe5]">
      <div className="mx-auto grid max-w-editorial gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-20">
        <figure className="mx-auto w-full max-w-xl">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div className="relative col-span-2 aspect-[2/1] overflow-hidden rounded-[1.5rem] border border-carbon/10 bg-[#d8c9ad] p-3 shadow-xl shadow-carbon/10 sm:p-5">
              <Image
                src="/images/fides-coin-aureus.jpg"
                alt="Áureo romano con un retrato y dos manos unidas bajo la palabra Fides."
                fill
                sizes="(min-width: 1024px) 36vw, 88vw"
                className="object-contain p-3 mix-blend-multiply sm:p-5"
              />
            </div>

            <div className="relative min-h-44 overflow-hidden rounded-[1.25rem] border border-carbon/10 bg-[#d9d0c2] shadow-lg shadow-carbon/10 sm:min-h-56">
              <Image
                src="/images/fides-coin-clasped-hands.webp"
                alt="Moneda romana con la palabra Fides y dos manos unidas."
                fill
                sizes="(min-width: 1024px) 22vw, 44vw"
                className="object-contain p-2 mix-blend-multiply sm:p-3"
              />
            </div>

            <div className="relative min-h-44 overflow-hidden rounded-[1.25rem] border border-carbon/10 bg-[#ded7cc] shadow-lg shadow-carbon/10 sm:min-h-56">
              <Image
                src="/images/fides-coin-standards.jpg"
                alt="Moneda romana con una figura de Fides entre estandartes."
                fill
                sizes="(min-width: 1024px) 14vw, 44vw"
                className="object-contain p-2 mix-blend-multiply sm:p-3"
              />
            </div>
          </div>
          <figcaption className="mt-4 text-center text-xs leading-relaxed text-carbon-soft">
            Fides aparece en monedas romanas como figura, palabra y gesto: las
            manos unidas hacen visible la confianza comprometida.
          </figcaption>
        </figure>

        <div>
          <p className="text-xs font-medium tracking-[0.22em] text-accent-strong uppercase">
            El nombre
          </p>
          <h2
            id="origen-fides"
            className="mt-5 font-display text-4xl leading-[1.08] font-semibold tracking-tight text-carbon text-balance sm:text-5xl"
          >
            La buena fe, hecha evidencia.
          </h2>
          <div className="ca-rule mt-8 w-40" aria-hidden="true" />
          <p className="mt-8 max-w-xl text-base leading-relaxed text-carbon-soft sm:text-lg">
            Fides toma su nombre de la diosa romana de la buena fe y la palabra
            dada. La idea alcanzaba las relaciones públicas y privadas, desde
            los juramentos hasta los acuerdos comerciales.
          </p>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-carbon-soft">
            Para nosotros se traduce en algo concreto: contratos digitales con
            evidencia clara, conservados como parte de un expediente completo.
          </p>
        </div>
      </div>
    </section>
  );
}
