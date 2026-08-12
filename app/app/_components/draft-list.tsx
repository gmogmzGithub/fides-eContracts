import Link from "next/link";
import type { DraftDetail } from "@/lib/domain/drafts";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";

/**
 * Un Borrador vive fuera del Contrato emitido: sólo lo ven su Emisor creador
 * y los Administradores, y se muestra siempre con el estado `Borrador`.
 */
export function DraftList({ drafts }: { drafts: DraftDetail[] }) {
  if (drafts.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg text-carbon">Borradores</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {drafts.map((draft) => (
          <li key={draft.id}>
            <Card>
              <CardBody>
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/app/contratos/nuevo/${draft.id}`}
                      className="cursor-pointer font-medium text-carbon underline-offset-4 transition-colors duration-200 hover:text-accent hover:underline"
                    >
                      {draft.template.name}
                    </Link>
                    <Badge tone="neutral">Borrador</Badge>
                  </div>
                  <p className="text-sm text-ink">
                    {draft.holder?.name ?? "Titular contractual pendiente"}
                  </p>
                  <p className="text-xs text-carbon-soft">
                    {draft.createdByName} · Actualizado {formatDateTime(draft.updatedAt)}
                  </p>
                  {draft.missingFields.length > 0 ? (
                    <p className="text-xs text-carbon-soft">
                      Faltan {draft.missingFields.length} datos obligatorios.
                    </p>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
