---
status: accepted
---

# Fides documentará condiciones económicas sin operar pagos o CFDI

Cada Contrato emitido incluirá las Condiciones económicas aprobadas para su Instrumento contractual: precio, moneda, impuestos, cargos y términos de pago. La aceptación registrará un compromiso contractual, no un pago.

Fides no cobrará, generará enlaces de pago, recibirá anticipos,
conciliará pagos, generará, enviará, almacenará o validará CFDI. Cualquier cobro
o facturación de una Organización será externo al producto. El nombre que una
Organización dé a su instrumento no convierte el PDF contractual en una factura
fiscal.

## Considered Options

- Integrar pagos y CFDI desde el piloto.
- Omitir toda información económica.
- Incluir condiciones económicas sin operar el flujo financiero.

## Consequences

- Los importes y términos serán variables contractuales versionadas e inmutables después de emitir.
- Contrato aceptado no implicará Pago confirmado.
- El Estado contractual no confirmará pago, prestación o cumplimiento.
- No existirán credenciales, webhooks o estados de un proveedor de pagos durante el piloto.
- El sistema no solicitará RFC, uso fiscal, régimen fiscal, UUID, XML o datos de pago con la finalidad de facturar.
- Responsable juridico entregará cualquier contenido aplicable y Publicador de plataforma será el único que
  lo apruebe y publique antes de usarlo.
- Incorporar pagos o CFDI exigiría una nueva decisión que cambie expresamente esta frontera; no se considera parte de la evolución normal del piloto.
- La futura integración de Mercado Pago para cobrar la Suscripción de la plataforma no procesará los pagos descritos dentro de los Contratos de las Organizaciones y no cambiará esta frontera.
