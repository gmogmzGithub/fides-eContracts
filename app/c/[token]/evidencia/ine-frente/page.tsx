import { redirect } from "next/navigation";
import { EvidenceFrame } from "@/app/c/_components/evidence-frame";
import { IneCapture } from "@/app/c/_components/ine-capture";
import { LinkUnavailable } from "@/app/c/_components/link-unavailable";
import {
  basePath,
  evidenceSteps,
  isDone,
  loadView,
} from "@/app/c/_lib/view";

export const dynamic = "force-dynamic";

export default async function IneFrontPage({
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

  const steps = evidenceSteps(view);
  const index = steps.findIndex((step) => step.id === "ine_front");
  if (index < 0) redirect(`${base}/evidencia`);

  return (
    <EvidenceFrame
      title="Fotografía del frente de tu INE"
      stepIndex={index + 1}
      stepCount={steps.length}
      intro="Toma una fotografía del frente de tu credencial para votar. Se conserva como evidencia de este contrato."
      footnote="Esto es captura de evidencia. La plataforma no consulta al INE, no valida la autenticidad o la vigencia de la credencial y no compara rostros; no es verificación de identidad."
    >
      <IneCapture
        uploadUrl={`${base}/evidencia/subir`}
        kind="ine_front"
        side="frente"
        nextHref={`${base}/evidencia`}
        alreadyStored={steps[index].stored}
      />
    </EvidenceFrame>
  );
}
