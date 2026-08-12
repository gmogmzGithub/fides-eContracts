import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cerrarSesion } from "@/app/acceso/actions";
import { TotpForm } from "@/app/acceso/totp/totp-form";
import { SubmitButton } from "@/components/ui/button";
import { getSessionAccount } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Segundo paso" };

/** Segundo paso exclusivo de las cuentas globales (ADR-0082). */
export default async function TotpPage() {
  const account = await getSessionAccount();
  if (!account) redirect("/acceso");
  if (!account.isPlatformAdmin) redirect("/app");
  if (account.totpSatisfied) redirect("/plataforma");
  if (!account.totpEnrolled) redirect("/plataforma/cuenta");

  return (
    <div className="grid gap-8">
      <header className="grid gap-3">
        <p className="text-xs font-medium tracking-[0.22em] text-accent-strong uppercase">
          Cuenta global
        </p>
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-carbon">
          Confirma tu código
        </h1>
        <p className="text-sm leading-relaxed text-carbon-soft">
          {account.email}
        </p>
      </header>

      <TotpForm />

      <form action={cerrarSesion}>
        <SubmitButton variant="ghost" size="sm" pendingLabel="Saliendo…">
          Usar otra cuenta
        </SubmitButton>
      </form>
    </div>
  );
}
