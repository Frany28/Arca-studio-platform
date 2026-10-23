import StatusConfirmationModal from "../../components/StatusConfirmationModal.jsx";
import { describeServiceStatusConfirmation } from "../utils/serviceStatusConfirmation.js";

/**
 * Adapta los textos de Servicios a la confirmación de estado compartida.
 *
 * @param {Object|null} change - Cambio individual o selección homogénea.
 * @returns {{title: string, description: string, actionLabel: string, activating: boolean}} Textos.
 */
function describeServiceChange(change) {
  return { ...describeServiceStatusConfirmation(change), activating: Boolean(change?.isActive) };
}

/**
 * Devuelve el foco al disparador de la fila: el menú se desmonta al abrir la confirmación.
 * Para el pie de la tabla conserva el elemento enfocado al abrir.
 *
 * @param {Object|null} change - Cambio que abrió el diálogo.
 * @returns {HTMLElement|null} Elemento que recibirá el foco al cerrar.
 */
function getServiceReturnFocus(change) {
  return change?.service
    ? document.querySelector(`button[aria-label="${CSS.escape(`Más opciones para ${change.service.code}`)}"]`)
    : document.activeElement;
}

/**
 * Confirma la activación o desactivación de un servicio, o de varios seleccionados, con la
 * confirmación de estado compartida (Figma 3727:686871). Desactivar no elimina el servicio ni su
 * historial: deja de ofrecerse y puede activarse de nuevo.
 *
 * @param {Object} props - Cambio pendiente y callbacks.
 * @param {{service: Object, isActive: boolean}|{services: Array<Object>, isActive: boolean}|null} props.change
 * Cambio solicitado: un servicio (menú de la fila) o varios (pie de la tabla).
 * @param {boolean} props.submitting - Petición en curso.
 * @param {() => void} props.onCancel - Cierra sin cambios.
 * @param {() => void} props.onConfirm - Ejecuta el cambio.
 * @returns {import("react").ReactElement} Modal de confirmación en portal.
 */
function ServiceStatusModal({ change, onCancel, onConfirm, submitting }) {
  // Solo este diálogo centra el shell sin su compensación inferior y deja pasar el clic exterior
  // al overlay compartido; la tarjeta conserva eventos y la animación fade-scale existente.
  return (
    <StatusConfirmationModal
      change={change}
      submitting={submitting}
      describe={describeServiceChange}
      dialogAttribute="data-service-status-modal"
      iconAttribute="data-service-status-icon"
      getReturnFocus={getServiceReturnFocus}
      dialogShellClassName="!pb-0 pointer-events-none"
      contentClassName="[&>*]:pointer-events-auto"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export default ServiceStatusModal;
