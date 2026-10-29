/*
 * Reglas puras de la unidad de medida de un servicio. No conocen PostgreSQL ni HTTP.
 *
 * - Cada servicio tiene exactamente una unidad: base y denominación opcional (en services), con la
 *   tarifa del servicio. Un servicio que se cobra de dos formas se registra como dos servicios.
 * - PostgreSQL guarda además esa unidad en service_unit_options (posición 1) con su texto
 *   comercial opcional, y cada versión la copia en service_version_unit_options. Las versiones
 *   anteriores a 20261030120000_service_single_unit_option pueden conservar unidades alternativas:
 *   son historial (y la unidad de conceptos ya cotizados) y nunca se ofrecen en cotizaciones nuevas.
 * - `presentationLabel` sustituye a la etiqueta compuesta («Global por Proyecto» en lugar de
 *   «proy.»). Solo es presentación: se conserva mientras la unidad no cambie.
 */

import { formatUnitLabel, normalizeUnitText } from "./measurementUnitLabel.js";

/** Posición de la unidad de un servicio (CHECK chk_service_unit_options_single en PostgreSQL). */
export const SERVICE_UNIT_POSITION = 1;

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
 * Etiqueta visible de la unidad de un servicio: el texto comercial si existe y, si no, la
 * composición de la abreviatura y la denominación («m² de construcción»).
 *
 * @param {{ symbol: string, denomination?: string|null, presentationLabel?: string|null }} unit - Unidad.
 * @returns {string} Etiqueta.
 */
export function formatUnitOptionLabel({ denomination = null, presentationLabel = null, symbol }) {
  return normalizePresentationLabel(presentationLabel) ?? formatUnitLabel(symbol, denomination);
}

/**
 * Texto comercial resultante de un alta o una edición: el enviado (vacío o null lo retira) o, si
 * no se envía, el vigente mientras la unidad sea la misma combinación de base y denominación. Un
 * cambio de unidad sin texto nuevo lo retira, porque describía la unidad anterior.
 *
 * @param {object} options - Datos de la operación.
 * @param {{ measurementUnitId: number, unitDenominationId: number|null, presentationLabel: string|null }|null} options.current
 *   - Unidad vigente (null en el alta).
 * @param {{ measurementUnitId: number, unitDenominationId: number|null }} options.next - Unidad resultante.
 * @param {string|null|undefined} options.requested - Texto enviado; undefined si no se envió.
 * @returns {string|null} Texto comercial resultante.
 */
export function resolvePresentationLabel({ current, next, requested }) {
  if (requested !== undefined) return normalizePresentationLabel(requested);
  if (!current) return null;
  const sameUnit = current.measurementUnitId === next.measurementUnitId && current.unitDenominationId === next.unitDenominationId;
  return sameUnit ? normalizePresentationLabel(current.presentationLabel) : null;
}
