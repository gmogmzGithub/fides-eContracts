---
status: accepted
---

# La custodia fría será base y la Custodia activa tendrá un nivel anual

Fides incluirá la Custodia fría base del Núcleo contractual conservable
para toda Organización de la Etapa 3. La Organización podrá contratar Custodia
activa como capacidad adicional para obtener acceso inmediato, descarga
individual y exportación masiva desde el portal mientras sus archivos no hayan
cumplido un año, además de recuperación histórica con un plazo comercial menor.
El pago adicional compra disponibilidad y operación, no la existencia del plazo
de conservación.

Custodia activa será una de las dos únicas capacidades adicionales de la oferta inicial; la otra será Revisión por AI. INE y video permanecerán como configuraciones del Servicio contractual base y no como adicionales comerciales.

Con Custodia activa, todos los objetos canónicos conservados de cada expediente se trasladarán a `Archivo Muerto` al cumplir un año desde su Fecha de cierre contractual, es decir, desde que el Contrato entra por primera vez a `Aceptado`, `Vencido` o `Cancelado`. Los archivos históricos seguirán cubiertos por la capacidad, pero requerirán preparación desde S3 Glacier Deep Archive mediante `Standard`; Fides asumirá frente a la Organización un compromiso máximo de 48 horas para tener disponible el archivo. Ese plazo es un compromiso del Proveedor y no una garantía de AWS.

Sin Custodia activa, los objetos canónicos se archivarán directamente en el bucket privado `Archivo Muerto` mediante S3 Glacier Deep Archive, sin una ventana canónica previa en S3 Standard. Su recuperación utilizará `Bulk` para minimizar costo y Fides comunicará un plazo operativo de hasta siete días hábiles. No habrá botones, formularios, niveles, tickets o trabajos de restauración solicitables dentro del portal: la Organización pedirá y validará la recuperación fuera de la plataforma mediante el Canal externo de custodia. Cuando el trabajo termine, el Archivo recuperado de Custodia fría base aparecerá dentro del apartado ordinario de archivos del expediente, junto con los demás contratos, sin enviarse como adjunto o enlace externo. El Administrador de plataforma operará internamente el inventario, recuperación y verificación desde la Vista interna de Archivo Muerto.

El Archivo recuperado de Custodia fría base permanecerá disponible durante tres días completos desde que termine la recuperación. Después expirará automáticamente: el contrato y sus metadatos seguirán visibles, el contenido volverá a `Resguardado` y una necesidad posterior exigirá otra solicitud por el Canal externo de custodia. El Paquete contractual frío permanecerá canónico en `Archivo Muerto` durante todo el ciclo.

Después de publicar el archivo, el Proveedor responderá manualmente por el mismo Canal externo de custodia `El archivo solicitado ya está disponible en su expediente durante tres días.` No adjuntará el archivo o un enlace y la aplicación no enviará o registrará esa comunicación.

Cuando una solicitud comprenda varios contratos, cada recuperación operará y se publicará independientemente en su expediente. Cada archivo iniciará sus propios tres días al quedar listo; no esperará a los demás y una falla no bloqueará las recuperaciones correctas. El Proveedor confirmará manualmente cuáles archivos ya están disponibles, sin convertirlos en una exportación masiva.

Cuando una Organización contrate Custodia activa después de acumular historial frío, la Activación de Custodia activa enumerará sus Contratos y Expedientes archivados no eliminados. Los paquetes que todavía no cumplan un año se recuperarán mediante `Standard`, verificarán y trasladarán al bucket canónico de acceso inmediato. Los que ya hayan cumplido un año permanecerán en `Archivo Muerto`, pero serán recuperables bajo el compromiso de 48 horas. Los nuevos Contratos se dirigirán al almacenamiento activo y también pasarán a `Archivo Muerto` al cumplir un año. Los asuntos `Eliminados` permanecerán en `Archivo Muerto`.

La Clasificación operativa es independiente de la ubicación. Por ello, `Eliminar` un asunto sin Custodia activa sólo cambia su clasificación porque los objetos ya están en `Archivo Muerto`; para un asunto con Custodia activa y contenido todavía inmediato, cambia inmediatamente su clasificación y corta su consulta documental, descarga y exportación dentro del portal mientras encola el traslado verificado hacia `Archivo Muerto`.

## Consequences

- “Sin Custodia activa” no significa “sin custodia” ni autoriza una copia oculta fuera del inventario.
- `Archivo Muerto` será un bucket compartido y aislado lógicamente por Organización, no un bucket por cliente; cada objeto conservará inventario, clave opaca, política, hash y pertenencia.
- La modalidad de custodia determinará disponibilidad y ubicación física; la Clasificación operativa determinará únicamente en qué sección aparece el asunto.
- `Pendiente de aceptación` y `A revisión` no iniciarán ni cumplirán el umbral anual. `Archivar`, `Restaurar`, `Eliminar` después de un cierre o cambiar la modalidad de custodia no reiniciarán la Fecha de cierre contractual.
- Cualquier objeto canónico creado después de que el expediente cumpla el año se escribirá directamente en `Archivo Muerto`; no recibirá un año adicional de almacenamiento inmediato.
- `Archivo Muerto` conservará todos los asuntos de Organizaciones sin Custodia activa, los asuntos `Eliminados` de Organizaciones con Custodia activa y todos los objetos canónicos con Custodia activa al cumplir un año.
- Custodia activa incluirá descarga individual de archivos históricos y Capacidad de exportación masiva exclusivas del Administrador de la Organización. `Descargar ZIP` sobre un paquete histórico iniciará automáticamente su Preparación de archivo histórico mediante `Standard`, sin formulario, motivo, confirmación o botón adicional. `Exportar` iniciará de la misma manera una Preparación de exportación masiva para todos los paquetes fríos del conjunto, reutilizando copias o recuperaciones vigentes y sin exigir preparación individual. Sin Custodia activa no existirá solicitud autoservicio o exportación masiva dentro del portal; después de una solicitud externa validada sí aparecerá el archivo recuperado en su expediente ordinario.
- La Preparación de exportación masiva mostrará `Estamos preparando tu exportación. Estará disponible en un máximo de 48 horas.` y enviará correo únicamente al Administrador solicitante cuando todo el lote autorizado esté listo.
- Una falla de cualquier paquete impedirá generar o entregar el lote completo. La plataforma mostrará `No se pudo completar`, avisará sólo al Administrador solicitante y ofrecerá `Reintentar exportación`; esa acción manual reintentará únicamente los paquetes fallidos y reutilizará los preparados que sigan vigentes.
- El Lote temporal de exportación será un único ZIP contenedor con un ZIP completo e independiente por cada Contrato seleccionado, identificado por su Referencia contractual. No agregará CSV, índice, manifiesto adicional del lote o componentes contractuales sueltos. Los Paquetes contractuales fríos se incorporarán byte por byte, sin descomprimirlos o modificarlos; para contratos todavía en almacenamiento de acceso inmediato se generará un ZIP individual equivalente con el contenido autorizado. El lote durará tres días completos desde que termine de generarse y después se eliminará automáticamente. Su expiración no afectará los objetos canónicos o las copias históricas preparadas; una exportación posterior deberá solicitarse nuevamente.
- El lote sólo podrá descargarlo el Administrador que inició esa exportación y que conserve sus permisos vigentes. Otro Administrador podrá generar un lote propio, pero no utilizar el ajeno.
- Mientras una Preparación de archivo histórico esté en curso, la Organización verá `Estamos preparando tu archivo. Estará disponible en un máximo de 48 horas.` Las acciones repetidas sobre el mismo paquete reutilizarán el trabajo existente y no crearán recuperaciones simultáneas.
- Al terminar, sólo el Administrador que inició la preparación recibirá correo. El expediente mostrará `Descargar ZIP` a cualquier Miembro activo con rol `Administrador`, pero cada acceso revalidará la Custodia activa, membresía y rol vigentes; ni el correo ni haber iniciado el trabajo conservarán una autorización revocada. Emisores y Revisores sólo verán el registro y su estado de disponibilidad, sin acciones sobre el ZIP.
- La Copia temporal de archivo histórico será el ZIP exacto y durará tres días completos desde que termine la recuperación. No se descomprimirá, previsualizará, reconstruirá, convertirá en PDF o entregará por componentes. Después expirará automáticamente y otra descarga iniciará una preparación nueva.
- Si una Preparación de archivo histórico falla, mostrará `No se pudo preparar el archivo`, enviará correo sólo al Administrador que inició ese intento y no tendrá reintento automático. Cualquier Miembro activo con rol `Administrador` podrá ejecutar `Reintentar`, con actor y resultado auditados separadamente.
- PostgreSQL conservará clase de almacenamiento, estado de restauración, política, hash y comprobantes de recuperación de cada objeto.
- Desde la Vista interna de Archivo Muerto, sólo el Administrador de plataforma podrá ejecutar `Recuperar contenido`; el resultado será temporal e interno y no reactivará capacidades para la Organización.
- Cada ejecución recuperará un solo Paquete contractual frío. La recuperación masiva o de una Organización completa queda fuera del alcance inicial como evolución futura por definir.
- Esa restricción aplica a la acción manual `Recuperar contenido`. La Activación de Custodia activa es un proceso automatizado distinto que puede recorrer, paquete por paquete, el historial no eliminado que todavía no cumple un año.
- Las recuperaciones de una Organización con Custodia activa usarán S3 Glacier Deep Archive `Standard` y sostendrán un compromiso comercial máximo de 48 horas. Sin Custodia activa usarán `Bulk` y un plazo operativo de hasta siete días hábiles.
- Las 48 horas serán naturales y consecutivas desde que la plataforma acepte la Preparación de archivo histórico o la Preparación de exportación masiva; incluirán noches, fines de semana y días festivos y no se presentarán como garantía de AWS.
- La Copia temporal de recuperación interna permanecerá disponible sólo tres días completos desde que termine la recuperación; después expirará automáticamente y podrá solicitarse de nuevo.
- La Vista interna mostrará `Archivado`, `Recuperación en curso`, `Disponible hasta <fecha>` o `Recuperación fallida` y enviará correo sólo al Administrador de plataforma cuando un trabajo quede disponible o falle.
- Una falla no se reintentará automáticamente. Sólo el Administrador de plataforma podrá ejecutar manualmente `Reintentar recuperación`, que iniciará otra operación con el nivel aplicable a la modalidad de custodia.
- `Recuperación en curso` y `Disponible hasta <fecha>` bloquearán otra solicitud para el mismo paquete. El segundo estado mostrará `Ver contenido`; al expirar volverá a `Archivado` y habilitará otra vez `Recuperar contenido`.
- Una Retención jurídica prevalecerá sobre transiciones y eliminaciones.
- El Canal externo de custodia, procedimiento y cualquier costo deberán comunicarse antes de contratar, sin convertir la solicitud en un flujo de la aplicación. Sin Custodia activa, el plazo comunicado será de hasta siete días hábiles y el resultado se colocará dentro del expediente ordinario, no se enviará por ese canal.
- Sólo un Miembro activo con rol `Administrador` podrá iniciar la solicitud externa; no tendrá que ser el Administrador principal. Después de publicar el Paquete contractual frío completo, únicamente un Miembro activo con ese rol podrá ejecutar `Descargar ZIP`, aunque no sea quien lo solicitó. Emisores y Revisores que normalmente consulten el contrato sólo verán el registro y `Disponible`, sin acciones sobre el ZIP.
- La recuperación no descomprimirá, previsualizará, reconstruirá, convertirá en PDF o entregará componentes selectivos dentro del portal. El ZIP completo conservado en `Archivo Muerto` será el artefacto entregado.
- El Administrador de plataforma reconocerá manualmente al solicitante y el alcance usando el contexto disponible en el mismo canal. No existirá confirmación obligatoria desde el correo registrado, OTP, INE, contraseña, documentos o método fijo; si la información es suficiente, podrá aceptar la solicitud.
- El Plazo de siete días hábiles comenzará cuando el Proveedor confirme externamente que validó la identidad y autorización del solicitante, identificó los contratos exactos y aceptó la solicitud completa. Se contará de lunes a viernes excluyendo días festivos oficiales en México; no comenzará con un mensaje incompleto y no se modelará dentro de la aplicación.
- La Copia de revisión y la Copia contractual aceptada se generan exclusivamente
  bajo demanda conforme a ADR-0059; nunca podrán confundirse con la custodia
  canónica.
- Los objetos pequeños se agruparán sólo cuando exista un paquete contractual inmutable por expediente con manifiesto y hash propios; no se mezclarán Organizaciones.
- Una modalidad futura verdaderamente sin custodia requerirá entrega verificable a un destino controlado por la Organización y eliminación posterior de las copias de Fides.
