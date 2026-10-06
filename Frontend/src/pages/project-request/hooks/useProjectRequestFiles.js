import { useRef, useState } from "react";

import { getProjectRequestFileErrors } from "../../../utils/projectRequestValidation.js";
import { isProjectRequestFileRemovable } from "../utils/projectRequestFilePresentation.js";

/**
 * Mantiene los adjuntos seleccionados y sus errores; no realiza uploads.
 * Cada selección se agrega a la anterior (el usuario puede elegir archivos de varias
 * carpetas) y los adjuntos pendientes o fallidos se pueden quitar uno a uno. Delega
 * límites, formatos y duplicados al validador compartido. Si ya existe un borrador
 * remoto se bloquea agregar archivos, como antes, para no mezclar selecciones con uploads
 * ya persistidos; quitar adjuntos no subidos sigue permitido porque no afecta al borrador.
 *
 * @param {Object} params - Estado externo usado para coordinar validación y envío.
 * @param {Object} params.currentFieldErrors - Errores actuales del formulario.
 * @param {number|string|null} params.draftId - Identificador de borrador; si es truthy bloquea agregar.
 * @param {boolean} params.hasAttemptedSubmit - Si ya se intentó validar el envío.
 * @param {Function} params.setShowRequiredAlert - Controla el aviso conjunto de campos y archivos.
 * @returns {Object} Adjuntos, errores y acciones para agregar, quitar, actualizar y reiniciar.
 */
export default function useProjectRequestFiles({
  currentFieldErrors,
  draftId,
  hasAttemptedSubmit,
  setShowRequiredAlert,
}) {
  const [files, setFiles] = useState([]);
  const [fileErrors, setFileErrors] = useState([]);
  // Contador local: los metadatos del archivo no son únicos si se agrega dos veces el mismo.
  const nextFileIdRef = useRef(0);

  /**
   * Aplica una nueva colección validándola completa y, tras un intento de envío, oculta
   * el aviso global cuando ya no quedan errores de campos ni de archivos.
   *
   * @param {Array} nextFiles - Colección resultante.
   * @returns {void}
   */
  const applyFiles = (nextFiles) => {
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

  /**
   * Agrega los archivos elegidos o soltados como adjuntos pendientes.
   *
   * @param {FileList|Array|null} fileList - Archivos nuevos.
   * @returns {void}
   */
  const handleFilesChange = (fileList) => {
    if (draftId) {
      setFileErrors(["Ya existe un borrador en proceso. Reintenta el envío antes de cambiar los archivos."]);
      return;
    }

    const addedFiles = Array.from(fileList || []).map((file) => {
      nextFileIdRef.current += 1;
      return {
        error: "",
        file,
        id: `project-request-file-${nextFileIdRef.current}`,
        progress: 0,
        status: "pending",
      };
    });
    if (!addedFiles.length) return;

    applyFiles([...files, ...addedFiles]);
  };

  /**
   * Quita un adjunto pendiente o fallido; ignora los subidos o en curso.
   *
   * @param {string} id - Identificador local del adjunto.
   * @returns {void}
   */
  const removeFile = (id) => {
    const target = files.find((item) => item.id === id);
    if (!isProjectRequestFileRemovable(target)) return;

    applyFiles(files.filter((item) => item.id !== id));
  };

  const updateFileItem = (id, values) => {
    setFiles((current) => current.map((item) => (
      item.id === id ? { ...item, ...values } : item
    )));
  };

  const resetFiles = () => {
    setFiles([]);
    setFileErrors([]);
  };

  return {
    fileErrors,
    files,
    handleFilesChange,
    removeFile,
    resetFiles,
    setFileErrors,
    updateFileItem,
  };
}
