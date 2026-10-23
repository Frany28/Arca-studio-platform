import { formatMeasurementUnitIdentity } from "./measurementUnitPresentation.js";

/**
 * Textos de la confirmación de activación o desactivación de una unidad de medida, con el patrón
 * de Servicios. La identidad (código público y nombre) se muestra de forma discreta bajo la
 * descripción. Desactivar no elimina la unidad: puede activarse de nuevo.
 *
 * @param {{denomination: Object, isActive: boolean}|null} change - Cambio pendiente.
 * @returns {{title: string, description: string, actionLabel: string, activating: boolean, detail: string}} Textos.
 */
export function describeMeasurementUnitStatusConfirmation(change) {
  const activating = Boolean(change?.isActive);
  return {
    activating,
    actionLabel: activating ? "Activar" : "Desactivar",
    title: activating ? "¿Activar unidad de medida?" : "¿Desactivar unidad de medida?",
    description: activating
      ? "Esta unidad volverá a estar disponible para nuevas asignaciones"
      : "Esta unidad dejará de estar disponible para nuevas asignaciones. Podrás activarla nuevamente",
    detail: formatMeasurementUnitIdentity(change?.denomination),
  };
}

// Consecuencia de cada operación confirmada; la edición solo informa el nombre vigente.
const SUCCESS_COPY = {
  create: { title: "Unidad creada correctamente", message: "Ya está disponible para asignarla a servicios" },
  update: { title: "Unidad actualizada correctamente", message: "" },
  unchanged: { title: "Sin cambios", message: "" },
  activate: { title: "Unidad activada correctamente", message: "Vuelve a estar disponible para nuevas asignaciones" },
  deactivate: { title: "Unidad desactivada correctamente", message: "Ya no está disponible para nuevas asignaciones" },
};

/**
 * Presenta una operación de unidades confirmada por la API con el patrón de avisos de Servicios:
 * título, identidad real devuelta por el backend como contenido y su consecuencia.
 *
 * @param {"create"|"update"|"unchanged"|"activate"|"deactivate"} operation - Operación confirmada.
 * @param {{publicCode?: string, label?: string}|null} denomination - Unidad devuelta por la API.
 * @returns {{tone: "success", title: string, message: string, content: string}} Aviso de éxito.
 */
export function describeMeasurementUnitSuccess(operation, denomination) {
  const copy = SUCCESS_COPY[operation];
  return { tone: "success", title: copy.title, message: copy.message, content: formatMeasurementUnitIdentity(denomination) };
}
