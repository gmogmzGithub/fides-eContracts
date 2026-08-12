---
status: accepted
---

# El producto tendrá una sola aplicación web móvil instalable

Fides utilizará una Aplicación web móvil instalable como única interfaz.
Administradores, Emisores y Revisores podrán operarla en computadora o iPhone.
El Firmante abrirá el Enlace contractual en Safari u otro navegador compatible
sin instalar una aplicación.

No se construirá una aplicación nativa ni se publicará en App Store durante el piloto. El desarrollo local, la demo y la futura operación utilizarán la misma aplicación web y los mismos recorridos.

## Considered Options

- Construir desde el piloto una aplicación nativa para iOS y otra interfaz web.
- Limitar la experiencia móvil a páginas sin capacidad instalable.
- Usar una sola aplicación web responsiva e instalable.

## Consequences

- Existirá una sola base de código para escritorio, iOS y otros navegadores móviles compatibles.
- El acceso del Firmante nunca dependerá de instalación, cuenta o App Store.
- La aplicación podrá ofrecer manifiesto, iconos y experiencia de pantalla de
  inicio para los Miembros de una Organización.
- Los enlaces contractuales seguirán abriéndose como rutas web normales aunque la aplicación no esté instalada.
- Captura de cámara, archivos u otras capacidades del dispositivo se implementarán mediante APIs web compatibles y tendrán una alternativa de navegador cuando sea necesaria.
- Las funciones del piloto no dependerán de notificaciones push, ejecución en segundo plano o capacidades exclusivas de una aplicación nativa.
- El diseño y las pruebas incluirán Safari en iPhone y una vista de escritorio.
- Una aplicación nativa futura requerirá una decisión separada basada en necesidades que la interfaz web no pueda resolver.
