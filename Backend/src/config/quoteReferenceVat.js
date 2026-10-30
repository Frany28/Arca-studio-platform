import { parseConfiguredReferenceVat } from "../domain/quoteReferenceVat.js";
import { AppError } from "../errors/appError.js";

/** Variable de entorno con la tasa del IVA referencial de las cotizaciones (porcentaje). */
export const QUOTE_REFERENCE_VAT_RATE_VARIABLE = "QUOTE_REFERENCE_VAT_RATE";

/**
 * Devuelve la tasa configurada del IVA referencial. Se lee en cada uso (sin caché), así que un
 * cambio de la variable se aplica tras el redespliegue sin más pasos. Sin valor, el IVA queda
 * «pendiente de configuración» y las cotizaciones se guardan sin él.
 *
 * @param {Record<string, string|undefined>} [environment] - Variables de entorno.
 * @returns {{ enabled: boolean, rate: string|null }} Tasa habilitada y normalizada, o sin configurar.
 * @throws {AppError} 500 QUOTE_REFERENCE_VAT_MISCONFIGURED si el valor no es un porcentaje válido:
 *   no se inventa una tasa ni se guarda una cotización con un IVA dudoso.
 */
export function getConfiguredReferenceVat(environment = process.env) {
  const parsed = parseConfiguredReferenceVat(environment[QUOTE_REFERENCE_VAT_RATE_VARIABLE]);
  if (parsed.error) {
    throw new AppError({
      code: "QUOTE_REFERENCE_VAT_MISCONFIGURED",
      message: "La tasa del IVA referencial configurada no es válida. Revisa la configuración del servidor.",
      status: 500,
    });
  }
  return parsed.referenceVat;
}
