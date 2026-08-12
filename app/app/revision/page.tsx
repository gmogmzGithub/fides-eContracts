import Link from "next/link";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { listReviewTasks } from "@/lib/domain/review";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AI_RECOMMENDATION_LABELS } from "@/app/app/_lib/labels";
import type { RawSearchParams } from "@/app/app/_lib/search-params";

const BASE_PATH = "/app/revision";

/** Antigüedad operativa del intento; nunca vence una revisión por tiempo. */
function ageLabel(submittedAt: Date): string {
  const days = Math.floor((Date.now() - new Date(submittedAt).getTime()) / 86_400_000);
  if (days <= 0) return "Hoy";
  if (days === 1) return "1 día";
  return `${days} días`;
}

export default async function ReviewInboxPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const context = await requireOrganizationContext();
  requireRole(context, "reviewer");

  const query = await searchParams;
  const rawPage = typeof query.page === "string" ? Number.parseInt(query.page, 10) : 1;
  const result = await listReviewTasks(
    context,
    Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="A revisión"
        description="Bandeja compartida de la Organización. Cualquier Miembro con rol Revisor puede decidir."
      />

      {result.rows.length === 0 ? (
        <EmptyState
          title="No hay procesos a revisión"
          description="Cuando un Firmante envíe un intento bajo revisión manual o asistida por AI aparecerá aquí."
        />
      ) : (
        <>
          <Table className="hidden md:block">
            <THead>
              <Tr>
                <Th>Referencia</Th>
                <Th>Titular contractual</Th>
                <Th>Firmante</Th>
                <Th>Intento</Th>
                <Th>Recibido</Th>
                <Th>Antigüedad</Th>
                <Th>Recomendación AI</Th>
              </Tr>
            </THead>
            <TBody>
              {result.rows.map((task) => (
                <Tr key={task.taskId}>
                  <Td>
                    <Link
                      href={`${BASE_PATH}/${task.taskId}`}
                      className="cursor-pointer font-medium text-carbon underline-offset-4 transition-colors duration-200 hover:text-accent hover:underline"
                    >
                      {task.reference}
                    </Link>
                    <span className="block text-xs text-carbon-soft">
                      {task.templateName}
                    </span>
                  </Td>
                  <Td>{task.holderName}</Td>
                  <Td>{task.signerName}</Td>
                  <Td>{task.sequence}</Td>
                  <Td>{formatDateTime(task.submittedAt)}</Td>
                  <Td>{ageLabel(task.submittedAt)}</Td>
                  <Td>
                    {task.aiRecommendation ? (
                      <Badge
                        tone={task.aiRecommendation === "repeat" ? "warn" : "neutral"}
                      >
                        {AI_RECOMMENDATION_LABELS[task.aiRecommendation] ??
                          task.aiRecommendation}
                      </Badge>
                    ) : (
                      <span className="text-carbon-soft">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>

          <ul className="grid gap-3 md:hidden">
            {result.rows.map((task) => (
              <li key={task.taskId}>
                <Card>
                  <CardBody>
                    <div className="grid gap-2">
                      <Link
                        href={`${BASE_PATH}/${task.taskId}`}
                        className="cursor-pointer font-medium text-carbon underline-offset-4 transition-colors duration-200 hover:text-accent hover:underline"
                      >
                        {task.reference}
                      </Link>
                      <p className="text-xs text-carbon-soft">{task.templateName}</p>
                      <p className="text-sm text-ink">{task.holderName}</p>
                      <p className="text-xs text-carbon-soft">
                        Firmante: {task.signerName} · Intento {task.sequence}
                      </p>
                      <p className="text-xs text-carbon-soft">
                        Recibido {formatDateTime(task.submittedAt)} ·{" "}
                        {ageLabel(task.submittedAt)}
                      </p>
                      {task.aiRecommendation ? (
                        <div>
                          <Badge
                            tone={
                              task.aiRecommendation === "repeat" ? "warn" : "neutral"
                            }
                          >
                            {AI_RECOMMENDATION_LABELS[task.aiRecommendation] ??
                              task.aiRecommendation}
                          </Badge>
                        </div>
                      ) : null}
                    </div>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>

          <Pagination
            page={result.page}
            pages={result.pages}
            total={result.total}
            basePath={BASE_PATH}
          />
        </>
      )}
    </div>
  );
}
