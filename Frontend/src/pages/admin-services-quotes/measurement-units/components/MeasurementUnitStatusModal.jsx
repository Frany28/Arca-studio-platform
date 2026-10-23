import StatusConfirmationModal from "../../components/StatusConfirmationModal.jsx";
import { describeMeasurementUnitStatusConfirmation } from "../utils/measurementUnitFeedback.js";

/**
 * Devuelve el foco al disparador «Más opciones» de la fila: su menú se desmonta al confirmar.
 *
 * @param {{denomination: Object}|null} change - Cambio que abrió el diálogo.
 * @returns {HTMLElement|null} Disparador de la fila, si sigue en la página.
 */
function getUnitReturnFocus(change) {
  const code = change?.denomination?.publicCode;
  return code ? document.querySelector(`button[aria-label="${CSS.escape(`Más opciones para ${code}`)}"]`) : null;
}

/**
 * Confirma la activación o desactivación de una unidad de medida con la confirmación de estado
 * compartida con Servicios. Desactivar no elimina el registro: deja de ofrecerse para nuevas
 * asignaciones y conserva su código público. El backend decide si la unidad está en uso.
 *
 * @param {Object} props - Cambio pendiente y callbacks.
 * @param {{denomination: Object, isActive: boolean}|null} props.change - Cambio solicitado.
 * @param {boolean} props.submitting - Petición en curso.
 * @param {() => void} props.onCancel - Cierra sin cambios.
 * @param {() => void} props.onConfirm - Ejecuta el cambio.
 * @returns {import("react").ReactElement} Modal de confirmación en portal.
 */
function MeasurementUnitStatusModal({ change, onCancel, onConfirm, submitting }) {
  return (
    <StatusConfirmationModal
      change={change}
      submitting={submitting}
      describe={describeMeasurementUnitStatusConfirmation}
      dialogAttribute="data-measurement-unit-status-modal"
      iconAttribute="data-measurement-unit-status-icon"
      getReturnFocus={getUnitReturnFocus}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export default MeasurementUnitStatusModal;
