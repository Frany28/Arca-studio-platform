import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { getProjectRequestFileErrors } from "../../../utils/projectRequestValidation.js";
import { isProjectRequestFileRemovable } from "../utils/projectRequestFilePresentation.js";
import useProjectRequestDetail from "./useProjectRequestDetail.js";

const ATTACHMENTS_LOADING_MESSAGE = "Espera a que carguen los archivos adjuntos de la solicitud.";
const ATTACHMENTS_ERROR_PREFIX = "No se pudieron cargar los archivos adjuntos: ";

/**
 * Indica si un mensaje describe la disponibilidad de los adjuntos guardados (carga o error de
 * lectura), que depende del estado vigente de la lectura y no de la selección.
 *
 * @param {string} message - Mensaje de la sección.
 * @returns {boolean} true para los avisos de carga o error de lectura.
 */
function isAttachmentsAvailabilityMessage(message) {
  return message === ATTACHMENTS_LOADING_MESSAGE || message.startsWith(ATTACHMENTS_ERROR_PREFIX);
}

/**
 * Convierte un adjunto guardado en el backend al item del formulario. El descriptor `file`
 * no es un `File`: solo aporta nombre, tamaño y tipo para validar y presentar la tarjeta.
 *
 * @param {{id: number, name: string, size: number, fileType: string|null}} file - Adjunto de la API.
 * @param {boolean} removing - Si su eliminación está en curso.
 * @returns {Object} Item subido con `remoteId` y `persisted`.
 */
function toPersistedItem(file, removing) {
  return {
    error: "",
    file: { name: file.name, size: Number(file.size) || 0, type: file.fileType || "" },
    id: `project-request-persisted-${file.id}`,
    persisted: true,
    progress: 100,
    remoteId: file.id,
    removing,
    status: "uploaded",
  };
}

/**
 * Mantiene los adjuntos de la solicitud: los ya guardados en una corrección y los seleccionados
 * en la sesión, con sus errores. No sube archivos (lo hace el envío).
 *
 * - Corrección (`correctionRequestId`): lee los adjuntos guardados con useProjectRequestDetail y
 *   los muestra primero como subidos; se conservan al reenviar porque el envío omite los subidos.
 * - Agregar: cada selección se suma a la anterior, también con un borrador remoto, porque el envío
 *   solo sube los pendientes o fallidos. El validador compartido cuenta guardados y nuevos para el
 *   máximo de archivos, el tamaño total y los nombres repetidos (el backend reutilizaría un archivo
 *   con el mismo nombre, así que un repetido se rechaza antes de enviarse).
 * - Quitar: pendientes y fallidos se quitan localmente. Un adjunto subido solo se elimina en el
 *   servidor cuando existe un borrador editable (`draftId`, draft o changes_requested; el backend
 *   vuelve a comprobar estado y propiedad); si falla, se conserva y se informa el motivo.
 *
 * @param {Object} params - Estado externo usado para coordinar validación y envío.
 * @param {number|string|null} params.correctionRequestId - Solicitud devuelta cuyos adjuntos se cargan.
 * @param {Object} params.currentFieldErrors - Errores actuales del formulario.
 * @param {number|string|null} params.draftId - Borrador editable; habilita eliminar adjuntos subidos.
 * @param {boolean} params.hasAttemptedSubmit - Si ya se intentó validar el envío.
 * @param {Function} params.setShowRequiredAlert - Controla el aviso conjunto de campos y archivos.
 * @returns {Object} Adjuntos, errores, disponibilidad de los guardados y acciones para agregar,
 *   quitar, actualizar, validar y reiniciar.
 */
export default function useProjectRequestFiles({
  correctionRequestId = null,
  currentFieldErrors,
  draftId,
  hasAttemptedSubmit,
  setShowRequiredAlert,
}) {
  const [localFiles, setLocalFiles] = useState([]);
  const [fileErrors, setFileErrors] = useState([]);
  // Ids remotos eliminados o en eliminación: el detalle leído no se vuelve a pedir tras borrar.
  const [removedRemoteIds, setRemovedRemoteIds] = useState(() => new Set());
  const [removingRemoteIds, setRemovingRemoteIds] = useState(() => new Set());
  // Contador local: los metadatos del archivo no son únicos si se agrega dos veces el mismo.
  const nextFileIdRef = useRef(0);
  const persisted = useProjectRequestDetail({
    enabled: Boolean(correctionRequestId),
    projectRequestId: correctionRequestId,
  });
  const persistedFiles = persisted.projectRequest?.files;
  const persistedItems = useMemo(
    () => (persistedFiles || [])
      .filter((file) => !removedRemoteIds.has(file.id))
      .map((file) => toPersistedItem(file, removingRemoteIds.has(file.id))),
    [persistedFiles, removedRemoteIds, removingRemoteIds],
  );
  const files = useMemo(
    () => [...persistedItems, ...localFiles.map((item) => (
      item.remoteId && removingRemoteIds.has(item.remoteId) ? { ...item, removing: true } : item
    ))],
    [localFiles, persistedItems, removingRemoteIds],
  );
  const allowRemoteRemoval = Boolean(draftId);
  // Última selección confirmada: una eliminación remota termina después de otros cambios (por
  // ejemplo, agregar archivos mientras tanto) y debe aplicarse sobre la lista vigente.
  const latestRef = useRef({ localFiles, persistedItems });
  useEffect(() => {
    latestRef.current = { localFiles, persistedItems };
  });

  /**
   * Aplica una nueva selección local validándola junto con los adjuntos guardados y, tras un
   * intento de envío, oculta el aviso global cuando ya no quedan errores de campos ni archivos.
   *
   * @param {Array} nextLocalFiles - Selección local resultante.
   * @param {Array} [nextPersistedItems=persistedItems] - Guardados vigentes tras el cambio.
   * @returns {void}
   */
  const applyLocalFiles = (nextLocalFiles, nextPersistedItems = persistedItems) => {
    const nextErrors = getProjectRequestFileErrors([...nextPersistedItems, ...nextLocalFiles]);
    setLocalFiles(nextLocalFiles);
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

    applyLocalFiles([...localFiles, ...addedFiles]);
  };

  /**
   * Elimina en el servidor un adjunto subido. Mientras dura, el adjunto no se puede volver a
   * quitar; si falla, se conserva y el motivo se muestra con los errores de la sección.
   *
   * @param {Object} target - Adjunto subido con `remoteId`.
   * @returns {Promise<void>} Finaliza tras actualizar la lista o informar el error.
   */
  const removeRemoteFile = async (target) => {
    const { remoteId } = target;
    setRemovingRemoteIds((current) => new Set(current).add(remoteId));
    try {
      await api.projectRequests.deleteFile({ fileId: remoteId, projectRequestId: draftId });
      const latest = latestRef.current;
      if (target.persisted) {
        setRemovedRemoteIds((current) => new Set(current).add(remoteId));
        applyLocalFiles(latest.localFiles, latest.persistedItems.filter((item) => item.remoteId !== remoteId));
      } else {
        applyLocalFiles(latest.localFiles.filter((item) => item.id !== target.id), latest.persistedItems);
      }
    } catch (error) {
      const message = `${target.file?.name || "Un archivo"}: ${error?.message || "no se pudo eliminar."}`;
      setFileErrors((current) => (current.includes(message) ? current : [...current, message]));
    } finally {
      setRemovingRemoteIds((current) => {
        const next = new Set(current);
        next.delete(remoteId);
        return next;
      });
    }
  };

  /**
   * Quita un adjunto según su estado: localmente si no se ha subido o en el servidor si la
   * solicitud lo permite. Ignora los adjuntos que no se pueden quitar.
   *
   * @param {string} id - Identificador del adjunto en el formulario.
   * @returns {void}
   */
  const removeFile = (id) => {
    const target = files.find((item) => item.id === id);
    if (!isProjectRequestFileRemovable(target, { allowRemoteRemoval })) return;

    if (target.status === "uploaded") {
      void removeRemoteFile(target);
      return;
    }
    applyLocalFiles(localFiles.filter((item) => item.id !== id));
  };

  const updateFileItem = (id, values) => {
    setLocalFiles((current) => current.map((item) => (
      item.id === id ? { ...item, ...values } : item
    )));
  };

  /**
   * Valida todos los adjuntos para el envío. Mientras los guardados no estén disponibles, el
   * envío se bloquea: sin ellos no se pueden comprobar los límites ni los nombres repetidos.
   *
   * @returns {Array<string>} Errores que impiden enviar.
   */
  const availabilityMessage = persisted.loading
    ? ATTACHMENTS_LOADING_MESSAGE
    : persisted.error ? `${ATTACHMENTS_ERROR_PREFIX}${persisted.error}` : "";
  const getSubmitFileErrors = () => {
    const errors = getProjectRequestFileErrors(files);
    return availabilityMessage ? [...errors, availabilityMessage] : errors;
  };
  // Un aviso de disponibilidad solo se muestra mientras siga vigente: tras reintentar con éxito
  // desaparece sin esperar a otra validación.
  const visibleFileErrors = useMemo(
    () => fileErrors.filter((message) => !isAttachmentsAvailabilityMessage(message) || message === availabilityMessage),
    [availabilityMessage, fileErrors],
  );

  // Limpiar el formulario solo descarta la selección local: los adjuntos guardados siguen en la
  // solicitud y únicamente se eliminan con su botón.
  const resetFiles = () => {
    setLocalFiles([]);
    setFileErrors([]);
  };

  return {
    allowRemoteRemoval,
    attachmentsError: persisted.error,
    attachmentsLoading: persisted.loading,
    fileErrors: visibleFileErrors,
    files,
    getSubmitFileErrors,
    handleFilesChange,
    reloadAttachments: persisted.reload,
    removeFile,
    resetFiles,
    setFileErrors,
    updateFileItem,
  };
}
