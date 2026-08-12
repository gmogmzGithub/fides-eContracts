import { redirect } from "next/navigation";

/** Enlace heredado: el Directorio ya no es una seccion visible del portal. */
export default function CounterpartiesRedirect() {
  redirect("/app/recientes");
}
