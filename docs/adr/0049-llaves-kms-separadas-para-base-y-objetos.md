---
status: accepted
---

# Production separará las llaves KMS de base de datos y objetos

Production utilizará dos llaves KMS administradas por Fides: una para
RDS PostgreSQL y otra para los tres buckets de objetos: acceso inmediato,
`Archivo Muerto` y temporales. Non-production y
Security utilizarán llaves propias y no podrán descifrar recursos de Production.

## Consequences

- Comprometer permisos sobre la llave de objetos no concederá control criptográfico sobre RDS, ni viceversa.
- Web y worker recibirán únicamente las operaciones criptográficas necesarias mediante sus roles técnicos y el contexto del servicio AWS.
- El Administrador de plataforma no tendrá permisos KMS directos desde su sesión del producto.
- El Administrador de infraestructura AWS administrará políticas y rotación mediante su identidad técnica separada.
- Las políticas impedirán compartir las llaves con cuentas o regiones no aprobadas.
- El material de las llaves no se exportará, almacenará en Git o expondrá como secreto de aplicación.
- Cambiar o retirar una llave requerirá comprobar previamente que todos los objetos, snapshots y recursos dependientes permanecen recuperables.
- La futura copia de backups a Security usará una llave de esa cuenta y un flujo explícito de copia o restauración.
