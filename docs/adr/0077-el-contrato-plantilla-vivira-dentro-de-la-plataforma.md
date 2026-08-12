---
status: accepted
---

# El Contrato-plantilla vivirá dentro de la plataforma

Después de contratar el servicio, la Organización comunicará los contratos recurrentes y hechos operativos que necesita cubrir. Responsable juridico preparará y entregará todo el contenido jurídico como Markdown contractual. Publicador de plataforma programará sus campos, validaciones y comportamiento cuando corresponda, y será la única persona que apruebe y publique cada versión como Administrador de plataforma. El Markdown y esa lógica formarán juntos un Contrato-plantilla versionado que vive dentro de la plataforma.

Todo ese trabajo ocurre fuera del flujo de la aplicación. Integrar el Contrato-plantilla significa que Publicador de plataforma ya lo aprobó y dejó listo a partir del material de Responsable juridico; la plataforma no registra o solicita aprobadores, medios, fechas o evidencias de aprobación.

La Organización recibirá acceso operativo cuando sus Contratos-plantilla estén integrados y listos. Al crear un Contrato, el Motor común de formularios construirá la captura desde el Esquema programado de campos; después el programa leerá el Markdown elegido, sustituirá sus marcadores con los valores capturados y presentará el texto resultante al Firmante. No habrá un editor de plantillas dentro del portal de la Organización ni una aplicación frontend distinta para cada Organización. El Administrador de plataforma sí tendrá un Editor de Contrato-plantilla privado.

Si un Contrato-plantilla necesita cambiar, Responsable juridico entregará el contenido jurídico nuevo fuera del flujo operativo. Publicador de plataforma modificará el Markdown en su editor, realizará el trabajo técnico aplicable, decidirá manualmente el identificador de la versión, la aprobará y la publicará. Los Contratos ya emitidos permanecerán ligados a la versión exacta con la que fueron creados.

## Considered Options

- Mantener la fuente en computadoras personales y publicar un artefacto separado dentro de la plataforma.
- Permitir que la Organización edite contratos y campos desde el portal.
- Integrar el Markdown entregado por Responsable juridico y aprobado por Publicador de plataforma junto con su lógica programada como una unidad versionada de la plataforma.

## Consequences

- El Markdown contractual vivirá dentro de la plataforma y no en las computadoras personales como fuente operativa separada.
- Cada publicación de Contrato-plantilla conservará el Markdown y su relación con marcadores, campos, tipos, obligatoriedad, validaciones, condiciones buscable y destacada, y comportamiento aplicables.
- El Motor común de formularios construirá la interfaz de cada Contrato-plantilla desde su esquema programado; una interfaz especial será una excepción para comportamientos que el motor compartido no soporte.
- Cada Contrato-plantilla pertenecerá exclusivamente a una Organización aunque el equipo pueda reutilizar Modelos contractuales base para desarrollarla.
- El Emisor seleccionará un Contrato-plantilla y llenará sus campos; la plataforma utilizará automáticamente su única versión vigente. El Emisor no elegirá versiones ni editará Markdown, cláusulas, marcadores o validaciones.
- Los identificadores y el historial de versiones serán visibles exclusivamente para el Administrador de plataforma; no aparecerán en el portal de la Organización, el recorrido del Firmante o los PDF.
- No existirán pantallas o estados de negociación, aprobación jurídica, entrega de Markdown o desarrollo de la interfaz.
- Cada emisión conservará la versión exacta, los valores aplicados, el texto resultante y su Huella documental.
- Sólo el Administrador de plataforma podrá crear versiones nuevas mediante el editor simple definido en ADR-0079; la Organización no participará en esa pantalla.
- Para contenido jurídico, ese Administrador de plataforma será exclusivamente Publicador de plataforma; otra cuenta global no podrá aprobar o publicar versiones aunque pueda consultar la plataforma para pruebas o soporte.
- El editor no será un diseñador de formularios. Agregar, eliminar o modificar campos seguirá siendo trabajo de programación y despliegue.
- La primera versión será `1.0`; el Administrador escribirá manualmente si la siguiente es `1.1`, `2.0` u otro identificador y no deberá justificar o clasificar el cambio dentro de la plataforma.
- Sólo la versión vigente se utilizará para emisiones nuevas. Todas las versiones anteriores permanecerán conservadas para reproducción y auditoría, y una versión nueva nunca modificará Contratos ya emitidos.
- El mecanismo técnico concreto de organización, carga y validación de archivos Markdown se decidirá durante la implementación, sin reabrir esta frontera de producto.
