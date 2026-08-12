# Documentación de Fides

La documentación estable se organiza por autoridad:

1. [`CONTEXT.md`](../CONTEXT.md): lenguaje del dominio.
2. [`adr/`](./adr/): decisiones vigentes.
3. [Arquitectura del sistema](./architecture/SYSTEM-ARCHITECTURE.md): producto,
   flujos, componentes, datos y evolución a AWS.
4. [Gates para el Piloto real](./requirements/REAL-PILOT-GATES.md): evidencia
   necesaria antes de admitir contratos o datos reales.
5. [Frontera del Aviso de Privacidad](./privacy/PRIVACY-NOTICE-REQUIREMENTS.md):
   lógica de publicación, versionamiento y presentación.
6. [Historia del proyecto](./PROJECT-HISTORY.md): resumen público del trabajo.
7. [Ramas y política pública](./BRANCHING.md): estrategia para GitHub público.

## Disciplina documental

- Actualiza una fuente canónica antes de crear otra.
- Usa un ADR sólo para una decisión durable con alternativas o consecuencias.
- No guardes entrevistas de diseño, planes de sesión, auditorías puntuales,
  borradores jurídicos o investigación sectorial dentro de `docs/`.
- El contenido jurídico se prepara y aprueba fuera del flujo operativo de la
  aplicación.
- Nunca guardes credenciales, contratos reales, identidades, documentos
  institucionales sensibles o evidencia personal.
