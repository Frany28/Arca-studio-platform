import { PROJECT_REQUEST_OPTIONS } from "../../../utils/projectRequestOptions.js";

export const LEGAL_DOCUMENTS_PLACEHOLDER = "Selecciona la documentación";
// Figma resume la selección con dos documentos y "otros" para no desbordar el trigger.
const MAX_SUMMARY_LABELS = 2;

/**
 * Construye los ítems Checkbox de `DropdownMenu` a partir de los documentos seleccionados.
 * Conserva el orden del catálogo, independiente del orden en que se marcaron.
 *
 * @param {Array<string>} selectedValues - Valores marcados.
 * @param {Array<Object>} [options] - Catálogo de documentos del inmueble o del evento.
 * @returns {Array<{id: string, label: string, type: "Checkbox", checked: "Yes"|"No"}>} Ítems del menú.
 */
export function toLegalDocumentItems(selectedValues, options = PROJECT_REQUEST_OPTIONS.legalDocumentTypes) {
  const selected = new Set(Array.isArray(selectedValues) ? selectedValues : []);
  return options.map((option) => ({
    checked: selected.has(option.value) ? "Yes" : "No",
    id: option.value,
    label: option.label,
    supportingText: "",
    type: "Checkbox",
  }));
}

/**
 * Extrae los valores marcados de los ítems devueltos por `DropdownMenu.onItemsChange`.
 *
 * @param {Array<{id: string, checked: string}>} items - Ítems actualizados del menú.
 * @returns {Array<string>} Valores seleccionados en orden de catálogo.
 */
export function fromLegalDocumentItems(items) {
  return (items || []).filter((item) => item.checked === "Yes").map((item) => String(item.id));
}

/**
 * Resume la selección para el trigger: hasta dos etiquetas y ", otros" si hay más.
 *
 * @param {Array<string>} selectedValues - Valores marcados.
 * @param {Array<Object>} [options] - Catálogo usado para traducir los valores.
 * @returns {string} Texto visible del trigger o el placeholder si no hay selección.
 */
export function getLegalDocumentsSummary(selectedValues, options = PROJECT_REQUEST_OPTIONS.legalDocumentTypes) {
  const labels = toLegalDocumentItems(selectedValues, options)
    .filter((item) => item.checked === "Yes")
    .map((item) => item.label);

  if (!labels.length) return LEGAL_DOCUMENTS_PLACEHOLDER;
  if (labels.length <= MAX_SUMMARY_LABELS) return labels.join(", ");
  return `${labels.slice(0, MAX_SUMMARY_LABELS).join(", ")}, otros`;
}
