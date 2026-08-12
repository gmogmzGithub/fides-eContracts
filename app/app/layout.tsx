import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAccount } from "@/lib/auth/guards";
import { listMemberships } from "@/lib/auth/session";
import {
  PortalShell,
  type NavItem,
} from "@/app/app/_components/portal-shell";

export const metadata: Metadata = {
  title: "Fides",
};

/**
 * El armazón no redirige: resuelve lo que puede y deja que cada página exija
 * la Organización activa. Así `Selecciona una Organización` vive dentro del
 * mismo portal sin provocar un ciclo de redirecciones.
 */
export default async function PortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const account = await requireAccount();
  const memberships = await listMemberships(account.accountId);
  const membership =
    memberships.find(
      (item) => item.organizationId === account.activeOrganizationId
    ) ?? (memberships.length === 1 ? memberships[0] : undefined);

  const roles = membership?.roles ?? [];
  const isAdministrator = roles.includes("administrator");
  const isEmitter = roles.includes("emitter");
  const isReviewer = roles.includes("reviewer");
  // `Carpetas`, `Archivados` y `Eliminados` organizan expedientes: el rol
  // Revisor por sí solo no los abre.
  const organizesFiles = isAdministrator || isEmitter;

  const items: NavItem[] = membership
    ? [
        ...(organizesFiles
          ? [
              {
                href: "/app/contratos",
                label: "Contratos",
                icon: "contracts" as const,
              },
            ]
          : []),
        ...(isEmitter
          ? [
              {
                href: "/app/contratos/nuevo",
                label: "Crear contrato",
                icon: "create" as const,
              },
            ]
          : []),
        ...(isReviewer
          ? [{ href: "/app/revision", label: "A revisión", icon: "review" as const }]
          : []),
        ...(organizesFiles
          ? [
              {
                href: "/app/recientes",
                label: "Recientes",
                icon: "directory" as const,
              },
              { href: "/app/carpetas", label: "Carpetas", icon: "folders" as const },
              {
                href: "/app/archivados",
                label: "Archivados",
                icon: "archived" as const,
              },
              {
                href: "/app/eliminados",
                label: "Eliminados",
                icon: "deleted" as const,
              },
            ]
          : []),
        ...(isAdministrator
          ? [
              { href: "/app/accesos", label: "Accesos", icon: "access" as const },
              {
                href: "/app/configuracion",
                label: "Configuración",
                icon: "settings" as const,
              },
            ]
          : []),
      ]
    : [];

  return (
    <PortalShell
      items={items}
      accountName={account.fullName}
      activeOrganization={
        membership
          ? { id: membership.organizationId, name: membership.organizationName }
          : null
      }
      organizations={memberships.map((item) => ({
        id: item.organizationId,
        name: item.organizationName,
      }))}
    >
      {children}
    </PortalShell>
  );
}
