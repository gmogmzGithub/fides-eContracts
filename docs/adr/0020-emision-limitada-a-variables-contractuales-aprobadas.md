---
status: accepted
---

# El Emisor sólo completará variables contractuales aprobadas

Durante la creación ordinaria, el Emisor sólo podrá completar Campos
contractuales programados. Cada campo tendrá propósito, tipo, formato,
validaciones, obligatoriedad y ubicación en el Contrato-plantilla definidos
previamente.

El Emisor no podrá editar cláusulas, escribir texto libre dentro del contrato, modificar Bloques jurídicos condicionados, crear anexos improvisados o sustituir contenido entregado por Responsable juridico y aprobado por Publicador de plataforma.

## Considered Options

- Permitir que cada Emisor edite libremente el contrato.
- Ofrecer campos estructurados y una sección abierta de observaciones.
- Limitar la emisión a Variables contractuales aprobadas sin texto jurídico libre.

## Consequences

- Responsable juridico deberá entregar el catálogo de variables, sus reglas y su efecto documental; Publicador de plataforma será el único que los apruebe y publique antes de habilitar contratos reales.
- La interfaz usará controles específicos como fechas, monedas, importes y
  selecciones cerradas, no un editor de documentos.
- El servidor rechazará cualquier campo, valor o bloque que no corresponda a la versión vigente de la plantilla.
- La vista previa mostrará exactamente el documento que se convertirá en Contrato emitido.
- Miembro, versión de plantilla, valores capturados y resultado documental quedarán en auditoría.
- Un cambio de cláusulas, bloques, variables o validaciones requerirá contenido nuevo de Responsable juridico y una publicación versionada aprobada por Publicador de plataforma.
- Las Variables contractuales pendientes de definición jurídica u operativa
  permanecerán como gate del Piloto real.
