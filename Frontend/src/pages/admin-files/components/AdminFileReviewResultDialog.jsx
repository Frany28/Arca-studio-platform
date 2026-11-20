import { TickCircle } from "iconsax-react";
import { useId, useState } from "react";

import Modal from "../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../hooks/useDialogKeyboard.js";
import { describeReviewResult } from "../utils/adminFileReview.js";

/**
 * Aviso de una revisión confirmada (Figma 3795:580699 «Archivo aprobado correctamente» y
 * 3797:278032 «Archivo rechazado correctamente»). El texto se redacta con la respuesta de la API
 * (describeReviewResult): Figma anuncia que el archivo «ahora es visible», pero aprobar no comparte
 * con el cliente, así que el aviso lo dice expresamente. Figma muestra «Cancelar» y «Aceptar»; como
 * no hay nada que cancelar, solo se ofrece «Aceptar». Conserva el último aviso durante la salida.
 *
 * @param {Object} props - Revisión confirmada y cierre.
 * @param {{ action: "approve"|"reject", result: Object, name: string }|null} props.review - Revisión; null cierra.
 * @param {() => void} props.onClose - Cierra el aviso.
 * @returns {import("react").ReactElement} Modal en portal.
 */
function AdminFileReviewResultDialog({ onClose, review }) {
  const dialogId = useId();
  const [shown, setShown] = useState(review);
  if (review && review !== shown) setShown(review);
  const displayed = review ?? shown;
  const texts = displayed ? describeReviewResult(displayed.action, displayed.result, displayed.name) : { description: "", title: "" };

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
      icon={<TickCircle size="20" color="currentColor" className="size-5 text-[var(--color-success-200)]" aria-hidden="true" />}
      primaryActionLabel="Aceptar"
      showSecondaryAction={false}
      onClose={onClose}
      onPrimaryAction={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      aria-describedby={`${dialogId}-description`}
      data-admin-file-review-result={displayed?.action || ""}
    />
  );
}

export default AdminFileReviewResultDialog;
