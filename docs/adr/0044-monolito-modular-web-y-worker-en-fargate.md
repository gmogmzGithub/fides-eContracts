---
status: accepted
---

# El monolito modular se ejecutará como web y worker en ECS Fargate

Fides conservará un solo repositorio, modelo de dominio e imagen
versionada, pero la Etapa 3 ejecutará dos procesos independientes en ECS
Fargate: un servicio web público para Next.js, API y respuestas interactivas, y
un worker privado para trabajos asíncronos, externos o de larga duración.

El servicio web registrará en PostgreSQL el hecho contractual y su outbox dentro de una misma transacción. Un dispatcher publicará los trabajos en SQS y el worker los procesará de forma idempotente, con reintentos y dead-letter queue, sin mantener conexiones HTTP abiertas.

## Consequences

- Firmar, cancelar o consultar un contrato no dependerá de la disponibilidad inmediata de WhatsApp, Glacier u otro proveedor externo.
- Web y worker compartirán reglas de dominio, tipos, migraciones, hashes y versión de imagen, pero usarán comandos, escalamiento y roles IAM distintos.
- La Etapa 1 ejecutará esa misma separación desde una imagen común mediante
  Docker Compose, PostgreSQL, una cola local compatible con SQS y un proveedor
  sintético. Esta prueba conserva el contrato arquitectónico, pero no sustituye
  ECS, SQS, IAM, red privada, observabilidad ni pruebas en AWS Non-production.
- La Etapa 2 reutilizará la misma imagen y comandos de `app` y `worker` en un
  único host remoto sintético. La colocación conjunta reduce costo, pero no
  fusiona procesos, responsabilidades o estado canónico y no se presentará como
  disponibilidad de Production.
- Sólo el servicio web recibirá tráfico desde el Application Load Balancer; el worker no tendrá entrada pública.
- La capacidad web escalará por carga interactiva y los workers por profundidad y antigüedad de las colas.
- Restauraciones de Glacier se modelarán como estados y trabajos sucesivos; ningún proceso permanecerá bloqueado durante horas o días.
- Los mensajes incluirán claves de idempotencia y sólo se confirmarán después de conservar el resultado correspondiente.
- Fallas repetidas pasarán a una DLQ y generarán una alerta operativa.
- No se introducirán Kubernetes, microservicios, Lambda ni servidores EC2 administrados manualmente sin un requisito posterior que justifique el cambio.
