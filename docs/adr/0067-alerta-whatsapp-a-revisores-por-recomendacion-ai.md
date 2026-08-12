---
status: accepted
---

# Una recomendación de repetición alertará por WhatsApp a todos los Revisores

Cuando el Reporte de revisión por AI recomiende `Repetir proceso`, la plataforma enviará una Alerta de revisión AI por WhatsApp a todos los Revisores activos de la Organización. La alerta les pedirá entrar al portal autenticado para revisar el Intento de aceptación; el agente y la plataforma no contactarán al Firmante como consecuencia automática del reporte.

## Considered Options

- Permitir que el agente solicite directamente al Firmante una repetición.
- Alertar únicamente al Emisor o a un Revisor predeterminado.
- Alertar a todos los Revisores activos y dejar la decisión y seguimiento en manos de la Organización.

## Consequences

- La recomendación del agente no cambia el estado `A revisión` ni crea por sí sola un Intento de aceptación sucesor.
- Todos los Intentos `A revisión` aparecerán en la Bandeja de revisión; WhatsApp se reservará para la recomendación AI `Repetir proceso` y no se enviará por cada tarea manual ordinaria.
- El mensaje incluirá información mínima y un acceso al portal; no incluirá el Contrato, INE, video, transcripción, hallazgos sensibles o Enlace contractual del Firmante.
- Cada entrega conservará Organización, Revisor destinatario, evento de origen, canal, fecha, intentos y estado del proveedor.
- Un fallo total o parcial de WhatsApp no resolverá la revisión; quedará visible y reintentable dentro del portal.
- Agregar o retirar el rol de Revisor actualizará los destinatarios de alertas futuras sin alterar el historial.
- Si un Revisor elige `Repetir proceso`, la plataforma no contactará al Firmante. Mostrará el enlace nuevo y un mensaje sugerido para que el Revisor use el canal externo que decida; después podrá crear un Registro de contacto externo con canal, fecha y nota opcional, sin presentarlo como entrega verificada.
