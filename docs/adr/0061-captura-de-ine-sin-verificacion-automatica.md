---
status: accepted
---

# La INE se capturará como evidencia sin verificación automática

Cuando un Perfil de evidencia incluya INE, el Firmante capturará fotografías del frente y reverso de su credencial para votar. La plataforma conservará los archivos de forma privada, calculará sus hashes y los vinculará a la versión exacta del Contrato, pero no consultará al INE, realizará OCR obligatorio, validará autenticidad o vigencia, comparará rostros ni afirmará que la credencial identifica a quien acepta.

## Considered Options

- Integrar desde el inicio un proveedor de verificación documental y comparación facial.
- Tratar la fotografía de la credencial como identidad verificada por sí sola.
- Conservar frente y reverso únicamente como evidencia aportada, con afirmaciones limitadas a lo realmente capturado.

## Consequences

- La interfaz describirá la acción como captura de evidencia y no como verificación de identidad.
- Los archivos conservarán Organización, Contrato, Firmante, versión del Perfil de evidencia, fecha de recepción, tipo, tamaño y hash.
- Las imágenes no aparecerán en el PDF ni se expondrán mediante URLs públicas o permanentes.
- Acceso, exportación, conservación, Retención jurídica y supresión se aplicarán como políticas propias de esta categoría.
- Una falla o rechazo de captura impedirá concluir la aceptación cuando el Perfil de evidencia la exija.
- Incorporar OCR, validación documental, consulta a una fuente oficial, prueba de vida o comparación facial exigirá otra decisión, proveedor y revisión jurídica y de privacidad.
