---
status: accepted
---

# El Revisor concluirá, repetirá u omitirá la revisión

La pantalla de revisión tendrá exactamente tres decisiones: `Aceptar contrato`, para cerrar el Intento de aceptación después de revisar sus evidencias; `Repetir proceso`, para registrar la decisión y crear otro intento desde el inicio sobre el mismo Contrato emitido; u `Omitir revisión y aceptar (SKIP)`, para aceptar con la evidencia disponible sin afirmar que fue revisada. No existirá edición de evidencia o aprobación del equipo jurídico o de los Administradores de plataforma.

## Considered Options

- Permitir al Revisor editar o sustituir únicamente el archivo defectuoso.
- Conservar evidencias válidas y repetir sólo una parte del recorrido.
- Aceptar, repetir desde el inicio u omitir explícitamente la revisión con auditoría.

## Consequences

- La pantalla mostrará Contrato, Perfil de evidencia, evidencias del intento actual, Reporte de revisión por AI cuando exista y el historial sencillo de repeticiones anteriores antes de habilitar la decisión.
- La resolución será atómica: la primera decisión válida gana; una decisión concurrente posterior recibirá y mostrará el Revisor, fecha y resultado ya registrados sin producir otro efecto.
- La misma regla incluirá una cancelación concurrente del Miembro creador o Administrador: si la cancelación gana, cualquier resolución del Revisor fallará; si una aceptación gana, la cancelación fallará porque el Contrato ya no será cancelable.
- Nunca podrán coexistir resultados finales contradictorios para el mismo Intento de aceptación.
- Un Intento `A revisión` permanecerá pendiente indefinidamente hasta que un Revisor actúe; no se aceptará, repetirá, cancelará o descartará automáticamente por tiempo.
- El Miembro creador o un Administrador podrá cancelar expresamente el Contrato mientras esté `A revisión`. La tarea se cerrará sin decisión, conservará todas sus evidencias y reportes e impedirá `Aceptar contrato`, `Repetir proceso` u `Omitir revisión y aceptar` posteriores.
- El vencimiento del Enlace contractual no cambiará un intento ya enviado a revisión, porque sus evidencias ya fueron recibidas; la Bandeja mostrará su antigüedad únicamente como información operativa.
- `Aceptar contrato` conservará exactamente la evidencia actual y registrará Revisor, fecha y relación con cualquier recomendación AI.
- `Omitir revisión y aceptar` conservará Revisor, fecha, intento, evidencias existentes y nota opcional; el historial mostrará expresamente que no hubo revisión manual.
- `Omitir revisión y aceptar` estará incluido para cualquier Miembro con rol Revisor y no dependerá de un permiso adicional.
- `Omitir revisión y aceptar` se ejecutará como acción directa sin casilla, modal o segunda confirmación obligatoria. La Organización acepta el riesgo de activación accidental y dependerá del historial para identificar cada uso.
- El agente AI nunca recomendará `Omitir revisión`; sólo una persona podrá ejecutar esa decisión.
- `Repetir proceso` exigirá elegir `Video incompleto o sin audio`, `Declaración incorrecta`, `INE ilegible`, `INE incompleta o equivocada`, `Evidencia requerida faltante` u `Otro`. Sólo `Otro` exigirá una explicación escrita.
- `Repetir proceso` conservará el motivo, cerrará el intento, revocará su enlace y creará atómicamente un intento sucesor con enlace nuevo.
- El intento sucesor repetirá contrato, casilla, INE, video y cualquier otra evidencia exigida; ningún artefacto del intento anterior se copiará como evidencia del nuevo.
- La plataforma mostrará al Revisor el nuevo enlace y un mensaje sugerido, pero no enviará WhatsApp o correo al Firmante.
- El Revisor podrá registrar después canal, fecha y nota opcional como Registro de contacto externo; ese registro no constituye prueba de entrega.
- El historial de una repetición mostrará fecha, resultado, Revisor, motivo y relación con el intento sucesor; no conservará un paquete visible con las evidencias anteriores.
