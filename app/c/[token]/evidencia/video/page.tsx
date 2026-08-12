import { redirect } from "next/navigation";
import { EvidenceFrame } from "@/app/c/_components/evidence-frame";
import { LinkUnavailable } from "@/app/c/_components/link-unavailable";
import { Notice } from "@/app/c/_components/notice";
import { VideoRecorder } from "@/app/c/_components/video-recorder";
import { syntheticEvidenceEnabled } from "@/lib/evidence-limits";
import {
  basePath,
  evidenceSteps,
  isDone,
  loadView,
} from "@/app/c/_lib/view";

export const dynamic = "force-dynamic";

export default async function GuidedVideoPage({
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
  const index = steps.findIndex((step) => step.id === "video");
  if (index < 0) redirect(`${base}/evidencia`);

  const statement = view.videoStatement.trim();

  // Sin declaración aprobada no hay grabación guiada posible: falla cerrada.
  if (!statement && !steps[index].stored) {
    return (
      <EvidenceFrame
        title="Video guiado"
        stepIndex={index + 1}
        stepCount={steps.length}
        intro="Este contrato solicita un video guiado."
        footnote="La declaración se publica junto con el contrato-plantilla; la Organización no la redacta durante la operación."
      >
        <div className="mt-6">
          <Notice tone="warning" role="alert">
            La declaración aprobada para este contrato no está disponible en
            este momento, así que no es posible grabar ni completar la
            aceptación. Comunícate con la Organización que te compartió el
            enlace.
          </Notice>
        </div>
      </EvidenceFrame>
    );
  }

  return (
    <EvidenceFrame
      title="Video guiado"
      stepIndex={index + 1}
      stepCount={steps.length}
      intro="Graba aquí mismo un video corto leyendo en voz alta la declaración aprobada para este contrato."
      footnote="La grabación se conserva como evidencia de este contrato. La plataforma no transcribe la voz, no reconoce rostros y no verifica identidad."
    >
      <VideoRecorder
        uploadUrl={`${base}/evidencia/subir`}
        statement={statement}
        nextHref={`${base}/evidencia`}
        alreadyStored={steps[index].stored}
        allowSynthetic={syntheticEvidenceEnabled()}
      />
    </EvidenceFrame>
  );
}
