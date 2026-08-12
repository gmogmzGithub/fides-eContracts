---
status: accepted
---

# El Contrato-plantilla y el Aviso de Privacidad tendrán versionamiento manual

La plataforma manejará versiones manuales por Contrato-plantilla. La primera versión será siempre `1.0`. Sólo Publicador de plataforma podrá publicar Markdown desde una pantalla privada con un editor de texto simple, el valor de `Versión actual` y un campo para escribir `Versión nueva`.

La misma mecánica aplicará al Aviso de Privacidad de cada Organización. Cada aviso se publicará bajo una sola etiqueta; comenzará en `1.0`, conservará todas sus publicaciones anteriores y tendrá exactamente una vigente. Responsable juridico entregará el contenido y sólo Publicador de plataforma podrá aprobarlo, editarlo en la plataforma y publicarlo.

El Administrador podrá modificar libremente el Markdown y decidir manualmente si la publicación se identifica como `1.1`, `2.0` o conserva la misma etiqueta actual. La plataforma no exigirá unicidad, calculará el tipo de cambio, incrementará el número automáticamente ni exigirá motivo. Cada publicación confirmada creará un registro interno inmutable y conservará todos los anteriores, aunque dos o más registros tengan la misma etiqueta.

Cuando `Versión nueva` coincida con `Versión actual`, la plataforma mostrará `Estás usando la misma versión, ¿es esto correcto?`. Confirmar continuará con esa etiqueta; cancelar regresará al editor sin publicar. La advertencia no aparecerá ante la Organización o el Firmante.

El editor sólo modificará el Markdown y el identificador de versión. No creará, eliminará o cambiará el Esquema programado de campos. Si un Markdown nuevo requiere un marcador o comportamiento distinto, el Administrador de plataforma programará y desplegará primero el esquema correspondiente y después publicará la versión que lo utiliza.

Antes de publicar, la plataforma comprobará que cada marcador utilizado por el Markdown exista en el Esquema programado de campos aplicable. Un marcador desconocido bloqueará la publicación, mostrará cuál falta y conservará intacta la versión vigente. La plataforma no creará el campo automáticamente.

Cada Contrato-plantilla tendrá exactamente una publicación vigente para emisiones nuevas. Al guardar otra, el registro nuevo quedará vigente y el anterior pasará a histórico, aunque ambos tengan la misma etiqueta de versión. El Emisor elegirá el Contrato-plantilla, no su versión; los registros históricos permanecerán disponibles para reproducir y auditar Contratos existentes, pero no para crear otros.

Los editores, identificadores de versión e historiales serán visibles exclusivamente para Publicador de plataforma. La Organización, sus Miembros y el Firmante no verán `1.0`, `1.1` u otra etiqueta de versión en el portal, el recorrido contractual o los PDF. La plataforma conservará internamente la relación exacta para trazabilidad y reproducción.

El historial privado mostrará cada publicación como una entrada independiente con etiqueta, fecha y hora, y marcará exactamente cuál está vigente. Si varias publicaciones comparten `1.1`, aparecerán separadas por su fecha y hora; la plataforma no inventará un número de revisión adicional.

Un Contrato generado no tendrá una secuencia de versiones propia. Al ejecutar `Generar Contrato`, se creará una instantánea inmutable ligada al registro interno exacto del Contrato-plantilla, junto con su etiqueta, texto formado, valores, partes, configuración efectiva y Huella documental. Crear una publicación posterior de la plantilla no modificará esa instantánea.

## Considered Options

- Versionar por separado el Contrato-plantilla y cada Contrato emitido.
- Sobrescribir la versión actual del Contrato-plantilla.
- Versionar sólo el Contrato-plantilla mediante numeración elegida manualmente y conservar cada Contrato emitido como una instantánea inmutable.

## Consequences

- El Editor de Contrato-plantilla será exclusivo de Publicador de plataforma y no aparecerá en el portal de la Organización.
- El Editor de Aviso de Privacidad reutilizará la misma lógica de versión manual y será exclusivo de Publicador de plataforma.
- La pantalla permitirá editar el Markdown, mostrará la versión actual y exigirá escribir la versión nueva antes de guardar.
- La pantalla no incluirá un diseñador de campos, validaciones o formularios.
- La publicación fallará de forma cerrada si el Markdown contiene al menos un marcador que no exista en el esquema programado, y mostrará todos los marcadores desconocidos encontrados.
- Una publicación fallida no creará una versión parcial ni cambiará cuál versión está vigente.
- La primera versión será `1.0`; el Administrador decidirá manualmente toda etiqueta posterior y podrá conservar la actual.
- La etiqueta no tendrá que ser única, creciente o diferente de la actual.
- Repetir la etiqueta actual exigirá una sola confirmación mediante la Advertencia de misma versión.
- No habrá motivo obligatorio, clasificación semántica del cambio o incremento automático.
- Guardar creará un registro interno nuevo; ninguna publicación anterior podrá editarse o eliminarse aunque utilice la misma etiqueta.
- Guardar hará vigente el registro nuevo y retirará el anterior de las emisiones futuras en la misma operación.
- Publicar un Aviso de Privacidad nuevo no modificará el aviso ligado a Contratos ya emitidos.
- El Emisor no tendrá un selector de versiones de Contrato-plantilla.
- La Organización y el Firmante no verán identificadores o historial de versiones; esta información será exclusiva del Administrador de plataforma.
- El historial del Administrador distinguirá publicaciones con la misma etiqueta mediante fecha y hora, y marcará una sola como vigente sin asignarles otro número.
- Cada Contrato emitido conservará el nombre, el registro interno exacto y la etiqueta del Contrato-plantilla utilizado, además de su propia instantánea inmutable.
- Después de que un Contrato vence, cualquier intento posterior será un Contrato nuevo creado con el registro vigente del Contrato-plantilla, haya cambiado o no; nunca se renovará el enlace del Contrato histórico.
- No existirán `Versión emitida`, `Versión sucesora`, numeración propia del Contrato o herramienta para corregir un Contrato pendiente bajo la misma referencia.
- Si un Contrato emitido contiene un dato contractual incorrecto, no se modificará mediante este editor; se cancelará y se originará un Borrador nuevo mediante `Duplicar para corregir` conforme a ADR-0080.
