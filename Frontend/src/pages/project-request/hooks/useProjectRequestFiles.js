import { useRef, useState } from "react";

import { getProjectRequestFileErrors } from "../../../utils/projectRequestValidation.js";

/**
 * Adapta la selecci?n del input a items pendientes con progreso y error propios.
 * Combina metadatos e ?ndice para identificar cada archivo dentro de la selecci?n.
 *
 * @param {Object|Array|null} fileList - FileList o colecci?n de archivos.
 * @returns {Array} Items con file, id, status pending, progress cero y error vac?o.
 */
function toFileItems(fileList) {
  return Array.from(fileList || []).map((file, index) => ({
    error: "",
    file,
    id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
    progress: 0,
    status: "pending",
  }));
}

/**
 * Mantiene archivos seleccionados, sus errores y la referencia al input; no realiza uploads.
 * Delega l?mites y formatos al validador compartido y bloquea cambios si existe borrador.
 *
 * @param {Object} params - Estado externo usado para coordinar validaci?n y env?o.
 * @param {Object} params.currentFieldErrors - Errores actuales del formulario.
 * @param {number|string|null} params.draftId - Identificador de borrador; si es truthy bloquea cambios.
 * @param {boolean} params.hasAttemptedSubmit - Si ya se intent? validar el env?o.
 * @param {Function} params.setShowRequiredAlert - Controla el aviso conjunto de campos y archivos.
 * @returns {Object} Archivos, errores, referencia al input y acciones de selecci?n, actualizaci?n y reset.
 */
export default function useProjectRequestFiles({
  currentFieldErrors,
  draftId,
  hasAttemptedSubmit,
  setShowRequiredAlert,
}) {
  const [files, setFiles] = useState([]);
  const [fileErrors, setFileErrors] = useState([]);
  const fileInputRef = useRef(null);

  /**
   * Reemplaza la selecci?n y aplica la validaci?n compartida, salvo que exista borrador.
   * Tras un intento de env?o oculta el aviso solo si no quedan errores de campos ni archivos.
   *
   * @param {Object|Array|null} fileList - Nueva selecci?n de archivos.
   * @returns {void} Actualiza archivos, errores y eventualmente el aviso.
   */
  const handleFilesChange = (fileList) => {
    if (draftId) {
      setFileErrors(["Ya existe un borrador en proceso. Reintenta el envío antes de cambiar los archivos."]);
      return;
    }

    const nextFiles = toFileItems(fileList);
    const nextErrors = getProjectRequestFileErrors(nextFiles);
    setFiles(nextFiles);
    setFileErrors(nextErrors);

    if (
      hasAttemptedSubmit
      && nextErrors.length === 0
      && Object.keys(currentFieldErrors).length === 0
    ) {
      setShowRequiredAlert(false);
    }
  };

  const updateFileItem = (id, values) => {
    setFiles((current) => current.map((item) => (
      item.id === id ? { ...item, ...values } : item
    )));
  };

  const resetFiles = () => {
    setFiles([]);
    setFileErrors([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return {
    fileErrors,
    fileInputRef,
    files,
    handleFilesChange,
    resetFiles,
    setFileErrors,
    updateFileItem,
  };
}
