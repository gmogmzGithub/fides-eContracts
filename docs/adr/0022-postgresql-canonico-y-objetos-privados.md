---
status: accepted
---

# PostgreSQL será canónico y los archivos vivirán en objetos privados

PostgreSQL será el Registro contractual canónico. Ahí se conservarán Organizaciones, Miembros, contratos, versiones, Variables contractuales aprobadas, estados, eventos, permisos, hashes, auditoría, reglas de conservación y el Inventario de objetos contractuales.

Los PDF, identificaciones, fotografías, videos y demás archivos binarios autorizados serán Objetos contractuales privados dentro de un almacenamiento de objetos. El bucket no será la fuente de verdad y ningún archivo será válido dentro del expediente sin un registro canónico que lo relacione con su Organización, Contrato, versión interna de Contrato-plantilla y categoría. Esa versión será metadato técnico visible únicamente para el Administrador de plataforma.

## Considered Options

- Guardar todos los archivos binarios dentro de PostgreSQL.
- Usar el bucket como sistema principal y derivar el expediente de sus rutas.
- Separar datos transaccionales canónicos y objetos binarios privados.

## Consequences

- Cada objeto tendrá identificador opaco, Organización, expediente, categoría, hash, tamaño, tipo, estado, versión y política de conservación registrados en PostgreSQL.
- Los nombres y rutas del bucket no otorgarán autoridad ni sustituirán los metadatos canónicos.
- El bucket será privado; no habrá listado público ni URLs permanentes.
- Toda carga, lectura o descarga comprobará Organización, rol, expediente y propósito en el servidor.
- Las descargas utilizarán autorización de corta duración y quedarán sujetas a auditoría cuando corresponda.
- El hash se calculará al recibir o generar el archivo y se verificará de nuevo al exportarlo.
- Base de datos y bucket aplicarán el mismo Calendario de conservación por categoría y las mismas Retenciones jurídicas.
- La creación de un registro y la promoción del objeto a estado disponible deberán ser recuperables e idempotentes para evitar objetos huérfanos o referencias rotas.
- Los respaldos, restauraciones y pruebas de recuperación deberán validar conjuntamente metadatos y objetos.
- La implementación podrá cambiar de proveedor sin alterar esta frontera.
