import { TickCircle, Warning2 } from "iconsax-react";
import { useId } from "react";

import Modal from "../../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../../hooks/useDialogKeyboard.js";

/**
 * Confirmación tras crear una cotización (Figma 5786:314247): diálogo centrado con icono positivo
 * y la única acción «Aceptar», que vuelve al listado. Solo se muestra después de que la API
 * confirme el alta.
 *
 * @param {Object} props - Visibilidad y callback.
 * @param {boolean} props.open - Muestra el diálogo.
 * @param {() => void} props.onAccept - Cierra y vuelve al listado.
 * @returns {import("react").ReactElement} Modal en portal.
 */
export function QuoteCreatedDialog({ onAccept, open }) {
  const dialogId = useId();
  useDialogKeyboard({
    open,
    getContainer: () => document.querySelector("[data-quote-created-dialog]"),
    onEscape: onAccept,
    getInitialFocus: (elements) => elements.find((element) => element.textContent?.trim() === "Aceptar"),
  });
  return (
    <Modal
      visible={open}
      showDialog
      alignment="Centered"
      title={<span id={`${dialogId}-title`}>Has creado la cotización exitosamente</span>}
      description={<span id={`${dialogId}-description`}>Tu cotización ha sido guardada correctamente y está lista para ser utilizada.</span>}
      icon={<TickCircle size="20" color="currentColor" className="size-5 text-[var(--color-success-200)]" aria-hidden="true" />}
      primaryActionLabel="Aceptar"
      showSecondaryAction={false}
      onClose={onAccept}
      onPrimaryAction={onAccept}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      aria-describedby={`${dialogId}-description`}
      data-quote-created-dialog=""
    />
  );
}

/**
 * Confirmación antes de descartar un borrador con cambios sin guardar (Figma 5786:314277):
 * «Volver» conserva el borrador y «Cancelar cotización» sale sin guardar nada; en una edición la
 * versión guardada no cambia. Usa la variante Danger porque descarta el trabajo del formulario.
 *
 * @param {Object} props - Visibilidad y callbacks.
 * @param {boolean} props.open - Muestra el diálogo.
 * @param {() => void} props.onStay - Vuelve al formulario.
 * @param {() => void} props.onDiscard - Descarta y sale.
 * @returns {import("react").ReactElement} Modal en portal.
 */
export function QuoteDiscardDialog({ onDiscard, onStay, open }) {
  const dialogId = useId();
  useDialogKeyboard({
    open,
    getContainer: () => document.querySelector("[data-quote-discard-dialog]"),
    onEscape: onStay,
    getInitialFocus: (elements) => elements.find((element) => element.textContent?.trim() === "Volver"),
  });
  return (
    <Modal
      visible={open}
      showDialog
      alignment="Centered"
      title={<span id={`${dialogId}-title`}>¿Deseas cancelar la cotización?</span>}
      description={<span id={`${dialogId}-description`}>Si optas por cancelarla, se eliminará todo el progreso actual.</span>}
      icon={<Warning2 size="20" color="currentColor" className="size-5 text-[var(--color-danger-100)]" aria-hidden="true" />}
      secondaryActionLabel="Volver"
      primaryActionLabel="Cancelar cotización"
      secondaryActionTheme="Danger"
      primaryActionTheme="Danger"
      onClose={onStay}
      onSecondaryAction={onStay}
      onPrimaryAction={onDiscard}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      aria-describedby={`${dialogId}-description`}
      data-quote-discard-dialog=""
    />
  );
}
