import { requireOrganizationContext } from "@/lib/auth/guards";
import { readContractArchive } from "@/lib/domain/custody";
import { downloadError, privateFileResponse } from "@/app/app/_lib/download";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await requireOrganizationContext();
  const { id } = await params;
  if (!isUuid(id)) return new Response("No encontramos este contrato.", { status: 404 });

  try {
    const file = await readContractArchive(context, id);
    return privateFileResponse({
      body: file.body,
      contentType: "application/zip",
      fileName: file.fileName,
      disposition: "attachment",
    });
  } catch (error) {
    return downloadError(error);
  }
}
