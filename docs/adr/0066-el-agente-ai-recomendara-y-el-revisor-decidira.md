---
status: accepted
---

# El agente AI recomendará y el Revisor decidirá

Cuando la Política de revisión incluya asistencia por AI, el agente analizará únicamente el cumplimiento del Perfil de evidencia del Intento de aceptación, transcribirá el video, comparará el texto pronunciado con la Declaración audiovisual esperada, registrará hallazgos y recomendará `Aceptado` o `Repetir proceso`. No revisará jurídicamente cláusulas, monto o condiciones del Contrato-plantilla. Un Revisor humano de la Organización conservará la autoridad exclusiva para elegir el resultado.

## Considered Options

- Permitir que el agente acepte o solicite automáticamente una repetición.
- Usar el agente únicamente para transcribir sin emitir una recomendación.
- Permitir que el agente analice y recomiende, conservando la decisión humana.

## Consequences

- El Reporte de revisión por AI distinguirá transcripción, comparación, hallazgos, nivel de confianza, limitaciones y recomendación.
- El Revisor podrá aceptar o apartarse de la recomendación y su decisión quedará atribuida a su Cuenta individual de Miembro.
- Una falla, timeout, falta de confianza o resultado no concluyente mantendrá el Intento de aceptación `A revisión`; nunca producirá una decisión automática.
- El modelo, versión de configuración, fecha, entradas autorizadas y reporte quedarán identificados para reproducir qué análisis se realizó, sin convertir el reporte en evidencia original.
- El agente no modificará archivos, texto, hashes, eventos o estados contractuales y no enviará mensajes al Firmante.
- Cuando recomiende `Repetir proceso`, el resultado producirá Alertas de revisión AI para todos los Revisores activos conforme a ADR-0067.
- La Revisión por AI será una de las dos únicas capacidades adicionales de la oferta inicial; la otra será Custodia activa. Cuando esté habilitada, un Administrador podrá establecerla como modalidad predeterminada y el Emisor podrá conservarla o seleccionarla mediante la Personalización de emisión. Precio, límites de uso y proveedor se decidirán por separado.
- Los datos no podrán utilizarse para entrenamiento o finalidades ajenas al servicio sin otra base, aprobación y decisión explícitas.
