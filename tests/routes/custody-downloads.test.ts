import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationError,
  DomainError,
  NotFoundError,
} from "@/lib/domain/errors";

const mocks = vi.hoisted(() => ({
  requireOrganizationContext: vi.fn(),
  readContractArchive: vi.fn(),
  readExportArtifact: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireOrganizationContext: mocks.requireOrganizationContext,
}));
vi.mock("@/lib/domain/custody", () => ({
  readContractArchive: mocks.readContractArchive,
  readExportArtifact: mocks.readExportArtifact,
}));

import { GET as downloadContract } from "@/app/app/contratos/[id]/archivo/route";
import { GET as downloadExport } from "@/app/app/exportaciones/[jobId]/route";

const ID = "00000000-0000-4000-8000-000000000001";
const CONTEXT = { organization: { id: "org" } };

describe("rutas autenticadas de descarga de custodia", () => {
  beforeEach(() => {
    mocks.requireOrganizationContext.mockReset().mockResolvedValue(CONTEXT);
    mocks.readContractArchive.mockReset();
    mocks.readExportArtifact.mockReset();
  });

  it("transmite el ZIP individual como adjunto privado", async () => {
    mocks.readContractArchive.mockResolvedValue({
      body: Buffer.from("ZIP INDIVIDUAL"),
      fileName: "FID-2026-0001.zip",
    });

    const response = await downloadContract(new Request("http://local"), {
      params: Promise.resolve({ id: ID }),
    });

    expect(mocks.readContractArchive).toHaveBeenCalledWith(CONTEXT, ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="FID-2026-0001.zip"'
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe(
      "ZIP INDIVIDUAL"
    );
  });

  it("transmite la exportación completada como adjunto privado", async () => {
    mocks.readExportArtifact.mockResolvedValue({
      body: Buffer.from("ZIP LOTE"),
      fileName: `exportacion-${ID}.zip`,
    });

    const response = await downloadExport(new Request("http://local"), {
      params: Promise.resolve({ jobId: ID }),
    });

    expect(mocks.readExportArtifact).toHaveBeenCalledWith(CONTEXT, ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="exportacion-${ID}.zip"`
    );
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe(
      "ZIP LOTE"
    );
  });

  it("rechaza identificadores inválidos antes de consultar el artefacto", async () => {
    const contract = await downloadContract(new Request("http://local"), {
      params: Promise.resolve({ id: "no-es-uuid" }),
    });
    const exported = await downloadExport(new Request("http://local"), {
      params: Promise.resolve({ jobId: "no-es-uuid" }),
    });

    expect(contract.status).toBe(404);
    expect(exported.status).toBe(404);
    expect(mocks.readContractArchive).not.toHaveBeenCalled();
    expect(mocks.readExportArtifact).not.toHaveBeenCalled();
  });

  it.each([
    [new NotFoundError("ausente"), 404],
    [new AuthorizationError("prohibido"), 403],
    [new DomainError("no disponible"), 409],
  ])("mapea el error individual %s a HTTP %s", async (error, status) => {
    mocks.readContractArchive.mockRejectedValue(error);
    const response = await downloadContract(new Request("http://local"), {
      params: Promise.resolve({ id: ID }),
    });
    expect(response.status).toBe(status);
    expect(await response.text()).toBe(error.message);
  });

  it.each([
    [new NotFoundError("ausente"), 404],
    [new AuthorizationError("prohibido"), 403],
    [new DomainError("no disponible"), 409],
  ])("mapea el error de exportación %s a HTTP %s", async (error, status) => {
    mocks.readExportArtifact.mockRejectedValue(error);
    const response = await downloadExport(new Request("http://local"), {
      params: Promise.resolve({ jobId: ID }),
    });
    expect(response.status).toBe(status);
    expect(await response.text()).toBe(error.message);
  });

  it("no oculta fallas técnicas inesperadas", async () => {
    const unexpected = new Error("falla técnica");
    mocks.readContractArchive.mockRejectedValue(unexpected);
    mocks.readExportArtifact.mockRejectedValue(unexpected);

    await expect(
      downloadContract(new Request("http://local"), {
        params: Promise.resolve({ id: ID }),
      })
    ).rejects.toBe(unexpected);
    await expect(
      downloadExport(new Request("http://local"), {
        params: Promise.resolve({ jobId: ID }),
      })
    ).rejects.toBe(unexpected);
  });
});
