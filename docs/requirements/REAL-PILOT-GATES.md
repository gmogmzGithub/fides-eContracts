# Gates para usar datos reales

- **Actualizado:** 8 de agosto de 2026
- **Etapa actual:** Etapa 1 · POC-Demo local
- **Estado:** bloqueado; sólo se autorizan datos sintéticos

Este archivo registra únicamente lo que debe comprobarse antes de usar un
Contrato, dato reutilizable de una parte, INE, video o mensaje real. No define
contenido jurídico
ni modela dentro de la aplicación el trabajo previo de Responsable juridico y Publicador de plataforma.

## Regla de activación

Una Organización puede operar con datos reales sólo cuando todos los gates de
esta lista estén cerrados con evidencia. Un despliegue, una demo o una aprobación
verbal no los cierra.

## Gates de promoción entre etapas

| Promoción | Condición mínima |
|---|---|
| Etapa 1 → Etapa 2 | Verificaciones automatizadas completas, validación manual de Publicador de plataforma y corrección de los defectos encontrados |
| Etapa 2 → preparación de Etapa 3 | POC-Demo remoto validado sólo con datos sintéticos, presupuesto aprobado e infraestructura como código lista para AWS Non-production |
| AWS Non-production → Etapa 3A | Todos los gates de producto, AWS, proveedores, seguridad y operación cerrados; mismo artefacto promovible a Production; autorización expresa de Publicador de plataforma |
| Etapa 3A → Etapa 3B | Carga, clientes e ingresos justifican escala y redundancia; se cumplen los gates económicos específicos, incluido el de backups de ADR-0046 |

AWS Non-production forma parte de la preparación de la Etapa 3. No convierte la
Etapa 2 en AWS ni permite datos reales. Production es el único entorno autorizado
para ellos y únicamente después del cierre completo de esta lista.

## Prerrequisito humano

Para la Organización que será activada:

1. Responsable juridico entrega los Contratos, Aviso de Privacidad, consentimientos,
   leyendas y reglas de conservación aplicables.
2. Publicador de plataforma programa los Campos contractuales necesarios.
3. Publicador de plataforma aprueba y publica las versiones exactas.
4. Publicador de plataforma confirma expresamente que esa Organización puede comenzar a usar
   datos reales.

La plataforma no revisa o valida el contenido de estas decisiones.

## Gates del producto

| Gate | Evidencia mínima | Estado |
|---|---|---|
| Recorrido completo | Crear, abrir, recorrer, aceptar, revisar, repetir, vencer, cancelar, archivar y eliminar funcionan de extremo a extremo | Pendiente |
| Versionamiento | Plantilla y aviso publican `1.0`, versión nueva y etiqueta repetida; los Contratos históricos permanecen inmutables | Pendiente |
| Evidencia | Todas las Organizaciones pueden elegir aceptación sola, INE, video o ambos; límites, privacidad, hashes y aislamiento se prueban y cada Intento conserva sólo su propia evidencia | Pendiente |
| Revisión | Funcionan Sin revisión, Manual y AI; AI recomienda y el Revisor concluye, repite o usa `SKIP` | Pendiente |
| PDF | Sólo se genera mediante `Ver PDF` y nunca contiene enlace o token | Pendiente |
| Organización | Buscador progresivo, sugerencias libres, `Recientes`, `Favoritos`, Alertas, páginas de 20, Carpetas, Archivados y Eliminados están aislados por Organización y Cuenta cuando corresponde | Pendiente |
| Alertas | Eventos visibles, preferencias, outbox, deduplicación, reintentos y payload mínimo funcionan; ningún correo o WhatsApp incluye enlace, contrato o evidencia | Pendiente |
| Accesos | Invitaciones, diez lugares, roles acumulables, Administrador principal, recuperación, revocación y autenticación reforzada global de Etapa 3 funcionan | Pendiente |
| Autorización | Pruebas positivas y negativas demuestran que ninguna cuenta cruza Organizaciones o permisos | Pendiente |
| Integridad | Emisión y decisiones son atómicas e idempotentes; hashes, inventario y eventos se reconcilian | Pendiente |
| Custodia | ZIP completo, Archivo Muerto, umbral de un año, recuperación temporal y exportación masiva se prueban | Pendiente |
| AWS | La infraestructura como código despliega y verifica red, ECS, RDS, los tres buckets S3, KMS, SQS, DLQ, auditoría y aislamiento primero en Non-production y después en Production | Pendiente |
| Proveedores | Correo, WhatsApp y AI tienen credenciales, contratos, límites, fallas y reintentos verificados | Pendiente |
| Seguridad | Secretos, sesiones, TOTP global, cifrado, logs, rate limits y respuesta a incidentes se prueban | Pendiente |
| Operación | Despliegue, monitoreo, recuperación y soporte se ensayan con responsables definidos | Pendiente |

## Gate especial del ZIP

Antes de guardar evidencia real dentro de un solo Paquete contractual frío,
Responsable juridico debe entregar y Publicador de plataforma debe aprobar una regla de conservación
compatible para todos sus componentes. Si algún componente necesita eliminarse
antes, la arquitectura del ZIP debe cambiar antes de operar datos reales.

## Evidencia de cierre

La activación debe enlazar, como mínimo:

- Organización y capacidades habilitadas;
- publicaciones exactas de plantilla y aviso;
- commit e imagen desplegados;
- resultados de las pruebas anteriores;
- infraestructura y proveedores utilizados;
- riesgos aceptados expresamente;
- confirmación final de Publicador de plataforma.

## Fuentes vigentes

- [`CONTEXT.md`](../../CONTEXT.md)
- [ADR aceptados](../adr/)
- [Arquitectura del sistema](../architecture/SYSTEM-ARCHITECTURE.md)
- [Frontera del Aviso de Privacidad](../privacy/PRIVACY-NOTICE-REQUIREMENTS.md)
