import { PROJECT_REQUEST_TEXT_LIMITS } from "./projectRequest.js";

/*
 * Nombre de un proyecto nuevo (draft) creado desde una cotización. Módulo puro, sin I/O: lo usan
 * la validación, el servicio y el editor del frontend (importado como quoteTotals.js), para que la
 * coincidencia exacta se compare igual en ambos lados.
 */

// Mismos límites que el nombre de una solicitud de proyecto (projects.name es VARCHAR(150)).
export const PROJECT_NAME_LIMITS = PROJECT_REQUEST_TEXT_LIMITS.projectName;

/**
 * Normaliza el nombre escrito: recorta los extremos y reduce cualquier secuencia de espacios a uno.
 * Conserva mayúsculas y tildes, que son parte del nombre que se guarda y se muestra.
 *
 * @param {unknown} value - Texto escrito.
 * @returns {string} Nombre normalizado (vacío si no hay texto).
 */
export function normalizeProjectName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Clave de comparación de nombres equivalente a la unicidad de PostgreSQL
 * (uq_projects_client_active_name usa lower(name)): sin distinguir mayúsculas, con las tildes y
 * los espacios normalizados. El backend sigue siendo la autoridad: lower() de PostgreSQL puede
 * diferir de JavaScript en caracteres fuera de ASCII según la intercalación de la base.
 *
 * @param {unknown} value - Nombre escrito o guardado.
 * @returns {string} Clave en minúsculas.
 */
export function projectNameKey(value) {
  return normalizeProjectName(value).toLowerCase();
}

/**
 * Describe por qué un nombre de proyecto nuevo no es válido, o null si lo es.
 *
 * @param {unknown} value - Nombre escrito.
 * @returns {string|null} Mensaje para el campo o null.
 */
export function describeProjectNameError(value) {
  const name = normalizeProjectName(value);
  if (name.length < PROJECT_NAME_LIMITS.min) {
    return `El nombre del proyecto debe tener al menos ${PROJECT_NAME_LIMITS.min} caracteres.`;
  }
  if (name.length > PROJECT_NAME_LIMITS.max) {
    return `El nombre del proyecto admite como máximo ${PROJECT_NAME_LIMITS.max} caracteres.`;
  }
  return null;
}
