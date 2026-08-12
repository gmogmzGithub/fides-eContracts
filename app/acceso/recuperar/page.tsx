import type { Metadata } from "next";
import Link from "next/link";
import { RecuperarForm } from "@/app/acceso/recuperar/recuperar-form";

export const metadata: Metadata = { title: "Recuperar mi cuenta" };

export default function RecuperarPage() {
  return (
    <div className="grid gap-8">
      <header className="grid gap-3">
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-carbon">
          Olvidé mi contraseña
        </h1>
        <p className="text-sm leading-relaxed text-carbon-soft">
          Te enviaremos un enlace de un solo uso vigente durante una hora. Nadie
          más puede ver o elegir tu contraseña.
        </p>
      </header>

      <RecuperarForm />

      <Link
        href="/acceso"
        className="cursor-pointer text-sm font-medium text-carbon-soft underline underline-offset-4 transition-colors duration-200 hover:text-carbon"
      >
        Volver a iniciar sesión
      </Link>
    </div>
  );
}
