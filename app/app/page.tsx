import { redirect } from "next/navigation";
import { hasRole, requireOrganizationContext } from "@/lib/auth/guards";

export default async function PortalHomePage() {
  const context = await requireOrganizationContext();
  if (
    hasRole(context, "administrator") ||
    hasRole(context, "emitter")
  ) {
    redirect("/app/contratos");
  }
  redirect("/app/revision");
}
