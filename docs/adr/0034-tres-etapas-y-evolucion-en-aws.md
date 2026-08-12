---
status: accepted
---

# Tres etapas: POC-Demo local, POC-Demo remoto y Operación real en AWS

Fides evolucionará mediante tres etapas. La **Etapa 1 · POC-Demo local** ejecuta
el producto completo en Docker Compose dentro de la computadora de Publicador de plataforma; al
momento, todo vive allí. La **Etapa 2 · POC-Demo remoto** publica ese mismo
producto sintético, con la misma imagen y separación de procesos, en un solo host
reemplazable de free tier o costo mínimo. La **Etapa 3 · Operación real en AWS**
migra esas fronteras a servicios administrados en AWS México Central y se divide
en 3A Piloto real y 3B Producción escalable.

La Etapa 1 es la etapa actual. Las Etapas 1 y 2 usan exclusivamente datos
sintéticos; ningún despliegue gratuito o remoto queda habilitado para contratos,
datos reutilizables de partes, INE, videos, mensajes o identidades reales.

## Consequences

- La Etapa 1 ejecuta `app`, `worker`, PostgreSQL, ElasticMQ con DLQ, objetos
  privados, captura de mensajes y doble AI dentro de Docker Compose. Los
  servicios externos sólo aparecen como dobles locales controlados.
- La Etapa 1 ya es el POC-Demo funcional. Publicador de plataforma debe validar manualmente
  todos sus roles, recorridos, estados y capacidades, además de las pruebas
  automatizadas, antes de publicarlo remotamente en la Etapa 2.
- La Etapa 2 despliega el mismo producto en un solo host remoto sintético. Sólo
  la aplicación web se publica por HTTPS; PostgreSQL, worker, cola, objetos,
  captura de mensajes y doble AI permanecen privados en la red del host.
- El host de Etapa 2 es desechable y reconstruible desde migraciones y semilla.
  No ofrece alta disponibilidad, recuperación contractual, controles de AWS o
  autorización para datos reales. El proveedor concreto se elige al preparar la
  publicación remota y no cambia el dominio.
- Las credenciales públicas sintéticas de Etapa 1 nunca se reutilizan en la
  Etapa 2; el entorno remoto recibe credenciales distintas y revocables. La
  Etapa 1 no exige segundo factor: ADR-0041 admite una identidad de
  demostración mientras el entorno sólo tenga datos sintéticos.
- La cuenta AWS Non-production pertenece a la Etapa 3, no al POC-Demo remoto. Allí
  se valida la infraestructura como código con datos sintéticos antes de
  promover el mismo artefacto a Production.
- El primer dato real activa 3A y exige AWS Production y todos los gates del
  Piloto real cerrados.
- 3A y 3B conservan el mismo monolito modular, PostgreSQL canónico, outbox,
  web/worker separados y objetos privados. 3B añade capacidad, redundancia y
  controles operativos sin otra migración de plataforma.
