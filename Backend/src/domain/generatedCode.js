/*
 * Códigos visibles generados por el sistema a partir del id de un registro (`SERV-001`,
 * `COT-001`). Heredan la unicidad y la permanencia del id, admiten saltos en la numeración y
 * son solo presentación y búsqueda: las relaciones y las reglas usan siempre el id.
 */

const GENERATED_CODE_MIN_DIGITS = 3;

/**
 * Compone un código visible con un prefijo y el id con al menos tres dígitos (`SERV-001`,
 * `COT-1000`). Valida el id para no generar códigos que PostgreSQL rechazaría por su CHECK
 * ni números inseguros en JavaScript.
 *
 * @param {string} prefix - Prefijo con su separador, por ejemplo `COT-`.
 * @param {number} id - Identificador del registro (entero positivo seguro).
 * @param {string} subject - Descripción del registro para el mensaje de error («el id del servicio»).
 * @returns {string} Código generado.
 * @throws {TypeError} Si el id no es un entero positivo seguro.
 */
export function formatGeneratedCode(prefix, id, subject) {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError(`${subject} debe ser un entero positivo.`);
  }
  return `${prefix}${String(id).padStart(GENERATED_CODE_MIN_DIGITS, "0")}`;
}
