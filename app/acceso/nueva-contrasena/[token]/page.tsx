import type { Metadata } from "next";
import Link from "next/link";
import { NuevaContrasenaForm } from "@/app/acceso/nueva-contrasena/[token]/nueva-contrasena-form";

export const metadata: Metadata = { title: "Contraseña nueva" };

export default async function NuevaContrasenaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="grid gap-8">
      <header className="grid gap-3">
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-carbon">
          Establece tu contraseña
        </h1>
        <p className="text-sm leading-relaxed text-carbon-soft">
          El cambio aplica a tu Cuenta individual en todas tus Organizaciones y
          no modifica membresías, roles o historial.
        </p>
      </header>

      <NuevaContrasenaForm token={token} />

      <Link
        href="/acceso/recuperar"
        className="cursor-pointer text-sm font-medium text-carbon-soft underline underline-offset-4 transition-colors duration-200 hover:text-carbon"
      >
        Solicitar otro enlace
      </Link>
    </div>
  );
}
