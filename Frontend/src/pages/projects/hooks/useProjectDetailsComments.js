import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";
import {
  getProjectReadOnlyMessage,
  isProjectOperationallyReadOnly,
} from "../../../utils/projectReadOnly.js";
import {
  mergeCommentsById,
  upsertCommentById,
} from "../utils/projectDetailsPresentation.js";

/**
 * Carga observaciones del proyecto y combina actualizaciones por id con los helpers compartidos.
 * Suscribe eventos SSE y refresca cada 5 s con drawer abierto o 15 s cerrado;
 * al limpiar el efecto ignora respuestas pendientes, retira el intervalo y cierra la suscripci?n.
 *
 * @param {Object} params - Proyecto y estado del drawer.
 * @param {boolean} params.isNotificationsDrawerOpen - Determina la frecuencia de refresco.
 * @param {Object|null} params.project - Proyecto usado para comprobar el modo de solo lectura al enviar.
 * @param {number|null} params.resolvedProjectId - Id usado en consultas, eventos y env?o; sin id no carga.
 * @returns {Object} Observaciones, error combinado, readError de lectura, loading de lectura y submitComment.
 */
export default function useProjectDetailsComments({
  isNotificationsDrawerOpen,
  project,
  resolvedProjectId,
}) {
  const [comments, setComments] = useState([]);
  const [readError, setReadError] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    if (!resolvedProjectId) {
      queueMicrotask(() => {
        if (!isMounted) return;
        setComments([]);
        setReadError("");
        setLoading(false);
      });
      return () => { isMounted = false; };
    }

    /**
     * Inicia la carga de todas las p?ginas de observaciones y combina la respuesta con el estado actual.
     * Solo modifica el estado mientras el efecto siga vigente; los refrescos no activan loading.
     *
     * @param {Object} [options={}] - Presentaci?n de la carga.
     * @param {boolean} [options.showLoading=false] - Si debe activar y luego desactivar loading.
     * @returns {void} Inicia la petici?n sin devolver su promesa; registra los fallos en error.
     */
    function loadProjectComments({ showLoading = false } = {}) {
      if (showLoading) {
        setLoading(true);
      }

      setReadError("");

      api.projects
        .listAllComments({ projectId: resolvedProjectId })
        .then((data) => {
          if (isMounted) {
            setComments((current) =>
              mergeCommentsById(
                current,
                Array.isArray(data.comments) ? data.comments : [],
              ),
            );
          }
        })
        .catch((requestError) => {
          if (isMounted) {
            setReadError(
              requestError.message || "No se pudieron cargar las observaciones.",
            );
          }
        })
        .finally(() => {
          if (isMounted && showLoading) {
            setLoading(false);
          }
        });
    }

    // La microtarea evita actualizaciones durante el efecto; su guarda descarta
    // cargas cuyo proyecto o montaje ya cambió antes de iniciarse.
    queueMicrotask(() => {
      if (isMounted) loadProjectComments({ showLoading: true });
    });

    const unsubscribe = api.projects.subscribeToEvents({
      projectId: resolvedProjectId,
      onCommentCreated: (comment) => {
        if (isMounted) {
          setComments((current) => upsertCommentById(current, comment));
        }
      },
    });

    const refreshIntervalId = window.setInterval(
      () => loadProjectComments(),
      isNotificationsDrawerOpen ? 5000 : 15000,
    );

    return () => {
      isMounted = false;
      window.clearInterval(refreshIntervalId);
      unsubscribe();
    };
  }, [isNotificationsDrawerOpen, resolvedProjectId]);

  /**
   * Impide enviar en proyectos de solo lectura o sin id y publica la observaci?n mediante la API.
   * Inserta o actualiza el resultado por id y conserva y propaga los errores de envío.
   * No activa la carga de lectura: el compositor controla su pending sin desmontarse.
   *
   * @param {Object} params - Contenido y relaci?n de respuesta.
   * @param {string} params.message - Texto enviado como content.
   * @param {number|null} [params.parentCommentId=null] - Observaci?n padre; null crea una ra?z.
   * @returns {Promise<void>} Confirma la creación y actualiza las observaciones.
   * @throws {Error} Proyecto de solo lectura, destino ausente o rechazo de la API.
   */
  const submitComment = async ({ message, parentCommentId = null }) => {
    if (isProjectOperationallyReadOnly(project)) {
      const requestError = new Error(getProjectReadOnlyMessage(project));
      setSubmissionError(requestError.message);
      throw requestError;
    }

    if (!resolvedProjectId) {
      const requestError = new Error("No se encontro el proyecto para comentar.");
      setSubmissionError(requestError.message);
      throw requestError;
    }

    setSubmissionError("");

    try {
      const data = await api.projects.createComment({
        content: message,
        parentCommentId,
        projectId: resolvedProjectId,
      });

      if (data.comment) {
        setComments((current) => upsertCommentById(current, data.comment));
      }
    } catch (requestError) {
      setSubmissionError(requestError.message || "No se pudo guardar la observación.");
      throw requestError;
    }
  };

  return {
    comments,
    error: readError || submissionError,
    readError,
    loading,
    submitComment,
  };
}
