/**
 * Etiquetas visibles de los niveles de compatibilidad calculados por el backend
 * (`compatibilityLevel` en `Backend/src/domain/projectRequest.js`).
 */
export const PROJECT_REQUEST_COMPATIBILITY_LABELS = {
  excellent: "Excelente compatibilidad",
  high: "Buena compatibilidad",
  medium: "Compatibilidad media",
  low: "Baja compatibilidad",
  poorly_defined: "Solicitud poco definida",
};

// Valoración visual de cada nivel; los niveles bajos no deben verse como un éxito.
const COMPATIBILITY_PROGRESS_THEMES = {
  excellent: "Success",
  high: "Success",
  medium: "Warning",
  low: "Danger",
  poorly_defined: "Danger",
};

/**
 * Resuelve la etiqueta legible de un nivel de compatibilidad.
 * Los niveles desconocidos (p. ej. versiones futuras de la fórmula) usan el fallback.
 *
 * @param {string|null|undefined} level - Nivel devuelto por la API.
 * @param {string} [fallback="Evaluación disponible"] - Texto alternativo.
 * @returns {string} Etiqueta del nivel.
 */
export function getCompatibilityLevelLabel(level, fallback = "Evaluación disponible") {
  return PROJECT_REQUEST_COMPATIBILITY_LABELS[level] || fallback;
}

/**
 * Normaliza la compatibilidad de una solicitud para presentarla en un progreso circular.
 * Limita el score a 0–100 y devuelve null cuando la solicitud todavía no fue evaluada,
 * para que la vista muestre un estado vacío en lugar de un 0 % engañoso.
 *
 * @param {{score?: number|string, level?: string}|null|undefined} compatibility - Evaluación de la API.
 * @returns {{score: number, label: string, theme: string}|null} Datos de presentación o null.
 */
export function getCompatibilityPresentation(compatibility) {
  const rawScore = Number(compatibility?.score);
  if (compatibility?.score == null || !Number.isFinite(rawScore)) return null;

  return {
    label: getCompatibilityLevelLabel(compatibility.level),
    score: Math.round(Math.max(0, Math.min(100, rawScore))),
    theme: COMPATIBILITY_PROGRESS_THEMES[compatibility.level] || "Accent",
  };
}
