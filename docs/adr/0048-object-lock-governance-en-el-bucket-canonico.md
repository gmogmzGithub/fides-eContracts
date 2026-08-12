---
status: accepted
---

# Los buckets canónicos usarán Versioning y Object Lock en Governance

El bucket canónico de acceso inmediato y `Archivo Muerto` tendrán S3 Versioning y Object Lock habilitados desde su creación. Los objetos recibirán retención en modo Governance conforme a su categoría y política aprobada; el bucket temporal no tendrá Object Lock porque sus copias deben expirar.

## Consequences

- Cada registro canónico conservará también el bucket y el `version_id` de S3; una clave sin bucket y versión no identificará por sí sola el objeto contractual.
- Los permisos para omitir Governance estarán restringidos a una operación excepcional, explícita y auditada del Administrador de infraestructura AWS.
- El Administrador de plataforma no podrá omitir la retención desde la aplicación.
- Un delete marker no se interpretará como eliminación de una versión protegida y la reconciliación detectará ambos estados.
- Las transiciones o traslados verificados entre el bucket de acceso inmediato y `Archivo Muerto` conservarán la protección, inventario y trazabilidad de cada versión.
- No existirá una retención predeterminada irreversible hasta que cada categoría tenga plazo, inicio de cómputo y reglas aprobadas.
- Compliance requerirá una decisión posterior después de probar emisión, transición, restauración, Retención jurídica, supresión y costos durante el periodo completo de gracia.
