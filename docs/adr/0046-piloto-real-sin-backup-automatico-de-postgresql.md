---
status: accepted
---

# El Piloto real comenzará sin backup automático de PostgreSQL

Durante 3A, Production ejecutará RDS PostgreSQL Multi-AZ con cifrado, pero sin backups automáticos, recuperación a un punto en el tiempo, snapshots programados o copias de recuperación en la cuenta Security. Publicador de plataforma acepta diferir estos controles hasta que el MRR efectivamente cobrado sea al menos tres veces el costo mensual proyectado de backups.

## Consequences

- Multi-AZ sólo protegerá continuidad ante falla de instancia o zona; replicará también eliminaciones, corrupción lógica y migraciones defectuosas.
- La pérdida lógica de PostgreSQL durante 3A podrá ser irreversible.
- Los Paquetes contractuales fríos en S3 Glacier no reconstruirán por sí solos Organizaciones, Miembros, permisos, plantillas, estados, inventario, outbox o auditoría completa.
- Durante 3A Fides no afirmará un RPO, recuperación a un punto en el tiempo o restauración integral de PostgreSQL.
- La cuenta Security conservará auditoría, pero no copias de RDS mientras este gate permanezca abierto.
- El sistema seguirá generando Paquetes contractuales fríos verificables por contrato, sin presentarlos como backup de la plataforma.
- El costo proyectado incluirá almacenamiento, copias, claves, solicitudes y pruebas de restauración de la arquitectura de backups que se pretenda activar.
- Al cumplirse `MRR cobrado >= 3 × costo mensual proyectado`, el gate se cerrará y los backups pasarán a ser obligatorios; no quedarán sujetos a una nueva decisión discrecional.
