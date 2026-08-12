---
status: accepted
---

# El POC-Demo completo vivirá localmente antes de publicarse de forma remota

La implementación actual es un POC-Demo local dockerizado, funcional y completo,
exclusivamente con datos sintéticos. En la Etapa 1 todos los servicios viven en
la computadora de Publicador de plataforma. Publicador de plataforma deberá poder probar de extremo a extremo
todos los roles, flujos, estados y capacidades definidos para esta versión.
Después de validar el producto y corregir los errores encontrados, ese mismo
POC-Demo podrá publicarse de forma remota en la Etapa 2.

Este POC-Demo local es la **Etapa 1 · POC-Demo local** definida en
ADR-0034 y es la etapa actual del proyecto. Que la pila arranque o que las
pruebas automatizadas pasen no promueve por sí solo el proyecto a la Etapa 2.

## Consequences

- El alcance actual no incluye un botón `Ver demostración`, acceso público o una
  experiencia reducida para presentaciones.
- La landing local conservará `Iniciar sesión` como acción principal y
  `Contactar` como acción secundaria.
- Docker deberá iniciar el producto y sus dependencias locales de forma
  reproducible con datos y cuentas sintéticas suficientes para probar todo.
- El entorno local incluirá estas identidades funcionales:

  | Correo | Alcance local |
  |---|---|
  | `platform-admin@fides.local` | Administrador de plataforma con acceso global |
  | `legal-partner@fides.local` | Administrador de plataforma con acceso global |
  | `transportes-admin@transportes.local` | Administrador y Emisor de Transportes |
  | `transportes-emisor@transportes.local` | Emisor de Transportes |
  | `transportes-revisor@transportes.local` | Revisor de Transportes |
  | `aviacion-norte-admin@aviacion-norte.local` | Andrea Rios: Administrador y Emisor de las dos Organizaciones Aviacion Norte |
  | `aviacion-norte-emisor@aviacion-norte.local` | Emisor de Aviacion Norte · Taxi aéreo y carga |
  | `aviacion-norte-revisor@aviacion-norte.local` | Revisor de Aviacion Norte · Taxi aéreo y carga |
  | `aviacion-norte-air-ambulance-emisor@aviacion-norte.local` | Emisor de Aviacion Norte · Ambulancia aérea |
  | `aviacion-norte-air-ambulance-revisor@aviacion-norte.local` | Revisor de Aviacion Norte · Ambulancia aérea |
  | `gasolinera-admin@gasolinera.local` | Administrador y Emisor de Gasolinera |
  | `gasolinera-emisor@gasolinera.local` | Emisor de Gasolinera |
  | `gasolinera-revisor@gasolinera.local` | Revisor de Gasolinera |
  | `euzen-admin@euzen.local` | Administrador y Emisor de Euzen |
  | `euzen-emisor@euzen.local` | Emisor de Euzen |
  | `euzen-revisor@euzen.local` | Revisor de Euzen |
  | `retto-admin@retto.local` | Administrador y Emisor de Retto |
  | `retto-emisor@retto.local` | Emisor de Retto |
  | `retto-revisor@retto.local` | Revisor de Retto |

- Andrea tendrá una sola Cuenta, `aviacion-norte-admin@aviacion-norte.local`, con dos Accesos de
  Organización: uno para `Aviacion Norte · Taxi aéreo y carga` y otro para
  `Aviacion Norte · Ambulancia aérea`. Las seis Organizaciones permanecen aisladas.
- El catálogo sintético tendrá exactamente 6 Organizaciones, 19 Cuentas, 7
  Contratos-plantilla, 27 registros reutilizables de partes, 18 Carpetas y 53
  Expedientes: 47
  Contratos y 6 Borradores. Retto tendrá 12 Contratos y un Borrador con seis
  Titulares proveedores y distintos tipos de bienes, y seguirá el mismo patrón
  de acceso que las demás Organizaciones: Administrador y Emisor, Emisor y
  Revisor. Sus capacidades
  adicionales habilitadas serán:

  | Organización | Capacidades adicionales habilitadas |
  |---|---|
  | Transportes | Ninguna |
  | Aviacion Norte · Taxi aéreo y carga | Revisión por AI y Custodia activa |
  | Aviacion Norte · Ambulancia aérea | Custodia activa |
  | Gasolinera | Custodia activa |
  | Euzen | Revisión por AI y Custodia activa |
  | Retto | Ninguna |
- Todas estas cuentas usarán la misma contraseña pública e intencional del demo
  sintético, `FidesDemo123!`, documentada en `README.md` y `.env.example` para que
  el primer arranque sea reproducible. No se tratará como secreto ni se
  reutilizará fuera de este entorno. Contraseñas reales, secretos TOTP y
  credenciales de proveedores nunca se documentarán o versionarán. El entorno
  no enviará mensajes a esos correos.
- Ninguna cuenta exigirá segundo factor en el POC-Demo local: correo y
  contraseña bastan para las 19. ADR-0041 reserva la autenticación reforzada
  para la Etapa 3 y admite una identidad de demostración mientras el entorno
  sólo tenga datos sintéticos, así que la siembra no fija ningún secreto TOTP.
  La capacidad permanece implementada: una cuenta global puede darse de alta
  desde `/plataforma/cuenta`, con su código QR, y desde ese momento su acceso
  vuelve a exigir el código de seis dígitos.
- El producto local no sustituirá funciones por simulaciones visuales; sólo las
  integraciones externas podrán usar dobles locales controlados para evitar
  contactar personas o proveedores reales.
- La Etapa 1 es el POC-Demo funcional, no una preparación incompleta para otro
  producto de demostración.
- La Etapa 2 hospedará el mismo POC-Demo como un entorno remoto sintético separado;
  no reutilizará la contraseña pública de esta instalación local ni ningún
  secreto que se dé de alta en ella.
- Fuera de los identificadores de acceso expresamente proporcionados, ninguna
  etapa local o de demo autoriza Organizaciones, contratos, datos reutilizables
  de partes,
  identidades contractuales o evidencias reales.
