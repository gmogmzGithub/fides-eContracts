---
status: accepted
---

# Production utilizará un S3 Gateway Endpoint desde la Etapa 3A

Las subredes privadas de web y worker accederán a los buckets de acceso inmediato, `Archivo Muerto` y temporales de Production mediante un S3 Gateway Endpoint desde la Etapa 3A. El tráfico hacia S3 no dependerá del NAT Gateway; el NAT permanecerá disponible para WhatsApp y los demás destinos públicos que no tengan una ruta privada aprobada.

## Consequences

- El software continuará utilizando el cliente y las operaciones normales de S3; no seleccionará el Gateway Endpoint ni contendrá una condición para elegir entre endpoint y NAT.
- Las tablas de rutas de las subredes privadas enviarán automáticamente el tráfico destinado a S3 hacia el Gateway Endpoint.
- La política del endpoint y las políticas de los buckets limitarán el acceso a los tres buckets de objetos, las cuentas, los roles y las operaciones autorizadas.
- Una falla del único NAT Gateway de 3A no interrumpirá por sí misma el acceso de web y worker a S3.
- El Gateway Endpoint no proporcionará salida hacia WhatsApp, ECR, SQS, KMS u otros servicios; esos recorridos conservarán la ruta que se apruebe para cada servicio.
- Non-production tendrá su propio endpoint, rutas, roles y buckets, sin acceso a los objetos de Production.
- El recorrido se probará con carga, lectura, versionado, transición, solicitud de restauración y verificación de hash antes del primer contrato real.
- No se crearán inicialmente todos los endpoints de interfaz disponibles. Su costo y beneficio se decidirán por servicio cuando el volumen, la disponibilidad o la seguridad lo justifiquen.
