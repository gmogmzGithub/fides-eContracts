---
status: accepted
---

# El Administrador de plataforma tendrá acceso global

El Administrador de plataforma tendrá acceso transversal a todas las Organizaciones, Miembros, expedientes, contratos, evidencias, objetos, auditoría y operaciones internas de recuperación de la plataforma. Este acceso no dependerá de una autorización individual de la Organización y se utilizará para administrar la plataforma, operar la custodia y atender soporte e incidentes.

## Consequences

- Fides no se diseñará como un custodio técnicamente ciego al contenido.
- La autorización de dominio y las políticas de almacenamiento reconocerán explícitamente una identidad interna con alcance global.
- El acceso global no convierte al Administrador de plataforma en Miembro, Administrador o Emisor de cada Organización.
- Podrá consultar, exportar y restaurar cualquier expediente, administrar Organizaciones, Miembros, configuración, infraestructura y custodia, y atender soporte e incidentes.
- La Vista interna de Archivo Muerto agrupará por Organización todos los paquetes y objetos y permitirá buscarlos por sus metadatos contractuales y técnicos, consultar su estado de almacenamiento y, después de la recuperación técnica aplicable, inspeccionar su contenido completo.
- `Recuperar contenido` iniciará desde esa vista la recuperación técnica y permitirá inspeccionar o descargar temporalmente los objetos cuando estén disponibles. La acción quedará auditada, no cambiará Estados contractuales o Clasificaciones operativas y no reactivará el portal de la Organización.
- Cada acción se limitará a un Paquete contractual frío. No habrá selección múltiple o recuperación masiva por Organización en el alcance inicial; esa capacidad queda como mejora futura/TBD.
- `Recuperar contenido` seleccionará automáticamente el nivel según la modalidad vigente: S3 Glacier Deep Archive `Standard` para una Organización con Custodia activa, bajo el compromiso comercial máximo de 48 horas, y `Bulk` sin Custodia activa, bajo un plazo operativo de hasta siete días hábiles. No existirá selector manual de nivel.
- La Copia temporal de recuperación interna estará disponible durante tres días completos desde que finalice la operación y después expirará automáticamente. Una necesidad posterior exigirá otra ejecución de `Recuperar contenido`.
- Cada paquete mostrará `Archivado`, `Recuperación en curso`, `Disponible hasta <fecha>` o `Recuperación fallida`. La plataforma enviará correo únicamente al Administrador de plataforma cuando la recuperación termine o falle; nunca notificará a la Organización.
- `Recuperación fallida` no tendrá reintentos automáticos. La acción manual `Reintentar recuperación`, exclusiva del Administrador de plataforma, iniciará otra solicitud con el nivel aplicable y quedará auditada como una operación distinta.
- No podrán coexistir dos recuperaciones del mismo paquete. En `Recuperación en curso` se deshabilitará la acción; en `Disponible hasta <fecha>` se mostrará `Ver contenido`; después de expirar volverá a `Archivado` y reaparecerá `Recuperar contenido`.
- Esta herramienta interna no aparecerá para la Organización y no recibirá, registrará o dará seguimiento dentro del producto a correos, WhatsApp, mensajes u otras solicitudes externas.
- No podrá modificar un Contrato emitido o aceptado, firmar por un Titular contractual, aceptar como Firmante ni suplantar silenciosamente a un Miembro.
- Toda acción que afecte el dominio conservará la autoría real del Administrador de plataforma; no se registrará como si hubiera sido ejecutada por la Organización.
- La eliminación sólo podrá ejecutarse mediante las políticas de conservación, Retención jurídica y trabajos auditados aplicables.
- Los controles reforzados de esta identidad se decidirán por separado.
