import type { ReactNode } from "react";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { cerrarSesion } from "@/app/acceso/actions";
import { PlatformNavLink } from "./nav-link";
import { Wordmark } from "@/components/landing/wordmark";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/plataforma", label: "Organizaciones", exact: true },
  { href: "/plataforma/soporte", label: "Soporte", exact: false },
  { href: "/plataforma/archivo-muerto", label: "Archivo Muerto", exact: false },
  { href: "/plataforma/cuenta", label: "Mi cuenta", exact: false },
];

/**
 * Superficie del Proveedor: cromo oscuro y marca explícita para que nunca se
 * confunda con el portal de una Organización (ADR-0040, ADR-0057).
 */
export default async function PlataformaLayout({
  children,
}: {
  children: ReactNode;
}) {
  const account = await requirePlatformAdmin();

  return (
    <div className="min-h-screen bg-ivory text-ink">
      <header className="bg-carbon-deep text-ivory">
        <div className="mx-auto grid max-w-7xl gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/plataforma"
                className="cursor-pointer rounded-md transition-opacity duration-200 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <Wordmark tone="light" />
              </Link>
              <span className="rounded-full border border-accent/50 bg-accent/10 px-3 py-1 text-xs font-semibold tracking-widest text-accent uppercase">
                Administración de plataforma
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-white/70">
                {account.fullName}
                <span className="mx-2 text-white/30">·</span>
                {account.email}
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/80">
                {account.isLegalPublisher
                  ? "Publicador de contenido jurídico"
                  : "Sólo consulta y soporte"}
              </span>
              <form action={cerrarSesion}>
                <button
                  type="submit"
                  className="cursor-pointer rounded-lg border border-white/25 px-3 py-1.5 text-sm font-medium transition-colors duration-200 hover:border-white/60 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Cerrar sesión
                </button>
              </form>
            </div>
          </div>

          <nav
            aria-label="Administración de plataforma"
            className="flex flex-wrap items-center gap-1"
          >
            {NAV.map((item) => (
              <PlatformNavLink
                key={item.href}
                href={item.href}
                label={item.label}
                exact={item.exact}
              />
            ))}
          </nav>
        </div>

        <p className="border-t border-line-dark bg-carbon px-4 py-2 text-center text-xs text-white/60 sm:px-6 lg:px-8">
          Superficie del Proveedor. Ves todas las Organizaciones; no eres Miembro
          de ninguna y cada consulta queda auditada con tu identidad real.
        </p>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
