# Cambio

<!-- Qué cambia y por qué, en dos o tres líneas. -->

## Decisión que sigue

<!-- ADR aceptado, sección de `docs/` o regla de `CONTEXT.md` que respalda el
     cambio. Si el cambio necesita una decisión nueva, enlaza el ADR nuevo. -->

- Referencia:

## Evidencia

| Comando | Resultado |
|---|---|
| `npm run verify` | <!-- pega la última línea o el resumen --> |
| `npm run smoke` | <!-- pega el resumen de la corrida --> |

<!-- Si alguno no aplica, explica por qué. -->

## Reglas del repositorio

- [ ] No se versiona ningún Contrato, contraparte, INE, video, mensaje,
      evidencia, credencial o secreto de proveedor real; todo dato es sintético.
- [ ] Ningún texto visible afirma validez legal, cumplimiento NOM-151, no
      repudio, identidad verificada, inmutabilidad jurídica ni equivalencia con
      una firma avanzada.
- [ ] Ninguna consulta, ruta o acción permite que una cuenta lea o escriba datos
      de otra Organización; hay pruebas positivas y negativas cuando aplica.
- [ ] Aceptación, pago, prestación del servicio y cumplimiento siguen separados.
- [ ] Un Contrato emitido sigue siendo una instantánea inmutable y sin secuencia
      de versiones; no se introduce un estado `Rechazado`.
- [ ] El PDF se genera sólo bajo `Ver PDF` y el texto digital sigue siendo el
      primario.
- [ ] Si el cambio toca `db/migrations/`, la migración es aditiva y la semilla
      sintética sigue corriendo desde cero.

## Notas para quien revisa

<!-- Riesgos, pasos manuales, o lo que conviene mirar primero. -->
