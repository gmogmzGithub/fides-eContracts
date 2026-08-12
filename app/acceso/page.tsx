import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/app/acceso/login-form";
import { Alert } from "@/components/ui/alert";
import { getSessionAccount } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function AccesoPage({
  searchParams,
}: {
  searchParams: Promise<{ restablecida?: string }>;
}) {
  const account = await getSessionAccount();
  if (account) {
    if (account.isPlatformAdmin) {
      if (account.totpEnrolled && !account.totpSatisfied) redirect("/acceso/totp");
      redirect("/plataforma");
    }
    redirect("/app");
  }

  const { restablecida } = await searchParams;

  return (
    <div className="grid gap-8">
      <header className="grid gap-3">
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-carbon">
          Iniciar sesión
        </h1>
        <p className="text-sm leading-relaxed text-carbon-soft">
          Entra con el correo de tu Cuenta individual.
        </p>
      </header>

      {restablecida ? (
        <Alert tone="success" title="Contraseña actualizada">
          Ya puedes entrar con tu contraseña nueva.
        </Alert>
      ) : null}

      <LoginForm />
    </div>
  );
}
