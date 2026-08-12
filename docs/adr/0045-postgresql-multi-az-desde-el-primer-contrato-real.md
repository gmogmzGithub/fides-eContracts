---
status: accepted
---

# PostgreSQL utilizará RDS Multi-AZ desde el primer contrato real

Non-production utilizará una instancia pequeña de RDS PostgreSQL Single-AZ exclusivamente con datos sintéticos. Production utilizará una instancia RDS PostgreSQL Multi-AZ con réplica standby sincronizada desde 3A, antes de admitir el primer contrato real.

## Consequences

- PostgreSQL continuará como Registro contractual canónico; S3 no podrá utilizarse para reconstruir por sí solo estados, permisos, eventos o auditoría.
- RDS, web y workers permanecerán en subredes privadas dentro de `mx-central-1`.
- RDS administrará la conmutación a la standby ante una falla de la instancia primaria o su zona.
- La aplicación deberá tolerar conexiones interrumpidas durante un failover y restablecer su pool sin duplicar operaciones.
- Non-production no simulará alta disponibilidad con datos reales ni se presentará como Production.
- No se introducirán Aurora, un clúster RDS de tres instancias o réplicas de lectura hasta que carga, recuperación o disponibilidad medidas lo justifiquen.
- El cifrado seguirá siendo obligatorio, pero ADR-0046 difiere los backups automáticos, la recuperación a un punto en el tiempo y las pruebas de restauración hasta un gate económico posterior.
