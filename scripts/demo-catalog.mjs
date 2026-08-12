/**
 * Catálogo sintético canónico del POC-Demo local de Fides (ADR-0082).
 * Ningún dato contractual de este archivo describe una operación real.
 */

import {
  AIRPORT_SUGGESTIONS,
  CITY_SUGGESTIONS,
} from "./place-suggestions.mjs";

export const SYNTHETIC_NOTE =
  "> Datos sintéticos de demostración. No es un contrato real, no constituye " +
  "asesoría jurídica y no debe utilizarse con personas o datos reales.";

const ACCEPTANCE_TAIL = `## Aceptación

El Firmante manifiesta su conformidad mediante la acción \`Aceptar contrato\`. Fides conserva el texto exacto mostrado, la fecha y hora del servidor, la Leyenda de aceptación y la evidencia configurada. Fides conserva y presenta este contenido; no determina su suficiencia jurídica.`;

const PARTIES_BLOCK = `## Partes

Celebran este instrumento {{organizacion.razon_social}}, en lo sucesivo la Organización, y {{titular.nombre}}, con Registro Federal de Contribuyentes {{titular.rfc}} y domicilio en {{titular.domicilio}}, en lo sucesivo el Titular.

El recorrido de aceptación lo realiza {{firmante.nombre}}, quien manifiesta actuar por cuenta propia.`;

const HEADER_BLOCK =
  "Referencia {{contrato.referencia}}, emitida el {{contrato.fecha}} por {{organizacion.nombre}}.";

const NOTICES_BLOCK = `## Notificaciones

Las comunicaciones relacionadas con este instrumento se dirigirán a {{titular.correo}} y {{titular.telefono}}. Cualquier cambio deberá informarse por escrito a la Organización.`;

function demoDate(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Campo `suggest`: la lista propone y quien captura puede escribir otra cosa. */
function suggestField(key, label, { helpText, options, ...rest }) {
  return {
    key,
    label,
    helpText,
    dataType: "suggest",
    options,
    searchable: true,
    highlighted: true,
    ...rest,
  };
}

const cityField = (key, label, rest) =>
  suggestField(key, label, {
    helpText: "Escribe la ciudad y elige de la lista, o captura otra.",
    options: CITY_SUGGESTIONS,
    ...rest,
  });

const airportField = (key, label, rest) =>
  suggestField(key, label, {
    helpText: "Escribe el nombre o el código y elige de la lista, o captura otro.",
    options: AIRPORT_SUGGESTIONS,
    ...rest,
  });

const moneyField = (key, label, rest = {}) => ({
  key,
  label,
  dataType: "money",
  highlighted: true,
  ...rest,
});

function template({
  name,
  summary,
  objectClause,
  fields,
  defaults,
  demoValues,
  baseModel = "Prestación de servicios",
  partiesBlock = PARTIES_BLOCK,
  clauses,
}) {
  const contractClauses =
    clauses ??
    `## Primera. Objeto

${objectClause}

## Segunda. Operación

La Organización prestará el servicio con personal y recursos propios. El Titular entregará oportunamente la información necesaria y comunicará cualquier cambio que afecte la ejecución.

## Tercera. Condiciones económicas

Las cantidades señaladas se registran para efectos contractuales. Fides no procesa pagos ni acredita su cumplimiento.

## Cuarta. Cambios y cancelación

Cualquier cambio de alcance, fecha o precio deberá constar por escrito entre las partes. La cancelación del servicio no equivale a eliminar este expediente de Fides.`;
  return {
    name,
    summary,
    baseModel,
    acceptanceLegend:
      "Al presionar Aceptar contrato manifiesto que tuve a la vista el texto completo, que los datos corresponden a lo acordado y que acepto las obligaciones descritas a mi nombre. Entiendo que Fides conserva el texto, la fecha y hora del servidor y la evidencia configurada.",
    videoStatement:
      "Soy {{firmante.nombre}}. Hoy {{contrato.fecha}} acepto el contrato por {{contrato.monto_principal}} celebrado con {{organizacion.razon_social}}",
    defaults,
    fields,
    demoValues,
    markdown: `# ${name}

${SYNTHETIC_NOTE}

${HEADER_BLOCK}

${partiesBlock}

${contractClauses}

${NOTICES_BLOCK}

## Sexta. Protección de datos personales

El tratamiento de los datos del Titular y del Firmante se sujeta al Aviso de Privacidad mostrado al inicio del recorrido.

${ACCEPTANCE_TAIL}`,
  };
}

function people(slug, city, names) {
  return names.map((name, index) => ({
    name,
    personKind: "fisica",
    rfc: `DEMO0${index + 1}0101${String.fromCharCode(65 + index)}${index}0`,
    email: `${slug}-cliente-${index + 1}@demo.local`,
    phone: `+52 33 5555 01${String(index + 1).padStart(2, "0")}`,
    address: `Domicilio sintético ${index + 1}, ${city}`,
    position: "Titular",
  }));
}

function companiesAndRepresentatives(slug, city, pairs) {
  return pairs.flatMap(([company, representative], index) => [
    {
      name: company,
      personKind: "moral",
      rfc: `D${String(index + 1).padStart(2, "0")}010101A${index}0`,
      email: `${slug}-proveedor-${index + 1}@demo.local`,
      phone: `+52 33 5555 02${String(index + 1).padStart(2, "0")}`,
      address: `Domicilio mercantil sintético ${index + 1}, ${city}`,
      position: "Proveedor",
    },
    {
      name: representative,
      personKind: "fisica",
      rfc: `DEMO0${index + 4}0101${String.fromCharCode(68 + index)}${index}0`,
      email: `${slug}-firmante-${index + 1}@demo.local`,
      phone: `+52 33 5555 03${String(index + 1).padStart(2, "0")}`,
      address: `Domicilio personal sintético ${index + 1}, ${city}`,
      position: "Representante del proveedor (Demo)",
    },
  ]);
}

const TRANSPORT_SETTINGS = {
  linkDays: 7,
  requiresVideo: false,
  requiresIne: true,
  reviewPolicy: "manual",
};
const AEROJL_SETTINGS = {
  linkDays: 10,
  requiresVideo: true,
  requiresIne: true,
  reviewPolicy: "ai",
};
const AMBULANCE_SETTINGS = {
  linkDays: 5,
  requiresVideo: true,
  requiresIne: true,
  reviewPolicy: "manual",
};
const GAS_SETTINGS = {
  linkDays: 15,
  requiresVideo: false,
  requiresIne: true,
  reviewPolicy: "manual",
};
const EUZEN_SETTINGS = {
  linkDays: 10,
  requiresVideo: true,
  requiresIne: false,
  reviewPolicy: "ai",
};
const RETTO_SETTINGS = {
  linkDays: 7,
  requiresVideo: false,
  requiresIne: false,
  reviewPolicy: "none",
};
const RETTO_GOODS = [
  {
    product: "Cerveza Neven Green Beer (Demo)",
    presentation: "Caja de 24 botellas (Demo)",
    quantity: "80",
    amount: "192000",
    paymentTerm: "15 días",
  },
  {
    product: "Agua mineral saborizada (Demo)",
    presentation: "Caja de 12 latas (Demo)",
    quantity: "120",
    amount: "86400",
    paymentTerm: "7 días",
  },
  {
    product: "Cajas de cartón corrugado (Demo)",
    presentation: "Paquete de 25 cajas (Demo)",
    quantity: "60",
    amount: "73500",
    paymentTerm: "30 días",
  },
  {
    product: "Café tostado en grano (Demo)",
    presentation: "Caja de 10 bolsas de 1 kg (Demo)",
    quantity: "45",
    amount: "101250",
    paymentTerm: "15 días",
  },
  {
    product: "Productos de limpieza biodegradables (Demo)",
    presentation: "Kit comercial de 6 piezas (Demo)",
    quantity: "35",
    amount: "52500",
    paymentTerm: "7 días",
  },
  {
    product: "Refrigeradores exhibidores comerciales (Demo)",
    presentation: "Unidad vertical de una puerta (Demo)",
    quantity: "8",
    amount: "248000",
    paymentTerm: "30 días",
  },
];

export const ORGANIZATIONS = [
  {
    slug: "transportes",
    name: "Transportes",
    legalName: "Transportes Demo, S.A. de C.V.",
    industry: "Transporte terrestre de carga",
    city: "Guadalajara, Jalisco",
    seatLimit: 10,
    entitlements: {
      ai_review: false,
      active_custody: false,
      evidence_video: true,
      evidence_ine: true,
    },
    settings: TRANSPORT_SETTINGS,
    folders: ["Servicios programados", "Flotillas", "Renovaciones"],
    templates: [
      template({
        name: "Servicio de transporte terrestre de carga",
        summary:
          "Traslado nacional de mercancía en tráiler, con origen, destino, tipo de carga y tarifa definidos.",
        objectClause:
          "La Organización trasladará {{tipo_carga}} desde {{origen}} hasta {{destino}} el {{fecha_servicio}}, por una tarifa de {{tarifa}}.",
        defaults: TRANSPORT_SETTINGS,
        fields: [
          cityField("origen", "Origen"),
          cityField("destino", "Destino"),
          {
            key: "tipo_carga",
            label: "Tipo de carga (Opcional)",
            helpText: "Opcional. Describe la carga sólo si aplica al servicio.",
            dataType: "text",
            required: false,
            searchable: true,
            highlighted: false,
          },
          { key: "fecha_servicio", label: "Fecha del servicio", dataType: "date", highlighted: true },
          moneyField("tarifa", "Tarifa o costo"),
        ],
        demoValues: (index) => ({
          origen: ["Guadalajara, Jalisco", "León, Guanajuato", "Querétaro, Querétaro"][index % 3],
          destino: [
            "Monterrey, Nuevo León",
            "Ciudad de México",
            "San Luis Potosí, San Luis Potosí",
          ][index % 3],
          tipo_carga: ["Carga seca", "Alimentos empacados", "Material industrial"][index % 3],
          fecha_servicio: demoDate(5 + index),
          tarifa: String(28_500 + index * 2_750),
        }),
      }),
    ],
    counterparties: people("transportes", "Guadalajara, Jalisco", [
      "Alejandra Campos Rivera",
      "Roberto Salcedo Núñez",
      "Mariana Ponce Aguilar",
    ]),
  },
  {
    slug: "aviacion-norte-operaciones",
    name: "Aviacion Norte · Taxi aéreo y carga",
    legalName: "Aviacion Norte Operaciones Aéreas (Demo)",
    industry: "Taxi aéreo privado y transporte aéreo privado de carga",
    city: "Guadalajara, Jalisco",
    seatLimit: 10,
    entitlements: {
      ai_review: true,
      active_custody: true,
      evidence_video: true,
      evidence_ine: true,
    },
    settings: AEROJL_SETTINGS,
    folders: ["Taxi aéreo", "Carga aérea", "Clientes recurrentes"],
    templateRotation: [0, 1, 0, 0, 1, 1, 0, 1],
    templates: [
      template({
        name: "Servicio de taxi aéreo privado",
        summary:
          "Vuelo privado solicitado por el Titular, con ruta, fecha, pasajeros y precio determinados.",
        objectClause:
          "La Organización realizará un vuelo privado de {{origen}} a {{destino}} el {{fecha_vuelo}}, para {{pasajeros}} pasajeros, por {{importe}}.",
        defaults: AEROJL_SETTINGS,
        fields: [
          airportField("origen", "Aeropuerto de origen"),
          airportField("destino", "Aeropuerto de destino"),
          { key: "fecha_vuelo", label: "Fecha del vuelo", dataType: "date", highlighted: true },
          { key: "pasajeros", label: "Pasajeros", dataType: "number" },
          moneyField("importe", "Precio del servicio"),
        ],
        demoValues: (index) => ({
          origen: [
            "Guadalajara (GDL) · Miguel Hidalgo y Costilla",
            "Toluca (TLC) · Lic. Adolfo López Mateos",
            "Puerto Vallarta (PVR) · Lic. Gustavo Díaz Ordaz",
          ][index % 3],
          destino: [
            "Los Cabos (SJD) · Los Cabos",
            "Cancún (CUN) · Cancún",
            "Monterrey (MTY) · Gral. Mariano Escobedo",
          ][index % 3],
          fecha_vuelo: demoDate(7 + index),
          pasajeros: String(3 + (index % 5)),
          importe: String(145_000 + index * 18_500),
        }),
      }),
      template({
        name: "Transporte aéreo privado de carga",
        summary:
          "Traslado aéreo privado de mercancía identificada, con ruta, peso y precio definidos.",
        objectClause:
          "La Organización trasladará {{descripcion_carga}}, con peso declarado de {{peso_kg}} kg, de {{origen}} a {{destino}} el {{fecha_vuelo}}, por {{importe}}.",
        defaults: AEROJL_SETTINGS,
        fields: [
          airportField("origen", "Aeropuerto de origen"),
          airportField("destino", "Aeropuerto de destino"),
          { key: "descripcion_carga", label: "Descripción de la carga", dataType: "text", required: false, searchable: true },
          { key: "peso_kg", label: "Peso en kg", dataType: "number", highlighted: true },
          { key: "fecha_vuelo", label: "Fecha del vuelo", dataType: "date" },
          moneyField("importe", "Precio del servicio"),
        ],
        demoValues: (index) => ({
          origen: [
            "Guadalajara (GDL) · Miguel Hidalgo y Costilla",
            "Tijuana (TIJ) · Gral. Abelardo L. Rodríguez",
            "Mérida (MID) · Manuel Crescencio Rejón",
          ][index % 3],
          destino: [
            "Monterrey (MTY) · Gral. Mariano Escobedo",
            "Querétaro (QRO) · Intercontinental de Querétaro",
            "Toluca (TLC) · Lic. Adolfo López Mateos",
          ][index % 3],
          descripcion_carga: ["refacciones industriales", "equipo electrónico", "muestras comerciales"][index % 3],
          peso_kg: String(320 + index * 55),
          fecha_vuelo: demoDate(4 + index),
          importe: String(118_000 + index * 15_250),
        }),
      }),
    ],
    counterparties: people("aviacion-norte", "Guadalajara, Jalisco", [
      "Fernanda Cortés Medina",
      "Ignacio Velasco Mora",
      "Claudia Serrano Ruiz",
    ]),
  },
  {
    slug: "aviacion-norte-ambulancia",
    name: "Aviacion Norte · Ambulancia aérea",
    legalName: "Aviacion Norte Ambulancia Aérea (Demo)",
    industry: "Traslado médico aéreo privado",
    city: "Guadalajara, Jalisco",
    seatLimit: 10,
    entitlements: {
      ai_review: false,
      active_custody: true,
      evidence_video: true,
      evidence_ine: true,
    },
    settings: AMBULANCE_SETTINGS,
    folders: ["Hospitales y aseguradoras", "Traslados programados", "Casos concluidos"],
    templates: [
      template({
        name: "Servicio de ambulancia aérea",
        summary:
          "Traslado médico aéreo privado con origen, destino, nivel de atención y precio determinados.",
        objectClause:
          "La Organización coordinará el traslado aéreo de {{origen}} a {{destino}} el {{fecha_servicio}}, con atención {{nivel_atencion}}, por {{importe}}.",
        defaults: AMBULANCE_SETTINGS,
        fields: [
          cityField("origen", "Ciudad de origen"),
          cityField("destino", "Ciudad de destino"),
          { key: "fecha_servicio", label: "Fecha del traslado", dataType: "date", highlighted: true },
          {
            key: "nivel_atencion",
            label: "Nivel de atención",
            dataType: "select",
            options: ["Soporte básico", "Soporte avanzado", "Traslado neonatal"],
          },
          moneyField("importe", "Precio del servicio"),
        ],
        demoValues: (index) => ({
          origen: [
            "Guadalajara, Jalisco",
            "Aguascalientes, Aguascalientes",
            "Puerto Vallarta, Jalisco",
          ][index % 3],
          destino: ["Ciudad de México", "Monterrey, Nuevo León", "Guadalajara, Jalisco"][index % 3],
          fecha_servicio: demoDate(2 + index),
          nivel_atencion: ["Soporte básico", "Soporte avanzado", "Traslado neonatal"][index % 3],
          importe: String(175_000 + index * 21_000),
        }),
      }),
    ],
    counterparties: people("ambulancia", "Guadalajara, Jalisco", [
      "Lucía Mendoza Arce",
      "Gerardo Villaseñor Díaz",
      "Natalia Orozco Paz",
    ]),
  },
  {
    slug: "gasolinera",
    name: "Gasolinera",
    legalName: "Gasolinera Demo, S.A. de C.V.",
    industry: "Suministro de combustible a crédito para transportistas",
    city: "Guadalajara, Jalisco",
    seatLimit: 10,
    entitlements: {
      ai_review: false,
      active_custody: true,
      evidence_video: true,
      evidence_ine: true,
    },
    settings: GAS_SETTINGS,
    folders: ["Flotillas", "Crédito vigente", "Renovaciones"],
    templates: [
      template({
        name: "Suministro de combustible a crédito",
        summary:
          "Combustible entregado a crédito, medido en litros o en pesos, con la fecha en que el Titular se comprometió a pagar.",
        objectClause:
          "La Organización otorgará {{unidad_credito}} por {{cantidad_credito}}. El Titular se obliga a pagar el importe correspondiente a más tardar el {{fecha_pago}}.",
        defaults: GAS_SETTINGS,
        fields: [
          {
            key: "unidad_credito",
            label: "Motivo del Contrato",
            helpText:
              "Elige litros si se acordó una cantidad de combustible, o monto en pesos si se acordó un límite de dinero.",
            dataType: "select",
            options: ["Litros de combustible a crédito", "Crédito de combustible en pesos"],
            searchable: true,
          },
          {
            key: "cantidad_credito",
            label: "Cantidad de litros o monto en pesos",
            helpText:
              "Escribe el número acordado y usa una de estas formas: litros de diesel por 5000 MXN, litros de gasolina premium por 4000 MXN o litros de gasolina regular por 4000 MXN.",
            dataType: "suggest",
            options: [
              "litros de diesel por 5000 MXN",
              "litros de gasolina premium por 4000 MXN",
              "litros de gasolina regular por 4000 MXN",
            ],
            searchable: true,
            highlighted: true,
          },
          {
            key: "fecha_pago",
            label: "Fecha límite de pago",
            helpText: "Elige el día acordado. No hay plazos fijos.",
            dataType: "date",
            highlighted: true,
          },
        ],
        demoValues: (index) => ({
          unidad_credito: [
            "Litros de combustible a crédito",
            "Crédito de combustible en pesos",
          ][index % 2],
          cantidad_credito: [
            "litros de diesel por 5000 MXN",
            "litros de gasolina premium por 4000 MXN",
            "litros de gasolina regular por 4000 MXN",
          ][index % 3],
          fecha_pago: demoDate(8 + index * 3),
        }),
      }),
    ],
    counterparties: people("gasolinera", "Guadalajara, Jalisco", [
      "Héctor Ibarra Chávez",
      "Beatriz Lozano Peña",
      "Samuel Padilla Cruz",
    ]),
  },
  {
    slug: "euzen",
    name: "Euzen",
    legalName: "EU ZEN CONSULTORES, S.C.",
    industry: "Estrategia y comunicación",
    city: "Zapopan, Jalisco",
    seatLimit: 10,
    entitlements: {
      ai_review: true,
      active_custody: true,
      evidence_video: true,
      evidence_ine: true,
    },
    settings: EUZEN_SETTINGS,
    folders: ["Campañas", "Instituciones", "Producción y proveedores"],
    templates: [
      template({
        name: "Servicios de estrategia y comunicación",
        summary:
          "Proyecto de estrategia y comunicación con entregables, vigencia y honorarios definidos.",
        objectClause:
          "La Organización desarrollará el proyecto {{proyecto}}, con los entregables {{entregables}}, del {{fecha_inicio}} al {{fecha_termino}}, por honorarios de {{honorarios}}.",
        defaults: EUZEN_SETTINGS,
        fields: [
          { key: "proyecto", label: "Proyecto", dataType: "text", searchable: true, highlighted: true },
          { key: "entregables", label: "Entregables", dataType: "longtext", searchable: true },
          { key: "fecha_inicio", label: "Fecha de inicio", dataType: "date", highlighted: true },
          { key: "fecha_termino", label: "Fecha de término", dataType: "date", highlighted: true },
          moneyField("honorarios", "Honorarios"),
        ],
        demoValues: (index) => ({
          proyecto: ["Estrategia institucional", "Campaña informativa", "Identidad y contenidos"][index % 3],
          entregables: [
            "diagnóstico, mensajes clave y plan de trabajo",
            "concepto creativo, piezas digitales y reporte de resultados",
            "manual de identidad, contenidos y archivos finales",
          ][index % 3],
          fecha_inicio: demoDate(3 + index),
          fecha_termino: demoDate(33 + index),
          honorarios: String(220_000 + index * 35_000),
        }),
      }),
    ],
    counterparties: people("euzen", "Zapopan, Jalisco", [
      "Mónica Robles Téllez",
      "Arturo Jiménez Solís",
      "Daniela Franco Lara",
    ]),
  },
  {
    slug: "retto",
    name: "Retto",
    legalName: "Retto · Organización sintética de demostración",
    industry: "Comercialización de productos",
    city: "Guadalajara, Jalisco",
    seatLimit: 10,
    entitlements: {
      ai_review: false,
      active_custody: false,
      evidence_video: true,
      evidence_ine: true,
    },
    settings: RETTO_SETTINGS,
    folders: ["Proveedores", "Contratos vigentes", "Seguimiento"],
    partyPairs: [
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
      [8, 9],
      [10, 11],
    ],
    extraCases: [
      { kind: "contract", status: "accepted", classification: "active", daysAgo: 30, folder: 1 },
      { kind: "contract", status: "accepted", classification: "active", daysAgo: 45, folder: 1 },
      { kind: "contract", status: "accepted", classification: "active", daysAgo: 60, folder: 1 },
      { kind: "contract", status: "accepted", classification: "active", daysAgo: 75, folder: 1 },
      { kind: "contract", status: "accepted", classification: "active", daysAgo: 90, folder: 1 },
    ],
    templates: [
      template({
        name: "Compraventa y suministro de bienes (Demo)",
        summary:
          "Contrato dummy para que Retto documente la compra de distintos bienes, genere una liga y obtenga la aceptación del proveedor.",
        baseModel: "Suministro de bienes",
        partiesBlock: `## Partes

Celebran este instrumento {{organizacion.razon_social}}, en lo sucesivo el Comprador, y {{titular.nombre}}, con Registro Federal de Contribuyentes {{titular.rfc}} y domicilio en {{titular.domicilio}}, en lo sucesivo el Proveedor.

El recorrido de aceptación lo realiza {{firmante.nombre}}. Cuando el Firmante sea distinto del Titular, manifiesta actuar en representación del Proveedor. Todos los datos de este ejemplo son sintéticos.`,
        objectClause: "",
        clauses: `## Primera. Objeto

El Proveedor venderá y entregará al Comprador {{cantidad}} unidades de {{producto}}, bajo la presentación {{presentacion}}.

## Segunda. Entrega

La entrega se realizará el {{fecha_entrega}} en {{lugar_entrega}}.

## Tercera. Precio y pago

El precio total de la operación es {{importe_total}} y el término de pago acordado es {{plazo_pago}}. Los impuestos, comprobantes fiscales y condiciones de crédito se operan fuera de Fides; la aceptación de este Contrato no acredita pago, entrega o facturación.

## Cuarta. Acuerdo completo

Producto, cantidad, precio, fecha y lugar de entrega forman el acuerdo mostrado. Cualquier condición adicional deberá incorporarse antes de generar el contrato.

## Quinta. Cambios

Cualquier cambio deberá acordarse por escrito entre las partes y reflejarse en un Contrato nuevo.`,
        defaults: RETTO_SETTINGS,
        fields: [
          { key: "producto", label: "Producto", dataType: "text", searchable: true, highlighted: true },
          { key: "presentacion", label: "Presentación", dataType: "text", searchable: true },
          { key: "cantidad", label: "Cantidad", dataType: "number", highlighted: true },
          { key: "fecha_entrega", label: "Fecha de entrega", dataType: "date", highlighted: true },
          { key: "lugar_entrega", label: "Lugar de entrega", dataType: "text", searchable: true },
          moneyField("importe_total", "Precio total"),
          {
            key: "plazo_pago",
            label: "Término de pago",
            dataType: "select",
            options: ["Contado", "7 días", "15 días", "30 días"],
          },
        ],
        demoValues: (index) => {
          const goods = RETTO_GOODS[index % RETTO_GOODS.length];
          return {
            producto: goods.product,
            presentacion: goods.presentation,
            cantidad: goods.quantity,
            fecha_entrega: demoDate(4 + (index % RETTO_GOODS.length)),
            lugar_entrega: [
              "Almacén sintético Guadalajara",
              "Centro de distribución sintético Zapopan",
              "Punto de entrega sintético El Salto",
            ][index % 3],
            importe_total: goods.amount,
            plazo_pago: goods.paymentTerm,
          };
        },
      }),
    ],
    counterparties: companiesAndRepresentatives("retto", "Guadalajara, Jalisco", [
      ["Olea Drinks (Demo)", "Representante de Olea Drinks (Demo)"],
      ["Distribuidora Verde del Pacífico, S.A. de C.V. (Demo)", "Adriana Molina Reyes (Demo)"],
      ["Empaques de Occidente, S.A. de C.V. (Demo)", "Arturo Salgado Pérez (Demo)"],
      ["Café Sierra Madre, S.A. de C.V. (Demo)", "Lucía Cortés Mora (Demo)"],
      ["Higiene Comercial de Jalisco, S.A. de C.V. (Demo)", "Fernanda Ruiz Torres (Demo)"],
      ["Equipamiento Comercial del Bajío, S.A. de C.V. (Demo)", "Martín Navarro Gil (Demo)"],
    ]),
  },
];

// Una Cuenta individual de Andrea tiene dos Accesos de Organización.
export const ACCOUNTS = [
  {
    email: "platform-admin@fides.local",
    fullName: "Platform Administrator (Demo)",
    isPlatformAdmin: true,
    isLegalPublisher: true,
    memberships: [],
  },
  {
    email: "legal-partner@fides.local",
    fullName: "Legal Content Partner",
    isPlatformAdmin: true,
    memberships: [],
  },
  {
    email: "transportes-admin@transportes.local",
    fullName: "Mariana Torres (Demo)",
    memberships: [{ slug: "transportes", roles: ["administrator", "emitter"], primaryAdmin: true }],
  },
  {
    email: "transportes-emisor@transportes.local",
    fullName: "Andrés Ríos (Demo)",
    memberships: [{ slug: "transportes", roles: ["emitter"] }],
  },
  {
    email: "transportes-revisor@transportes.local",
    fullName: "Paola Méndez (Demo)",
    memberships: [{ slug: "transportes", roles: ["reviewer"] }],
  },
  {
    email: "aviacion-norte-admin@aviacion-norte.local",
    fullName: "Andrea Rios",
    memberships: [
      { slug: "aviacion-norte-operaciones", roles: ["administrator", "emitter"], primaryAdmin: true },
      { slug: "aviacion-norte-ambulancia", roles: ["administrator", "emitter"], primaryAdmin: true },
    ],
  },
  {
    email: "aviacion-norte-emisor@aviacion-norte.local",
    fullName: "Daniela Cárdenas (Demo)",
    memberships: [{ slug: "aviacion-norte-operaciones", roles: ["emitter"] }],
  },
  {
    email: "aviacion-norte-revisor@aviacion-norte.local",
    fullName: "Mauricio Vega (Demo)",
    memberships: [{ slug: "aviacion-norte-operaciones", roles: ["reviewer"] }],
  },
  {
    email: "aviacion-norte-air-ambulance-emisor@aviacion-norte.local",
    fullName: "Renata Ocampo (Demo)",
    memberships: [{ slug: "aviacion-norte-ambulancia", roles: ["emitter"] }],
  },
  {
    email: "aviacion-norte-air-ambulance-revisor@aviacion-norte.local",
    fullName: "Luis Herrera (Demo)",
    memberships: [{ slug: "aviacion-norte-ambulancia", roles: ["reviewer"] }],
  },
  {
    email: "gasolinera-admin@gasolinera.local",
    fullName: "Carolina Silva (Demo)",
    memberships: [{ slug: "gasolinera", roles: ["administrator", "emitter"], primaryAdmin: true }],
  },
  {
    email: "gasolinera-emisor@gasolinera.local",
    fullName: "Jorge Navarro (Demo)",
    memberships: [{ slug: "gasolinera", roles: ["emitter"] }],
  },
  {
    email: "gasolinera-revisor@gasolinera.local",
    fullName: "Elena Ruiz (Demo)",
    memberships: [{ slug: "gasolinera", roles: ["reviewer"] }],
  },
  {
    email: "euzen-admin@euzen.local",
    fullName: "Sofía Campos (Demo)",
    memberships: [{ slug: "euzen", roles: ["administrator", "emitter"], primaryAdmin: true }],
  },
  {
    email: "euzen-emisor@euzen.local",
    fullName: "Mateo Luna (Demo)",
    memberships: [{ slug: "euzen", roles: ["emitter"] }],
  },
  {
    email: "euzen-revisor@euzen.local",
    fullName: "Valeria Soto (Demo)",
    memberships: [{ slug: "euzen", roles: ["reviewer"] }],
  },
  {
    email: "retto-admin@retto.local",
    fullName: "Responsable administrativa Retto (Demo)",
    memberships: [
      {
        slug: "retto",
        roles: ["administrator", "emitter"],
        primaryAdmin: true,
      },
    ],
  },
  {
    email: "retto-emisor@retto.local",
    fullName: "Responsable de contratos Retto (Demo)",
    memberships: [{ slug: "retto", roles: ["emitter"] }],
  },
  {
    email: "retto-revisor@retto.local",
    fullName: "Responsable de revisión Retto (Demo)",
    memberships: [{ slug: "retto", roles: ["reviewer"] }],
  },
];

export const RETENTION_POLICIES = [
  {
    category: "nucleo_contractual",
    retentionMonths: 120,
    description: "Contenido contractual sintético, hashes y eventos del POC-Demo.",
  },
  {
    category: "evidencia_sensible",
    retentionMonths: 24,
    description: "INE y video exclusivamente sintéticos del intento concluyente.",
  },
  {
    category: "enlaces_y_exportaciones",
    retentionMonths: 1,
    description: "Enlaces vencidos y artefactos técnicos temporales del POC-Demo.",
  },
];

/** Base común: un Borrador y siete Contratos por Organización. */
export const DEMO_CASES = [
  { kind: "draft", daysAgo: 0, folder: 0 },
  { kind: "contract", status: "pending", classification: "active", daysAgo: 1, folder: 0 },
  { kind: "contract", status: "in_review", classification: "active", daysAgo: 2, folder: 1 },
  { kind: "contract", status: "accepted", classification: "active", daysAgo: 3, folder: 1 },
  { kind: "contract", status: "expired", classification: "active", daysAgo: 15, folder: 2 },
  { kind: "contract", status: "cancelled", classification: "active", daysAgo: 7, folder: 0 },
  { kind: "contract", status: "accepted", classification: "archived", daysAgo: 20, folder: 2 },
  { kind: "contract", status: "cancelled", classification: "deleted", daysAgo: 12, folder: 1 },
];

export function demoCasesFor(organization) {
  return [...DEMO_CASES, ...(organization.extraCases ?? [])];
}

export const DEMO_ORGANIZATION_SLUGS = ORGANIZATIONS.map(({ slug }) => slug);
export const DEMO_ACCOUNT_EMAILS = ACCOUNTS.map(({ email }) => email);
export const DEMO_CATALOG_TOTALS = {
  organizations: ORGANIZATIONS.length,
  accounts: ACCOUNTS.length,
  templates: ORGANIZATIONS.reduce((total, organization) => total + organization.templates.length, 0),
  counterparties: ORGANIZATIONS.reduce(
    (total, organization) => total + organization.counterparties.length,
    0
  ),
  folders: ORGANIZATIONS.reduce((total, organization) => total + organization.folders.length, 0),
  contracts: ORGANIZATIONS.reduce(
    (total, organization) =>
      total + demoCasesFor(organization).filter(({ kind }) => kind === "contract").length,
    0
  ),
  drafts: ORGANIZATIONS.reduce(
    (total, organization) =>
      total + demoCasesFor(organization).filter(({ kind }) => kind === "draft").length,
    0
  ),
};

export const DEMO_CONTRACT_COVERAGE = ORGANIZATIONS.flatMap((organization) =>
  demoCasesFor(organization)
)
  .filter(({ kind }) => kind === "contract")
  .reduce((coverage, { status, classification }) => {
    const key = `${status}:${classification}`;
    coverage[key] = (coverage[key] ?? 0) + 1;
    return coverage;
  }, {});
