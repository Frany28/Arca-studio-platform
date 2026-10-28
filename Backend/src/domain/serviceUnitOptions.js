/*
 * Reglas puras de las unidades de medida de un servicio. No conocen PostgreSQL ni HTTP.
 *
 * - Un servicio tiene de 1 a SERVICE_UNIT_OPTIONS_MAX unidades, en posiciones 1..n. La posición 1
 *   es la principal: su unidad y denominación son las de services (filtros, etiqueta principal).
 * - La misma combinación de unidad base y denominación no se repite en un servicio.
 * - Con una sola unidad, su tarifa es la del servicio (no se envía aparte).
 * - Con varias, la tarifa del servicio es la de referencia del tabulador y cada unidad lleva la
 *   suya o null: «pendiente de validación comercial». Una unidad pendiente no se cotiza; omitir
 *   la tarifa de una unidad nunca copia otra tarifa (no se inventan precios).
 * - `presentationLabel` sustituye a la etiqueta compuesta («Global por Proyecto» en lugar de
 *   «proy.»). Solo es presentación: ninguna regla depende de ese texto.
 */

import { formatUnitLabel, normalizeUnitText } from "./measurementUnitLabel.js";

/** Unidades admitidas por servicio (CHECK chk_service_unit_options_position en PostgreSQL). */
export const SERVICE_UNIT_OPTIONS_MAX = 10;

/** Longitud máxima del texto comercial de una unidad (VARCHAR(80)). */
export const PRESENTATION_LABEL_MAX_LENGTH = 80;

/**
 * Normaliza el texto comercial opcional de una unidad: mismo criterio que las denominaciones
 * (NFC, sin espacios sobrantes). Vacío equivale a no tener texto comercial.
 *
 * @param {unknown} value - Texto recibido.
 * @returns {string|null} Texto normalizado o null.
 */
export function normalizePresentationLabel(value) {
  return normalizeUnitText(value) || null;
}

/**
 * Etiqueta visible de una unidad del servicio: el texto comercial si existe y, si no, la
 * composición de la abreviatura y la denominación («m² de construcción»).
 *
 * @param {{ symbol: string, denomination?: string|null, presentationLabel?: string|null }} option - Unidad.
 * @returns {string} Etiqueta.
 */
export function formatUnitOptionLabel({ denomination = null, presentationLabel = null, symbol }) {
  return normalizePresentationLabel(presentationLabel) ?? formatUnitLabel(symbol, denomination);
}

/**
 * Indica si una unidad puede cotizarse: necesita una tarifa confirmada.
 *
 * @param {{ referenceRate: string|null }} option - Unidad con su tarifa.
 * @returns {boolean} true si su tarifa no está pendiente.
 */
export function isUnitOptionQuotable(option) {
  return option.referenceRate !== null && option.referenceRate !== undefined;
}

/**
 * Forma canónica de una unidad para guardarla y compararla: ids numéricos, denominación y texto
 * comercial opcionales como null, y tarifa como texto decimal o null.
 *
 * @param {{ measurementUnitId: number, unitDenominationId?: number|null, presentationLabel?: string|null,
 *   referenceRate?: string|null }} option - Unidad recibida o leída.
 * @returns {{ measurementUnitId: number, unitDenominationId: number|null, presentationLabel: string|null,
 *   referenceRate: string|null }} Unidad canónica.
 */
export function toCanonicalUnitOption(option) {
  return {
    measurementUnitId: Number(option.measurementUnitId),
    presentationLabel: normalizePresentationLabel(option.presentationLabel),
    referenceRate: option.referenceRate ?? null,
    unitDenominationId: option.unitDenominationId === null || option.unitDenominationId === undefined
      ? null
      : Number(option.unitDenominationId),
  };
}

/**
 * Convierte las unidades públicas de un servicio (forma del repositorio) a su forma canónica.
 * Si el servicio no trae `unitOptions`, su unidad principal (`measurementUnit` /
 * `unitDenomination`) es la única, con la tarifa del servicio.
 *
 * @param {{ unitOptions?: Array<{ measurementUnit: { id: number }, unitDenomination: { id: number }|null,
 *   presentationLabel: string|null, referenceRate: string|null }>, measurementUnit?: { id: number },
 *   unitDenomination?: { id: number }|null, referenceRate?: string }} service - Servicio vigente.
 * @returns {Array<object>} Unidades canónicas en su orden.
 */
export function currentUnitOptions(service) {
  if (!Array.isArray(service.unitOptions)) {
    return [toCanonicalUnitOption({
      measurementUnitId: service.measurementUnit.id,
      referenceRate: service.referenceRate,
      unitDenominationId: service.unitDenomination?.id ?? null,
    })];
  }
  return service.unitOptions.map((option) => toCanonicalUnitOption({
    measurementUnitId: option.measurementUnit.id,
    presentationLabel: option.presentationLabel,
    referenceRate: option.referenceRate,
    unitDenominationId: option.unitDenomination?.id ?? null,
  }));
}

/**
 * Identifica una combinación de unidad base y denominación, para detectar repeticiones y saber
 * si una unidad ya estaba asignada al servicio.
 *
 * @param {{ measurementUnitId: number, unitDenominationId: number|null }} option - Unidad canónica.
 * @returns {string} Clave de la combinación.
 */
export function unitOptionKey(option) {
  return `${option.measurementUnitId}:${option.unitDenominationId ?? ""}`;
}

/**
 * Sustituye la unidad principal conservando las alternativas (atajo `measurementUnitId` /
 * `unitDenominationId` del contrato anterior). El texto comercial solo se conserva si la unidad
 * principal sigue siendo la misma combinación.
 *
 * @param {Array<object>} options - Unidades canónicas vigentes.
 * @param {{ measurementUnitId?: number, unitDenominationId?: number|null }} changes - Campos recibidos.
 * @returns {Array<object>} Unidades resultantes.
 */
function replacePrimaryUnit(options, changes) {
  const [primary, ...alternatives] = options;
  const next = {
    measurementUnitId: changes.measurementUnitId ?? primary.measurementUnitId,
    unitDenominationId: changes.unitDenominationId !== undefined ? changes.unitDenominationId : primary.unitDenominationId,
  };
  const keepsUnit = unitOptionKey(toCanonicalUnitOption(next)) === unitOptionKey(primary);
  return [
    toCanonicalUnitOption({ ...next, presentationLabel: keepsUnit ? primary.presentationLabel : null, referenceRate: primary.referenceRate }),
    ...alternatives,
  ];
}

/**
 * Calcula las unidades resultantes de un alta o una edición. `unitOptions` sustituye la lista
 * completa; el atajo `measurementUnitId` / `unitDenominationId` solo cambia la principal; sin
 * ninguno se conservan las vigentes. Con una sola unidad su tarifa pasa a ser la del servicio.
 *
 * @param {object} options - Datos de la operación.
 * @param {Array<object>} options.current - Unidades canónicas vigentes (vacío en el alta).
 * @param {object} options.changes - Cuerpo validado (alta o edición).
 * @param {string} options.referenceRate - Tarifa resultante del servicio.
 * @returns {Array<object>} Unidades canónicas resultantes.
 */
export function resolveUnitOptions({ changes, current, referenceRate }) {
  let options;
  if (changes.unitOptions !== undefined) options = changes.unitOptions.map(toCanonicalUnitOption);
  else if (changes.measurementUnitId !== undefined || changes.unitDenominationId !== undefined) {
    options = current.length
      ? replacePrimaryUnit(current, changes)
      : [toCanonicalUnitOption({ measurementUnitId: changes.measurementUnitId, unitDenominationId: changes.unitDenominationId })];
  } else options = current;
  return options.length === 1 ? [{ ...options[0], referenceRate }] : options;
}

/**
 * Comprueba las reglas que no dependen de la base de datos: cantidad de unidades, sin
 * combinaciones repetidas y, con una sola unidad enviada en `unitOptions`, que su tarifa (si se
 * indica) sea la del servicio.
 *
 * @param {Array<object>} requested - Unidades canónicas enviadas en `unitOptions`, o null si no se enviaron.
 * @param {string} referenceRate - Tarifa resultante del servicio.
 * @returns {Record<string, string>} Errores por ruta (`unitOptions.N.campo`); vacío si son válidas.
 */
export function collectUnitOptionErrors(requested, referenceRate) {
  const fields = {};
  if (!requested) return fields;
  if (requested.length < 1 || requested.length > SERVICE_UNIT_OPTIONS_MAX) {
    fields.unitOptions = `Indica entre 1 y ${SERVICE_UNIT_OPTIONS_MAX} unidades de medida.`;
    return fields;
  }
  const seen = new Set();
  requested.forEach((option, index) => {
    const key = unitOptionKey(option);
    if (seen.has(key)) fields[`unitOptions.${index}.measurementUnitId`] = "Esta unidad ya está incluida en el servicio.";
    seen.add(key);
  });
  if (requested.length === 1 && requested[0].referenceRate !== null && requested[0].referenceRate !== referenceRate) {
    fields["unitOptions.0.referenceRate"] = "Con una sola unidad, su tarifa es la tarifa del servicio.";
  }
  return fields;
}

/**
 * Indica si dos listas canónicas de unidades difieren (orden, unidad, denominación, texto o tarifa).
 *
 * @param {Array<object>} before - Unidades vigentes.
 * @param {Array<object>} after - Unidades resultantes.
 * @returns {boolean} true si hay un cambio efectivo.
 */
export function unitOptionsChanged(before, after) {
  return JSON.stringify(before.map(toCanonicalUnitOption)) !== JSON.stringify(after.map(toCanonicalUnitOption));
}
