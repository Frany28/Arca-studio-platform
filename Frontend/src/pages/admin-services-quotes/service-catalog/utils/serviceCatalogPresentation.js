// Presentación del tabulador de servicios. Los datos se muestran tal como los entrega la API:
// el código público lo genera el sistema al crear el servicio (`SERV-001`, en el backend; el
// frontend ni lo envía ni lo compone),
// `kind` define la modalidad, `unitLabel` es la etiqueta oficial de la unidad y
// `referenceRate` es texto decimal.

import { getActiveStatusBadge } from "../../utils/activeStatusBadge.js";
import { formatDecimalMoney } from "../../utils/moneyFormat.js";

// Opciones del filtro de estado, alineadas con `status=active|inactive` del contrato.
export const SERVICE_STATUS_FILTER_ITEMS = Object.freeze([
  { id: "active", label: "Activos" },
  { id: "inactive", label: "Inactivos" },
]);

/**
 * Formatea una tarifa decimal para la tabla sin convertirla a Number, de modo que no se pierde
 * precisión ni se redondea: agrupa los miles de la parte entera y muestra los céntimos solo
 * cuando no son cero, como en Figma ("$12", "$12.50", "$1,250"). El valor almacenado no cambia.
 * Un valor con un formato inesperado se muestra tal cual en lugar de inventar una cifra.
 *
 * @param {string} rate - `referenceRate` de la API (por ejemplo "12.00").
 * @param {string} [currency="USD"] - Moneda del servicio.
 * @returns {string} Tarifa legible.
 */
export function formatReferenceRate(rate, currency = "USD") {
  return formatDecimalMoney(rate, { currency });
}

/**
 * Devuelve la descripción real del servicio sin espacios exteriores. Una descripción vacía o
 * ausente no tiene tooltip ni icono informativo (anotación de Figma 5790:332100).
 *
 * @param {Object} service - Servicio de la API.
 * @returns {string} Descripción o cadena vacía.
 */
export function getServiceDescription(service) {
  return typeof service?.description === "string" ? service.description.trim() : "";
}

/**
 * Estado del servicio para su Badge: solo depende de `isActive`. Comparte la regla con la tabla
 * de Unidades de medida (`getActiveStatusBadge`).
 *
 * @param {Object} service - Servicio de la API.
 * @returns {{label: "Activo"|"Inactivo", theme: "Success"|"Disabled"}} Texto y tema.
 */
export function getServiceStatusBadge(service) {
  return getActiveStatusBadge(service);
}

// Etiquetas de la columna «Modalidad» (Figma 5924:439741) por cada `kind` del contrato
// (`individual|turnkey`). El texto de `individual` es el de Figma, no la clave interna.
const SERVICE_MODALITY_LABELS = Object.freeze({
  individual: "Detalle por detalle",
  turnkey: "Llave en mano",
});

// Opciones de «Modalidad de Contratación» en el formulario (Figma 5924:439642), con los mismos
// textos que la columna para que tabla y formulario no diverjan.
export const SERVICE_MODALITY_OPTIONS = Object.freeze(
  Object.entries(SERVICE_MODALITY_LABELS).map(([id, label]) => Object.freeze({ id, label })),
);

/**
 * Modalidad del servicio para su Badge, derivada solo del `kind` que devuelve la API: nunca se
 * deduce del nombre, la tarifa ni la unidad. Sin `kind` se indica «Sin modalidad» y un valor
 * fuera del contrato se marca «No reconocida» (con el valor recibido en `rawKind`), ambos con
 * el tema `Disabled`, en lugar de mostrar una modalidad inventada.
 *
 * @param {Object} service - Servicio de la API.
 * @returns {{label: string, theme: "Brand 2"|"Disabled", rawKind: string|null}} Texto, tema y
 *   valor original cuando no es reconocido.
 */
export function getServiceModalityBadge(service) {
  const kind = typeof service?.kind === "string" ? service.kind.trim() : "";
  if (!kind) return { label: "Sin modalidad", theme: "Disabled", rawKind: null };
  if (Object.hasOwn(SERVICE_MODALITY_LABELS, kind)) return { label: SERVICE_MODALITY_LABELS[kind], theme: "Brand 2", rawKind: null };
  return { label: "No reconocida", theme: "Disabled", rawKind: kind };
}

/**
 * Construye las opciones del filtro por unidad a partir de las unidades que usan los servicios
 * reales del catálogo, sin ofrecer filtros que no producen resultados. Por cada unidad base
 * usada hay una opción que filtra por `measurementUnitId` (incluye todas sus denominaciones,
 * "m² · todas" cuando alguna se usa) y, debajo, una opción por denominación usada que filtra
 * por `unitDenominationId` ("m² de construcción").
 *
 * @param {Array<Object>} services - Colección completa del catálogo.
 * @returns {Array<{id: string, label: string, filter: {name: string, value: number}}>} Opciones ordenadas.
 */
export function buildUnitFilterItems(services) {
  const bases = new Map();
  for (const service of services || []) {
    const unit = service?.measurementUnit;
    if (!unit?.id) continue;
    const base = bases.get(unit.id) ?? { unit, denominations: new Map() };
    const denomination = service.unitDenomination;
    // Se compone la etiqueta de la unidad, sin el texto comercial: el filtro es por unidad.
    if (denomination?.id) base.denominations.set(denomination.id, `${unit.symbol} ${denomination.denomination}`);
    bases.set(unit.id, base);
  }

  const byLabel = (left, right) => left.label.localeCompare(right.label, "es");
  return [...bases.values()]
    .map(({ unit, denominations }) => ({
      base: {
        id: `unit:${unit.id}`,
        label: denominations.size ? `${unit.symbol} · todas` : unit.symbol,
        filter: { name: "measurementUnitId", value: unit.id },
      },
      denominations: [...denominations.entries()]
        .map(([id, label]) => ({ id: `denomination:${id}`, label, filter: { name: "unitDenominationId", value: id } }))
        .sort(byLabel),
    }))
    .sort((left, right) => byLabel(left.base, right.base))
    .flatMap(({ base, denominations }) => [base, ...denominations]);
}
