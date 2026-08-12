---
status: accepted
---

# El alcance inicial tendrá un Firmante y el multifirmante permanecerá TBD

Cada Contrato del alcance inicial tendrá exactamente un Firmante y un solo recorrido activo de Intentos de aceptación. Aunque algunas industrias puedan requerir posteriormente varias personas con obligaciones o capacidades distintas, la coordinación multifirmante queda fuera del diseño actual y se conserva como `TBD` de evolución futura.

## Considered Options

- Diseñar e implementar desde ahora varios Firmantes, enlaces, órdenes y aceptaciones parciales.
- Mantener un Firmante en el alcance inicial y decidir el modelo multifirmante cuando exista un caso real aprobado.

## Consequences

- Un Contrato no tendrá aceptación parcial entre varias personas.
- Titular contractual, Representante firmante y Obligado solidario continuarán siendo capacidades distintas, pero una sola persona física será el actor técnico del recorrido inicial.
- Cada Intento de aceptación, Perfil de evidencia y Conclusión de revisión corresponderá a ese Firmante único.
- No se decidirán todavía aceptación paralela o secuencial, obligatoriedad por Firmante, sustituciones, recordatorios individuales o cierre parcial.
- Una futura capacidad multifirmante deberá preservar Contratos e historiales existentes y requerirá un ADR nuevo antes de implementarse.
