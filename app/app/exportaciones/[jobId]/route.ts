import { requireOrganizationContext } from "@/lib/auth/guards";
import { readExportArtifact } from "@/lib/domain/custody";
import { downloadError, privateFileResponse } from "@/app/app/_lib/download";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const context = await requireOrganizationContext();
  const { jobId } = await params;
  if (!isUuid(jobId)) {
    return new Response("No encontramos esa exportación.", { status: 404 });
  }

  try {
    const file = await readExportArtifact(context, jobId);
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
