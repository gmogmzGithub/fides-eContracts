---
status: accepted
---

# AWS utilizará cuentas separadas para administración, seguridad, pruebas y producción

La Etapa 3 operará mediante AWS Organizations con cuatro cuentas: Management para organización y facturación, Security para auditoría protegida, Non-production para validar infraestructura exclusivamente con datos sintéticos y Production para contratos y datos reales.

## Consequences

- La cuenta Management no hospedará la aplicación ni datos contractuales.
- La cuenta Security recibirá las bitácoras organizacionales y limitará su modificación o eliminación desde las cuentas de trabajo.
- Non-production reproducirá la arquitectura de Production a menor capacidad, pero nunca recibirá contratos, identidades o evidencia reales.
- Production será la única cuenta habilitada para operar Organizaciones reales.
- Los despliegues se promoverán mediante artefactos identificables e infraestructura como código; no se reconstruirán manualmente en Production.
- Cada cuenta tendrá roles, secretos, claves y límites independientes.
- La existencia de las cuentas no autoriza crear recursos antes de definir presupuesto, controles regionales y procedimiento de recuperación.
- El POC-Demo remoto de Etapa 2 no es la cuenta Non-production ni acredita
  la arquitectura AWS. Non-production comienza como parte de la preparación de
  Etapa 3 y valida la infraestructura como código que después se promueve a
  Production.
