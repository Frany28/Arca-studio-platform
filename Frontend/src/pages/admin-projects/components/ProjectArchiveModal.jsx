import { DocumentForward } from "iconsax-react";

import Modal from "../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../hooks/useDialogKeyboard.js";
import { getProjectDisplayName } from "../utils/projectRowActions.js";

const ARCHIVE_COPY = {
  archive: {
    title: "¿Deseas archivar el proyecto?",
    description: (name) => `${name} se ocultará de las listas principales y dejará de mostrarse en el portafolio público. Su información se conserva y podrás desarchivarlo después.`,
    confirm: "Archivar",
  },
  unarchive: {
    title: "¿Deseas desarchivar el proyecto?",
    description: (name) => `${name} volverá a las listas principales con su estado anterior. Su visibilidad pública permanecerá desactivada hasta que la cambies.`,
    confirm: "Desarchivar",
  },
};

/**
 * Confirma Archivar/Desarchivar desde el menú de fila con el diálogo estándar de Modal.
 * Comparte con el modal de configuración la misma operación de dominio; aquí solo se
 * presentan textos según el estado real del proyecto y se bloquean acciones al guardar.
 *
 * @param {Object} props - Estado del diálogo y callbacks del coordinador.
 * @param {boolean} props.open - Visibilidad animada.
 * @param {Object|null} props.project - Snapshot del proyecto.
 * @param {boolean} props.archived - Si el proyecto ya está archivado (ofrece desarchivar).
 * @param {boolean} props.submitting - Guardado en curso.
 * @param {() => void} props.onCancel - Cierra sin cambios.
 * @param {() => void} props.onConfirm - Ejecuta la operación.
 * @returns {import("react").ReactElement} Modal de confirmación en portal.
 */
function ProjectArchiveModal({ archived, onCancel, onConfirm, open, project, submitting }) {
  const copy = ARCHIVE_COPY[archived ? "unarchive" : "archive"];
  const getContainer = () => document.querySelector("[data-project-archive-modal]");

  useDialogKeyboard({
    open,
    getContainer,
    onEscape: onCancel,
    getInitialFocus: (elements) => elements.find((element) => element.textContent?.trim() === "Cancelar"),
  });

  return (
    <Modal
      visible={open}
      showDialog
      alignment="Centered"
      overlayVariant="blurred"
      transitionPreset="fade-scale"
      title={copy.title}
      description={copy.description(getProjectDisplayName(project))}
      secondaryActionLabel="Cancelar"
      primaryActionLabel={submitting ? "Confirmando..." : copy.confirm}
      actionsDisabled={submitting}
      primaryActionBusy={submitting}
      icon={<DocumentForward size="20" color="currentColor" className="size-5" />}
      onClose={onCancel}
      onSecondaryAction={onCancel}
      onPrimaryAction={onConfirm}
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      data-project-archive-modal
    />
  );
}

export default ProjectArchiveModal;
