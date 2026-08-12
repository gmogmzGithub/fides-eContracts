---
status: accepted
---

# El acceso interno será individual y por invitación

La plataforma no tendrá registro público. El Administrador inicial de una Organización capturará su nombre completo, utilizará el correo que elija y establecerá su propia contraseña. Una Cuenta individual podrá tener membresías en varias Organizaciones con el mismo nombre, correo y contraseña; al entrar, la persona elegirá la Organización cuando pertenezca a más de una. Los roles, autorizaciones, Asiento e historial permanecerán separados por membresía y no se mezclarán datos entre Organizaciones. Cada Organización admitirá como máximo diez membresías activas al mismo tiempo, incluido su Administrador principal vigente. Un Administrador podrá preparar y enviar tantas invitaciones como quiera, capturando únicamente correo y uno o varios de los roles predefinidos `Administrador`, `Emisor` y `Revisor`, y decidir cuándo ejecutar `Enviar invitación`. Cada rol será un paquete fijo de permisos; los roles podrán acumularse, pero no existirán permisos individuales configurables o roles personalizados. Las invitaciones pendientes no reservarán un Asiento: los primeros destinatarios que completen la activación mientras exista capacidad obtendrán los lugares disponibles. Cada persona activada tendrá una Cuenta individual de Miembro y no se permitirán credenciales compartidas.

El Administrador inicial comenzará como el único `Administrador principal`, condición que lo protege contra `Eliminar acceso` y exige que conserve el rol `Administrador`. Podrá transferir expresamente esa condición a otro Miembro activo que ya tenga el rol `Administrador`. Al completarse la transferencia sólo el receptor quedará protegido; el anterior conservará sus roles actuales, pero podrá modificarse o eliminarse como cualquier otro acceso.

Para sustituir el correo del Administrador principal deberán crearse y activarse una invitación nueva con el correo correcto y el rol `Administrador`, transferirse a ese acceso la condición de Administrador principal y eliminarse después el acceso anterior. El correo original nunca se editará o migrará.

El límite de diez Asientos seguirá siendo estricto durante ese reemplazo. Si la Organización está en `10 de 10`, deberá eliminar primero otro acceso para liberar un lugar; la plataforma no concederá un Asiento temporal número once.

Registrar un correo no enviará automáticamente la invitación. Cuando el Administrador lo decida, la plataforma enviará a esa dirección un enlace individual, temporal, de un solo uso y vigente durante 30 días. Una persona nueva deberá abrirlo, capturar su nombre completo y establecer su propia contraseña. Si ese correo ya identifica una Cuenta individual, la persona iniciará sesión con sus credenciales existentes, reutilizará el nombre de su cuenta y aceptará la nueva membresía sin crear otra contraseña. El Administrador no podrá definir o consultar la contraseña de otra persona. Si la invitación vence, `Reenviar invitación` generará un enlace nuevo con otros 30 días de vigencia e invalidará el anterior.

Mientras la invitación permanezca pendiente, un Administrador podrá cambiar sus roles sin reenviar el correo o sustituir el enlace. La activación consultará el registro vigente en servidor y asignará los roles que tenga la invitación en ese momento, no una copia fijada al enviarla.

Un Administrador podrá ejecutar `Revocar invitación` mientras permanezca pendiente. La revocación invalidará el enlace inmediatamente, no ocupará un Asiento y conservará tanto el registro como el evento de auditoría.

Después de una revocación, el Administrador podrá ejecutar `Enviar nueva invitación` para el mismo correo. La plataforma creará un registro y enlace nuevos con 30 días de vigencia, sin borrar o reutilizar las invitaciones anteriores.

Dentro de una Organización sólo podrá existir una invitación pendiente por correo y no podrá crearse otra si ese correo ya corresponde a un Miembro activo. Un intento repetido abrirá la invitación existente con `Editar roles` y `Reenviar invitación`, o mostrará al Miembro existente si ya está activo.

Si el destinatario intenta activar su cuenta cuando los diez Asientos ya están ocupados, la plataforma mostrará `No hay accesos disponibles en este momento. Contacta al Administrador de tu Organización.` El intento no consumirá la invitación: podrá reintentarse mientras el enlace continúe vigente si posteriormente se libera un lugar.

En el alcance actual, la Cuenta individual utilizará correo y contraseña sin exigir un segundo factor. La Autenticación reforzada de Miembro se conserva como mejora para una versión posterior y no será condición para la primera operación con datos reales. Antes de implementarla deberán decidirse su método, recuperación, obligatoriedad y alcance para `Administrador`, `Emisor` y `Revisor`.

La pantalla de acceso será única y no preguntará rol u Organización. En
escritorio combinará una fotografía vertical con el formulario; en móvil
mostrará directamente `Correo`, `Contraseña`, `Olvidé mi contraseña` e `Iniciar
sesión`. Sólo las cuentas globales de Administrador de plataforma
continuarán a un segundo paso TOTP, y únicamente cuando estén dadas de alta:
el POC-Demo local no siembra secretos (ADR-0082).

`Olvidé mi contraseña` enviará al correo de la Cuenta individual un enlace de un solo uso vigente durante una hora. La persona establecerá una contraseña nueva sin intervención de un Administrador de Organización; el cambio se aplicará a su identidad para todas sus Organizaciones y no modificará membresías, roles o historial.

Cada persona podrá corregir su nombre completo desde `Mi perfil`. El nombre nuevo se utilizará en acciones futuras; cada Contrato y evento anterior conservará la copia del nombre vigente cuando la acción ocurrió.

El correo de una Cuenta individual o Invitación de Miembro nunca podrá editarse, incluso mientras la invitación esté `Preparada`. Si una invitación contiene un correo equivocado, sólo un Administrador podrá ejecutar `Eliminar`: borrará el registro sin conservar historial, invalidará cualquier enlace ya enviado y exigirá crear otro con la dirección correcta. Esta corrección será distinta de `Revocar invitación`, que se usará cuando el correo era correcto pero se decide cancelar la incorporación y conservará el registro histórico.

El Administrador gestionará invitaciones y membresías desde una sola pantalla `Accesos`. Cada correo mostrará sus roles y uno de cinco estados operativos: `Preparada`, `Invitada`, `Vencida`, `Revocada` o `Activa`. No existirá `Desactivada`: sobre cualquier Miembro que no sea el Administrador principal, `Eliminar acceso` se ejecutará inmediatamente, sin advertencia, confirmación, motivo o paso adicional; revocará sesiones, liberará el Asiento y eliminará la membresía y su historial de administración de acceso, sin conservar un registro reactivable. La pantalla mostrará permanentemente `X de 10 accesos activos`; sólo las membresías `Activa` contarán y, al llegar a `10 de 10`, se avisará que las nuevas activaciones deberán esperar a que se libere un Asiento. Las acciones disponibles dependerán del estado.

## Considered Options

- Permitir registro público y asignar el rol después.
- Utilizar una cuenta compartida para una Organización.
- Usar cuentas individuales por invitación y dejar el segundo factor para una versión posterior.

## Consequences

- Sólo un Administrador podrá preparar y enviar invitaciones, eliminar accesos de Miembros o cambiar sus Roles de Miembro.
- Una sola pantalla `Accesos` reunirá invitaciones y membresías con correo, roles y estado visible.
- Los estados visibles serán `Preparada`, `Invitada`, `Vencida`, `Revocada` y `Activa`; no existirá `Desactivada`.
- Los únicos roles asignables serán `Administrador`, `Emisor` y `Revisor`; podrán acumularse en una misma persona y cada uno concederá su paquete fijo de permisos.
- La Organización no podrá crear roles personalizados ni activar o desactivar permisos individuales dentro de un rol.
- Los roles de una invitación pendiente podrán cambiarse sin reenviar el enlace; la activación asignará los roles vigentes en ese instante.
- El correo será único entre invitaciones pendientes y Miembros activos dentro de cada Organización; el flujo reutilizará el registro existente en vez de crear duplicados.
- Cada Organización deberá conservar al menos un Miembro activo con el rol `Administrador`.
- La plataforma bloqueará cualquier cambio de rol o eliminación que deje a la Organización sin un Administrador activo.
- Cada Organización tendrá exactamente un `Administrador principal`, que deberá estar activo y conservar el rol `Administrador`.
- Sólo el Administrador principal vigente podrá transferir esa condición y únicamente a otro Miembro activo que ya tenga rol `Administrador`.
- La transferencia no eliminará ni cambiará los demás roles del anterior; sólo permitirá que después sea modificado o eliminado como cualquier otro acceso.
- Sustituir el correo del Administrador principal exigirá crear y activar un acceso nuevo con rol `Administrador`, transferirle la condición y eliminar el acceso anterior.
- El reemplazo no permitirá exceder temporalmente los diez Asientos; en `10 de 10` deberá liberarse primero otro lugar.
- Un Administrador podrá cambiar los roles de una Cuenta individual después de su activación.
- El cambio de roles surtirá efecto inmediatamente en las autorizaciones posteriores, quedará auditado y no alterará la identidad, autoría, acciones o roles históricos del Miembro.
- La invitación tendrá destinatario, propósito, 30 días de vigencia y uso único.
- Reenviar una invitación generará un enlace nuevo con 30 días de vigencia e invalidará cualquier enlace anterior de ese envío.
- Revocar una invitación pendiente invalidará su enlace inmediatamente y quedará auditado sin borrar el registro.
- Después de una revocación podrá enviarse una invitación nueva al mismo correo; será un registro distinto y conservará el historial de todos los envíos anteriores.
- El envío del correo será una acción explícita del Administrador y quedará separado de la simple captura de la dirección.
- La plataforma enviará Invitaciones de Miembro, aunque no distribuya Enlaces contractuales a Firmantes.
- Cuando corresponda crear una Cuenta individual, el colaborador establecerá su contraseña desde el enlace; ninguna contraseña será visible o elegida por el Administrador para otra persona.
- El Administrador que invita capturará sólo correo y roles; la persona nueva proporcionará su nombre completo durante la primera activación y una Cuenta existente reutilizará su nombre.
- Sólo la propia persona podrá corregir su nombre desde `Mi perfil`; el cambio no reescribirá nombres históricos conservados en Contratos o eventos anteriores.
- El correo de una Cuenta individual o invitación nunca se modificará en el mismo registro. Sólo un Administrador podrá corregirlo eliminando el registro y creando otro con la dirección nueva.
- `Eliminar` una invitación con correo equivocado borrará su registro e invalidará su enlace sin conservar historial; `Revocar invitación` conservará el historial de una cancelación deliberada.
- Sólo una persona sin Cuenta individual establecerá una contraseña desde la invitación; una persona existente iniciará sesión y aceptará la nueva membresía con sus credenciales actuales.
- La cantidad de invitaciones preparadas, enviadas o pendientes no estará limitada por los diez Asientos.
- La activación asignará el Asiento por orden efectivo de finalización y deberá comprobar el límite de forma atómica para no exceder diez cuentas activas ante intentos simultáneos.
- Un intento rechazado por falta de capacidad no activará la cuenta, no concederá acceso y no consumirá la invitación.
- Una cuenta no podrá pertenecer simultáneamente a varias personas ni usarse como buzón operativo compartido.
- Una Cuenta individual podrá pertenecer a varias Organizaciones; cada membresía tendrá roles y autorización propios y ocupará un Asiento independiente en su Organización.
- Una eliminación de acceso o cambio de roles dentro de una Organización no modificará las membresías de esa Cuenta en otras Organizaciones.
- Invitación, activación, autenticación relevante, recuperación, alta y cambios de rol quedarán auditados mientras exista el Acceso de Organización; `Eliminar acceso` borrará ese historial administrativo para el Miembro eliminado.
- La Recuperación de Cuenta será autónoma, utilizará un enlace de un solo uso válido por una hora y nunca revelará o permitirá elegir la contraseña a un Administrador de Organización.
- `Eliminar acceso` sobre un Miembro que no sea el Administrador principal revocará inmediatamente sus sesiones y acceso a esa Organización, liberará el Asiento y eliminará la membresía sin opción de reactivación.
- `Eliminar acceso` no mostrará advertencia, solicitará confirmación o motivo ni añadirá un paso intermedio.
- El mismo correo podrá recibir después una Invitación de Miembro nueva, pero creará otro Acceso de Organización con roles nuevos y sin restaurar o vincular información de la membresía eliminada.
- Una vez liberado el Asiento, cualquier Invitación de Miembro pendiente y vigente podrá competir por el lugar conforme al orden efectivo de activación.
- Los Contratos, evidencias y eventos operativos realizados antes de `Eliminar acceso` seguirán perteneciendo a la Organización y podrán conservar únicamente el nombre del antiguo Miembro como referencia histórica; se eliminarán correo, roles, credenciales, identificadores de cuenta y cualquier relación técnica con el acceso eliminado.
- La eliminación del Miembro creador no afectará el expediente, pero terminará sus notificaciones y dejará al Administrador como responsable de cualquier cancelación todavía permitida.
- El límite será de diez Cuentas individuales activas simultáneamente por Organización, incluido el Administrador principal vigente y sin importar cuántos roles acumule cada persona.
- La Demo sintética podrá utilizar identidades de prueba, pero no habilitará registro público.
- El segundo factor de las Cuentas individuales de Miembro no forma parte del alcance actual ni bloquea la primera operación con datos reales; esto no elimina el TOTP separado de los Administradores de plataforma.
- La Autenticación reforzada de Miembro queda registrada como mejora futura; su método, recuperación, obligatoriedad y despliegue requieren una decisión posterior.
- No existirán selector de rol, selector de Organización, acceso social, SSO o magic link en la pantalla de inicio de sesión.
- La marca visible de la plataforma será `Fides`.
- Una futura alta autoservicio de Organizaciones requerirá una decisión independiente y no eliminará las cuentas individuales.
