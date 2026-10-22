import { MinusCirlce, TickCircle } from "iconsax-react";

import Modal from "../../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../../hooks/useDialogKeyboard.js";

const DIALOG_SELECTOR = "[data-service-status-modal]";

/**
 * Confirma la activación o desactivación de un servicio con el diálogo estándar de Modal, como
 * en Unidades (Figma no define una confirmación propia). Desactivar no elimina el servicio ni su
 * historial: deja de ofrecerse y puede activarse de nuevo. Las acciones se bloquean mientras la
 * petición está en curso.
 *
 * @param {Object} props - Cambio pendiente y callbacks.
 * @param {{service: Object, isActive: boolean}|null} props.change - Cambio solicitado.
 * @param {boolean} props.submitting - Petición en curso.
 * @param {() => void} props.onCancel - Cierra sin cambios.
 * @param {() => void} props.onConfirm - Ejecuta el cambio.
 * @returns {import("react").ReactElement} Modal de confirmación en portal.
 */
function ServiceStatusModal({ change, onCancel, onConfirm, submitting }) {
  const activating = Boolean(change?.isActive);
  const name = change ? `${change.service.code} · ${change.service.name}` : "";
  const title = activating ? "¿Deseas activar el servicio?" : "¿Deseas desactivar el servicio?";

  useDialogKeyboard({
    open: Boolean(change),
    getContainer: () => document.querySelector(DIALOG_SELECTOR),
    onEscape: onCancel,
    getInitialFocus: (elements) => elements.find((element) => element.textContent?.trim() === "Cancelar"),
  });

  return (
    <Modal
      visible={Boolean(change)}
      showDialog
      alignment="Centered"
      overlayVariant="blurred"
      transitionPreset="fade-scale"
      title={title}
      description={activating
        ? `${name} volverá a estar disponible en el tabulador.`
        : `${name} dejará de estar disponible en el tabulador. No se elimina y podrás activarlo de nuevo.`}
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
      aria-label={title}
      data-service-status-modal
    />
  );
}

export default ServiceStatusModal;
