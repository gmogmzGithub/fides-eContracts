import { redirect } from "next/navigation";
import { LinkUnavailable } from "@/app/c/_components/link-unavailable";
import { MarkdownBlock } from "@/app/c/_components/markdown";
import { ScrollGate } from "@/app/c/_components/scroll-gate";
import {
  CARD,
  FOCUS_RING,
  HEADING,
  MUTED,
  SUBHEADING,
  TINY,
} from "@/app/c/_components/styles";
import { afterContractHref, basePath, isDone, loadView } from "@/app/c/_lib/view";
import { formatDateTime } from "@/lib/format";
import { markWalkedAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ContractStagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await loadView(token);
  if (!view.ok) return <LinkUnavailable />;

  const base = basePath(view.token);
  if (isDone(view)) redirect(`${base}/listo`);

  const onReachedEnd = markWalkedAction.bind(null, view.token);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-6 pb-16">
      <h1 className={HEADING}>Contrato para tu revisión</h1>
      <p className={`${MUTED} mt-2`}>
        {view.organizationName} te compartió este contrato. Revísalo completo
        antes de continuar. No necesitas cuenta, correo, teléfono ni código.
      </p>

      {/* El Aviso de Privacidad se muestra antes de cualquier evidencia. */}
      <section className={`${CARD} mt-6`} aria-labelledby="aviso-titulo">
        <h2 id="aviso-titulo" className={SUBHEADING}>
          Aviso de Privacidad
        </h2>
        <MarkdownBlock className="mt-3" markdown={view.privacy.markdown} />
      </section>

      <section className={`${CARD} mt-6`} aria-labelledby="contrato-titulo">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="contrato-titulo" className={SUBHEADING}>
            Contrato
          </h2>
          <a
            className={`inline-flex min-h-[44px] cursor-pointer items-center rounded-lg px-2 text-sm font-semibold text-[#1C1917] underline decoration-[#CA8A04] decoration-2 underline-offset-4 transition-colors duration-200 hover:text-[#A16207] ${FOCUS_RING}`}
            href={`${base}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver PDF
          </a>
        </div>
        <p className={`${TINY} mt-1`}>
          El texto de esta pantalla es el contrato. Abrir el PDF es opcional y
          no es necesario para continuar.
        </p>

        <MarkdownBlock className="mt-5" markdown={view.contractMarkdown} />

        <ScrollGate
          walked={view.walked}
          nextHref={afterContractHref(view)}
          onReachedEnd={onReachedEnd}
        />
      </section>

      <p className={`${TINY} mt-6`}>
        Este enlace está disponible hasta el {formatDateTime(view.expiresAt)}.
      </p>
    </main>
  );
}
