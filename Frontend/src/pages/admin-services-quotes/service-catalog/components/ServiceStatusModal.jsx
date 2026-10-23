import { MinusCirlce, TickCircle } from "iconsax-react";

import Modal from "../../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../../hooks/useDialogKeyboard.js";

const DIALOG_SELECTOR = "[data-service-status-modal]";

/**
 * Textos breves de servicios para el diálogo compacto compartido: singular o plural según
 * la selección completa, sin exclusiones ni textos de administración de usuarios.
 *
 * @param {Object|null} change - Cambio individual o selección homogénea pendiente.
 * @returns {{title: string, description: string}} Textos.
 */
function describeServiceChange(change) {
  const count = change?.services?.length ?? 1;
  const plural = count > 1;
  const activating = Boolean(change?.isActive);
  const verb = activating ? "activar" : "desactivar";
  const question = plural ? `${count} servicios${activating ? " seleccionados" : ""}` : "este servicio";
  return {
    title: `${activating ? "Activar" : "Desactivar"} ${plural ? "servicios" : "servicio"}`,
    description: `¿Deseas ${verb} ${question}?${activating ? "" : ` No ${plural ? "estarán disponibles" : "estará disponible"} para nuevas cotizaciones.`}`,
  };
}

/**
 * Confirma la activación o desactivación de un servicio, o de varios seleccionados, con el diálogo
 * estándar de Modal, como en Unidades (Figma no define una confirmación propia). Desactivar no
 * elimina el servicio ni su historial: deja de ofrecerse y puede activarse de nuevo. Las acciones
 * se bloquean mientras la petición está en curso.
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
  const activating = Boolean(change?.isActive);
  const texts = describeServiceChange(change);

  useDialogKeyboard({
    open: Boolean(change),
    getContainer: () => document.querySelector(DIALOG_SELECTOR),
    onEscape: () => {
      if (!submitting) onCancel();
    },
    getInitialFocus: (elements) => elements.find((element) => element.textContent?.trim() === "Cancelar"),
  });

  return (
    <Modal
      visible={Boolean(change)}
      showDialog
      alignment="Centered"
      overlayVariant="blurred"
      transitionPreset="fade-scale"
      title={texts.title}
      description={texts.description}
      secondaryActionLabel="Cancelar"
      primaryActionLabel={submitting ? "Confirmando..." : activating ? "Activar" : "Desactivar"}
      actionsDisabled={submitting}
      primaryActionBusy={submitting}
      icon={activating
        ? <TickCircle size="20" color="currentColor" className="size-5" />
        : <MinusCirlce size="20" color="currentColor" className="size-5" />}
      onClose={submitting ? undefined : onCancel}
      onSecondaryAction={onCancel}
      onPrimaryAction={onConfirm}
      role="dialog"
      aria-modal="true"
      aria-label={texts.title}
      data-service-status-modal
    />
  );
}

export default ServiceStatusModal;
