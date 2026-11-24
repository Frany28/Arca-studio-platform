import { CloseCircle, TickCircle } from "iconsax-react";
import { useId, useState } from "react";

import Modal from "../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../hooks/useDialogKeyboard.js";
import { describeReviewResult } from "../utils/adminFileReview.js";

/**
 * Confirmación de una revisión (Figma 3795:579327 «Archivo aprobado correctamente» y 3795:579509
 * «Archivo rechazado correctamente»): icono de éxito o de rechazo, título, texto de Figma y los dos
 * botones del diseño. Solo se abre con la respuesta confirmada de la API; la operación ya está
 * persistida, así que «Cancelar» y «Aceptar» solo cierran (ninguno repite ni deshace nada).
 *
 * @param {Object} props - Revisión confirmada o null y cierre.
 * @param {{ action: "approve"|"reject", result: Object, name: string }|null} props.review - Revisión.
 * @param {() => void} props.onClose - Cierra el aviso.
 * @returns {import("react").ReactElement} Modal.
 */
function AdminFileReviewResultDialog({ onClose, review }) {
  const dialogId = useId();
  const [shown, setShown] = useState(review);
  if (review && review !== shown) setShown(review);
  const displayed = review ?? shown;
  const texts = displayed ? describeReviewResult(displayed.action) : { description: "", title: "" };
  const rejected = displayed?.action === "reject";

  useDialogKeyboard({
    open: Boolean(review),
    getContainer: () => document.querySelector("[data-admin-file-review-result]"),
    onEscape: onClose,
    getInitialFocus: (elements) => elements.find((element) => element.textContent?.trim() === "Aceptar"),
  });

  return (
    <Modal
      visible={Boolean(review)}
      showDialog
      alignment="Centered"
      overlayVariant="blurred"
      transitionPreset="fade-scale"
      title={<span id={`${dialogId}-title`}>{texts.title}</span>}
      description={<span id={`${dialogId}-description`}>{texts.description}</span>}
      icon={rejected
        ? <CloseCircle size="20" color="currentColor" className="size-5 text-[var(--color-danger-100)]" aria-hidden="true" />
        : <TickCircle size="20" color="currentColor" className="size-5 text-[var(--color-success-200)]" aria-hidden="true" />}
      primaryActionLabel="Aceptar"
      secondaryActionLabel="Cancelar"
      showSecondaryAction
      onClose={onClose}
      onPrimaryAction={onClose}
      onSecondaryAction={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      aria-describedby={`${dialogId}-description`}
      data-admin-file-review-result={displayed?.action || ""}
    />
  );
}

export default AdminFileReviewResultDialog;
