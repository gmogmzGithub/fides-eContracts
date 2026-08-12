---
status: accepted
---

# Los modelos serán reutilizables y los Contratos-plantilla serán exclusivos por Organización

El Proveedor de la plataforma podrá reutilizar Modelos contractuales base para preparar configuraciones de negocios semejantes, pero cada Contrato-plantilla pertenecerá exclusivamente a una Organización. Todo contenido jurídico procederá de Responsable juridico y cada publicación requerirá la aprobación exclusiva de Publicador de plataforma; la Organización no la aprueba o edita. Una Organización podrá tener uno o varios Contratos-plantilla según sus relaciones contractuales recurrentes; ninguno se operará desde otra Organización.

## Considered Options

- Compartir un mismo Contrato-plantilla entre todas las Organizaciones de una industria.
- Crear cada Contrato-plantilla desde cero sin reutilizar conocimiento interno.
- Reutilizar Modelos contractuales base internamente y derivar Contratos-plantilla independientes por Organización.

## Consequences

- El Modelo contractual base no está aprobado para emitir contratos ni aparece como opción operativa para los Miembros.
- Identidad, cláusulas, variables, reglas, avisos y evidencia se versionan dentro de la Configuración contractual de cada Organización; la plataforma no modela un expediente o flujo de aprobación.
- Mejorar un Modelo contractual base no modifica automáticamente ningún Contrato-plantilla publicado.
- La adopción de una mejora requiere que Responsable juridico entregue el contenido aplicable y que Publicador de plataforma prepare, apruebe y publique una versión nueva para cada Organización afectada.
- Los contratos ya emitidos permanecen ligados a la versión exacta utilizada y nunca cambian por actualizar el modelo o un Contrato-plantilla posterior.
- Sólo la versión vigente de cada Contrato-plantilla estará disponible para emisiones nuevas. Las versiones anteriores se conservarán dentro de la plataforma para reproducir texto, campos y reglas de los Contratos históricos, pero no podrán seleccionarse para crear otros.
- Cada Contrato-plantilla vivirá dentro de la plataforma como Markdown contractual y Esquema programado de campos exclusivo de la Organización conforme a ADR-0077.
