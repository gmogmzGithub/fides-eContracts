---
status: accepted
---

# La plataforma mostrará el Aviso de Privacidad sin decidir su contenido

Responsable juridico preparará y entregará el Aviso de Privacidad y cualquier consentimiento adicional. Publicador de plataforma será la única persona que apruebe, cargue y publique ese contenido. La plataforma no lo redactará, interpretará o validará jurídicamente.

El Recorrido adaptativo del Firmante mostrará el Aviso de Privacidad al inicio de `Contrato`, antes de recopilar evidencia. No exigirá una casilla genérica por mostrar el aviso. Si Responsable juridico y Publicador de plataforma definen un consentimiento separado, la configuración publicada indicará cuándo presentarlo y la plataforma conservará ese evento separado de `Aceptar contrato`.

## Considered Options

- Permitir que cada Organización redacte o edite sus avisos dentro del portal.
- Intentar que la plataforma genere o valide automáticamente el contenido jurídico.
- Recibir el contenido de Responsable juridico, publicarlo sólo por Publicador de plataforma y limitar la aplicación a versionarlo, mostrarlo y conservarlo.

## Consequences

- La Organización y sus Miembros no tendrán editor o aprobación de avisos.
- El Aviso de Privacidad se publicará bajo una versión.
- Su versionamiento manual seguirá exactamente la mecánica del Contrato-plantilla definida en ADR-0079.
- Cada Contrato emitido conservará la publicación exacta del aviso vigente al generar su enlace.
- Una publicación nueva sólo aplicará a Contratos posteriores y no modificará los ya emitidos.
- Si falta una publicación vigente completa, el recorrido fallará cerrado antes de recopilar evidencia o aceptación.
- La aceptación contractual y cualquier consentimiento adicional permanecerán como eventos distintos.
