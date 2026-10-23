import { TickCircle, Warning2 } from "iconsax-react";
import { useId, useState } from "react";

import Modal from "../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../hooks/useDialogKeyboard.js";

/**
 * Confirmación de activación o desactivación compartida por Servicios y Unidades con el diálogo
 * estándar de Modal (Figma 3727:686871). Activar usa el tema Success con icono positivo y
 * desactivar la variante Danger con icono de advertencia, en Cancelar y en la acción principal.
 * Las acciones se bloquean mientras la petición está en curso y durante la animación de salida.
 *
 * Modal mantiene el diálogo montado durante esa salida, cuando `change` ya es null. Sin conservar
 * el último cambio mostrado, la salida repintaba la variante por defecto (título, icono y tema de
 * desactivación) con el botón habilitado: parecía abrirse un segundo diálogo. El último cambio se
 * conserva ajustando el estado durante el render, sin efectos ni retrasos.
 *
 * @param {Object} props - Cambio pendiente, presentación y callbacks.
 * @param {Object|null} props.change - Cambio solicitado; null cierra el diálogo.
 * @param {boolean} props.submitting - Petición en curso.
 * @param {(change: Object) => {title: string, description: string, actionLabel: string,
 * activating: boolean, detail?: string}} props.describe - Textos del cambio; `detail` identifica
 * discretamente el registro bajo la descripción.
 * @param {string} props.dialogAttribute - Atributo `data-*` que identifica el diálogo.
 * @param {string} props.iconAttribute - Atributo `data-*` del icono (valor activate|deactivate).
 * @param {() => void} props.onCancel - Cierra sin cambios.
 * @param {() => void} props.onConfirm - Ejecuta el cambio.
 * @param {(change: Object) => HTMLElement|null} [props.getReturnFocus] - Origen del foco al cerrar.
 * @param {string} [props.dialogShellClassName] - Clases del contenedor del diálogo en Modal.
 * @param {string} [props.contentClassName] - Clases del contenido animado en Modal.
 * @returns {import("react").ReactElement} Modal de confirmación en portal.
 */
function StatusConfirmationModal({
  change,
  contentClassName,
  describe,
  dialogAttribute,
  dialogShellClassName,
  getReturnFocus,
  iconAttribute,
  onCancel,
  onConfirm,
  submitting,
}) {
  const dialogId = useId();
  const [shown, setShown] = useState({ change, submitting });
  if (change && (shown.change !== change || shown.submitting !== submitting)) setShown({ change, submitting });
  const closing = !change;
  const displayedChange = change ?? shown.change;
  // Tras confirmar, la salida conserva «Confirmando...» y las acciones bloqueadas: el diálogo no
  // vuelve a su estado abierto. Tras cancelar conserva la etiqueta original.
  const displayedSubmitting = closing ? shown.submitting : submitting;
  const texts = describe(displayedChange);
  const actionTheme = texts.activating ? "Success" : "Danger";
  const iconProps = { [iconAttribute]: texts.activating ? "activate" : "deactivate", "aria-hidden": "true" };

  useDialogKeyboard({
    open: Boolean(change),
    getContainer: () => document.querySelector(`[${dialogAttribute}]`),
    onEscape: () => {
      if (!submitting) onCancel();
    },
    getInitialFocus: (elements) => elements.find((element) => element.textContent?.trim() === "Cancelar"),
    getReturnFocus: getReturnFocus ? () => getReturnFocus(change) : undefined,
  });

  return (
    <Modal
      visible={Boolean(change)}
      showDialog
      alignment="Centered"
      overlayVariant="blurred"
      transitionPreset="fade-scale"
      dialogShellClassName={dialogShellClassName}
      contentClassName={contentClassName}
      title={<span id={`${dialogId}-title`}>{texts.title}</span>}
      description={(
        <span id={`${dialogId}-description`}>
          {texts.description}
          {texts.detail ? (
            <span className="mt-[4px] block text-[var(--color-text-50)] [overflow-wrap:anywhere]" data-status-confirmation-detail>
              {texts.detail}
            </span>
          ) : null}
        </span>
      )}
      secondaryActionLabel="Cancelar"
      primaryActionLabel={displayedSubmitting ? "Confirmando..." : texts.actionLabel}
      secondaryActionTheme={actionTheme}
      primaryActionTheme={actionTheme}
      actionsDisabled={displayedSubmitting || closing}
      primaryActionBusy={displayedSubmitting}
      icon={texts.activating
        ? <TickCircle size="20" color="currentColor" className="size-5 text-[var(--color-success-200)]" {...iconProps} />
        : <Warning2 size="20" color="currentColor" className="size-5 text-[var(--color-danger-100)]" {...iconProps} />}
      onClose={submitting || closing ? undefined : onCancel}
      onSecondaryAction={submitting || closing ? undefined : onCancel}
      onPrimaryAction={closing ? undefined : onConfirm}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      aria-describedby={`${dialogId}-description`}
      aria-busy={displayedSubmitting || undefined}
      {...{ [dialogAttribute]: "" }}
    />
  );
}

export default StatusConfirmationModal;
