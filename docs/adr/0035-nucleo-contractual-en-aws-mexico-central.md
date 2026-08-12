---
status: accepted
---

# El núcleo contractual permanecerá en AWS México Central

Durante la Etapa 3, la aplicación que procesa contratos, PostgreSQL, los objetos contractuales, sus respaldos y los logs que puedan contener metadatos contractuales permanecerán en AWS México Central (`mx-central-1`). Esta frontera reduce transferencias y mantiene juntos procesamiento, custodia y recuperación del Núcleo contractual.

DNS y las alertas mínimas de WhatsApp podrán utilizar servicios externos o globales únicamente después de revisar proveedor, contrato, transferencias y minimización. Las alertas no incluirán la liga, el contrato, evidencia, datos de salud ni contenido contractual.

## Consequences

- El acceso público inicial priorizará una entrada regional y no dependerá de una CDN global para servir contenido contractual.
- Los respaldos y copias de recuperación no saldrán de México Central sin una decisión posterior que documente necesidad, región, tratamiento y riesgo.
- Identidad, monitoreo y seguridad deberán configurarse para impedir que contenido contractual o tokens aparezcan en servicios globales.
- La disponibilidad regional de cada servicio AWS se verificará antes de incorporarlo al diseño ejecutable.
