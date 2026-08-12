import Link from "next/link";
import { contactEmail, contactMailto } from "@/components/landing/contact-address";

export function Contact() {
  return (
    <section id="contacto" className="border-t border-line bg-[#f5f4f2]">
      <div className="mx-auto max-w-editorial px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-xs font-medium tracking-[0.22em] text-accent-strong uppercase">
              Contacto
            </p>
            <h2 className="mt-5 font-display text-3xl leading-tight font-semibold tracking-tight text-carbon text-balance sm:text-4xl">
              Hablemos de la operación contractual de su Organización.
            </h2>
            <div className="ca-rule mt-7 w-32" aria-hidden="true" />
            <p className="mt-7 max-w-xl text-base leading-relaxed text-carbon-soft">
              Cada implementación comienza fuera de la aplicación: revisamos su
              operación, preparamos el contenido jurídico y publicamos sus
              contratos-plantilla. Después su equipo entra y opera.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <a
              href={contactMailto()}
              className="inline-flex cursor-pointer items-center rounded-lg bg-carbon px-6 py-3 text-[0.9375rem] font-semibold text-ivory transition-colors duration-200 hover:bg-carbon-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Contactar
            </a>
            <Link
              href="/acceso"
              className="inline-flex cursor-pointer items-center rounded-lg border border-carbon/25 px-6 py-3 text-[0.9375rem] font-medium text-carbon transition-colors duration-200 hover:border-carbon hover:bg-carbon/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Iniciar sesión
            </Link>
          </div>
        </div>

        <p className="mt-10 text-sm text-carbon-soft">
          Escríbanos a{" "}
          <a
            className="cursor-pointer font-medium text-accent-strong underline underline-offset-4 transition-colors duration-200 hover:text-carbon"
            href={contactMailto()}
          >
            {contactEmail()}
          </a>
          .
        </p>
      </div>
    </section>
  );
}
