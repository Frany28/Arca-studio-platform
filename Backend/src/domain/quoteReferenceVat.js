import { calculateQuoteTotals } from "./quoteTotals.js";

/*
 * Reglas del IVA referencial de las cotizaciones (informativo, no fiscal). Módulo puro: lo usan el
 * servicio de cotizaciones y la vista previa del formulario (Frontend/.../quoteAmounts.js), para
 * que ambos apliquen la misma tasa sin duplicar la regla.
 */

/** IVA sin tasa configurada («pendiente de configuración»): no se calcula ni se guarda. */
export const REFERENCE_VAT_NOT_CONFIGURED = Object.freeze({ enabled: false, rate: null });

/**
 * Lee la tasa configurada del IVA referencial a partir de su texto (variable de entorno
 * QUOTE_REFERENCE_VAT_RATE). Vacía o ausente significa «pendiente de configuración»; si no, se
 * valida con el motor de importes (porcentaje entre 0 y 100 con hasta 2 decimales; 0 es válido)
 * y se normaliza a su escala («16» → «16.00»).
 *
 * @param {string|undefined|null} rawRate - Texto configurado.
 * @returns {{ referenceVat: { enabled: boolean, rate: string|null } } | { error: string }} Tasa
 *   habilitada o REFERENCE_VAT_NOT_CONFIGURED; `error` con el motivo si el texto no es válido.
 */
export function parseConfiguredReferenceVat(rawRate) {
  const rate = String(rawRate ?? "").trim();
  if (!rate) return { referenceVat: REFERENCE_VAT_NOT_CONFIGURED };
  try {
    const { referenceVat } = calculateQuoteTotals({ items: [], referenceVat: { enabled: true, rate } });
    return { referenceVat: { enabled: true, rate: referenceVat.rate } };
  } catch (error) {
    return { error: error.fields?.["referenceVat.rate"] ?? "No es una tasa válida." };
  }
}

/**
 * Elige el IVA referencial con que se calcula un guardado. Una cotización que ya se guardó con IVA
 * conserva su tasa al editarse, aunque la configuración cambie después; una nueva, o una guardada
 * cuando la tasa estaba pendiente, usa la configurada en ese momento.
 *
 * @param {object} options - Datos de la operación.
 * @param {{ enabled: boolean, rate: string|null }|null|undefined} options.stored - IVA de la versión
 *   vigente al editar; null o ausente al crear.
 * @param {{ enabled: boolean, rate: string|null }} options.configured - Tasa configurada.
 * @returns {{ enabled: boolean, rate: string|null }} IVA que se aplica.
 */
export function resolveQuoteReferenceVat({ configured, stored }) {
  if (stored?.enabled) return { enabled: true, rate: stored.rate };
  return configured.enabled ? { enabled: true, rate: configured.rate } : REFERENCE_VAT_NOT_CONFIGURED;
}
