---
status: accepted
---

# El acceso global exigirá autenticación reforzada y auditoría completa desde AWS

Al activar la Etapa 3 en AWS, el Administrador de plataforma deberá completar autenticación reforzada antes de utilizar cualquier capacidad global. Toda consulta de contenido, exportación, restauración, cambio transversal, operación de custodia o administración de una Organización quedará auditada con su identidad real.

Las Etapas 1 y 2 podrán utilizar una identidad de demostración y auditoría técnica proporcional porque sólo contienen datos sintéticos. La ausencia de controles productivos en esos entornos no los habilita para datos reales.

## Consequences

- No existirán cuentas compartidas, credenciales genéricas ni acceso global anónimo.
- El Administrador de plataforma tendrá una identidad separada de las identidades de Miembro y de los roles técnicos usados por servicios.
- La promoción a AWS fallará cerrada si la autenticación reforzada y la auditoría transversal no están activas.
- Cada registro incluirá actor, acción, Organización, entidad, propósito, fecha, resultado y metadatos técnicos mínimos.
- Los logs operativos no sustituirán la auditoría de dominio ni conservarán tokens o contenido contractual.
- Los registros de auditoría no podrán editarse desde la interfaz ordinaria y tendrán su propia conservación.
- Exportaciones, restauraciones y cambios sensibles requerirán autenticación reciente.
- El método concreto de autenticación reforzada y recuperación se decidirá después de verificar las capacidades regionales del proveedor.
