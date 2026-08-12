---
status: accepted
---

# Production separará custodia activa, Archivo Muerto y objetos temporales

Production utilizará tres buckets privados: uno canónico de acceso inmediato para objetos de Organizaciones con Custodia activa que todavía no cumplen un año; `Archivo Muerto`, en S3 Glacier Deep Archive, para todos los contratos de Organizaciones sin Custodia activa, todos los objetos canónicos que cumplan un año y los Expedientes `Eliminados` procedentes del bucket de acceso inmediato; y uno temporal para Copias temporales de entrega, recuperaciones y exportaciones de vigencia breve. No se creará un bucket por Organización.

## Consequences

- El bucket canónico de acceso inmediato conservará los objetos autorizados de Organizaciones con Custodia activa únicamente hasta que cumplan un año desde la Fecha de cierre contractual.
- `Archivo Muerto` utilizará S3 Glacier Deep Archive. La Clasificación operativa será metadato independiente: para una Organización sin Custodia activa, marcar un asunto `Eliminado` no provocará otro traslado; para una Organización con Custodia activa, sí encolará el cambio de destino canónico.
- Una transición automatizada trasladará a `Archivo Muerto` todos los objetos canónicos con Custodia activa al cumplir un año desde la Fecha de cierre contractual, registrada al entrar por primera vez a `Aceptado`, `Vencido` o `Cancelado`.
- Un Contrato `Pendiente de aceptación` o `A revisión` no se trasladará por antigüedad de emisión. Un objeto canónico creado después de cumplido el año se escribirá directamente en `Archivo Muerto`.
- Al contratar Custodia activa, la Activación de Custodia activa trasladará al bucket de acceso inmediato sólo los paquetes no eliminados que todavía no cumplan un año desde la Fecha de cierre contractual; el historial más antiguo y los clasificados como `Eliminados` conservarán su destino en `Archivo Muerto`.
- Las recuperaciones desde `Archivo Muerto` usarán `Standard` para Organizaciones con Custodia activa, bajo un compromiso comercial máximo de 48 horas, y `Bulk` sin Custodia activa, bajo un plazo operativo de hasta siete días hábiles.
- El bucket temporal tendrá políticas y trabajos de eliminación acordes con la Vigencia del enlace o de la exportación.
- Ninguno de los tres tendrá acceso público, listado público o URLs permanentes.
- PostgreSQL conservará el Inventario de objetos contractuales y seguirá siendo la fuente de verdad sobre Organización, expediente, versión, clase, hash, tamaño, estado y conservación.
- Las claves serán opacas y no contendrán nombres, correos, RFC, rutas comerciales u otros datos personales o contractuales.
- Toda lectura y descarga comprobará autorización en el servidor y utilizará acceso de corta duración.
- La eliminación del bucket temporal no afectará las copias canónicas; las políticas del bucket activo, `Archivo Muerto` y el temporal permanecerán separadas.
- La separación se repetirá en Non-production con nombres, cuentas, claves y datos sintéticos independientes.
