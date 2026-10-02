import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/http.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { useProjectReadOnly } from "../contexts/ProjectReadOnlyContext.jsx";
import { decorateCommentForDisplay } from "../utils/commentDisplay.js";

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 50;
const commentCache = new Map();

function isPositiveId(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0;
}

/**
 * Valida puntos con coordenadas normalizadas entre cero y uno.
 * Exige límites válidos de página o sección según el tipo; para hojas comprueba
 * nombre no vacío y referencia de celda compatible con el patrón admitido.
 *
 * @param {Object|null} selection - Referencia del punto seleccionado.
 * @returns {boolean} Si cumple las reglas del tipo de selección.
 */
function isValidDocumentSelection(selection) {
  if (!selection || typeof selection !== "object") return false;
  const hasCoordinates =
    Number.isFinite(selection.normalizedX) &&
    selection.normalizedX >= 0 &&
    selection.normalizedX <= 1 &&
    Number.isFinite(selection.normalizedY) &&
    selection.normalizedY >= 0 &&
    selection.normalizedY <= 1;

  if (!hasCoordinates) return false;
  if (selection.kind === "document-point") {
    return isPositiveId(selection.pageNumber) &&
      isPositiveId(selection.pageCount) &&
      Number(selection.pageNumber) <= Number(selection.pageCount);
  }
  if (selection.kind === "document-section-point") {
    return Number.isInteger(selection.sectionIndex) &&
      selection.sectionIndex >= 0 &&
      isPositiveId(selection.sectionCount) &&
      selection.sectionIndex < Number(selection.sectionCount);
  }
  if (selection.kind === "document-cell-point") {
    return typeof selection.sheetName === "string" &&
      selection.sheetName.trim().length > 0 &&
      /^[A-Z]{1,3}[1-9]\d{0,6}$/.test(selection.cell || "");
  }
  return false;
}

/**
 * Actualiza una observación comparando IDs como texto para evitar duplicados.
 * Reemplaza la coincidencia o añade la fila sin mutar el array original.
 *
 * @param {Array} comments - Observaciones existentes.
 * @param {Object} comment - Observación entrante.
 * @returns {Array} Lista actualizada.
 */
function upsert(comments, comment) {
  return comments.some((item) => String(item.id) === String(comment.id))
    ? comments.map((item) => String(item.id) === String(comment.id) ? comment : item)
    : [...comments, comment];
}

/**
 * Aísla la caché por usuario, proyecto, archivo y versión.
 * El consumidor proporciona anonymous cuando no hay ID de usuario.
 *
 * @param {Object} params - fileId, fileVersionId, projectId y userId del ámbito.
 * @returns {string} Clave compartida entre instancias del mismo ámbito.
 */
function getCacheKey({ fileId, fileVersionId, projectId, userId }) {
  return `${userId}:${projectId}:${fileId}:${fileVersionId}`;
}

/**
 * Limita la caché compartida a 50 entradas eliminando las primeras insertadas.
 * La eliminación también puede afectar entradas con peticiones pendientes.
 *
 * @returns {void}
 */
function trimCache() {
  while (commentCache.size > CACHE_MAX_ENTRIES) {
    commentCache.delete(commentCache.keys().next().value);
  }
}

/**
 * Reutiliza lecturas de menos de 30 segundos o la promesa pendiente del mismo ámbito.
 * Guarda resultados al resolver y elimina la entrada ante fallo para permitir
 * otra lectura. Limita la caché a 50 entradas y no aborta requests compartidos.
 *
 * @param {string} cacheKey - Clave por usuario, proyecto, archivo y versión.
 * @param {Object} input - Identificadores enviados a listAllDocumentComments.
 * @returns {Promise<Array>} Observaciones del documento.
 * @throws {Error} Rechaza la promesa si falla la lectura de la API.
 */
function loadComments(cacheKey, input) {
  const cached = commentCache.get(cacheKey);
  if (cached && (cached.promise || Date.now() - cached.createdAt < CACHE_TTL_MS)) {
    return cached.promise || Promise.resolve(cached.comments);
  }

  const promise = api.projects.listAllDocumentComments(input)
    .then((data) => {
      const comments = data.comments || [];
      commentCache.set(cacheKey, { comments, createdAt: Date.now(), promise: null });
      trimCache();
      return comments;
    })
    .catch((error) => {
      commentCache.delete(cacheKey);
      throw error;
    });
  commentCache.set(cacheKey, { comments: [], createdAt: Date.now(), promise });
  trimCache();
  return promise;
}

/**
 * Gestiona observaciones de una versión documental, respuestas y participantes.
 * Obtiene usuario y modo de solo lectura de sus contextos. La carga usa caché
 * por usuario/proyecto/archivo/versión y queueMicrotask para iniciar indicadores;
 * el cleanup descarta respuestas del efecto sin cancelar la petición compartida.
 * addComment valida IDs y puntos raíz, rechaza escrituras en solo lectura y
 * reutiliza el envío pendiente de esta instancia incluso con un payload distinto.
 * La creación actualiza filas y caché; sus errores se exponen y se propagan.
 * enabled controla solo la lectura automática; no hay polling ni listeners.
 *
 * @param {Object} params - Contexto de la versión documental.
 * @param {boolean} params.enabled - Habilita carga si están presentes todos los IDs.
 * @param {number|string|null} params.fileId - Identificador del archivo.
 * @param {number|string|null} params.fileVersionId - Identificador de la versión.
 * @param {number|string|null} params.projectId - Identificador del proyecto.
 * @returns {Object} comments, error, isLoading, isSubmitting y addComment.
 * addComment recibe { message, parentCommentId?, selection? } y devuelve Promise<Object> con la observación creada.
 */
export function useDocumentComments({ enabled, fileId, fileVersionId, projectId }) {
  const { user } = useAuth();
  const { message: readOnlyMessage, readOnly } = useProjectReadOnly();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitPromiseRef = useRef(null);
  const cacheKey = getCacheKey({ fileId, fileVersionId, projectId, userId: user?.id || "anonymous" });

  useEffect(() => {
    if (!enabled || !projectId || !fileId || !fileVersionId) {
      queueMicrotask(() => setRows([]));
      return undefined;
    }
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      setRows([]);
      setError("");
      setIsLoading(true);
    });
    loadComments(cacheKey, { fileId, fileVersionId, projectId })
      .then((comments) => mounted && setRows(comments))
      .catch(() => mounted && setError("No se pudieron cargar las observaciones."))
      .finally(() => mounted && setIsLoading(false));
    return () => { mounted = false; };
  }, [cacheKey, enabled, fileId, fileVersionId, projectId]);

  const comments = useMemo(() => {
    const replyCounts = new Map();
    const threadParticipants = new Map();
    const decoratedRows = rows.map((comment) => decorateCommentForDisplay(comment, user));

    decoratedRows.forEach((comment) => {
      const rootId = String(comment.parentCommentId || comment.id);
      const authorKey = comment.author?.id != null
        ? `id:${comment.author.id}`
        : `name:${comment.name}`;
      const participants = threadParticipants.get(rootId) || new Map();
      if (!participants.has(authorKey)) {
        participants.set(authorKey, {
          alt: comment.name,
          content: comment.avatarSrc ? "Image" : "Text",
          decorative: false,
          name: comment.name,
          src: comment.avatarSrc,
          theme: "Neutral",
        });
      }
      threadParticipants.set(rootId, participants);

      if (!comment.parentCommentId) return;
      const parentId = String(comment.parentCommentId);
      replyCounts.set(parentId, (replyCounts.get(parentId) || 0) + 1);
    });

    return decoratedRows.map((comment) => ({
      ...comment,
      imageComment: true,
      message: comment.content,
      replyCount: replyCounts.get(String(comment.id)) || 0,
      threadParticipants: Array.from(
        threadParticipants.get(String(comment.parentCommentId || comment.id))?.values() || [],
      ),
      timestamp: "",
    }));
  }, [rows, user]);

  const addComment = useCallback(async ({ message, parentCommentId = null, selection = null }) => {
    if (submitPromiseRef.current) return submitPromiseRef.current;

    if (readOnly) {
      setError(readOnlyMessage);
      throw new Error(readOnlyMessage);
    }

    const validationError = !isPositiveId(projectId) || !isPositiveId(fileId) || !isPositiveId(fileVersionId)
      ? "No se pudo identificar el documento o su versión."
      : parentCommentId
        ? null
        : isValidDocumentSelection(selection)
          ? null
          : "Selecciona un punto válido en el documento.";

    if (validationError) {
      setError(validationError);
      throw new Error(validationError);
    }

    setError("");
    setIsSubmitting(true);
    const request = api.projects.createComment({
      commentType: "document",
      content: message,
      fileId,
      fileVersionId,
      parentCommentId,
      projectId,
      selection,
    }).then((data) => {
      if (!data?.comment?.id) {
        throw new Error("El servidor no devolvió la observación guardada.");
      }

      setRows((current) => upsert(current, data.comment));
      const cached = commentCache.get(cacheKey);
      commentCache.set(cacheKey, {
        comments: upsert(cached?.comments || [], data.comment),
        createdAt: Date.now(),
        promise: null,
      });
      trimCache();
      return data.comment;
    }).catch((requestError) => {
      setError(requestError.message || "No se pudo guardar la observación.");
      throw requestError;
    }).finally(() => {
      submitPromiseRef.current = null;
      setIsSubmitting(false);
    });
    submitPromiseRef.current = request;
    return request;
  }, [cacheKey, fileId, fileVersionId, projectId, readOnly, readOnlyMessage]);

  return { addComment, comments, error, isLoading, isSubmitting };
}
