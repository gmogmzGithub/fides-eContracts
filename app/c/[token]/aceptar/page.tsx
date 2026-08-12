import Link from "next/link";
import { redirect } from "next/navigation";
import { AcceptForm } from "@/app/c/_components/accept-form";
import { LinkUnavailable } from "@/app/c/_components/link-unavailable";
import { MarkdownBlock } from "@/app/c/_components/markdown";
import {
  CARD,
  FOCUS_RING,
  HEADING,
  MUTED,
  SUBHEADING,
  TINY,
} from "@/app/c/_components/styles";
import {
  basePath,
  evidenceComplete,
  isDone,
  loadView,
} from "@/app/c/_lib/view";
import { acceptAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AcceptStagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await loadView(token);
  if (!view.ok) return <LinkUnavailable />;

  const base = basePath(view.token);
  if (isDone(view)) redirect(`${base}/listo`);
  if (!view.walked) redirect(base);
  if (!evidenceComplete(view)) redirect(`${base}/evidencia`);

  const action = acceptAction.bind(null, view.token);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-6 pb-16">
      <h1 className={HEADING}>Aceptar contrato</h1>
      <p className={`${MUTED} mt-2`}>
        Referencia contractual {view.reference} · {view.organizationName}
      </p>

      <section className={`${CARD} mt-6`} aria-labelledby="leyenda-titulo">
        <AcceptForm
          action={action}
          legend={
            <div>
              <h2 id="leyenda-titulo" className={SUBHEADING}>
                Leyenda de aceptación
              </h2>
              <MarkdownBlock
                className="mt-3"
                markdown={view.acceptanceLegend}
              />
            </div>
          }
        />
      </section>

      <p className={`${TINY} mt-6`}>
        ¿Quieres revisar el texto otra vez?{" "}
        <Link
          className={`cursor-pointer font-semibold text-[#1C1917] underline decoration-[#CA8A04] decoration-2 underline-offset-4 ${FOCUS_RING}`}
          href={base}
          prefetch={false}
        >
          Volver al contrato
        </Link>
        .
      </p>
    </main>
  );
}
