---
status: accepted
---

# El ALB será público y los workloads permanecerán en subredes privadas

Cada VPC de Non-production y Production abarcará varias zonas de disponibilidad. El Application Load Balancer será el único componente de entrada pública; los servicios web y worker de ECS Fargate se ejecutarán sin IP pública en subredes privadas, y RDS PostgreSQL permanecerá en subredes aisladas sin ruta a internet.

Durante la Etapa 3A, Production utilizará un solo NAT Gateway como compromiso explícito de costo. En la Etapa 3B se desplegará un NAT Gateway por zona de disponibilidad usada por los workloads cuando los ingresos permitan sostener la redundancia.

## Consequences

- Internet sólo podrá iniciar conexiones HTTPS hacia el ALB; no podrá iniciar conexiones directas hacia tareas ECS, el worker o RDS.
- El grupo de seguridad del servicio web sólo aceptará tráfico de aplicación procedente del grupo de seguridad del ALB.
- El worker no tendrá entrada pública ni requerirá un listener; consumirá trabajos desde las colas autorizadas.
- RDS sólo aceptará conexiones PostgreSQL desde los roles de red de web y worker, y no tendrá una ruta de salida directa a internet.
- Las tareas privadas utilizarán endpoints privados de AWS cuando se aprueben y, para los destinos públicos restantes, saldrán mediante el NAT Gateway.
- El NAT no publicará ni aceptará conexiones iniciadas desde internet; sólo permitirá la salida de conexiones iniciadas por workloads privados.
- Un solo NAT Gateway constituye un punto único de falla para la salida de Production en 3A. Una falla podrá degradar integraciones externas, despliegues o trabajos que dependan de internet, pero no hará públicos los workloads ni RDS.
- En 3B, un NAT Gateway por zona evitará que la salida de todas las zonas dependa de un solo recurso o de una ruta entre zonas.
- Los grupos de seguridad expresarán relaciones entre componentes, no listas amplias de direcciones IP.
- Los registros de flujo y la auditoría de cambios de red se activarán en Production de acuerdo con el diseño operativo de la Etapa 3.
