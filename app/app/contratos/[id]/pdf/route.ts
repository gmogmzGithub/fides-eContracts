import { requireOrganizationContext } from "@/lib/auth/guards";
import { buildContractPdf } from "@/app/app/_lib/portal-queries";
import { downloadError, privateFileResponse } from "@/app/app/_lib/download";

/**
 * `Ver PDF` bajo demanda. Antes de aceptar entrega la representación de
 * revisión y después la copia aceptada, siempre sin el token ni el enlace.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await requireOrganizationContext();
  const { id } = await params;

  try {
    const pdf = await buildContractPdf(context.organization.id, id);
    return privateFileResponse({
      body: pdf.buffer,
      contentType: "application/pdf",
      fileName: pdf.fileName,
      disposition: "inline",
    });
  } catch (error) {
    return downloadError(error);
  }
}
