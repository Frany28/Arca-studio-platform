import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { getUserFacingErrorMessage } from "../../../utils/userFacingError.js";
import { getProjectUploadFileError } from "../utils/projectUploadFiles.js";

const UPLOAD_ERROR = "No se pudo subir el archivo. Inténtalo de nuevo.";

/**
 * Mantiene la cola local del proyecto y sus transferencias cancelables. La vista del cliente
 * confirma la cola de forma explícita; los demás usos del panel mantienen la subida al seleccionar.
 *
 * @param {Object} options - Proyecto, permisos y callbacks de resultado.
 * @returns {Object} Archivos de la sesión y acciones de selección, envío, reintento y borrado.
 */
export function useProjectUploadFiles({ projectId, manualUpload, readOnly, readOnlyMessage, onSuccess, onError, onFilesChanged }) {
  const [files, setFiles] = useState([]);
  // Las selecciones rápidas, el progreso y los clics repetidos consultan la cola actual,
  // incluso antes de que React vuelva a renderizar.
  const filesRef = useRef(files);
  const controllersRef = useRef(new Map());

  /**
   * Publica una actualización local y la deja disponible para el siguiente evento de subida.
   * @param {Array<Object>} nextFiles - Cola actualizada.
   */
  const updateFiles = useCallback((nextFiles) => {
    filesRef.current = nextFiles;
    setFiles(nextFiles);
  }, []);

  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  useEffect(() => {
    if (!readOnly) return undefined;
    const controllers = controllersRef.current;
    const interruptedIds = new Set(controllers.keys());
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
    let active = true;
    queueMicrotask(() => {
      if (!active || !interruptedIds.size) return;
      updateFiles(filesRef.current.map((item) => interruptedIds.has(item.id)
        ? { ...item, errorMessage: readOnlyMessage, progress: 0, status: "failed" }
        : item));
    });
    return () => { active = false; };
  }, [readOnly, readOnlyMessage, updateFiles]);

  /**
   * Envía un archivo una sola vez por intento y descarta respuestas de transferencias canceladas.
   * La subida confirmada actualiza el proyecto y, para el cliente, retira su tarjeta local.
   *
   * @param {string} id - Identificador local del archivo.
   * @param {() => void} [notifySuccess=onSuccess] - Aviso del intento o del lote que lo inició.
   * @returns {Promise<void>} Termina al resolverse el intento.
   */
  async function uploadFile(id, notifySuccess = onSuccess) {
    const item = filesRef.current.find((candidate) => candidate.id === id);
    const controllers = controllersRef.current;
    if (readOnly || !item || item.validationError || item.status === "completed" || controllers.has(id)) return;

    const patch = (values) => updateFiles(filesRef.current.map((candidate) => candidate.id === id
      ? { ...candidate, ...values }
      : candidate));
    const controller = new AbortController();
    controllers.set(id, controller);
    patch({ loadedBytes: 0, progress: 0, errorMessage: "", status: "uploading" });
    try {
      if (!projectId) throw new Error("No se encontró el proyecto para subir el archivo.");
      await api.projects.uploadFile({
        file: item.file,
        onUploadProgress: ({ loaded, progress }) => {
          if (!controller.signal.aborted) patch({ loadedBytes: loaded, progress });
        },
        projectId,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const errorMessage = error.status >= 500 ? UPLOAD_ERROR : getUserFacingErrorMessage(error, UPLOAD_ERROR);
      patch({ errorMessage, progress: 0, status: "failed" });
      onError(errorMessage);
      return;
    } finally {
      if (controllers.get(id) === controller) controllers.delete(id);
    }

    if (controller.signal.aborted) return;
    if (manualUpload) {
      updateFiles(filesRef.current.filter((candidate) => candidate.id !== id));
    } else {
      patch({ loadedBytes: item.file.size, progress: 100, status: "completed" });
    }
    notifySuccess();
    onFilesChanged?.();
  }

  /**
   * Valida y registra una selección fuera de los actualizadores de React, que StrictMode puede
   * ejecutar varias veces. Solo los flujos internos existentes se envían en este punto.
   *
   * @param {FileList|File[]} fileList - Archivos elegidos o soltados.
   */
  function selectFiles(fileList) {
    if (readOnly || !fileList?.length) return;
    const nextFiles = [...filesRef.current];
    const added = Array.from(fileList, (file) => {
      const validationError = getProjectUploadFileError(file, nextFiles);
      const item = {
        file,
        id: crypto.randomUUID(),
        loadedBytes: 0,
        progress: 0,
        status: validationError ? "failed" : "pending",
        validationError,
      };
      nextFiles.push(item);
      return item;
    });
    updateFiles(nextFiles);
    if (!manualUpload) added.forEach((item) => uploadFile(item.id));
  }

  /**
   * Inicia las transferencias válidas que siguen pendientes. La primera confirmación del lote
   * emite el único aviso; cada confirmación posterior limpia su tarjeta de forma independiente.
   */
  function uploadPending() {
    if (controllersRef.current.size) return;
    let notified = false;
    const notifyBatchSuccess = () => {
      if (notified) return;
      notified = true;
      onSuccess();
    };
    filesRef.current.filter((item) => item.status === "pending").forEach((item) => uploadFile(item.id, notifyBatchSuccess));
  }

  /**
   * Quita una selección local. Una transferencia cancelada puede haberse guardado antes de
   * recibir el aborto, por lo que se recarga el proyecto sin intentar borrar lo persistido.
   *
   * @param {string} id - Identificador local del archivo.
   */
  function removeFile(id) {
    const item = filesRef.current.find((candidate) => candidate.id === id);
    if (readOnly || !item || item.status === "completed") return;
    const controllers = controllersRef.current;
    const controller = controllers.get(id);
    controller?.abort();
    controllers.delete(id);
    updateFiles(filesRef.current.filter((candidate) => candidate.id !== id));
    if (controller) onFilesChanged?.();
  }

  return { files, selectFiles, uploadPending, uploadFile, removeFile };
}
