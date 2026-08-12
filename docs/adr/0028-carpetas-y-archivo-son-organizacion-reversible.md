---
status: accepted
---

# Las carpetas y el archivo sólo organizan expedientes

Administradores y Emisores podrán crear Carpetas operativas, mover Expedientes contractuales entre ellas y archivar o restaurar expedientes. Un Expediente archivado no aparece en la vista principal, pero permanece disponible en una vista específica, en el Buscador contractual y en su carpeta.

## Considered Options

- Tratar `archivado` como un Estado contractual.
- Ocultar expedientes antiguos mediante eliminación o revocación.
- Mantener carpeta y archivo como metadatos organizativos reversibles.

## Consequences

- Archivar no revoca el Enlace contractual, cancela el Contrato ni modifica su aceptación.
- Mover o archivar no cambia el Contrato emitido, hashes, PDF, Manifiesto de evidencia, eventos contractuales o Calendario de conservación.
- La vista principal excluye expedientes archivados por defecto.
- La vista `Archivados` permite buscarlos, filtrarlos por carpeta, abrirlos y restaurarlos.
- Las carpetas pertenecen a una sola Organización y no se representan como rutas físicas del bucket.
- El modelo persistente usará una referencia opcional de carpeta y una marca temporal de archivo; ambas son mutables y auditables.
- Un “switch” comercial en estado de conservación no archiva expedientes ni elimina carpetas.
