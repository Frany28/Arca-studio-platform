import { CloseCircle, TickCircle } from "iconsax-react";
import { useId, useRef, useState } from "react";

import Modal, { ModalDialog } from "../../../components/ui/Modal/Modal.jsx";
import { MODAL_DARK_CONTRAST } from "../../../components/ui/Modal/modalConfig.js";
import { useDialogKeyboard } from "../../../hooks/useDialogKeyboard.js";
import { describeReviewResult } from "../utils/adminFileReview.js";

/**
 * Resultado de revisión confirmado por la API (Figma 3795:579327 y 3795:579509).
 * Los controles del modal solo lo cierran. Al salir, el foco vuelve a la pestaña activa.
 *
 * @param {Object} props - Resultado y navegación.
 * @param {"approve"|"reject"|null} props.action - Revisión confirmada o null para cerrar.
 * @param {() => HTMLElement|null} props.getReturnFocus - Pestaña que abrió el visor.
 * @param {() => void} props.onClose - Cierra el resultado.
 * @returns {import("react").ReactElement|null} Modal de resultado.
 */
function AdminFileReviewResultDialog({ action, getReturnFocus, onClose }) {
  const dialogRef = useRef(null);
  const id = useId();
  // Conserva el resultado durante la animación de salida.
  const [shownAction, setShownAction] = useState(action);
  if (action && action !== shownAction) setShownAction(action);

  useDialogKeyboard({
    open: Boolean(action),
    getContainer: () => dialogRef.current,
    getInitialFocus: (elements) => elements.find((element) => element.textContent.trim() === "Aceptar"),
    getReturnFocus,
    onEscape: onClose,
  });

  if (!shownAction) return null;
  const { description, title } = describeReviewResult(action ?? shownAction);
  const rejected = (action ?? shownAction) === "reject";

  return (
    <Modal visible={Boolean(action)} dialogShellClassName="!pb-0" onClose={onClose}>
      <ModalDialog
        alignment="Centered"
        dialogRef={dialogRef}
        insetBorders
        className={`max-h-[calc(100dvh-32px)] [&>button]:z-10 [&>button>svg]:size-[18px] ${MODAL_DARK_CONTRAST}`}
        bodyClassName="min-h-0 overflow-y-auto overscroll-contain [&>*]:shrink-0"
        title={<span id={`${id}-title`}>{title}</span>}
        description={<span id={`${id}-description`}>{description}</span>}
        icon={rejected
          ? <CloseCircle size="20" variant="Linear" color="currentColor" className="text-[var(--color-danger-200)]" />
          : <TickCircle size="20" variant="Linear" color="currentColor" className="text-[var(--color-success-200)]" />}
        primaryActionLabel="Aceptar"
        secondaryActionLabel="Cancelar"
        closeButtonAriaLabel="Cerrar resultado de revisión"
        onClose={onClose}
        onPrimaryAction={onClose}
        onSecondaryAction={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        inert={!action}
        data-admin-file-review-result={action ?? shownAction}
      />
    </Modal>
  );
}

export default AdminFileReviewResultDialog;
