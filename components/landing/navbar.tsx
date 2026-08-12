import Link from "next/link";
import { contactMailto } from "@/components/landing/contact-address";
import { Wordmark } from "@/components/landing/wordmark";

export function Navbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-carbon/95 backdrop-blur">
      <nav
        aria-label="Principal"
        className="mx-auto flex h-16 max-w-editorial items-center justify-between gap-4 px-5 sm:px-8"
      >
        <Link
          href="/"
          className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          aria-label="Fides, inicio"
        >
          <Wordmark tone="light" />
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href={contactMailto()}
            className="hidden cursor-pointer rounded-lg border border-white/25 px-4 py-2 text-sm font-medium text-ivory transition-colors duration-200 hover:border-white/60 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:inline-flex"
          >
            Contactar
          </a>
          <Link
            href="/acceso"
            className="inline-flex cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-carbon-deep transition-colors duration-200 hover:bg-[#b8790a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Iniciar sesión
          </Link>
        </div>
      </nav>
    </header>
  );
}
