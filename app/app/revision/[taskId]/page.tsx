import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { getReviewTask } from "@/lib/domain/review";
import { NotFoundError } from "@/lib/domain/errors";
import { formatBytes, formatDateTime } from "@/lib/format";
import {
  EVIDENCE_LABELS,
  REPEAT_REASON_LABELS,
  REVIEW_POLICY_LABELS,
  evidenceSummary,
} from "@/lib/domain/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { MarkdownView } from "@/components/ui/markdown-view";
import { DecisionPanel } from "@/app/app/revision/[taskId]/decision-panel";
import {
  AI_RECOMMENDATION_LABELS,
  DECISION_LABELS,
} from "@/app/app/_lib/labels";

export default async function ReviewTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const context = await requireOrganizationContext();
  requireRole(context, "reviewer");
  const { taskId } = await params;

  let task;
  try {
    task = await getReviewTask(context, taskId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const profile = evidenceSummary(task);

  return (
    <div className="space-y-6">
      <PageHeader
        title={task.reference}
        description={`${task.templateName} · Intento ${task.sequence} · Recibido ${formatDateTime(task.submittedAt)}`}
        actions={
          <Link
            href={`/app/contratos/${task.contractId}`}
            className="cursor-pointer text-sm text-carbon-soft underline-offset-4 transition-colors duration-200 hover:text-carbon hover:underline"
          >
            Ver el expediente
          </Link>
        }
      />

      {task.decision ? (
        <Alert tone="info" title="Esta revisión ya tiene una decisión registrada">
          {DECISION_LABELS[task.decision.decision]} · {task.decision.reviewerName} ·{" "}
          {formatDateTime(task.decision.createdAt)}
          {task.decision.reasonCode
            ? ` · Motivo: ${REPEAT_REASON_LABELS[task.decision.reasonCode]}`
            : ""}
          {task.decision.reasonText ? ` — ${task.decision.reasonText}` : ""}
        </Alert>
      ) : null}

      {task.canDecide ? (
        <DecisionPanel taskId={task.taskId} contractId={task.contractId} />
      ) : (
        <Alert tone="info">
          Esta revisión ya no admite decisiones. Consulta el expediente para ver el
          resultado registrado.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Perfil de evidencia efectivo"
          description="Quedó congelado al emitir el Contrato y aplica a todos sus intentos."
        />
        <CardBody>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="font-medium text-carbon">Evidencia exigida:</dt>
              <dd className="text-carbon-soft">{profile.join(", ")}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-carbon">Política de revisión:</dt>
              <dd className="text-carbon-soft">
                {REVIEW_POLICY_LABELS[task.reviewPolicy]}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-carbon">Titular contractual:</dt>
              <dd className="text-carbon-soft">{task.holderName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-carbon">Firmante:</dt>
              <dd className="text-carbon-soft">{task.signerName}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Evidencia de este intento" />
        <CardBody>
          {task.evidence.length === 0 ? (
            <p className="text-sm text-carbon-soft">Sin evidencia registrada.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {task.evidence.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2"
                >
                  <span className="font-medium text-carbon">
                    {EVIDENCE_LABELS[item.kind]}
                  </span>
                  <span className="text-carbon-soft">
                    {item.contentType} · {formatBytes(item.byteSize)} ·{" "}
                    {formatDateTime(item.createdAt)}
                  </span>
                  <span className="font-mono text-xs break-all text-carbon-soft">
                    {item.sha256}
                  </span>
                  {task.canOpenEvidence && item.objectKey ? (
                    <a
                      href={`/app/evidencia/${item.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-accent-strong underline underline-offset-4"
                    >
                      Abrir archivo
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {task.videoStatement ? (
            <div className="mt-4 rounded-lg bg-[#fcfcfb] px-4 py-3">
              <p className="text-xs tracking-wide text-muted uppercase">
                Declaración esperada en el video
              </p>
              <p className="text-sm text-carbon-soft">{task.videoStatement}</p>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {task.aiReport ? (
        <Card>
          <CardHeader
            title="Reporte de revisión por AI"
            description="El agente sólo recomienda; la decisión es tuya."
            action={
              task.aiReport.recommendation ? (
                <Badge
                  tone={
                    task.aiReport.recommendation === "repeat" ? "warn" : "neutral"
                  }
                >
                  {AI_RECOMMENDATION_LABELS[task.aiReport.recommendation]}
                </Badge>
              ) : null
            }
          />
          <CardBody>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="font-medium text-carbon">Estado del análisis</dt>
                <dd className="text-carbon-soft">
                  {task.aiReport.status === "completed" ? "Completado" : "Falló"} ·{" "}
                  {formatDateTime(task.aiReport.createdAt)}
                </dd>
              </div>
              {task.aiReport.transcript ? (
                <div>
                  <dt className="font-medium text-carbon">Transcripción</dt>
                  <dd className="text-carbon-soft">{task.aiReport.transcript}</dd>
                </div>
              ) : null}
              {task.aiReport.expectedStatement ? (
                <div>
                  <dt className="font-medium text-carbon">Declaración esperada</dt>
                  <dd className="text-carbon-soft">
                    {task.aiReport.expectedStatement}
                  </dd>
                </div>
              ) : null}
              {task.aiReport.limitations ? (
                <div>
                  <dt className="font-medium text-carbon">Limitaciones</dt>
                  <dd className="text-carbon-soft">{task.aiReport.limitations}</dd>
                </div>
              ) : null}
            </dl>
          </CardBody>
        </Card>
      ) : null}

      {task.history.length > 0 ? (
        <Card>
          <CardHeader title="Repeticiones anteriores" />
          <CardBody>
            <ol className="grid gap-2 text-sm">
              {task.history.map((entry) => (
                <li key={entry.taskId + entry.createdAt.toString()}>
                  <span className="text-carbon-soft">
                    {formatDateTime(entry.createdAt)}
                  </span>{" "}
                  <span className="font-medium text-carbon">
                    {DECISION_LABELS[entry.decision]}
                  </span>{" "}
                  <span className="text-carbon-soft">
                    {entry.reviewerName}
                    {entry.reasonCode
                      ? ` · ${REPEAT_REASON_LABELS[entry.reasonCode]}`
                      : ""}
                    {entry.reasonText ? ` — ${entry.reasonText}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Contrato" />
        <CardBody>
          <MarkdownView markdown={task.contractMarkdown} />
        </CardBody>
      </Card>
    </div>
  );
}
