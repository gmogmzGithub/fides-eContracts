---
status: accepted
---

# El Firmante accederá directamente y recorrerá sólo los pasos aplicables

El Enlace contractual será el único mecanismo de acceso del Firmante. No exigirá cuenta, contraseña, selección de canal, OTP o instalación. Abrirlo mostrará el Aviso de Privacidad y el Contrato digital completo. El paso siguiente permanecerá bloqueado hasta que la interfaz alcance el final del Contrato. Después permitirá continuar por un Recorrido adaptativo del Firmante formado únicamente por los pasos efectivos de esa operación: consentimiento adicional cuando aplique, INE cuando aplique, video cuando aplique y la acción final `Aceptar contrato`.

La posesión del enlace no se describirá como identidad verificada. El Aviso de Privacidad aplicable deberá estar disponible desde el recorrido y quedar vinculado al expediente; su presentación exacta permanece sujeta a validación jurídica.

## Considered Options

- Exigir una cuenta y contraseña a cada Firmante.
- Verificar teléfono o correo mediante OTP antes de mostrar el Contrato.
- Mostrar siempre INE, video y otros pasos aunque no sean exigidos.
- Permitir continuar sin llegar al final del Contrato digital.
- Usar acceso directo por enlace y construir el recorrido desde la configuración efectiva del Contrato.

## Consequences

- El formulario de acceso no pedirá teléfono, correo, canal o código sólo para abrir el Contrato.
- Después del Aviso de Privacidad, el Contrato completo será el primer contenido contractual presentado al Firmante.
- El Front-End mostrará tres etapas visibles: `Contrato`, `Evidencia` y `Aceptar`, con una barra superior pequeña que conserve Organización, Referencia contractual y progreso.
- No mostrará login, menú del portal, promociones o contenido de la landing dentro del recorrido.
- Cada evidencia aplicable ocupará una pantalla sencilla; los pasos que no correspondan se omitirán por completo.
- Llegar al final del Contrato será obligatorio para habilitar el paso siguiente y producirá un evento `Contrato recorrido` en cada Intento de aceptación.
- Al llegar al final se habilitará `Continuar` inmediatamente; no habrá cronómetro, permanencia mínima o retraso artificial.
- `Contrato recorrido` documentará únicamente la interacción técnica; no se presentará como prueba de lectura, comprensión, identidad o conformidad.
- Un Intento sucesor exigirá recorrer nuevamente el Contrato porque la repetición comienza desde el inicio.
- Los pasos de INE y video aparecerán únicamente cuando el Perfil de evidencia efectivo los exija.
- `Ver PDF` será opcional; no abrirlo o descargarlo no impedirá continuar o aceptar.
- `Aceptar contrato` sólo estará disponible mientras el enlace permanezca vigente y después de completar la evidencia exigida.
- Después de `Aceptar contrato`, el resultado será mínimo: `Contrato aceptado`, Referencia contractual y `Ver PDF` cuando no exista revisión; o `Proceso enviado a revisión` con la indicación de que la Organización contactará al Firmante sólo si necesita que repita, cuando la revisión sea manual o asistida por AI.
- El resultado no ofrecerá cuenta, seguimiento, bandeja, mensajería o acciones adicionales al Firmante.
- La primera apertura se registrará como presentación, no como lectura, identidad o aceptación.
- La Vigencia del enlace seguirá la configuración resuelta conforme a ADR-0070 y no será universalmente de siete días.
- La distribución inicial continuará siendo externa y la plataforma sólo ofrecerá `Copiar enlace` conforme a ADR-0056.
- Las alertas de la Organización se definirán separadamente del mecanismo de acceso y nunca convertirán el canal de notificación en canal del Firmante.
