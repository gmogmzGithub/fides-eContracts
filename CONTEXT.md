# Lenguaje del dominio

Este archivo contiene únicamente el vocabulario compartido de Fides.
Las reglas de producto y arquitectura viven en los ADR y en
[`SYSTEM-ARCHITECTURE.md`](docs/architecture/SYSTEM-ARCHITECTURE.md).

## Producto y actores

**Fides**: Plataforma contractual digital multiindustria que opera el Proveedor. Es el único nombre de la plataforma y se usa en producto, infraestructura, base de datos, contenedores y documentación; _Avoid_: Contratos App, AeroContrato, plataforma sectorial, generador libre de contratos

**Plataforma contractual administrada**: Servicio en el que el Proveedor entrega a cada Organización un portal listo para emitir y conservar sus contratos aprobados; _Avoid_: marketplace de plantillas, editor jurídico autoservicio, despacho jurídico dentro de la aplicación

**Proveedor**: Empresa que opera Fides y presta a las Organizaciones el servicio contractual, las capacidades adicionales y la custodia acordada; _Avoid_: Organización, Firmante, proveedor de nube

**Organización**: Empresa cliente cuyo personal autorizado crea, revisa, organiza y consulta sus propios asuntos contractuales; _Avoid_: tenant visible, industria específica, Firmante

**Administrador de plataforma**: Cuenta global del Proveedor con acceso transversal para operar y dar soporte a la plataforma; _Avoid_: Administrador de Organización, Revisor, administrador de AWS

**Publicador de contenido jurídico**: Capacidad exclusiva de Publicador de plataforma para ingresar, versionar y publicar en la plataforma el contenido que Responsable juridico le entrega; _Avoid_: editor de la Organización, aprobación automática, revisión jurídica de la aplicación

**Cuenta individual**: Identidad personal que inicia sesión con sus propias credenciales y puede participar en una o más Organizaciones; _Avoid_: cuenta compartida, Organización, Firmante sin cuenta

**Acceso de Organización**: Relación entre una Cuenta individual y una Organización, con uno o más roles acumulables; _Avoid_: identidad global, invitación, permiso aislado

**Administrador principal**: Único Administrador protegido de una Organización, cuya condición puede transferirse a otro Administrador activo; _Avoid_: Administrador de plataforma, propietario de todos los datos personales

**Administrador**: Rol de Organización que administra accesos, configuración, asuntos y operaciones reservadas de su Organización; _Avoid_: Administrador principal obligatorio, Administrador de plataforma

**Emisor**: Rol de Organización que prepara y genera Contratos para esa Organización; _Avoid_: abogado que redacta la plantilla, Firmante, Revisor

**Revisor**: Rol de Organización que decide si un proceso sometido a revisión puede concluir con su evidencia actual o debe repetirse; _Avoid_: Responsable juridico, equipo juridico, validador jurídico, agente AI

**Asiento**: Lugar ocupado por un Acceso de Organización activo dentro del límite contratado o configurado; _Avoid_: invitación pendiente, Cuenta individual global

### Mapa rápido de personas y entidades

| Persona o entidad en el ejemplo | Término recomendado | Qué significa |
|---|---|---|
| Publicador de plataforma | Administrador de plataforma | Administra Fides y sus Organizaciones |
| Retto | Organización | Cliente directo de Fides cuyo personal crea y controla sus Contratos |
| Olea Drinks (Demo) | Titular contractual | Empresa a cuyo nombre se emite el Contrato de suministro |
| Persona que acepta | Firmante | Puede ser el propio Titular, si es persona física, o una persona que actúa por una persona moral |
| Personas transportadas en un Contrato de Aviacion Norte | Pasajeros, como dato del Contrato | No son por ese solo hecho Titulares, Firmantes ni usuarios de Fides |

## Contenido jurídico administrado

**Contrato-plantilla**: Contrato aprobado para una Organización, conservado como texto Markdown con Campos contractuales programados y utilizado para formar nuevos Contratos; _Avoid_: plantilla universal editable, Contrato emitido, archivo local usado en tiempo de ejecución

**Markdown contractual**: Texto fuente de una publicación de Contrato-plantilla, sin lógica ejecutable ni edición por la Organización; _Avoid_: PDF canónico, documento Word operativo, código arbitrario

**Campo contractual programado**: Dato que la interfaz solicita y valida porque Publicador de plataforma lo implementó para un Contrato-plantilla; _Avoid_: marcador libre, cláusula editable, campo creado automáticamente

**Publicación de plantilla**: Registro inmutable del Markdown, etiqueta de versión y configuración asociada que el Publicador de contenido jurídico pone disponible; _Avoid_: sobrescritura, Contrato emitido, aprobación de la Organización

**Versión vigente de plantilla**: Única Publicación de plantilla utilizada para crear Contratos nuevos; _Avoid_: versión elegida por el Emisor, cambio retroactivo, versión del Contrato emitido

**Etiqueta manual de versión**: Identificador escrito por el Publicador de contenido jurídico, iniciado en `1.0` y sin incremento automático; _Avoid_: contador interno visible, semver validado por la aplicación

**Aviso de Privacidad publicado**: Texto versionado e inmutable que se pone a disposición del Firmante antes de recopilar evidencia o aceptación; _Avoid_: texto generado por la plataforma, documento sustituible retroactivamente, aprobación jurídica automatizada, aviso paralelo

**Configuración predeterminada de emisión**: Combinación inicial de vigencia, evidencia y revisión propuesta al crear un Contrato, que el Emisor puede personalizar antes de emitir; _Avoid_: configuración obligatoria, decisión del Firmante, regla jurídica inferida

## Partes y reutilización

**Datos reutilizables de partes**: Registros internos de personas físicas y morales que una Organización conserva para preparar Contratos sin volver a capturar todo; _Avoid_: módulo visible llamado Contrapartes, CRM general, padrón compartido entre Organizaciones, fuente histórica de un Contrato ya emitido

**Titular contractual**: Persona física o moral que adquiere derechos u obligaciones en el Contrato; _Avoid_: usuario de la plataforma, Firmante necesariamente, contacto informal

**Firmante**: Persona física que accede al Contrato mediante su Enlace contractual y manifiesta su aceptación; _Avoid_: Cuenta individual, Organización, persona moral como actor técnico

**Instantánea contractual de parte**: Copia inmutable de los datos de las partes utilizados al emitir un Contrato; _Avoid_: registro reutilizable vigente, edición retroactiva

**Recientes**: Superficie de trabajo que permite crear un Borrador nuevo a partir de los datos operativos compatibles de un Contrato anterior; _Avoid_: directorio de personas, copia del estado o evidencia, reactivación del Contrato anterior

**Favorito**: Marca personal que coloca un Contrato reutilizable antes que los demás en `Recientes`; _Avoid_: clasificación compartida de la Organización, Carpeta operativa, cambio del Contrato

## Creación y aceptación

**Borrador contractual**: Captura editable anterior a la emisión, todavía sin referencia ni enlace; _Avoid_: Contrato emitido, Orden, aprobación intermedia

**Contrato emitido**: Resultado inmutable formado con una publicación exacta de plantilla, campos, partes y configuración de emisión; _Avoid_: borrador editable, PDF, secuencia de versiones del mismo contrato

**Expediente contractual**: Conjunto de Contrato, eventos, intentos, decisiones y evidencias que pertenecen a un mismo asunto de la Organización; _Avoid_: carpeta operativa, PDF aislado, Orden

**Referencia contractual**: Identificador humano de un Contrato emitido que facilita su consulta sin conceder acceso; _Avoid_: token, enlace, versión de plantilla

**Enlace contractual**: URL opaca y temporal que permite al Firmante completar el recorrido sin crear una cuenta; _Avoid_: prueba de identidad, canal de distribución, referencia pública

**Recorrido del Firmante**: Experiencia móvil formada por las etapas `Contrato`, `Evidencia` y `Aceptar`, omitiendo la evidencia que no aplique; _Avoid_: login, wizard comercial, pasos vacíos

**Contrato recorrido**: Evento técnico que indica que la interfaz llegó al final del texto contractual antes de continuar; _Avoid_: contrato leído, comprendido o aceptado

**Leyenda de aceptación**: Declaración aprobada que acompaña la casilla y la acción inequívoca `Aceptar contrato`; _Avoid_: garantía de validez, consentimiento de privacidad implícito

**Intento de aceptación**: Ejecución completa del recorrido del Firmante con su propio enlace, eventos y evidencia; _Avoid_: Contrato nuevo, versión del Contrato, reactivación del mismo enlace

**Contrato aceptado**: Contrato cuyo proceso terminó conforme a la Política de revisión efectiva; _Avoid_: enlace abierto, evidencia enviada a revisión, pago confirmado

**Repetir proceso**: Decisión que cierra el Intento actual y crea otro sobre el mismo Contrato inmutable para volver a capturar aceptación y evidencia; _Avoid_: rechazo contractual, edición del Contrato, Contrato nuevo

**Contrato vencido**: Contrato cuyo enlace terminó sin completar el proceso y que requiere crear otro Contrato si la Organización desea intentarlo de nuevo; _Avoid_: enlace renovado, Contrato cancelado, nueva versión del mismo Contrato

**Contrato cancelado**: Contrato abierto que la Organización cierra e invalida antes de su conclusión; _Avoid_: Contrato vencido, rechazo del Firmante, eliminación física

## Evidencia y revisión

**Perfil de evidencia**: Composición efectiva de aceptación electrónica obligatoria y las opciones universales de video e INE que el Emisor selecciona para un Contrato; _Avoid_: paquete universal obligatorio, decisión del Firmante, validación automática implícita

**Video guiado**: Grabación del Firmante pronunciando la declaración breve aprobada para el Contrato; _Avoid_: videollamada, prueba automática de identidad, transcripción obligatoria

**Declaración audiovisual**: Resumen breve aprobado y formado con datos del Contrato que permanece visible durante la cuenta regresiva y la grabación del Video guiado; _Avoid_: contrato completo, texto libre del Emisor, transcripción de lo pronunciado

**Captura de INE**: Evidencia visual del documento solicitada cuando el Perfil de evidencia la incluye; _Avoid_: verificación oficial automática, garantía de autenticidad, requisito universal

**Política de revisión**: Configuración efectiva `Sin revisión`, `Revisión manual` o `Revisión por AI` que determina cómo concluye el proceso; _Avoid_: revisión jurídica, rechazo del Contrato, política elegida después del intento

**Revisión manual**: Evaluación de la evidencia por una persona con rol Revisor de la Organización; _Avoid_: revisión de Responsable juridico o equipo juridico, cambio del Contrato, validación jurídica

**Revisión por AI**: Capacidad adicional que analiza la evidencia, produce un reporte y recomienda si hace falta atención humana; _Avoid_: decisión final automática, aprobación jurídica, transcripción infalible

**Reporte AI**: Resultado informativo del análisis automatizado disponible para los Revisores; _Avoid_: resolución contractual, dictamen legal, sustituto de evidencia

**A revisión**: Estado en el que el proceso espera una decisión de un Revisor; _Avoid_: rechazado, contrato modificado, revisión jurídica

**Aceptar contrato**: Decisión del Revisor que acepta el proceso con la evidencia disponible; _Avoid_: editar evidencia, aprobación de contenido jurídico

**Omitir y aceptar**: Decisión documentada de usar `SKIP` y concluir el proceso sin exigir otra captura; _Avoid_: acción invisible, borrado de evidencia, aceptación automática

## Organización de asuntos

**Carpeta operativa**: Agrupación opcional de Expedientes contractuales creada por una Organización; _Avoid_: estado contractual, estructura de almacenamiento, custodia

**Clasificación operativa**: Ubicación de un asunto en `Contratos`, `Archivados` o `Eliminados`, independiente de su estado contractual y custodia; _Avoid_: estado contractual, borrado físico inmediato

**Archivado**: Clasificación reversible que oculta un asunto de la lista principal sin alterar el Contrato; _Avoid_: Archivo Muerto, eliminación, vencimiento

**Eliminado**: Clasificación que retira el asunto de la operación ordinaria y conserva sólo la visibilidad y metadata definidas; _Avoid_: supresión jurídica automática, periodo de restauración, Archivado

## Custodia

**Custodia fría base**: Resguardo de contratos en almacenamiento de costo mínimo para Organizaciones sin Custodia activa, cuya recuperación se coordina fuera de la plataforma; _Avoid_: restauración autoservicio, exportación masiva, eliminación por falta de pago

**Custodia activa**: Capacidad adicional de acceso inmediato para archivos recientes, exportación masiva y recuperación histórica prioritaria; _Avoid_: fundamento legal de conservación, archivo permanente caliente, condición para que el Contrato exista

**Archivo Muerto**: Almacenamiento frío común del Proveedor, organizado por metadata de Organización y Contrato, que conserva los Paquetes contractuales fríos; _Avoid_: papelera temporal, sección de restauración de la Organización, bucket público

**Paquete contractual frío**: ZIP inmutable de un Contrato con su documento y los artefactos relevantes que deban conservarse juntos; _Avoid_: CSV, paquete de varios contratos, archivos sueltos entregables

**Recuperación histórica**: Preparación temporal del Paquete contractual frío para su inspección o descarga autorizada; _Avoid_: restauración del Contrato a estado activo, envío automático por WhatsApp o correo

**Exportación masiva**: Preparación de múltiples Paquetes contractuales para una Organización con Custodia activa; _Avoid_: CSV adicional, cruce entre Organizaciones, capacidad de Custodia fría base

## Etapas y evoluciones deliberadamente posteriores

**POC-Demo**: Producto funcional completo que usa únicamente identidades y datos sintéticos; vive localmente en la Etapa 1 y podrá publicarse remotamente en la Etapa 2 sin convertirse en operación real; _Avoid_: maqueta sin lógica, Production, entorno con datos reales

**Pago integrado**: Evolución futura que conectará Mercado Pago al punto de capacidad comercial sin cambiar el dominio contractual; _Avoid_: alcance actual, pago inferido de una aceptación

**Contrato multifirmante**: Evolución futura para más de un Firmante en un mismo Contrato, todavía sin flujo definido; _Avoid_: capacidad de la primera versión, varios intentos como varios firmantes
