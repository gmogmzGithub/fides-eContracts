import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { storeEvidence } from "@/lib/domain/signer";
import { DomainError } from "@/lib/domain/errors";
import type { EvidenceKind } from "@/lib/domain/types";
import {
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_LABEL,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LABEL,
  isSyntheticMarker,
} from "@/app/c/_lib/limits";
import { syntheticEvidenceEnabled } from "@/lib/evidence-limits";
import { basePath, loadView } from "@/app/c/_lib/view";
import { SIGNER_GENERIC_ERROR } from "@/app/c/_lib/result";

export const dynamic = "force-dynamic";

const LINK_ERROR =
  "Este enlace no está disponible. Comunícate con la Organización que te lo compartió.";

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Marcador local: el doble controlado del proveedor AI elige su resultado
 * leyendo el nombre del archivo. Sin marcador recomienda aceptar.
 */
function syntheticFileName(marker: string): string {
  return marker === "aceptar"
    ? "grabacion-sintetica-de-prueba.webm"
    : `grabacion-sintetica-de-prueba-${marker}.webm`;
}

function syntheticRecording(marker: string): Buffer {
  const ebml = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  const body = Buffer.from(
    [
      "GRABACION SINTETICA DE PRUEBA",
      "Entorno local sintetico de Fides",
      `Marcador: ${marker}`,
      "Este archivo no contiene la grabacion real de ninguna persona.",
      "",
    ].join("\n") +
      "relleno sintetico sin contenido audiovisual real\n".repeat(32),
    "utf8"
  );
  return Buffer.concat([ebml, body]);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // El enlace y el Perfil efectivo se revalidan en servidor en cada subida.
  const view = await loadView(token);
  if (!view.ok) return fail(LINK_ERROR, 404);
  if (!view.walked) {
    return fail("Primero recorre el contrato completo.", 409);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("No pudimos leer el archivo enviado. Inténtalo de nuevo.", 413);
  }

  const rawKind = form.get("tipo");
  if (rawKind !== "ine_front" && rawKind !== "ine_back" && rawKind !== "video") {
    return fail("Evidencia no reconocida.");
  }
  const kind: EvidenceKind = rawKind;

  const requiredByProfile =
    kind === "video" ? view.requiresVideo : view.requiresIne;
  if (!requiredByProfile) {
    return fail("Este contrato no solicita esa evidencia.", 409);
  }

  const rawStatement = form.get("declaracion");
  const shownStatement =
    typeof rawStatement === "string" && rawStatement.trim()
      ? rawStatement
      : undefined;

  let buffer: Buffer;
  let contentType: string;
  let fileName: string;

  if (kind === "video" && form.get("sintetico") === "1") {
    if (!syntheticEvidenceEnabled()) {
      return fail("Graba el video dentro de esta sesión para continuar.");
    }
    const rawMarker = form.get("marcador");
    const marker =
      typeof rawMarker === "string" && isSyntheticMarker(rawMarker)
        ? rawMarker
        : "aceptar";
    buffer = syntheticRecording(marker);
    contentType = "video/webm";
    fileName = syntheticFileName(marker);
  } else {
    const file = form.get("archivo");
    if (file === null || typeof file === "string") {
      return fail("Adjunta la evidencia antes de enviarla.");
    }
    if (file.size === 0) {
      return fail("El archivo llegó vacío. Vuelve a capturar la evidencia.");
    }
    const maxBytes = kind === "video" ? MAX_EVIDENCE_BYTES : MAX_IMAGE_BYTES;
    const maxLabel = kind === "video" ? MAX_EVIDENCE_LABEL : MAX_IMAGE_LABEL;
    if (file.size > maxBytes) {
      return fail(
        `El archivo supera ${maxLabel}. Vuelve a capturar la evidencia de forma más ligera.`,
        413
      );
    }

    const declaredType = file.type || "";
    const expected = kind === "video" ? "video/" : "image/";
    if (declaredType && !declaredType.startsWith(expected)) {
      return fail(
        kind === "video"
          ? "El archivo enviado no es una grabación de video."
          : "El archivo enviado no es una fotografía."
      );
    }

    buffer = Buffer.from(await file.arrayBuffer());
    contentType =
      declaredType || (kind === "video" ? "video/webm" : "image/jpeg");
    fileName =
      file.name || (kind === "video" ? "video-guiado.webm" : `${kind}.jpg`);
  }

  try {
    await storeEvidence(
      token,
      kind,
      { buffer, contentType, fileName },
      kind === "video"
        ? // La grabación nació dentro de esta sesión contractual: la pantalla
          // de video nunca ofrece adjuntar un archivo previo.
          { recordedInSession: true, shownStatement }
        : {}
    );
  } catch (error) {
    if (error instanceof DomainError) {
      return fail(error.message, 409);
    }
    return fail(SIGNER_GENERIC_ERROR, 500);
  }

  revalidatePath(basePath(token), "layout");
  return NextResponse.json({ ok: true });
}
