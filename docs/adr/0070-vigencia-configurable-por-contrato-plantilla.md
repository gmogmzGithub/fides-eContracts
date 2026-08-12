---
status: accepted
---

# El Contrato-plantilla propondrá una Vigencia del enlace personalizable

La Vigencia del enlace tendrá un valor predeterminado inicial de siete días, pero dejará de ser un plazo obligatorio para todas las Organizaciones u operaciones. Admitirá de `1` a `30` días completos y no tendrá una opción sin vencimiento. Después de la Implementación contractual inicial, un Administrador de la Organización podrá cambiar el valor propuesto para contratos futuros dentro de ese rango, sin intervención del Administrador de plataforma y sin crear otra versión jurídica del Contrato-plantilla. Antes de emitir, el Emisor podrá conservar el valor vigente sin pasos adicionales o elegir cualquier plazo permitido mediante `Personalizar este contrato`. El valor efectivo quedará congelado para ese Contrato.

## Considered Options

- Conservar siete días obligatorios para todas las industrias y relaciones contractuales.
- Exigir que cada Organización elija expresamente el plazo aunque no tenga una necesidad distinta.
- Configurar una vigencia obligatoria por versión de Contrato-plantilla sin permitir ajustes operativos.
- Exigir que el Proveedor cambie cada valor predeterminado solicitado por una Organización.
- Proponer siete días y permitir que el Emisor elija otro plazo permitido para una operación.

## Consequences

- La captura diaria mostrará siete días o el valor predeterminado del Contrato-plantilla sin exigir una decisión adicional.
- La plataforma sólo aceptará días completos entre `1` y `30`; no permitirá cero, valores negativos, fracciones, plazos mayores o enlaces indefinidos.
- Un Administrador de la Organización podrá cambiar ese valor predeterminado para emisiones futuras y el historial conservará cada versión operativa.
- `Personalizar este contrato` permitirá al Emisor elegir otro plazo dentro de los límites habilitados y mostrará la fecha de vencimiento resultante antes de emitir.
- Elegir otro plazo para una operación no exigirá motivo o aprobación adicional.
- Cada Enlace contractual conservará la vigencia efectiva del Contrato aunque el Contrato-plantilla cambie después.
- Un enlace vencido o revocado nunca se reactivará.
- `Eliminar` un Expediente invalidará inmediatamente todos sus enlaces, aunque su vigencia no haya terminado o sólo permitieran consultar el Contrato aceptado. Mientras conserve la Clasificación operativa `Eliminado` no podrá generarse un enlace nuevo, de reemplazo o repetición.
- Nunca se generará otro enlace para un Contrato vencido. Cualquier intento posterior exigirá crear un Contrato nuevo usando la publicación vigente del Contrato-plantilla, con UUID, Referencia contractual, Huella documental, Intento y enlace nuevos.
- Esta regla será igual aunque la publicación vigente sea la misma que utilizó el Contrato vencido. Si existe otra publicación, el Contrato nuevo utilizará siempre esa publicación vigente, incluso cuando conserve la misma etiqueta manual.
- El Contrato vencido ofrecerá `Crear nuevo a partir de este`. La acción originará un Borrador sobre la publicación vigente y precargará sólo los campos compatibles; los obligatorios nuevos o incompatibles quedarán pendientes.
- Titular contractual y Firmante se resolverán desde sus registros activos actuales en el Directorio de contrapartes, no desde la instantánea histórica. Un registro desactivado deberá sustituirse por uno activo antes de emitir.
- El Borrador utilizará la Configuración predeterminada de emisión actual para vigencia, video, INE y revisión; no copiará las selecciones efectivas del Contrato vencido. El Emisor podrá personalizar las opciones habilitadas antes de emitir.
- La Carpeta operativa se conservará cuando todavía exista; si fue eliminada, el Borrador nuevo quedará sin carpeta.
- Cualquier Emisor que pueda consultar el Contrato vencido podrá ejecutar la acción. El Borrador pertenecerá a ese Emisor; un Administrador necesitará también el rol Emisor.
- La acción no copiará UUID, Referencia contractual, Huella documental, enlace, Intentos, aceptación o evidencia, y nunca ejecutará `Generar Contrato` automáticamente.
- El portal de la Organización y el recorrido del Firmante no mostrarán mensajes, enlaces cruzados, etiquetas, filtros o historial que relacionen el Contrato vencido con el nuevo.
- La plataforma conservará una Relación técnica de origen entre ambos objetos, consultable sólo por el Administrador de plataforma para soporte y auditoría y excluida de las exportaciones ordinarias de la Organización.
- `Repetir proceso` creará un enlace nuevo con el plazo efectivo completo del Contrato calculado desde su propia generación.
- Cambiar el valor predeterminado no requerirá una versión jurídica nueva del Contrato-plantilla y no afectará enlaces existentes; personalizar una operación tampoco modificará la plantilla.
- La emisión conservará el valor predeterminado, cualquier sustitución, el Emisor que la realizó y la Vigencia del enlace efectiva.
