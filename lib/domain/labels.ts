import type { AttemptStatus, ReviewDecisionKind } from "@/lib/domain/types";

export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus, string> = {
  open: "Abierto",
  in_review: "A revisión",
  accepted: "Aceptado",
  repeated: "Mandado a repetir",
  expired: "Vencido",
  cancelled: "Cancelado",
};

export const DECISION_LABELS: Record<ReviewDecisionKind, string> = {
  conclude: "Aceptar contrato",
  skip: "Omitir revisión y aceptar (SKIP)",
  repeat: "Repetir proceso",
};

/** El agente sólo recomienda; la decisión siempre es de una persona. */
export const AI_RECOMMENDATION_LABELS: Record<string, string> = {
  accept: "Recomienda aceptar",
  repeat: "Recomienda repetir el proceso",
  inconclusive: "Sin recomendación concluyente",
};

const EVENT_LABELS: Record<string, string> = {
  contrato_emitido: "Contrato emitido",
  enlace_abierto: "Enlace abierto",
  contrato_recorrido: "Contrato recorrido",
  evidencia_recibida: "Evidencia recibida",
  contrato_aceptado: "Contrato aceptado",
  enviado_a_revision: "Enviado a revisión",
  reporte_ai_registrado: "Reporte de revisión por AI registrado",
  revision_concluida: "Revisión concluida",
  revision_omitida: "Revisión omitida (SKIP)",
  proceso_repetido: "Proceso mandado a repetir",
  intento_sucesor_creado: "Intento sucesor creado",
  contacto_externo_registrado: "Contacto externo registrado",
  contrato_cancelado: "Contrato cancelado",
  contrato_vencido: "Contrato vencido",
  enlace_vencido: "Enlace vencido",
  expediente_eliminado: "Expediente eliminado",
  expediente_archivado: "Expediente archivado",
  expediente_restaurado: "Expediente restaurado",
  paquete_frio_sellado: "Paquete contractual resguardado",
  paquete_movido_a_frio: "Paquete trasladado a Archivo Muerto",
  archivo_historico_solicitado: "Preparación de archivo histórico iniciada",
  copia_temporal_publicada: "Copia temporal publicada en el expediente",
};

export function eventLabel(type: string): string {
  const known = EVENT_LABELS[type];
  if (known) return known;
  const words = type.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function actorLabel(kind: string, name: string): string {
  if (name) return name;
  if (kind === "signer") return "Firmante";
  if (kind === "platform") return "Plataforma";
  if (kind === "system") return "Sistema";
  return "Miembro";
}
