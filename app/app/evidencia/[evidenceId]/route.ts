import { requireOrganizationContext } from "@/lib/auth/guards";
import { readEvidenceFile } from "@/lib/domain/evidence";
import { downloadError, privateFileResponse } from "@/app/app/_lib/download";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

/**
 * Entrega una evidencia conservada a un Administrador o Revisor de la
 * Organización dueña del Contrato. No existe una URL pública ni permanente:
 * cada consulta revalida la membresía, el rol y la clasificación del asunto.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ evidenceId: string }> }
) {
  const context = await requireOrganizationContext();
  const { evidenceId } = await params;
  if (!isUuid(evidenceId)) {
    return new Response("No encontramos esa evidencia.", { status: 404 });
  }

  try {
    const file = await readEvidenceFile(context, evidenceId);
    return privateFileResponse({
      body: file.body,
      contentType: file.contentType,
      fileName: file.fileName,
      disposition: "inline",
    });
  } catch (error) {
    return downloadError(error);
  }
}
