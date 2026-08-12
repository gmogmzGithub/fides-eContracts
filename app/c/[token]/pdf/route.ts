import { NextResponse } from "next/server";
import { buildContractPdfForToken } from "@/lib/domain/documents";
import { loadView } from "@/app/c/_lib/view";

export const dynamic = "force-dynamic";

const LINK_ERROR =
  "Este enlace no está disponible. Comunícate con la Organización que te lo compartió.";

/**
 * `Ver PDF` bajo demanda. Entrega la misma representación que ve la
 * Organización: Copia de revisión antes de aceptar y Copia contractual aceptada
 * después. El archivo nunca contiene el token ni el Enlace contractual.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const view = await loadView(token);
  if (!view.ok) {
    return new NextResponse(LINK_ERROR, {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const pdf = await buildContractPdfForToken(token);

  return new NextResponse(new Uint8Array(pdf.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      // El nombre usa la Referencia contractual, nunca el token.
      "Content-Disposition": `inline; filename="${pdf.fileName}"`,
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
