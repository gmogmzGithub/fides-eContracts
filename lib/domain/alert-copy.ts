/** Actividad contractual que merece una alerta operativa para la Organizacion. */
const CONTRACT_ALERT_MESSAGES: Record<string, string> = {
  contrato_emitido: "Quedó pendiente de aceptación",
  enlace_abierto: "Fue abierto",
  contrato_recorrido: "Se recorrió hasta el final",
  intento_enviado_a_revision: "Quedó a revisión",
  contrato_aceptado: "Fue aceptado",
  revision_concluida: "Fue aceptado",
  revision_omitida: "Fue aceptado",
  proceso_repetido: "Requiere repetir el proceso",
  contrato_vencido: "Venció",
  contrato_cancelado: "Fue cancelado",
};

export const CONTRACT_ALERT_EVENT_TYPES = Object.freeze(
  Object.keys(CONTRACT_ALERT_MESSAGES)
);

export function contractAlertMessage(eventType: string): string | null {
  return CONTRACT_ALERT_MESSAGES[eventType] ?? null;
}
