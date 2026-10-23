import { TickCircle, Warning2 } from "iconsax-react";
import { useId, useState } from "react";

import Modal from "../../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../../hooks/useDialogKeyboard.js";
import { describeServiceStatusConfirmation } from "../utils/serviceStatusConfirmation.js";

const DIALOG_SELECTOR = "[data-service-status-modal]";

/**
 * Confirma la activación o desactivación de un servicio, o de varios seleccionados, con el diálogo
 * estándar de Modal (Figma 3727:686871), también usado para retirar responsables. Desactivar no
 * elimina el servicio ni su historial: deja de ofrecerse y puede activarse de nuevo. Las acciones
 * se bloquean mientras la petición está en curso y durante la animación de salida, que conserva
 * el último cambio mostrado para no repintar otra variante del diálogo.
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
  const dialogId = useId();
  // Modal mantiene el diálogo montado durante su animación de salida, cuando `change` ya es null.
  // Sin conservar el último cambio mostrado, esa salida repintaba la variante por defecto
  // («¿Desactivar servicio?», icono y tema de desactivación) con el botón habilitado: parecía
  // abrirse un segundo diálogo. Se ajusta durante el render, sin efectos ni retrasos.
  const [shown, setShown] = useState({ change, submitting });
  if (change && (shown.change !== change || shown.submitting !== submitting)) setShown({ change, submitting });
  const closing = !change;
  const displayedChange = change ?? shown.change;
  // Tras confirmar, la salida conserva «Confirmando...» y las acciones bloqueadas: el diálogo no
  // vuelve a su estado abierto. Tras cancelar conserva la etiqueta original.
  const displayedSubmitting = closing ? shown.submitting : submitting;
  const activating = Boolean(displayedChange?.isActive);
  const texts = describeServiceStatusConfirmation(displayedChange);

  useDialogKeyboard({
    open: Boolean(change),
    getContainer: () => document.querySelector(DIALOG_SELECTOR),
    onEscape: () => {
      if (!submitting) onCancel();
    },
    getInitialFocus: (elements) => elements.find((element) => element.textContent?.trim() === "Cancelar"),
    // El menú se desmonta al abrir la confirmación; su disparador de fila permanece disponible.
    getReturnFocus: () => change?.service
      ? document.querySelector(`button[aria-label="${CSS.escape(`Más opciones para ${change.service.code}`)}"]`)
      : document.activeElement,
  });

  // Solo este diálogo centra el shell sin su compensación inferior y deja pasar el clic exterior
  // al overlay compartido; la tarjeta conserva eventos y la animación fade-scale existente.
  return (
    <Modal
      visible={Boolean(change)}
      showDialog
      alignment="Centered"
      overlayVariant="blurred"
      transitionPreset="fade-scale"
      dialogShellClassName="!pb-0 pointer-events-none"
      contentClassName="[&>*]:pointer-events-auto"
      title={<span id={`${dialogId}-title`}>{texts.title}</span>}
      description={<span id={`${dialogId}-description`}>{texts.description}</span>}
      secondaryActionLabel="Cancelar"
      primaryActionLabel={displayedSubmitting ? "Confirmando..." : texts.actionLabel}
      secondaryActionTheme={texts.actionTheme}
      primaryActionTheme={texts.actionTheme}
      actionsDisabled={displayedSubmitting || closing}
      primaryActionBusy={displayedSubmitting}
      icon={activating
        ? <TickCircle size="20" color="currentColor" className="size-5 text-[var(--color-success-200)]" data-service-status-icon="activate" aria-hidden="true" />
        : <Warning2 size="20" color="currentColor" className="size-5 text-[var(--color-danger-100)]" data-service-status-icon="deactivate" aria-hidden="true" />}
      onClose={submitting || closing ? undefined : onCancel}
      onSecondaryAction={submitting || closing ? undefined : onCancel}
      onPrimaryAction={closing ? undefined : onConfirm}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      aria-describedby={`${dialogId}-description`}
      aria-busy={displayedSubmitting || undefined}
      data-service-status-modal
    />
  );
}

export default ServiceStatusModal;
