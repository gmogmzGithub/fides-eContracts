---
status: accepted
---

# El Contrato-plantilla será texto puro y el PDF será una representación bajo demanda

Cada Contrato-plantilla vivirá dentro de la plataforma como un Markdown contractual versionado con un Esquema programado de campos y reglas previamente permitidos. Durante la operación, un Miembro completará esos campos y el programa leerá el Markdown, sustituirá sus marcadores e instanciará un Contrato nuevo sin modificar la plantilla. El Firmante recibirá el Contrato digital para revisarlo y aceptarlo; el PDF no será la fuente del contrato ni un requisito para aceptar.

La plataforma generará una representación PDF únicamente cuando una persona utilice la acción `Ver PDF`. Antes de la aceptación producirá una Copia de revisión marcada como pendiente y no la conservará. Después de la aceptación, la primera solicitud producirá y conservará una Copia contractual aceptada inmutable con su comprobante; las solicitudes posteriores entregarán exactamente el mismo archivo. Aceptar el Contrato nunca genera automáticamente un PDF.

## Considered Options

- Utilizar archivos Word o PDF editables como fuente operativa de los contratos.
- Generar y almacenar un PDF obligatorio antes de presentar cada contrato.
- Mantener el Contrato-plantilla como texto puro, presentar el Contrato digital y generar PDF sólo bajo demanda.

## Consequences

- El Contrato-plantilla publicado permanece inmutable; capturar valores crea un Contrato y no sobrescribe la plantilla.
- La aplicación conservará el Markdown contractual y su lógica programada. No ofrecerá un editor de plantillas dentro del portal de la Organización; el Administrador de plataforma tendrá el Editor de Contrato-plantilla privado definido en ADR-0079.
- La Organización sólo podrá elegir los Contratos-plantilla que le pertenezcan; la plataforma utilizará internamente su versión vigente sin mostrar un selector o identificador de versión. La Organización no podrá modificar su Markdown o esquema.
- Los campos, tipos, validaciones y posiciones permitidos forman parte de la misma versión aprobada que el texto.
- La Organización no recibe un editor de texto jurídico ni acceso para modificar el Contrato-plantilla.
- Modificar el Markdown aprobado producirá una versión nueva del Contrato-plantilla; si también cambian campos, validaciones o comportamiento, se realizará el trabajo técnico correspondiente.
- El Contrato emitido conserva una instantánea completa del texto resultante, sus valores, la versión de origen y su huella documental.
- Una versión posterior del Contrato-plantilla nunca sobrescribirá esa instantánea; todos los PDFs bajo demanda se generarán desde el Contrato emitido que corresponda.
- `Ver PDF` renderiza desde esa misma instantánea y no desde un documento paralelo.
- La acción de aceptar conserva el Contrato digital y su evidencia, pero no ejecuta el render PDF.
- El Firmante podrá continuar el Recorrido adaptativo sin abrir, descargar o desplazarse dentro de una representación PDF.
- Una Copia de revisión se entrega de forma efímera y nunca ingresa al inventario canónico de objetos.
- La primera Copia contractual aceptada solicitada se registra como objeto privado, con su hash, y no vuelve a renderizarse en solicitudes posteriores.
- Ver, descargar o no solicitar el PDF no constituye aceptación ni cambia el estado del Contrato.
