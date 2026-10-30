/*
 * Reglas del IVA referencial de las cotizaciones (informativo, no fiscal). Módulo puro: lo usan el
 * servicio de cotizaciones y la vista previa del formulario (Frontend/.../quoteAmounts.js), para
 * que ambos apliquen la misma tasa sin duplicar la regla. El PDF no imprime el IVA referencial.
 */

/** Tasa referencial fija de las cotizaciones nuevas (porcentaje, escala de QUOTE_DECIMAL_FORMATS.vatRate). */
export const QUOTE_REFERENCE_VAT_RATE = "16.00";

/** IVA referencial que se aplica a una cotización nueva. */
export const QUOTE_REFERENCE_VAT = Object.freeze({ enabled: true, rate: QUOTE_REFERENCE_VAT_RATE });

/** Versión guardada sin IVA referencial (anterior a esta regla): no tiene tasa ni importe. */
export const REFERENCE_VAT_NOT_APPLIED = Object.freeze({ enabled: false, rate: null });

/**
 * Elige el IVA referencial con que se calcula un guardado. Una cotización nueva usa la tasa fija;
 * una existente conserva el de su versión guardada (su tasa histórica, o sin IVA si se guardó
 * antes de esta regla), para no sustituirlo en silencio al editarla.
 *
 * @param {object} options - Datos de la operación.
 * @param {{ enabled: boolean, rate: string|null }|null|undefined} options.stored - IVA de la versión
 *   vigente al editar; null o ausente al crear.
 * @returns {{ enabled: boolean, rate: string|null }} IVA que se aplica.
 */
export function resolveQuoteReferenceVat({ stored }) {
  if (!stored) return QUOTE_REFERENCE_VAT;
  return stored.enabled ? { enabled: true, rate: stored.rate } : REFERENCE_VAT_NOT_APPLIED;
}

/**
 * Escribe la tasa para mostrarla junto a «IVA referencial» sin los ceros decimales sobrantes de
 * NUMERIC(5,2) («16.00» → «16», «12.50» → «12.5»). Trabaja sobre texto, sin convertir a Number.
 *
 * @param {string} rate - Tasa como texto decimal.
 * @returns {string} Tasa para mostrar, sin el signo «%».
 */
export function formatReferenceVatRate(rate) {
  const [integerPart, fractionPart = ""] = String(rate).split(".");
  const fraction = fractionPart.replace(/0+$/, "");
  return fraction ? `${integerPart}.${fraction}` : integerPart;
}

