import { timingSafeEqual } from "node:crypto";
import {
  moveExpiredPackagesToCold,
  runExportJob,
  runRecoveryJob,
  sealColdPackage,
} from "@/lib/domain/custody";
import { expireDueLinks } from "@/lib/domain/expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint interno del worker. Los trabajos que necesitan el dominio en
 * TypeScript se ejecutan aquí; el worker sólo los dispara con el token
 * compartido del entorno local. No es una ruta pública ni de sesión.
 */

interface WorkerRequestBody {
  jobId?: string | null;
  kind?: string;
  payload?: Record<string, unknown>;
}

function tokenMatches(received: string | null): boolean {
  const expected = process.env.FIDES_WORKER_TOKEN ?? "";
  if (expected === "" || received === null || received === "") return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readString(
  payload: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

function failure(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (!tokenMatches(request.headers.get("x-fides-worker-token"))) {
    return failure("No autorizado", 401);
  }

  let body: WorkerRequestBody;
  try {
    body = (await request.json()) as WorkerRequestBody;
  } catch {
    return failure("JSON inválido", 400);
  }

  const kind = typeof body.kind === "string" ? body.kind : "";
  const payload: Record<string, unknown> =
    body.payload !== null && typeof body.payload === "object" ? body.payload : {};

  try {
    switch (kind) {
      case "seal_cold_package": {
        const contractId = readString(payload, "contractId", "contract_id");
        if (contractId === null) {
          return failure("seal_cold_package requiere contractId", 400);
        }
        await sealColdPackage(contractId);
        return Response.json({ ok: true });
      }

      case "move_to_cold":
      case "move_to_cold_sweep": {
        const moved = await moveExpiredPackagesToCold();
        return Response.json({ ok: true, moved });
      }

      case "recovery": {
        const recoveryJobId = readString(
          payload,
          "recoveryJobId",
          "recovery_job_id",
          "jobId",
          "job_id",
          "id"
        );
        if (recoveryJobId === null) {
          return failure("recovery requiere el identificador de la recuperación", 400);
        }
        await runRecoveryJob(recoveryJobId);
        return Response.json({ ok: true });
      }

      case "export": {
        const exportJobId = readString(
          payload,
          "exportJobId",
          "export_job_id",
          "jobId",
          "job_id",
          "id"
        );
        if (exportJobId === null) {
          return failure("export requiere el identificador de la exportación", 400);
        }
        await runExportJob(exportJobId);
        return Response.json({ ok: true });
      }

      case "expire_links": {
        const expired = await expireDueLinks();
        return Response.json({ ok: true, expired });
      }

      default:
        return failure(`clase de trabajo desconocida: ${kind}`, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "error desconocido";
    return failure(message, 500);
  }
}
