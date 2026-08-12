import { Wordmark } from "@/components/landing/wordmark";

export function Footer() {
  return (
    <footer className="bg-carbon text-ivory">
      <div className="mx-auto flex max-w-editorial flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Wordmark tone="light" />
        <p className="max-w-xl text-xs leading-relaxed text-ivory/50">
          La plataforma almacena y presenta el contenido contractual de cada
          Organización y conserva la evidencia de cada aceptación. No determina
          la suficiencia legal de un documento ni sustituye la asesoría de un
          profesional.
        </p>
      </div>
    </footer>
  );
}
