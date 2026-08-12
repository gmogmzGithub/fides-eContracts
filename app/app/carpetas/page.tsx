import Link from "next/link";
import { Folder, FolderPlus, MoreHorizontal } from "lucide-react";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { listFolders } from "@/lib/domain/contracts";
import { PageHeader } from "@/components/ui/page-header";
import { CardBody } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm } from "@/app/app/_components/action-form";
import {
  crearCarpeta,
  eliminarCarpeta,
  renombrarCarpeta,
} from "@/app/app/carpetas/actions";

export default async function FoldersPage() {
  const context = await requireOrganizationContext();
  requireRole(context, "administrator", "emitter");

  const folders = await listFolders(context.organization.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Carpetas"
        description="Abre una carpeta para ver los contratos que contiene."
        actions={
          <details className="group relative">
            <summary className={buttonClass("secondary", "sm") }>
              <FolderPlus aria-hidden className="size-4" />
              Nueva carpeta
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white shadow-xl">
              <CardBody>
                <ActionForm action={crearCarpeta} submitLabel="Crear carpeta">
                  <Field label="Nombre" required>
                    <TextInput
                      name="name"
                      required
                      maxLength={80}
                      placeholder="Proveedores, Flota norte…"
                      autoFocus
                    />
                  </Field>
                </ActionForm>
              </CardBody>
            </div>
          </details>
        }
      />

      {folders.length === 0 ? (
        <EmptyState
          title="Sin carpetas"
          description="Crea una carpeta para agrupar expedientes. Son opcionales y siempre reversibles."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {folders.map((folder) => (
            <li key={folder.id}>
              <section className="relative h-full rounded-xl border border-line bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md">
                <Link
                  href={`/app/contratos?carpeta=${folder.id}`}
                  className="flex min-h-36 cursor-pointer flex-col rounded-lg pr-8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <Folder
                    aria-hidden
                    className="mb-4 h-14 w-14 text-accent-strong"
                    fill="var(--color-accent-soft)"
                    strokeWidth={1.4}
                  />
                  <span className="font-display text-lg font-semibold text-carbon">
                    {folder.name}
                  </span>
                  <span className="mt-1 text-xs text-muted">
                    {folder.count === 1 ? "1 contrato" : `${folder.count} contratos`}
                  </span>
                </Link>

                <details className="group absolute top-3 right-3">
                  <summary
                    aria-label={`Opciones de ${folder.name}`}
                    className="cursor-pointer list-none rounded-lg p-2 text-muted transition-colors duration-200 hover:bg-[#f5f5f4] hover:text-carbon"
                  >
                    <MoreHorizontal aria-hidden className="size-5" />
                  </summary>
                  <div className="absolute right-0 z-10 mt-2 w-80 max-w-[calc(100vw-2rem)] space-y-4 rounded-xl border border-line bg-white p-4 shadow-xl">
                    <ActionForm
                      action={renombrarCarpeta}
                      submitLabel="Guardar nombre"
                      variant="secondary"
                      hidden={{ folderId: folder.id }}
                    >
                      <Field label="Renombrar" required>
                        <TextInput
                          name="name"
                          required
                          maxLength={80}
                          defaultValue={folder.name}
                        />
                      </Field>
                    </ActionForm>
                    <div className="border-t border-line pt-4">
                      <ActionForm
                        action={eliminarCarpeta}
                        submitLabel="Eliminar carpeta"
                        variant="danger"
                        hidden={{ folderId: folder.id }}
                      />
                      <p className="mt-2 text-xs leading-relaxed text-muted">
                        Los contratos permanecerán disponibles, sólo quedarán sin carpeta.
                      </p>
                    </div>
                  </div>
                </details>
              </section>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
