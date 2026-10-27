import { z } from "zod";

import { describeDecimalParseError, formatScaledDecimal, parseScaledDecimal } from "../utils/scaledDecimal.js";

/**
 * Valida un decimal exacto con la precisión indicada y lo normaliza a texto con escala fija.
 * Registra el error en el contexto de Zod con el mismo mensaje que usa el motor de
 * cotizaciones, para que una regla no se redacte de dos maneras.
 *
 * @param {{ scale: number, maxIntegerDigits: number }} format - Precisión del campo.
 * @param {unknown} value - Valor recibido como texto decimal o número exacto.
 * @param {import("zod").RefinementCtx} context - Contexto de Zod para registrar el error.
 * @returns {string} Decimal normalizado ("12.00", "35.000") o `z.NEVER` si es inválido.
 */
function normalizeScaledDecimal(format, value, context) {
  const parsed = parseScaledDecimal(value, format);
  if (parsed.error) {
    context.addIssue({ code: "custom", message: describeDecimalParseError(parsed.error, format) });
    return z.NEVER;
  }
  return formatScaledDecimal(parsed.value, format.scale);
}

/**
 * Crea un esquema Zod para un decimal exacto no negativo con la precisión de una columna
 * NUMERIC. Reutiliza el analizador del motor de cotizaciones: no redondea, rechaza negativos
 * y números inseguros de JavaScript.
 *
 * @param {{ scale: number, maxIntegerDigits: number }} format - Precisión del campo (QUOTE_DECIMAL_FORMATS).
 * @returns {import("zod").ZodType<string>} Esquema que entrega el decimal normalizado.
 */
export function scaledDecimalText(format) {
  return z.unknown().transform((value, context) => normalizeScaledDecimal(format, value, context));
}
