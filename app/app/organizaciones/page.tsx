import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/guards";
import { listMemberships } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/domain/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionForm } from "@/app/app/_components/action-form";
import { cambiarOrganizacion } from "@/app/app/actions";

export default async function SelectOrganizationPage() {
  const account = await requireAccount();
  const memberships = await listMemberships(account.accountId);

  if (memberships.length === 0) {
    redirect(account.isPlatformAdmin ? "/plataforma" : "/acceso/sin-acceso");
  }
  if (memberships.length === 1) {
    redirect("/app/contratos");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Selecciona una Organización"
        description="Tus roles, expedientes e historial se mantienen separados en cada Organización."
      />
      <ul className="grid gap-4 sm:grid-cols-2">
        {memberships.map((membership) => (
          <li key={membership.organizationId}>
            <Card>
              <CardBody>
                <div className="space-y-3">
                  <p className="font-display text-xl text-carbon">
                    {membership.organizationName}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {membership.roles.map((role) => (
                      <Badge key={role} tone="neutral">{ROLE_LABELS[role]}</Badge>
                    ))}
                  </div>
                  <ActionForm
                    action={cambiarOrganizacion}
                    submitLabel="Entrar"
                    hidden={{ organizationId: membership.organizationId }}
                  />
                </div>
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
