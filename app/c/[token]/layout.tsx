import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LinkUnavailable } from "@/app/c/_components/link-unavailable";
import { StageProgress } from "@/app/c/_components/stage-progress";
import {
  basePath,
  evidenceComplete,
  isDone,
  loadView,
} from "@/app/c/_lib/view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contrato",
  robots: { index: false, follow: false },
};

export default async function SignerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await loadView(token);

  // El enlace se resuelve en servidor antes de mostrar cualquier dato del
  // Contrato. Sin enlace utilizable no se renderiza la pantalla hija.
  if (!view.ok) {
    return (
      <div className="min-h-dvh bg-[#FAFAF9] text-[#0C0A09]">
        <LinkUnavailable />
      </div>
    );
  }

  const base = basePath(view.token);

  return (
    <div className="min-h-dvh bg-[#FAFAF9] text-[#0C0A09]">
      <header className="sticky top-0 z-20 border-b border-[#292524] bg-[#1C1917]">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-1.5 px-4 py-3">
          <p className="truncate text-sm font-medium text-[#FAFAF9]">
            {view.organizationName}
            <span aria-hidden="true" className="px-2 text-[#78716C]">
              ·
            </span>
            <span className="text-[#E8D9A8]">{view.reference}</span>
          </p>
          <StageProgress
            base={base}
            walked={view.walked}
            evidenceReady={evidenceComplete(view)}
            finished={isDone(view)}
          />
        </div>
      </header>
      {children}
    </div>
  );
}
