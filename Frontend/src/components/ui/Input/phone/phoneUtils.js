/**
 * Extrae los dígitos del teléfono o prefijo sin interpretar su validez.
 * Convierte valores ausentes en vacío y elimina los separadores de presentación.
 *
 * @param {*} value Número, prefijo o texto recibido.
 * @returns {string} Dígitos conservados en su orden original.
 */
export function getPhoneDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}


/**
 * Normaliza el prefijo conservando un único signo más antes de sus dígitos.
 * Un valor sin dígitos produce "+" para mantener el estado de búsqueda vacío.
 *
 * @param {*} value Prefijo recibido.
 * @returns {string} Prefijo de presentación.
 */
export function normalizeDialCode(value) {
  const digits = getPhoneDigits(value);

  if (!digits) {
    return "+";
  }

  return `+${digits}`;
}


/**
 * Aplica la máscara del país al número, sin completar dígitos ausentes.
 * Conserva el formato original: descarta el exceso de dígitos y usa la máscara de respaldo.
 *
 * @param {*} value Número que se desea presentar.
 * @param {Object} [option] País seleccionado con su máscara opcional.
 * @returns {string} Número formateado o vacío.
 */
export function formatPhoneNumber(value, option) {
  const digits = getPhoneDigits(value);
  const mask = option?.mask ?? "(###) ####-####";

  if (!digits) {
    return "";
  }

  let digitIndex = 0;
  let output = "";

  for (const character of mask) {
    if (character === "#") {
      if (digitIndex >= digits.length) {
        break;
      }

      output += digits[digitIndex];
      digitIndex += 1;
      continue;
    }

    if (digitIndex < digits.length) {
      output += character;
    }
  }

  return output;
}
