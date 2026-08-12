import Link from "next/link";
import Image from "next/image";
import { contactMailto } from "@/components/landing/contact-address";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-carbon text-ivory">
      <div className="ca-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-editorial gap-14 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-20">
        <div className="ca-rise">
          <p className="text-xs font-medium tracking-[0.22em] text-accent uppercase">
            Plataforma contractual administrada
          </p>
          <h1 className="mt-6 font-display text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
            Contratos que su Organización emite, comparte y conserva.
          </h1>
          <div className="ca-rule mt-8 w-40" aria-hidden="true" />
          <p className="mt-8 max-w-xl text-base leading-relaxed text-ivory/75 sm:text-lg">
            Su Organización recibe la plataforma lista: contratos-plantilla
            publicados, campos definidos e interfaces configuradas. Su equipo
            captura únicamente las variables permitidas, comparte un enlace y
            conserva cada expediente completo.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/acceso"
              className="inline-flex cursor-pointer items-center rounded-lg bg-accent px-6 py-3 text-[0.9375rem] font-semibold text-carbon-deep transition-colors duration-200 hover:bg-[#b8790a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Iniciar sesión
            </Link>
            <a
              href={contactMailto()}
              className="inline-flex cursor-pointer items-center rounded-lg border border-white/30 px-6 py-3 text-[0.9375rem] font-medium text-ivory transition-colors duration-200 hover:border-white/70 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Contactar
            </a>
          </div>

          <p className="mt-6 text-sm text-ivory/50">
            El acceso es individual y por invitación. No hay registro público.
          </p>
        </div>

        <figure className="ca-rise ca-rise-2 relative min-h-[32rem] overflow-hidden rounded-xl border border-white/12 bg-white/5 shadow-2xl shadow-black/20">
          <Image
            src="/images/amina-atar-contract-handshake.jpg"
            alt="Dos profesionales estrechan la mano sobre un acuerdo firmado."
            fill
            priority
            sizes="(min-width: 1024px) 38vw, 92vw"
            className="object-cover object-center"
          />
          <div
            className="pointer-events-none absolute inset-0 bg-linear-to-t from-carbon/55 via-transparent to-transparent"
            aria-hidden="true"
          />
          <figcaption className="absolute right-6 bottom-5 left-6 text-sm leading-relaxed text-ivory/80">
            Contratos digitales con evidencia clara.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
