/*
 * Nombre de un cliente nuevo creado al guardar una cotización. Módulo puro, sin I/O: lo usan la
 * validación, el servicio y el editor del frontend. El nombre se guarda tal como se escribe (sin
 * dividirlo en nombre y apellido): puede ser una persona natural o una empresa.
 */

// clients.name y users.first_name son VARCHAR(150).
export const CLIENT_NAME_LIMITS = Object.freeze({ max: 150, min: 2 });

// Marcas diacríticas combinantes (U+0300–U+036F), el mismo rango que public.person_name_key.
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

/**
 * Normaliza el nombre escrito: recorta los extremos y reduce cualquier secuencia de espacios a uno.
 * Conserva mayúsculas y tildes, que forman parte del nombre que se guarda y se muestra.
 *
 * @param {unknown} value - Texto escrito.
 * @returns {string} Nombre normalizado (vacío si no hay texto).
 */
export function normalizeClientName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Clave de comparación sin mayúsculas, acentos ni espacios repetidos, equivalente a
 * public.person_name_key. Solo orienta al frontend: la autoridad es la consulta de PostgreSQL.
 *
 * @param {unknown} value - Nombre escrito o guardado.
 * @returns {string} Clave normalizada.
 */
export function clientNameKey(value) {
  return normalizeClientName(String(value ?? "").normalize("NFD").replace(COMBINING_MARKS, "")).toLowerCase();
}

/**
 * Describe por qué el nombre de un cliente nuevo no es válido, o null si lo es.
 *
 * @param {unknown} value - Nombre escrito.
 * @returns {string|null} Mensaje para el campo o null.
 */
export function describeClientNameError(value) {
  const name = normalizeClientName(value);
  if (name.length < CLIENT_NAME_LIMITS.min) {
    return `El nombre del cliente debe tener al menos ${CLIENT_NAME_LIMITS.min} caracteres.`;
  }
  if (name.length > CLIENT_NAME_LIMITS.max) {
    return `El nombre del cliente admite como máximo ${CLIENT_NAME_LIMITS.max} caracteres.`;
  }
  if (!/[\p{L}\p{N}]/u.test(name)) return "El nombre del cliente debe incluir letras o números.";
  return null;
}
