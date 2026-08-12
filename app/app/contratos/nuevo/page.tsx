import Link from "next/link";
import { Star } from "lucide-react";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { listTemplates } from "@/lib/domain/templates";
import { listDrafts } from "@/lib/domain/drafts";
import {
  listRecentContracts,
  type RecentContract,
} from "@/lib/domain/recent-contracts";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm } from "@/app/app/_components/action-form";
import { DraftList } from "@/app/app/_components/draft-list";
import { crearDesdeContrato } from "@/app/app/_actions/contracts";
import { iniciarBorrador } from "@/app/app/contratos/nuevo/actions";

const FAVORITES_SHOWN = 6;

export default async function NewContractPage() {
  const context = await requireOrganizationContext();
  requireRole(context, "emitter");

  // Las tres lecturas son independientes: la página no se arma hasta tener las
  // tres, así que encadenarlas sólo sumaría viajes a la base.
  const [allTemplates, allDrafts, favorites] = await Promise.all([
    listTemplates(context.organization.id),
    listDrafts(context),
    // Un contrato que se repite mucho se marca como Favorito y se vuelve a
    // crear con los mismos datos. Fides copia el contenido capturado, nunca el
    // enlace, la evidencia ni el estado del Contrato anterior.
    listRecentContracts(context, "", {
      onlyFavorites: true,
      limit: FAVORITES_SHOWN,
    }),
  ]);
  const templates = allTemplates.filter(
    (template) => template.currentVersion !== null
  );
  const drafts = allDrafts.filter(
    (draft) => draft.createdBy === context.account.accountId
  );

  if (templates.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Crear contrato" />
        <EmptyState
          title="Todavía no hay un Contrato-plantilla listo"
          description="Tu Organización aún no tiene contenido contractual publicado para operar. En cuanto esté disponible aparecerá aquí."
        />
      </div>
    );
  }

  const single = templates.length === 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crear contrato"
        description={
          single
            ? "Tu contrato está listo para capturar."
            : "Elige qué contrato quieres crear."
        }
      />

      <FavoritesCard favorites={favorites} />

      <ul className="grid gap-4 md:grid-cols-2">
        {templates.map((template) => (
          <li key={template.id}>
            <Card>
              <CardHeader title={template.name} description={template.summary} />
              <CardBody>
                <ActionForm
                  action={iniciarBorrador}
                  submitLabel="Comenzar"
                  hidden={{ templateId: template.id }}
                />
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>

      <DraftList drafts={drafts} />
    </div>
  );
}

/** Atajo para repetir un contrato frecuente sin pasar por `Recientes`. */
function FavoritesCard({ favorites }: { favorites: RecentContract[] }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Star aria-hidden className="size-5 text-accent-strong" fill="currentColor" />
            Favoritos
          </span>
        }
        description="Contratos que marcaste con la estrella. Créalos otra vez con los mismos datos y sólo cambia lo que haga falta."
        action={
          <Link
            href="/app/recientes"
            className="cursor-pointer text-sm text-carbon-soft underline-offset-4 transition-colors duration-200 hover:text-carbon hover:underline"
          >
            Ver Recientes
          </Link>
        }
      />
      <CardBody>
        {favorites.length === 0 ? (
          <p className="text-sm text-carbon-soft">
            Todavía no tienes Favoritos. En{" "}
            <Link
              href="/app/recientes"
              className="cursor-pointer font-medium text-carbon underline underline-offset-4"
            >
              Recientes
            </Link>{" "}
            marca con la estrella los contratos que repites y aparecerán aquí.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {favorites.map((favorite) => (
              <li
                key={favorite.id}
                className="flex flex-col gap-3 rounded-lg border border-line p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-carbon">{favorite.templateName}</p>
                  <p className="mt-1 truncate text-sm text-carbon-soft">
                    {favorite.holderName}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{favorite.reference}</p>
                </div>
                <ActionForm
                  action={crearDesdeContrato}
                  submitLabel="Usar este favorito"
                  variant="secondary"
                  size="sm"
                  className="mt-auto"
                  hidden={{ contractId: favorite.id }}
                />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
