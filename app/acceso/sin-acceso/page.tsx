import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cerrarSesion } from "@/app/acceso/actions";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/button";
import { getSessionAccount, listMemberships } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sin acceso" };

export default async function SinAccesoPage() {
  const account = await getSessionAccount();
  if (!account) redirect("/acceso");

  const memberships = await listMemberships(account.accountId);
  if (memberships.length > 0) redirect("/app");
  if (account.isPlatformAdmin) redirect("/plataforma");

  return (
    <div className="grid gap-8">
      <header className="grid gap-3">
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-carbon">
          Tu cuenta no tiene acceso
        </h1>
        <p className="text-sm leading-relaxed text-carbon-soft">{account.email}</p>
      </header>

      <Alert tone="info" title="Todavía no perteneces a una Organización">
        Un Administrador debe enviarte una invitación a este correo. Cuando la
        actives, entrarás directamente al portal de su Organización.
      </Alert>

      <form action={cerrarSesion}>
        <SubmitButton variant="secondary" pendingLabel="Saliendo…">
          Cerrar sesión
        </SubmitButton>
      </form>
    </div>
  );
}
