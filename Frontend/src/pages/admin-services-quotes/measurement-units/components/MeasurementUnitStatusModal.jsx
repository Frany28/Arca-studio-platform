import { MinusCirlce, TickCircle } from "iconsax-react";

import Modal from "../../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../../hooks/useDialogKeyboard.js";

const DIALOG_SELECTOR = "[data-measurement-unit-status-modal]";

/**
 * Confirma la activación o desactivación de una unidad de medida con el diálogo estándar de
 * Modal. Desactivar no elimina el registro: deja de ofrecerse para servicios nuevos y conserva
 * su código público. Las acciones se bloquean mientras la petición está en curso.
 *
 * @param {Object} props - Cambio pendiente y callbacks.
 * @param {{denomination: Object, isActive: boolean}|null} props.change - Cambio solicitado.
 * @param {boolean} props.submitting - Petición en curso.
 * @param {() => void} props.onCancel - Cierra sin cambios.
 * @param {() => void} props.onConfirm - Ejecuta el cambio.
 * @returns {import("react").ReactElement} Modal de confirmación en portal.
 */
function MeasurementUnitStatusModal({ change, onCancel, onConfirm, submitting }) {
  const activating = Boolean(change?.isActive);
  const name = change ? `${change.denomination.publicCode} · ${change.denomination.label}` : "";
  const title = activating ? "¿Deseas activar la unidad de medida?" : "¿Deseas desactivar la unidad de medida?";

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
        ? `${name} volverá a estar disponible para asignarla a servicios.`
        : `${name} dejará de estar disponible para servicios nuevos. No se elimina y podrás activarla de nuevo.`}
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
      data-measurement-unit-status-modal
    />
  );
}

export default MeasurementUnitStatusModal;
