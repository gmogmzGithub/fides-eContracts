---
status: accepted
---

# La revisión decidirá el resultado de cada Intento de aceptación

Cuando la Política de revisión sea `Sin revisión`, completar las evidencias y pulsar `Aceptar contrato` concluirá inmediatamente la aceptación. Cuando exista revisión manual o asistida por AI, la misma acción enviará un Intento de aceptación que quedará `A revisión`; un Revisor de la Organización decidirá `Aceptar contrato`, `Repetir proceso` u `Omitir revisión y aceptar`. Responsable juridico, equipo juridico y los Administradores de plataforma no participarán en esta decisión operativa.

La Configuración predeterminada de emisión asociada al Contrato-plantilla propondrá una Política de revisión. Un Administrador de la Organización podrá cambiar esa modalidad predeterminada para contratos futuros dentro de las capacidades habilitadas. Antes de emitir, el Emisor podrá conservarla o elegir otra modalidad habilitada para la Organización. La modalidad efectiva quedará congelada para el Contrato y se aplicará a todos sus Intentos de aceptación.

`Repetir proceso` se utilizará únicamente cuando la evidencia no cumpla lo esperado, por ejemplo video incompleto, sin audio o incorrecto, INE ilegible, equivocada o incompleta, o evidencia faltante. Si el texto contractual no cambia, se conservará el mismo Contrato emitido: el sistema cerrará el intento revisado, conservará un historial sencillo de su decisión y motivo y creará un Intento de aceptación sucesor con enlace nuevo. Los archivos del intento repetido no se agregarán al Paquete contractual frío final.

## Considered Options

- Considerar aceptado el Contrato antes de cualquier revisión y tratar los hallazgos como informativos.
- Crear un Contrato nuevo cada vez que falle una evidencia, aunque el texto no cambie.
- Separar el Contrato inmutable de sus Intentos de aceptación y conservar un historial sencillo de repeticiones.

## Consequences

- `A revisión` será estado visible del Intento de aceptación y del Contrato mientras espera decisión humana; no permitirá presentarlo como aceptado todavía.
- Cuando la Política efectiva sea `Sin revisión`, el Firmante verá al terminar `Contrato aceptado`, la Referencia contractual y `Ver PDF`.
- Cuando exista revisión manual o asistida por AI, el Firmante verá `Proceso enviado a revisión` y sólo la indicación de que la Organización lo contactará si necesita que repita el proceso; no verá el análisis, la cola, el Revisor o una promesa de aceptación.
- Ninguno de los dos resultados creará cuenta, bandeja, seguimiento, mensajería o distribución dentro de la plataforma para el Firmante.
- La pantalla de emisión mostrará la modalidad predeterminada sin exigir una selección; `Personalizar este contrato` permitirá elegir `Sin revisión`, revisión manual o revisión asistida por AI cuando la Organización tenga habilitada cada capacidad.
- Elegir otra modalidad para una operación no exigirá motivo o aprobación adicional, pero el resumen previo a la emisión mostrará claramente la Política de revisión efectiva.
- Cambiar la modalidad predeterminada creará una versión operativa nueva aplicable sólo a emisiones futuras y no modificará el texto jurídico del Contrato-plantilla.
- La emisión conservará la modalidad predeterminada, cualquier sustitución, el Emisor que la realizó y la Política de revisión efectiva.
- `Aceptar contrato` cerrará el intento vigente y aceptará el Contrato con las evidencias actuales, aunque el Revisor se aparte de una recomendación del agente AI.
- `Omitir revisión y aceptar` cerrará el intento y aceptará el Contrato sin afirmar que la evidencia fue revisada; conservará la decisión humana conforme a ADR-0068.
- `Repetir proceso` exigirá un motivo del Revisor, cerrará el intento vigente y revocará cualquier acceso restante de su enlace.
- `Repetir proceso` será un evento del historial, no un estado final; al crear el intento sucesor devolverá el Contrato a `Pendiente de aceptación`.
- Si un Administrador ejecuta `Eliminar` mientras el Contrato está `A revisión`, la operación competirá atómicamente con la decisión del Revisor, cambiará el Contrato a `Cancelado`, cerrará la tarea sin decisión y asignará la Clasificación operativa `Eliminado`.
- El intento sucesor tendrá identificador y enlace opaco nuevos y referenciará el intento que reemplaza.
- Todos los intentos sucesores conservarán la misma Política de revisión y el mismo Perfil de evidencia resueltos al emitir el Contrato.
- La repetición comenzará desde el inicio y exigirá todas las evidencias del Perfil de evidencia; no reutilizará INE, video, casillas o aceptación del intento anterior.
- El historial conservará fecha, resultado, Revisor, motivo y relación con el intento sucesor; el ZIP final no conservará INE, video, reporte AI u otros archivos de los intentos mandados repetir.
- Si cambia texto, monto, parte, objeto u otro dato contractual, no será una repetición: el Contrato se cancelará y se creará otro mediante `Duplicar para corregir` conforme a ADR-0080.
- La plataforma no contactará al Firmante: entregará al Revisor el enlace y un mensaje sugerido, y permitirá registrar posteriormente el contacto externo sin afirmar entrega verificada.
- El agente AI sólo recomendará un resultado y el Revisor conservará la decisión final conforme a ADR-0066.
