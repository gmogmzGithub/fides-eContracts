import "server-only";
import { cache } from "react";
import {
  loadSignerView,
  type SignerLoad,
  type SignerView,
} from "@/lib/domain/signer";

/**
 * El recorrido resuelve el token en servidor en cada petición.
 * `cache` sólo evita repetir la consulta dentro del mismo render
 * (layout y página); nunca conserva estado entre peticiones.
 */
export const loadView = cache(
  async (token: string): Promise<SignerLoad> => loadSignerView(token)
);

export type EvidenceStepId = "ine_front" | "ine_back" | "video";
export type EvidenceStepSlug = "ine-frente" | "ine-reverso" | "video";

export interface EvidenceStep {
  id: EvidenceStepId;
  slug: EvidenceStepSlug;
  title: string;
  stored: boolean;
}

export function basePath(token: string): string {
  return `/c/${encodeURIComponent(token)}`;
}

/** Pasos de evidencia adicionales del Perfil efectivo, en orden. */
export function evidenceSteps(view: SignerView): EvidenceStep[] {
  const steps: EvidenceStep[] = [];
  if (view.requiresIne) {
    steps.push({
      id: "ine_front",
      slug: "ine-frente",
      title: "INE — frente",
      stored: view.evidence.ine_front === true,
    });
    steps.push({
      id: "ine_back",
      slug: "ine-reverso",
      title: "INE — reverso",
      stored: view.evidence.ine_back === true,
    });
  }
  if (view.requiresVideo) {
    steps.push({
      id: "video",
      slug: "video",
      title: "Video guiado",
      stored: view.evidence.video === true,
    });
  }
  return steps;
}

export function hasAdditionalEvidence(view: SignerView): boolean {
  return view.requiresIne || view.requiresVideo;
}

export function pendingEvidence(view: SignerView): EvidenceStep | null {
  return evidenceSteps(view).find((step) => !step.stored) ?? null;
}

export function evidenceComplete(view: SignerView): boolean {
  return pendingEvidence(view) === null;
}

export function isDone(view: SignerView): boolean {
  return view.stage === "done" || view.result !== undefined;
}

/** Ruta que corresponde al avance real del Intento, resuelto en servidor. */
export function stageHref(view: SignerView): string {
  const base = basePath(view.token);
  if (isDone(view)) return `${base}/listo`;
  if (!view.walked) return base;
  const pending = pendingEvidence(view);
  if (pending) return `${base}/evidencia/${pending.slug}`;
  return `${base}/aceptar`;
}

/** Destino del `Continuar` de la etapa `Contrato`. */
export function afterContractHref(view: SignerView): string {
  const base = basePath(view.token);
  return hasAdditionalEvidence(view) ? `${base}/evidencia` : `${base}/aceptar`;
}
