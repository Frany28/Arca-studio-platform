import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { getProjectRequestFileErrors, getProjectRequestFileIssues } from "../../../utils/projectRequestValidation.js";
import { isProjectRequestFileRemovable, toPersistedProjectRequestFileItem } from "../utils/projectRequestFilePresentation.js";
import useProjectRequestDetail from "./useProjectRequestDetail.js";

const ATTACHMENTS_LOADING_MESSAGE = "Espera a que carguen los archivos adjuntos de la solicitud.";
const ATTACHMENTS_ERROR_PREFIX = "No se pudieron cargar los archivos adjuntos: ";
export const FILES_IN_PROGRESS_MESSAGE = "Espera a que terminen de subirse los archivos antes de enviar.";
export const FILES_FAILED_MESSAGE = "Reintenta o elimina los archivos que no se pudieron subir.";
// Subidas simultáneas como máximo: el resto espera en cola (estado pendiente).
const MAX_CONCURRENT_UPLOADS = 2;

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
 * Adjuntos de la solicitud con subida automática al seleccionarlos.
 *
 * - Subida: cada archivo válido se sube en cuanto se selecciona, sin esperar a «Enviar», al
 *   borrador compartido (`draft.ensureDraft` lo crea vacío la primera vez y de forma idempotente).
 *   Estados: pendiente (en cola o inválido), subiendo (progreso real 0–99 %), subido (100 %,
 *   confirmado por el backend, con su `remoteId`) y error (con «Intenta de nuevo»). Como máximo hay
 *   dos subidas a la vez. Las subidas se inician desde manejadores de eventos (nunca dentro de
 *   actualizadores de estado ni de efectos), así que StrictMode no las duplica; la lista vive en
 *   una referencia síncrona para que eventos concurrentes no partan de un estado anterior.
 * - Validación: un archivo con problemas propios (formato, tamaño, nombre repetido) o con
 *   problemas de la sección (cantidad o tamaño total) no se sube hasta que se corrige.
 * - Quitar: un pendiente o fallido se quita localmente; uno en curso se cancela (la transferencia
 *   se aborta); uno subido se elimina en el servidor y la tarjeta solo desaparece al confirmarse.
 * - Reintentar: solo vuelve a subir ese archivo; el backend reutiliza un reintento idéntico.
 * - Recuperación (`recoveryRequestId`, borrador o solicitud devuelta): los adjuntos guardados se
 *   leen del backend y se muestran como subidos, sin volver a transferirlos.
 * - Limpiar: cancela las subidas en curso y descarta pendientes y fallidos; los subidos siguen en
 *   el borrador (se eliminan con su botón).
 *
 * @param {Object} params - Estado externo usado para coordinar validación, borrador y envío.
 * @param {number|string|null} params.recoveryRequestId - Solicitud recuperada cuyos adjuntos se cargan.
 * @param {Object} params.currentFieldErrors - Errores actuales del formulario.
 * @param {{draftId: number|string|null, ensureDraft: () => Promise<number|string>}} params.draft - Borrador compartido.
 * @param {boolean} params.hasAttemptedSubmit - Si ya se intentó validar el envío.
 * @param {Function} params.setShowRequiredAlert - Controla el aviso conjunto de campos y archivos.
 * @returns {Object} Adjuntos, errores, disponibilidad de los guardados y acciones para agregar,
 *   quitar, reintentar, validar y reiniciar.
 */
export default function useProjectRequestFiles({
  currentFieldErrors,
  draft,
  hasAttemptedSubmit,
  recoveryRequestId = null,
  setShowRequiredAlert,
}) {
  const [localFiles, setLocalFiles] = useState([]);
  const [fileErrors, setFileErrors] = useState([]);
  // Ids remotos eliminados o en eliminación: el detalle leído no se vuelve a pedir tras borrar.
  const [removedRemoteIds, setRemovedRemoteIds] = useState(() => new Set());
  const [removingRemoteIds, setRemovingRemoteIds] = useState(() => new Set());
  // Contador local: los metadatos del archivo no son únicos si se agrega dos veces el mismo.
  const nextFileIdRef = useRef(0);
  // Fuente síncrona de la selección local y transferencias en curso (id → AbortController).
  const localFilesRef = useRef([]);
  const uploadsRef = useRef(new Map());
  const persisted = useProjectRequestDetail({
    enabled: Boolean(recoveryRequestId),
    projectRequestId: recoveryRequestId,
  });
  const persistedFiles = persisted.projectRequest?.files;
  const persistedItems = useMemo(
    () => (persistedFiles || [])
      .filter((file) => !removedRemoteIds.has(file.id))
      .map((file) => toPersistedProjectRequestFileItem(file, removingRemoteIds.has(file.id))),
    [persistedFiles, removedRemoteIds, removingRemoteIds],
  );
  const files = useMemo(
    () => [...persistedItems, ...localFiles.map((item) => (
      item.remoteId && removingRemoteIds.has(item.remoteId) ? { ...item, removing: true } : item
    ))],
    [localFiles, persistedItems, removingRemoteIds],
  );
  const allowRemoteRemoval = Boolean(draft.draftId);
  // Guardados vigentes para los manejadores asíncronos (una eliminación o subida termina después
  // de otros cambios y debe aplicarse sobre la lista actual).
  const persistedItemsRef = useRef(persistedItems);
  useEffect(() => {
    persistedItemsRef.current = persistedItems;
  });

  // Al desmontar (navegación o cierre) se cancelan las transferencias en curso.
  useEffect(() => {
    const uploads = uploadsRef.current;
    return () => {
      uploads.forEach((controller) => controller.abort());
      uploads.clear();
    };
  }, []);

  /**
   * Sustituye la selección local en la referencia síncrona y en el estado.
   *
   * @param {(current: Array) => Array} change - Calcula la nueva selección a partir de la actual.
   * @returns {Array} Selección resultante.
   */
  const commitLocalFiles = (change) => {
    const next = change(localFilesRef.current);
    localFilesRef.current = next;
    setLocalFiles(next);
    return next;
  };

  /**
   * Actualiza los datos de un adjunto local si sigue en la selección.
   *
   * @param {string} id - Adjunto local.
   * @param {Object} values - Valores a combinar.
   * @returns {void}
   */
  const updateLocalFile = (id, values) => {
    commitLocalFiles((current) => current.map((item) => (item.id === id ? { ...item, ...values } : item)));
  };

  /**
   * Recalcula los errores de la sección con la selección vigente y, tras un intento de envío,
   * oculta el aviso global cuando ya no quedan errores de campos ni archivos.
   *
   * @returns {void}
   */
  const refreshFileErrors = () => {
    const nextErrors = getProjectRequestFileErrors([...persistedItemsRef.current, ...localFilesRef.current]);
    setFileErrors(nextErrors);
    if (hasAttemptedSubmit && nextErrors.length === 0 && Object.keys(currentFieldErrors).length === 0) {
      setShowRequiredAlert(false);
    }
  };

  /**
   * Inicia las subidas de los adjuntos pendientes válidos hasta el máximo de concurrencia. Un
   * archivo con problemas propios o de la sección espera a que se corrijan. Se llama desde
   * manejadores (selección, reintento, eliminación y fin de otra subida), nunca desde un render.
   *
   * @returns {void}
   */
  const startPendingUploads = () => {
    const all = [...persistedItemsRef.current, ...localFilesRef.current];
    const issues = getProjectRequestFileIssues(all);
    if (issues.some((issue) => issue.index === null)) return;
    const invalidIds = new Set(issues.map((issue) => all[issue.index]?.id));
    let available = MAX_CONCURRENT_UPLOADS - uploadsRef.current.size;
    const toStart = [];
    for (const item of localFilesRef.current) {
      if (available <= 0) break;
      if (item.status !== "pending" || invalidIds.has(item.id) || uploadsRef.current.has(item.id)) continue;
      toStart.push(item);
      available -= 1;
    }
    if (!toStart.length) return;

    const startIds = new Set(toStart.map((item) => item.id));
    commitLocalFiles((current) => current.map((item) => (
      startIds.has(item.id) ? { ...item, error: "", progress: 0, status: "uploading" } : item
    )));
    toStart.forEach((item) => {
      const controller = new AbortController();
      uploadsRef.current.set(item.id, controller);
      void uploadFile(item, controller);
    });
  };

  /**
   * Sube un adjunto al borrador (creándolo si hace falta) con progreso real. Solo marca el adjunto
   * como subido cuando el backend lo confirma y registra su id remoto. Una cancelación no deja
   * error: el adjunto ya se quitó de la selección.
   *
   * @param {Object} item - Adjunto local con su `File`.
   * @param {AbortController} controller - Cancela la transferencia.
   * @returns {Promise<void>} Finaliza tras actualizar el adjunto y continuar la cola.
   */
  const uploadFile = async (item, controller) => {
    try {
      const projectRequestId = await draft.ensureDraft();
      if (controller.signal.aborted) return;
      const uploaded = await api.projectRequests.uploadFile({
        file: item.file,
        onUploadProgress: ({ progress }) => updateLocalFile(item.id, { progress }),
        projectRequestId,
        signal: controller.signal,
      });
      updateLocalFile(item.id, { error: "", progress: 100, remoteId: uploaded?.file?.id ?? null, status: "uploaded" });
    } catch (error) {
      if (!controller.signal.aborted && error?.code !== "UPLOAD_ABORTED") {
        updateLocalFile(item.id, { error: error?.message || "No se pudo subir el archivo.", status: "error" });
      }
    } finally {
      if (uploadsRef.current.get(item.id) === controller) uploadsRef.current.delete(item.id);
      if (!controller.signal.aborted) startPendingUploads();
    }
  };

  /**
   * Agrega los archivos elegidos o soltados y empieza a subir los válidos.
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

    commitLocalFiles((current) => [...current, ...addedFiles]);
    refreshFileErrors();
    startPendingUploads();
  };

  /**
   * Elimina en el servidor un adjunto subido. Mientras dura, el adjunto no se puede volver a
   * quitar; la tarjeta solo desaparece al confirmarse y, si falla, se conserva con el motivo.
   *
   * @param {Object} target - Adjunto subido con `remoteId`.
   * @returns {Promise<void>} Finaliza tras actualizar la lista o informar el error.
   */
  const removeRemoteFile = async (target) => {
    const { remoteId } = target;
    setRemovingRemoteIds((current) => new Set(current).add(remoteId));
    try {
      await api.projectRequests.deleteFile({ fileId: remoteId, projectRequestId: draft.draftId });
      if (target.persisted) {
        persistedItemsRef.current = persistedItemsRef.current.filter((item) => item.remoteId !== remoteId);
        setRemovedRemoteIds((current) => new Set(current).add(remoteId));
      } else {
        commitLocalFiles((current) => current.filter((item) => item.id !== target.id));
      }
      refreshFileErrors();
      startPendingUploads();
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
   * Quita un adjunto según su estado: cancela la transferencia en curso, lo elimina en el servidor
   * si ya está subido o lo quita localmente si aún no se subió. Ignora los que no se pueden quitar.
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
    const controller = uploadsRef.current.get(id);
    if (controller) {
      uploadsRef.current.delete(id);
      controller.abort();
    }
    commitLocalFiles((current) => current.filter((item) => item.id !== id));
    refreshFileErrors();
    startPendingUploads();
  };

  /**
   * Vuelve a subir un adjunto fallido sin tocar los demás.
   *
   * @param {string} id - Adjunto con error de subida.
   * @returns {void}
   */
  const retryFile = (id) => {
    const target = localFilesRef.current.find((item) => item.id === id);
    if (target?.status !== "error") return;
    updateLocalFile(id, { error: "", progress: 0, status: "pending" });
    startPendingUploads();
  };

  const availabilityMessage = persisted.loading
    ? ATTACHMENTS_LOADING_MESSAGE
    : persisted.error ? `${ATTACHMENTS_ERROR_PREFIX}${persisted.error}` : "";

  /**
   * Errores de los adjuntos que impiden enviar: validación, disponibilidad de los guardados y
   * archivos aún sin guardar (en cola, subiendo o fallidos). Mientras los guardados no estén
   * disponibles no se pueden comprobar los límites ni los nombres repetidos.
   *
   * @returns {Array<string>} Errores que impiden enviar.
   */
  const getSubmitFileErrors = () => {
    const errors = getProjectRequestFileErrors(files);
    const issues = getProjectRequestFileIssues(files);
    const issueIndexes = new Set(issues.map((issue) => issue.index));
    // Un pendiente válido solo «espera» si no lo bloquea un error de la sección (cantidad o tamaño
    // total): en ese caso no se sube y el motivo ya es ese error.
    const sectionBlocked = issueIndexes.has(null);
    const waiting = files.some((item, index) => item.status === "uploading"
      || (item.status === "pending" && !sectionBlocked && !issueIndexes.has(index)));
    const failed = files.some((item) => item.status === "error");
    return [
      ...errors,
      ...(availabilityMessage ? [availabilityMessage] : []),
      ...(waiting ? [FILES_IN_PROGRESS_MESSAGE] : []),
      ...(failed ? [FILES_FAILED_MESSAGE] : []),
    ];
  };
  // Un aviso de disponibilidad o de transferencia solo se muestra mientras siga vigente.
  const transferErrors = getSubmitFileErrors().filter((message) => message === FILES_IN_PROGRESS_MESSAGE || message === FILES_FAILED_MESSAGE);
  const visibleFileErrors = fileErrors.filter((message) => {
    if (isAttachmentsAvailabilityMessage(message)) return message === availabilityMessage;
    if (message === FILES_IN_PROGRESS_MESSAGE || message === FILES_FAILED_MESSAGE) return transferErrors.includes(message);
    return true;
  });

  /**
   * Motivo por el que los adjuntos impiden enviar ahora mismo (subidas en curso o fallidas), o
   * cadena vacía. Lo usa la confirmación del código para no enviar con archivos sin guardar.
   *
   * @returns {string} Motivo o cadena vacía.
   */
  const getTransferBlockReason = () => transferErrors[0] || "";

  /**
   * Limpia la selección: cancela las transferencias en curso y descarta pendientes y fallidos.
   * Los adjuntos subidos siguen en el borrador y en la lista (se eliminan con su botón).
   *
   * @returns {void}
   */
  const resetFiles = () => {
    uploadsRef.current.forEach((controller) => controller.abort());
    uploadsRef.current.clear();
    commitLocalFiles((current) => current.filter((item) => item.status === "uploaded"));
    setFileErrors([]);
  };

  return {
    allowRemoteRemoval,
    attachmentsError: persisted.error,
    attachmentsLoading: persisted.loading,
    fileErrors: visibleFileErrors,
    files,
    getSubmitFileErrors,
    getTransferBlockReason,
    handleFilesChange,
    reloadAttachments: persisted.reload,
    removeFile,
    resetFiles,
    retryFile,
    setFileErrors,
  };
}
