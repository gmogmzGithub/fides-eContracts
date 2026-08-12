import { redirect } from "next/navigation";
import { LinkUnavailable } from "@/app/c/_components/link-unavailable";
import { CARD, HEADING, MUTED, PRIMARY_ACTION } from "@/app/c/_components/styles";
import { basePath, isDone, loadView, stageHref } from "@/app/c/_lib/view";

export const dynamic = "force-dynamic";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await loadView(token);
  if (!view.ok) return <LinkUnavailable />;

  const base = basePath(view.token);
  if (!isDone(view)) redirect(stageHref(view));

  const result =
    view.result ?? (view.reviewPolicy === "none" ? "accepted" : "in_review");

  if (result === "accepted") {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 pt-10 pb-16">
        <section className={CARD}>
          <h1 className={HEADING}>Contrato aceptado</h1>
          <p className={`${MUTED} mt-3`}>
            Referencia contractual{" "}
            <strong className="text-[#0C0A09]">{view.reference}</strong>
          </p>
          <a
            className={`${PRIMARY_ACTION} mt-6`}
            href={`${base}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver PDF
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-10 pb-16">
      <section className={CARD}>
        <h1 className={HEADING}>Proceso enviado a revisión</h1>
        <p className={`${MUTED} mt-3`}>
          La Organización te contactará únicamente si necesita que repitas el
          proceso.
        </p>
      </section>
    </main>
  );
}
