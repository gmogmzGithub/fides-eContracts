---
status: accepted
clarified_by:
  - 0059-contrato-plantilla-en-texto-y-pdf-bajo-demanda
  - 0060-perfil-de-evidencia-por-contrato-plantilla
  - 0070-vigencia-configurable-por-contrato-plantilla
amended_by:
  - 0065-intentos-de-aceptacion-y-repeticion-por-revision
---

# La Organización creará y controlará el Contrato directamente

La Organización capturará la información requerida por un Contrato-plantilla y podrá conservar o personalizar sus valores operativos predeterminados. Antes de emitir, la plataforma mostrará en una sola vista el Contrato completo ya formado, las partes y la configuración efectiva. Al pulsar `Generar Contrato`, la plataforma creará directamente el Contrato digital como una instantánea inmutable, su Referencia contractual, primer Intento de aceptación y Enlace contractual. No existirá una entidad Orden, una referencia `ORD-*` ni una aprobación intermedia para convertirla en Contrato.

La Organización compartirá externamente el Enlace contractual y conservará el control de cancelar el Contrato mientras esté pendiente. El resultado posterior dependerá de la Política de revisión efectiva: aceptación inmediata o envío a revisión, con posible conclusión, omisión o repetición del proceso. Antes de que el Firmante envíe su intento, también podrá vencer el enlace o la Organización podrá cancelar el Contrato.

## Consequences

- La Organización controla la creación, distribución externa y cancelación de sus Contratos.
- Después de la emisión inicial, la plataforma mostrará únicamente `Copiar enlace`; no preparará un mensaje, abrirá WhatsApp o correo, enviará la liga ni registrará un contacto inicial.
- La plataforma controla las plantillas, reglas, versionado, hashes, aceptación y evidencia; la Organización controla sus valores operativos predeterminados y cada personalización permitida.
- Completar la captura válida sólo habilita el Resumen previo a la emisión. Ejecutar `Generar Contrato` crea atómicamente el Contrato, un UUID interno, la Referencia `AC-YYYYMMDD-NNNN`, la versión exacta de Contrato-plantilla, su texto y valores inmutables, Huella documental, configuración operativa efectiva, primer Intento de aceptación y Enlace contractual.
- Antes de esa acción, el Borrador tendrá guardado automático y sólo será visible para su Emisor creador y los Administradores; después, el Contrato emitido será visible para todos los Emisores.
- El Front-End organizará la creación en sólo dos pasos: `Capturar datos` y `Revisar y generar`. Seleccionará automáticamente la única plantilla disponible y reunirá en una sola tarjeta los datos de Titular contractual, Firmante y Campos contractuales programados. Cuando el Titular sea persona física, una casilla clara permitirá indicar que esa misma persona aceptará y deshabilitará la selección redundante del Firmante. `Requerir INE` y `Requerir video` permanecerán siempre visibles como decisiones simples del Contrato; sólo vigencia, revisión y carpeta quedarán como opciones secundarias.
- La advertencia de captura incompleta sólo aparecerá mientras falte al menos un dato obligatorio y enumerará, por nombre, exactamente qué falta. Desaparecerá en cuanto la captura esté completa.
- El Resumen previo a la emisión mostrará el texto completo, Titular contractual, Firmante, Vigencia del enlace, video, INE y Política de revisión sin exigir al Emisor casilla, PDF, motivo o aprobación adicional.
- No habrá estados de Orden, conversión, aprobación de emisión o relación Orden-Contrato.
- El Contrato digital en HTML será primario; `Ver PDF` generará una representación secundaria bajo demanda y `Ver Aviso de Privacidad` será una acción separada. Conforme a ADR-0059, aceptar no generará automáticamente un PDF; la misma acción `Ver PDF` producirá la representación aceptada después de la aceptación.
- El PDF no será requisito para aceptar.
- El Contrato permanecerá `Pendiente de aceptación` mientras su Intento no concluya; una Política de revisión podrá cambiarlo a `A revisión` sin presentarlo todavía como aceptado.
- El Firmante no tendrá una acción `No aceptar`; si no envía su intento, el Contrato permanecerá pendiente hasta vencer o ser cancelado por la Organización.
- La plataforma registrará emisión, apertura, recorrido, revisión, aceptación, repetición, vencimiento y cancelación. Cada evento aplicable producirá alertas por correo y WhatsApp únicamente en los canales y destinos configurados por la Organización, sin que la plataforma distribuya la liga. Abrir no se describirá como leer y el resultado concluido se describirá como `Aceptado`, no `Firmado`.
- Cancelar será una acción explícita y auditada disponible para el Miembro creador de ese Contrato y para cualquier Administrador de la Organización mientras se encuentre `Pendiente de aceptación` o `A revisión`. Revocará inmediatamente cualquier enlace vigente y no eliminará el historial.
- Antes de ejecutar la cancelación, la plataforma exigirá una sola confirmación que explique que el enlace dejará de funcionar. El motivo será opcional y no habrá segunda aprobación.
- La auditoría conservará actor, fecha y motivo opcional de la cancelación.
- Si el Contrato estaba `A revisión`, la cancelación cerrará la tarea sin una decisión de revisión, conservará Intentos, evidencias y reportes existentes e impedirá cualquier acción posterior del Revisor.
- La cancelación y una resolución concurrente del Revisor serán atómicas sobre el mismo estado. La primera acción válida ganará; si gana la cancelación, la revisión fallará, y si gana una aceptación, la cancelación fallará porque el Contrato ya estará `Aceptado`.
- Cuando la cancelación responda a un dato contractual incorrecto, `Duplicar para corregir` podrá crear un Borrador nuevo con los datos reutilizables precargados conforme a ADR-0080. No editará o versionará el Contrato cancelado.
- Los demás Emisores podrán consultar, copiar el enlace y organizar el expediente, pero no cancelar un Contrato ajeno.
- Vencer será una transición automática al completar la Vigencia del enlace efectiva sin que el Intento de aceptación se haya enviado y no significará cancelación.
- Aceptar vinculará la acción inequívoca con el Contrato emitido inmutable, la versión exacta de su Contrato-plantilla, su Huella documental, tiempo del servidor y Perfil de evidencia efectivo.
- La Referencia contractual será legible y no concederá acceso; la URL del Firmante continuará utilizando un token opaco independiente.
