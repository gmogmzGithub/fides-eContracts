---
status: accepted
---

# Los estados visibles serán seis y no existirá Rechazado

El portal mostrará únicamente `Borrador`, `Pendiente de aceptación`, `A revisión`, `Aceptado`, `Vencido` y `Cancelado` como Estados contractuales. `Repetir proceso` será un evento auditado sobre un Intento de aceptación: conservará el intento anterior, creará uno sucesor y devolverá el Contrato a `Pendiente de aceptación`.

No existirá `Rechazado`, porque una evidencia inadecuada no rechaza las cláusulas o la relación contractual; origina una repetición completa sobre el mismo Contrato emitido mientras el texto no cambie.

## Considered Options

- Usar sólo `Aceptado` y `A revisión` y ocultar borradores, pendientes, vencimientos y cancelaciones.
- Agregar `Rechazado` o `Repetir proceso` como estados terminales.
- Separar los seis estados visibles de los eventos y resultados internos de cada Intento de aceptación.

## Consequences

- Un Borrador contractual se guardará automáticamente y será visible como `Borrador` sólo para su Emisor creador y los Administradores antes de ejecutar `Generar Contrato`.
- `Eliminar` un Borrador conservará `Borrador` únicamente como estado histórico dentro de `Eliminados`, borrará sus valores editables y no creará un Contrato emitido o paquete de custodia.
- Los demás Emisores obtendrán visibilidad cuando se genere el enlace y el estado cambie a `Pendiente de aceptación`.
- Emitir y generar el primer enlace cambiará el estado a `Pendiente de aceptación`.
- Enviar un intento bajo revisión manual o asistida por AI cambiará el estado a `A revisión`.
- Aceptación inmediata, `Aceptar contrato` u `Omitir revisión y aceptar` producirán `Aceptado`.
- Vencer el enlace antes de enviar un intento producirá `Vencido`.
- La cancelación autorizada mientras el Contrato esté pendiente producirá `Cancelado`.
- `Eliminar` un Contrato en `Pendiente de aceptación` o `A revisión` también producirá `Cancelado` antes de asignar la Clasificación operativa `Eliminado`; un Contrato ya `Aceptado`, `Vencido` o `Cancelado` conservará ese estado terminal.
- `Repetir proceso` conservará su motivo en el historial y devolverá el Contrato a `Pendiente de aceptación` con un enlace nuevo.
- Los Estados contractuales no representarán pago, prestación o conclusión del servicio subyacente.
