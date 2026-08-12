---
status: accepted
---

# Cada Contrato-plantilla propondrá un Perfil de evidencia predeterminado

La plataforma no impondrá una composición de evidencia universal. Cada Contrato-plantilla propondrá un Perfil de evidencia predeterminado que siempre exige la aceptación electrónica y puede añadir Video guiado, Captura de INE o ambas. Al capturar cada Contrato, el Emisor verá siempre `Requerir INE` y `Requerir video` y podrá conservar o cambiar la propuesta sin abrir una configuración avanzada. El Perfil de evidencia efectivo quedará congelado para ese Contrato.

INE y video estarán disponibles para todas las Organizaciones como parte del Servicio contractual base. Durante la Implementación contractual inicial se establecerá un valor predeterminado y la finalidad y el tratamiento aprobados; después, un Administrador de la Organización podrá cambiar el valor para contratos futuros y cada Emisor podrá elegir ambas evidencias operación por operación. La personalización no permitirá inventar otra categoría ni desactivar la aceptación electrónica.

## Considered Options

- Exigir aceptación, video e INE en todos los contratos de todas las Organizaciones.
- Aprobar y congelar un Perfil de evidencia específico para cada versión de Contrato-plantilla.
- Obligar al Emisor a elegir la evidencia desde cero para cada Contrato.
- Proponer un perfil predeterminado y mostrar siempre al Emisor las dos elecciones universales.

## Consequences

- El Emisor verá dos controles persistentes y directos, `Requerir INE` y `Requerir video`, dentro de la captura de todos los Contratos.
- Activar o desactivar video o INE para una operación no exigirá motivo o aprobación adicional, pero el resumen previo a la emisión mostrará la composición efectiva.
- La aceptación electrónica siempre permanecerá activa.
- Un Administrador de la Organización podrá cambiar la combinación predeterminada de video e INE; el cambio creará una versión operativa nueva aplicable sólo a emisiones futuras.
- La Organización podrá tener Contratos-plantilla con Perfiles de evidencia diferentes cuando sus relaciones contractuales lo justifiquen.
- Video e INE serán configuraciones del Servicio contractual base y no planes, productos o adicionales comerciales independientes.
- Emitir un Contrato conservará el perfil predeterminado, cualquier Personalización de emisión, el actor que la realizó y el Perfil de evidencia efectivo junto con el texto, los valores y la Huella documental.
- Cuando el perfil incluya video o INE, el Firmante deberá completar esa evidencia antes de concluir la aceptación.
- Cada categoría tendrá finalidad, presentación de privacidad, acceso, conservación, supresión y respuesta a incidentes propias.
- Video e INE no se describirán automáticamente como identificación verificada, biometría, Firma electrónica avanzada, prueba plena o no repudio.
- Cuando el perfil exija INE, su captura seguirá la frontera de evidencia sin verificación definida por ADR-0061.
- Cuando el perfil exija video, su captura seguirá la grabación guiada, la Plantilla de declaración audiovisual y la Declaración audiovisual definidas por ADR-0062.
- Completar las evidencias exigidas concluye inmediatamente sólo cuando la Política de revisión usa `Sin revisión`; en los demás casos crea un Intento de aceptación `A revisión` conforme a ADR-0065.
- Cambiar el perfil predeterminado no creará una versión jurídica nueva del Contrato-plantilla y no afectará Contratos ya emitidos. Personalizar una sola operación tampoco modificará el Contrato-plantilla.
- La redacción de la aceptación, el detalle de captura de INE y el recorrido audiovisual se decidirán y validarán por separado.
