import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/landing/wordmark";

const PANEL_POINTS = [
  "Contratos-plantilla ya publicados para su Organización.",
  "Enlace con vigencia para quien debe aceptar.",
  "Expediente conservado con su evidencia y su línea de tiempo.",
];

export default function AccesoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      {/* Panel editorial vertical: sólo escritorio. */}
      <aside className="relative hidden overflow-hidden bg-carbon px-12 py-14 text-ivory lg:flex lg:flex-col lg:justify-between">
        <Image
          src="/images/romain-dancre-contract-signing.jpg"
          alt=""
          fill
          priority
          sizes="45vw"
          className="object-cover object-center"
        />
        <div
          className="pointer-events-none absolute inset-0 bg-linear-to-r from-carbon/95 via-carbon/80 to-carbon/35"
          aria-hidden="true"
        />
        <Link
          href="/"
          className="relative w-fit rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <Wordmark tone="light" />
        </Link>

        <div className="relative max-w-md">
          <p className="text-xs font-medium tracking-[0.22em] text-accent uppercase">
            Plataforma contractual administrada
          </p>
          <p className="mt-7 font-display text-4xl leading-[1.1] font-semibold tracking-tight text-balance">
            Su operación contractual, completa y conservada.
          </p>
          <div className="ca-rule mt-8 w-32" aria-hidden="true" />
          <ul className="mt-8 grid gap-3 text-sm leading-relaxed text-ivory/65">
            {PANEL_POINTS.map((point) => (
              <li key={point} className="flex gap-3">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-ivory/40">
          El acceso es individual y por invitación.
        </p>
      </aside>

      <main className="flex flex-col bg-ivory">
        <div className="border-b border-line px-5 py-4 lg:hidden">
          <Link
            href="/"
            className="w-fit rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <Wordmark />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-12 sm:px-10">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </main>
    </div>
  );
}
