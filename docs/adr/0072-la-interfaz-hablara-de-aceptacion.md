---
status: accepted
---

# La interfaz hablará de aceptación y no de firma

El lenguaje visible del recorrido usará `Aceptar contrato` para la acción inequívoca del Firmante y `Contrato aceptado` para el resultado concluido. Se conservará el término `Firmante` para la persona física que realiza el recorrido. La interfaz no alternará entre `Firmar`, `Firmar y aceptar`, `Firmado` y `Aceptado`.

`Firma electrónica ordinaria` permanecerá únicamente como posible clasificación jurídica interna de la evidencia de aceptación, pendiente de validación aplicable. No será el nombre del botón o Estado contractual y no permitirá presentar el método como Firma electrónica avanzada, firma fiable o conclusión automática de validez.

## Considered Options

- Mantener el vocabulario heredado `Firmar y aceptar` y `Contrato firmado`.
- Mostrar `Firmar` como término principal y explicar técnicamente el método.
- Usar aceptación en el producto y conservar la clasificación jurídica sólo en documentación interna validada.

## Consequences

- El botón del Firmante será `Aceptar contrato`.
- El estado o resultado visible será `Contrato aceptado`.
- La representación previa bajo demanda mostrará `Pendiente de aceptación`.
- La representación posterior bajo demanda se denominará Copia contractual aceptada.
- Eventos, alertas, búsquedas, comprobantes y exportaciones usarán aceptación como vocabulario de producto.
- La Leyenda de aceptación y cualquier declaración de representación u obligación solidaria deberán mencionar la acción visible exacta.
- Responsable juridico entregará la clasificación y redacción jurídica; Publicador de plataforma será el único que las apruebe y publique antes de operar contratos reales.
