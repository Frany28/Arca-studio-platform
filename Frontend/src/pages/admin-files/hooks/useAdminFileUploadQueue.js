import { useEffect, useRef, useState } from "react";

import { describeUploadError } from "../utils/adminFileUpload.js";

let nextItemId = 0;

/**
 * Cola de cargas de un diálogo de U3 («Nuevo archivo» o «Reemplazar archivo»). Las cargas se
 * transfieren de una en una para que el progreso y los errores sean claros.
 *
 * - Selección: cada archivo se valida al elegirlo o soltarlo (`validate`); uno inválido se muestra
 *   con su motivo y no se transfiere. Con `single`, una selección nueva sustituye a la anterior.
 * - Progreso real de la transferencia (0–99 %) y 100 % solo cuando el backend confirma el registro.
 * - Error: los transitorios (red, servidor no disponible) ofrecen «Intenta de nuevo»; los definitivos
 *   (nombre repetido, formato, carpeta llena, proyecto de solo lectura) muestran su motivo.
 * - Cancelar o perder la respuesta deja el resultado incierto: la carga pudo registrarse justo antes.
 *   `reconcile` consulta lo guardado; si quedó registrada, se conserva y se trata como completada (los
 *   archivos guardados no se eliminan); si no, el backend ya compensó el objeto y la tarjeta sale de
 *   la lista (cancelación) o queda con su error (fallo de red).
 * - Desmontar o cerrar aborta la transferencia en curso.
 *
 * @param {Object} params - Validación, transferencia, reconciliación y aviso.
 * @param {(file: File, takenNames: string[]) => string} params.validate - Motivo del rechazo o "".
 * @param {(file: File, options: {signal: AbortSignal, onUploadProgress: Function}) => Promise<Object>} params.upload - Transfiere.
 * @param {(file: File) => Promise<Object|null>} params.reconcile - Resultado guardado o null.
 * @param {(result: Object, file: File, meta: {reconciled: boolean}) => void} params.onUploaded - Carga confirmada.
 * @param {boolean} [params.single=false] - Un solo archivo por diálogo.
 * @param {string} [params.location] - Ubicación destino legible, para nombrarla en un conflicto de nombre.
 * @returns {Object} Elementos, estado y acciones (`add`, `start`, `retry`, `remove`, `abort`).
 */
export function useAdminFileUploadQueue({ location = "", onUploaded, reconcile, single = false, upload, validate }) {
  const [items, setItems] = useState([]);
  const itemsRef = useRef(items);
  const activeRef = useRef(null);
  const runningRef = useRef(false);
  const callbacks = useRef({ location, onUploaded, reconcile, upload, validate });
  useEffect(() => {
    callbacks.current = { location, onUploaded, reconcile, upload, validate };
  });
  useEffect(() => () => activeRef.current?.controller.abort(), []);

  /**
   * Actualiza la lista en la referencia síncrona y en el estado, para que eventos seguidos partan
   * siempre de la lista vigente.
   *
   * @param {(current: Array<Object>) => Array<Object>} change - Transformación.
   * @returns {void}
   */
  function commit(change) {
    itemsRef.current = change(itemsRef.current);
    setItems(itemsRef.current);
  }

  /**
   * Cambia los campos de un elemento.
   *
   * @param {number} id - Elemento.
   * @param {Object} values - Campos nuevos.
   * @returns {void}
   */
  function patch(id, values) {
    commit((current) => current.map((item) => (item.id === id ? { ...item, ...values } : item)));
  }

  /**
   * Añade los archivos elegidos o soltados, validados.
   *
   * @param {FileList|File[]} fileList - Selección.
   * @returns {void}
   */
  function add(fileList) {
    const chosen = Array.from(fileList || []);
    if (!chosen.length) return;
    const base = single ? itemsRef.current.filter((item) => item.status === "uploading" || item.status === "completed") : itemsRef.current;
    if (single && base.some((item) => item.status === "uploading")) return;
    const taken = base.map((item) => item.file.name);
    const added = (single ? chosen.slice(0, 1) : chosen).map((file) => {
      const validationMessage = callbacks.current.validate(file, taken);
      taken.push(file.name);
      nextItemId += 1;
      return { error: "", file, id: nextItemId, loaded: 0, notice: "", progress: 0, retryable: false, status: "pending", validationMessage };
    });
    commit(() => [...(single ? [] : base), ...added]);
  }

  /**
   * Transfiere un elemento y resuelve su resultado, reconciliando si es incierto.
   *
   * @param {Object} item - Elemento pendiente.
   * @returns {Promise<void>}
   */
  async function transfer(item) {
    const controller = new AbortController();
    activeRef.current = { controller, id: item.id, userCancelled: false };
    patch(item.id, { error: "", loaded: 0, progress: 0, retryable: false, status: "uploading" });
    try {
      const result = await callbacks.current.upload(item.file, {
        onUploadProgress: ({ loaded, progress }) => patch(item.id, { loaded, progress }),
        signal: controller.signal,
      });
      patch(item.id, { loaded: item.file.size, progress: 100, status: "completed" });
      callbacks.current.onUploaded(result, item.file, { reconciled: false });
    } catch (error) {
      const userCancelled = activeRef.current?.userCancelled;
      const described = describeUploadError(error, { location: callbacks.current.location });
      if (!described.uncertain) {
        patch(item.id, { error: described.message || described.fieldError, retryable: described.retryable, status: "failed" });
        return;
      }
      // Resultado incierto: la carga pudo registrarse justo antes de cancelarse o de perder la red.
      let saved = null;
      try {
        saved = await callbacks.current.reconcile(item.file);
      } catch {
        saved = null;
      }
      if (saved) {
        patch(item.id, { notice: "La carga ya estaba registrada: se conserva y queda pendiente de revisión.", progress: 100, status: "completed" });
        callbacks.current.onUploaded(saved, item.file, { reconciled: true });
      } else if (userCancelled) {
        commit((current) => current.filter((candidate) => candidate.id !== item.id));
      } else {
        patch(item.id, { error: described.message, retryable: true, status: "failed" });
      }
    } finally {
      if (activeRef.current?.id === item.id) activeRef.current = null;
    }
  }

  /**
   * Transfiere en orden los elementos válidos pendientes; ignora llamadas mientras ya corre.
   *
   * @returns {Promise<boolean>} true si al terminar todos los elementos quedaron guardados.
   */
  async function start() {
    if (runningRef.current) return false;
    runningRef.current = true;
    try {
      let next = itemsRef.current.find((item) => item.status === "pending" && !item.validationMessage);
      while (next) {
        await transfer(next);
        next = itemsRef.current.find((item) => item.status === "pending" && !item.validationMessage);
      }
    } finally {
      runningRef.current = false;
    }
    return itemsRef.current.length > 0 && itemsRef.current.every((item) => item.status === "completed");
  }

  return {
    abort: () => {
      if (!activeRef.current) return;
      activeRef.current.userCancelled = true;
      activeRef.current.controller.abort();
    },
    add,
    busy: items.some((item) => item.status === "uploading"),
    items,
    /**
     * Quita un elemento: uno en curso se cancela (y se reconcilia); uno guardado no se quita.
     *
     * @param {number} id - Elemento.
     * @returns {void}
     */
    remove(id) {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item || item.status === "completed") return;
      if (item.status === "uploading" && activeRef.current?.id === id) {
        activeRef.current.userCancelled = true;
        activeRef.current.controller.abort();
        return;
      }
      commit((current) => current.filter((candidate) => candidate.id !== id));
    },
    /**
     * Vuelve a transferir un elemento fallido con error transitorio.
     *
     * @param {number} id - Elemento.
     * @returns {Promise<boolean>} Si todos los elementos quedaron guardados.
     */
    async retry(id) {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (runningRef.current || item?.status !== "failed" || !item.retryable) return false;
      patch(id, { error: "", status: "pending" });
      return start();
    },
    start,
    uploadable: items.some((item) => item.status === "pending" && !item.validationMessage),
  };
}
