---
status: accepted
---

# Un Contrato incorrecto se cancelará y duplicará como Borrador nuevo

Un Contrato emitido nunca se editará o versionará. Si la Organización detecta un dato contractual incorrecto después de `Generar Contrato`, deberá cancelar el Contrato mientras esté `Pendiente de aceptación` o `A revisión`. La cancelación revocará cualquier Enlace contractual vigente, cerrará sin decisión la tarea de revisión cuando exista y conservará íntegramente el Contrato, actor, fecha, motivo opcional, eventos, Intentos, evidencias y reportes existentes.

Después de cancelar, la plataforma ofrecerá `Duplicar para corregir`. Esta acción creará un Borrador contractual nuevo basado en la publicación vigente del mismo Contrato-plantilla. Precargará únicamente los datos cuyos campos sigan siendo compatibles y dejará pendientes los campos obligatorios nuevos o incompatibles. El Borrador podrá corregirse con el flujo ordinario y no tendrá Referencia contractual, Huella documental, Intento de aceptación o Enlace contractual hasta ejecutar otra vez `Generar Contrato`. La nueva emisión será un Contrato distinto con referencia y enlace nuevos.

## Considered Options

- Editar el Contrato emitido y mantener su enlace.
- Crear una versión sucesora bajo la misma Referencia contractual.
- Cancelar el Contrato incorrecto y duplicar sus datos como un Borrador nuevo.

## Consequences

- El Contrato cancelado y su historial nunca se sobrescribirán, reactivarán o eliminarán.
- Después de cancelar un Contrato `A revisión`, ningún Revisor podrá concluir, omitir o repetir el Intento cerrado.
- Una cancelación y una resolución de revisión concurrentes competirán atómicamente: la primera acción válida ganará y la segunda conservará el resultado registrado sin producir efectos parciales.
- `Duplicar para corregir` no copiará enlaces, Intentos de aceptación, aceptaciones, INE, video u otra evidencia.
- Cualquier Emisor de la Organización que pueda consultar el Contrato cancelado podrá ejecutar la acción, aunque no haya creado el original.
- El Borrador resultante pertenecerá al Emisor que ejecutó la duplicación y conservará las reglas ordinarias de visibilidad de Borradores.
- Un Miembro con sólo el rol Administrador podrá cancelar el Contrato y consultar el Borrador resultante, pero necesitará también el rol Emisor para ejecutar `Duplicar para corregir`.
- La acción no emitirá automáticamente: el Emisor deberá revisar el Borrador y ejecutar `Generar Contrato`.
- El Borrador duplicado utilizará siempre la publicación vigente del mismo Contrato-plantilla; nunca reactivará o seleccionará la publicación histórica usada por el Contrato cancelado.
- Sólo se precargarán campos compatibles entre ambas publicaciones. Los campos obligatorios nuevos o incompatibles deberán completarse antes de emitir.
- Titular contractual y Firmante se tomarán de sus registros activos actuales en el Directorio de contrapartes y no de la instantánea histórica del Contrato cancelado.
- Si alguno de esos registros fue desactivado, el Emisor deberá seleccionar o crear uno activo antes de emitir.
- Vigencia, video, INE y revisión partirán de la Configuración predeterminada de emisión actual. No se copiará la configuración efectiva del Contrato cancelado y el Emisor podrá personalizar las opciones habilitadas antes de emitir.
- La Carpeta operativa se conservará cuando todavía exista; si fue eliminada, el Borrador nuevo quedará sin carpeta.
- La nueva emisión recibirá UUID, Referencia contractual, Huella documental, Intento de aceptación y Enlace contractual propios.
- El portal de la Organización y el recorrido del Firmante no mostrarán mensajes, enlaces cruzados, etiquetas, filtros o historial de procedencia entre el Contrato cancelado y el nuevo.
- Cada Contrato se presentará como independiente y nunca como versión, sustituto o continuación visible del anterior.
- La plataforma conservará una Relación técnica de origen consultable únicamente por el Administrador de plataforma para soporte y auditoría. No se incluirá en vistas, búsquedas o exportaciones ordinarias de la Organización.
