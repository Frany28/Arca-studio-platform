import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";
import { projectCommentFeed } from "../../../api/projectCommentFeed.js";
import {
  getProjectReadOnlyMessage,
  isProjectOperationallyReadOnly,
} from "../../../utils/projectReadOnly.js";

/**
 * Sigue las observaciones del proyecto mediante la fuente compartida (carga, SSE y sondeo incremental).
 * Pide respaldo cada 5 s con drawer abierto o 15 s cerrado; la fuente lo espacia con SSE conectado,
 * lo pausa con la pestaña oculta y al limpiar el efecto se cancela la suscripción.
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

    // Fuente compartida (P1-1): la página de detalle y sus notificaciones siguen el mismo proyecto
    // con una sola carga, una conexión SSE y un sondeo incremental (5 s con el drawer abierto, 15 s
    // cerrado, más espaciado mientras SSE está conectado y en pausa con la pestaña oculta).
    const unsubscribe = projectCommentFeed.subscribe(resolvedProjectId, {
      intervalMs: isNotificationsDrawerOpen ? 5000 : 15000,
      onChange: (snapshot) => {
        if (!isMounted) return;
        setComments(snapshot.comments);
        setLoading(snapshot.loading);
        setReadError(snapshot.error);
      },
    });

    return () => {
      isMounted = false;
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
        // La fuente compartida la muestra aquí y en las notificaciones del mismo proyecto.
        projectCommentFeed.add(resolvedProjectId, data.comment);
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
