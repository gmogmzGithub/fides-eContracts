---
status: accepted
---

# Archivo Muerto usará un ZIP completo por contrato

`Archivo Muerto` conservará un único ZIP inmutable por cada contrato, tanto
para la Custodia fría base como para los expedientes de Custodia activa que
cumplan un año desde su Fecha de cierre contractual.
El ZIP reunirá la representación exacta del Contrato digital y su
Contrato-plantilla, valores y partes, comprobante de aceptación, Manifiesto de
evidencia, historial sencillo de eventos y decisiones, consentimientos, PDFs que
efectivamente se hayan generado e INE, video, reporte AI u otra evidencia del
intento que produjo la aceptación, cuando aplique. No incluirá archivos de
intentos que el Revisor mandó repetir. Incluirá un manifiesto interno con el
inventario y hash de cada componente; PostgreSQL conservará el SHA-256 del ZIP
completo y su localizador canónico.

El ZIP será exactamente la unidad recuperada y entregada. No se recuperarán o
entregarán componentes selectivos y no permanecerán objetos fríos relevantes
sueltos fuera del paquete. La compatibilidad de esta unidad única con plazos de
conservación potencialmente distintos para INE, video u otros componentes queda
como gate jurídico obligatorio antes de usar datos reales.

## Consequences

- Ningún paquete combinará contratos u objetos de Organizaciones distintas.
- El empaquetado será determinista: orden, rutas, nombres y metadatos normalizados producirán los mismos bytes para el mismo contenido.
- PostgreSQL conservará el inventario de los componentes y del paquete, incluida su clase de almacenamiento, tamaño y hash.
- Restaurar el paquete permitirá verificar primero su hash global y después el hash de cada componente.
- El formato físico queda fijado como ZIP compatible con herramientas comunes.
- Recuperar el ZIP no lo descomprimirá, previsualizará, convertirá en PDF o reconstruirá dentro del portal; la entrega será el ZIP completo.
- Una repetición conserva en el historial sólo fecha, resultado, Revisor, motivo y relación con el intento siguiente; no crea un paquete de evidencia anterior dentro del ZIP final.
- Una exportación masiva podrá incorporar este ZIP byte por byte dentro de un único ZIP contenedor temporal, identificado por su Referencia contractual y junto con los ZIP individuales de los demás contratos seleccionados. El contenedor no agregará un CSV, índice o manifiesto adicional del lote y no modificará, descomprimirá o sustituirá este paquete canónico.
- Responsable juridico deberá entregar por escrito un mismo plazo de conservación jurídicamente defendible para todos los componentes del ZIP, incluidos inicio de cómputo, bloqueo, supresión y Retención jurídica; Publicador de plataforma será el único que lo apruebe.
- Mientras ese gate permanezca pendiente, el ZIP sólo podrá probarse con datos sintéticos y no podrá recibir contratos, INE, videos o evidencia reales.
- Si cualquier componente debe suprimirse antes y no puede conservarse durante el plazo común, la arquitectura del paquete tendrá que cambiar antes de operar datos reales; Object Lock o la conveniencia técnica no sustituyen esa conclusión.
