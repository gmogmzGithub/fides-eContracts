import { redirect } from "next/navigation";
import { LinkUnavailable } from "@/app/c/_components/link-unavailable";
import {
  basePath,
  isDone,
  loadView,
  pendingEvidence,
} from "@/app/c/_lib/view";

export const dynamic = "force-dynamic";

/**
 * Distribuidor de la etapa `Evidencia`. Nunca muestra una pantalla vacía:
 * envía al paso pendiente del Perfil efectivo o directamente a `Aceptar`.
 */
export default async function EvidenceStagePage({
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

  const pending = pendingEvidence(view);
  if (pending) redirect(`${base}/evidencia/${pending.slug}`);
  redirect(`${base}/aceptar`);
}
