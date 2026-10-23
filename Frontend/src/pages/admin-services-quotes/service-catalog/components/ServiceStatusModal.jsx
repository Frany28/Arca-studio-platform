import { MinusCirlce, TickCircle } from "iconsax-react";

import Modal from "../../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../../hooks/useDialogKeyboard.js";

const DIALOG_SELECTOR = "[data-service-status-modal]";

/**
 * Textos de la confirmación de varios servicios: cuántos cambiarán, cuántos seleccionados se
 * excluyen por estar ya en ese estado y que cada uno se procesa por separado (no es atómico).
 *
 * @param {{isActive: boolean, services: Array<Object>, selectedCount: number}} change - Cambio masivo.
 * @returns {{title: string, description: string}} Textos.
 */
function describeBulkChange({ isActive, selectedCount, services }) {
  const count = services.length;
  const skipped = selectedCount - count;
  const noun = count === 1 ? "1 servicio" : `${count} servicios`;
  const title = `¿Deseas ${isActive ? "activar" : "desactivar"} ${noun}?`;
  const effect = isActive
    ? "volverán a estar disponibles en el tabulador"
    : "dejarán de estar disponibles en el tabulador; no se eliminan y podrás activarlos de nuevo";
  const skippedText = skipped > 0
    ? ` ${skipped} de los ${selectedCount} seleccionados ya ${isActive ? "están activos" : "están inactivos"} y no cambian.`
    : "";
  return {
    title,
    description: `Los servicios ${effect}.${skippedText} Cada servicio se procesa por separado: si alguno no puede cambiar, los demás se aplican igualmente.`,
  };
}

/**
 * Confirma la activación o desactivación de un servicio, o de varios seleccionados, con el diálogo
 * estándar de Modal, como en Unidades (Figma no define una confirmación propia). Desactivar no
 * elimina el servicio ni su historial: deja de ofrecerse y puede activarse de nuevo. Las acciones
 * se bloquean mientras la petición está en curso.
 *
 * @param {Object} props - Cambio pendiente y callbacks.
 * @param {{service: Object, isActive: boolean}|{services: Array<Object>, isActive: boolean, selectedCount: number}|null} props.change
 * Cambio solicitado: un servicio (menú de la fila) o varios (pie de la tabla).
 * @param {boolean} props.submitting - Petición en curso.
 * @param {() => void} props.onCancel - Cierra sin cambios.
 * @param {() => void} props.onConfirm - Ejecuta el cambio.
 * @returns {import("react").ReactElement} Modal de confirmación en portal.
 */
function ServiceStatusModal({ change, onCancel, onConfirm, submitting }) {
  const activating = Boolean(change?.isActive);
  const bulk = Array.isArray(change?.services);
  const name = change && !bulk ? `${change.service.code} · ${change.service.name}` : "";
  const texts = bulk ? describeBulkChange(change) : {
    title: activating ? "¿Deseas activar el servicio?" : "¿Deseas desactivar el servicio?",
    description: activating
      ? `${name} volverá a estar disponible en el tabulador.`
      : `${name} dejará de estar disponible en el tabulador. No se elimina y podrás activarlo de nuevo.`,
  };

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
