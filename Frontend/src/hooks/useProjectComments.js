import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../api/http.js";
import { projectCommentFeed, subscribeToProjects } from "../api/projectCommentFeed.js";
import { canAccessObservations } from "../utils/observationAccess.js";
import { decorateCommentForDisplay } from "../utils/commentDisplay.js";

/**
 * Convierte una fecha en texto relativo en el momento de adaptar el comentario.
 * Devuelve vacío para fechas inválidas y Ahora para futuras; no programa timers
 * para actualizar la etiqueta con el paso del tiempo.
 *
 * @param {string|number} value - Fecha convertible mediante Date.
 * @returns {string} Etiqueta de minutos, horas o días.
 */
function getRelativeTimeLabel(value) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMinutes = Math.max(Math.floor(diffMs / 60000), 0);

  if (diffMinutes < 1) {
    return "Ahora";
  }

  if (diffMinutes < 60) {
    return `Hace ${diffMinutes} min`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `Hace ${diffHours} ${diffHours === 1 ? "hora" : "horas"}`;
  }

  const diffDays = Math.floor(diffHours / 24);

  return `Hace ${diffDays} ${diffDays === 1 ? "dia" : "dias"}`;
}

/**
 * Adapta una observación al panel conservando recursos y metadatos.
 * Prefija IDs de entorno y sus padres con environment: para evitar colisiones
 * con proyectos; añade autor, tipo, punto de panorámica y fecha relativa.
 *
 * @param {Object} comment - Observación original.
 * @param {Object|null} user - Usuario para decorar autor y avatar.
 * @param {Object} [projectNamesById={}] - Nombres indexados por ID de proyecto.
 * @returns {Object} Observación compatible con el drawer.
 */
function toDrawerComment(comment, user, projectNamesById = {}) {
  const commentType = comment.commentType || "general";
  const isEnvironmentComment = comment.scope === "environment";
  const commentId = isEnvironmentComment
    ? `environment:${comment.id}`
    : comment.id;
  const parentCommentId = comment.parentCommentId
    ? isEnvironmentComment
      ? `environment:${comment.parentCommentId}`
      : comment.parentCommentId
    : null;

  return {
    ...decorateCommentForDisplay(comment, user, projectNamesById),
    commentType,
    fileId: comment.fileId,
    fileType: comment.fileType,
    fileVersionId: comment.fileVersionId,
    id: commentId,
    image: comment.image,
    imageComment: ["image", "panorama", "video", "document"].includes(commentType),
    imageId: comment.targetId || comment.imageId,
    message: comment.content,
    pointNumber:
      commentType === "panorama"
        ? Number(comment.pointNumber ?? comment.targetMetadata?.pointNumber) ||
          null
        : null,
    createdAt: comment.createdAt,
    parentCommentId,
    projectId: comment.projectId,
    selection: comment.selection,
    targetId: comment.targetId,
    timestamp: getRelativeTimeLabel(comment.createdAt),
    type: comment.type,
  };
}

/**
 * Recupera el ID numérico de entorno desde la referencia visual del padre.
 * Admite el prefijo environment: y devuelve null para valores no enteros positivos.
 *
 * @param {string|number|null} value - Referencia recibida del panel.
 * @returns {number|null} ID para la API o null.
 */
function getEnvironmentCommentId(value) {
  const normalizedValue = String(value || "");
  const numericValue = Number(
    normalizedValue.startsWith("environment:")
      ? normalizedValue.slice("environment:".length)
      : normalizedValue,
  );

  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : null;
}

/**
 * Normaliza proyectos a enteros positivos únicos conservando el orden.
 * Permite construir una clave estable que evita repetir el efecto cuando cambia
 * la identidad del array pero contiene los mismos IDs en el mismo orden.
 *
 * @param {Array} [projectIds=[]] - IDs candidatos.
 * @returns {Array} IDs numéricos válidos sin duplicados.
 */
function normalizeProjectIds(projectIds = []) {
  return [
    ...new Set(
      projectIds
        .map((projectId) => Number(projectId))
        .filter((projectId) => Number.isInteger(projectId) && projectId > 0),
    ),
  ];
}

/**
 * Actualiza por igualdad estricta de ID o añade una observación recibida por API o SSE.
 * Ignora entradas sin ID y conserva el orden de las filas existentes.
 *
 * @param {Array} comments - Observaciones actuales.
 * @param {Object|null} comment - Observación entrante.
 * @returns {Array} Lista resultante sin mutar el array original.
 */
function upsertCommentById(comments, comment) {
  if (!comment?.id) {
    return comments;
  }

  const exists = comments.some((current) => current.id === comment.id);

  return exists
    ? comments.map((current) => (current.id === comment.id ? comment : current))
    : [...comments, comment];
}

/**
 * Ordena una copia de las observaciones de la fecha más antigua a la más reciente.
 * Utiliza cero como fecha cuando createdAt está ausente.
 *
 * @param {Array} comments - Observaciones por ordenar.
 * @returns {Array} Copia ordenada.
 */
function sortCommentsByCreatedAt(comments) {
  return [...comments].sort(
    (left, right) =>
      new Date(left.createdAt || 0).getTime() -
      new Date(right.createdAt || 0).getTime(),
  );
}

/**
 * Combina lecturas periódicas con observaciones locales o recibidas por eventos.
 * Normaliza IDs como texto, prioriza la lectura nueva y ordena por createdAt;
 * conserva observaciones previas ausentes en la nueva lectura.
 *
 * @param {Array} currentComments - Observaciones existentes.
 * @param {Array} nextComments - Observaciones de la lectura nueva.
 * @returns {Array} Unión ordenada sin IDs repetidos.
 */
function mergeCommentsById(currentComments, nextComments) {
  const commentsById = new Map();

  currentComments.forEach((comment) => {
    if (comment?.id) {
      commentsById.set(String(comment.id), comment);
    }
  });

  nextComments.forEach((comment) => {
    if (comment?.id) {
      commentsById.set(String(comment.id), comment);
    }
  });

  return sortCommentsByCreatedAt(Array.from(commentsById.values()));
}

/**
 * Coordina observaciones de un proyecto, creación, eventos SSE y polling opcional.
 * Con enabled y projectId se suscribe a la fuente compartida (projectCommentFeed): una carga,
 * una conexión SSE y un sondeo incremental por proyecto, en pausa con la pestaña oculta; los
 * errores de lecturas de fondo se ignoran. El cleanup cancela la suscripción, sin abortar
 * requests. Deshabilitar o quitar el proyecto limpia el estado.
 * submitComment acepta texto o { message, parentCommentId, projectId, commentType,
 * image, selection, targetId }; permite otro proyecto y propaga errores de creación.
 * refresh reemplaza filas y captura errores. Las acciones manuales no dependen
 * de enabled ni están protegidas por la guarda de montaje del efecto.
 *
 * @param {Object} params - Contexto de observaciones.
 * @param {boolean} [params.enabled=true] - Habilita lectura y suscripción automáticas.
 * @param {number|string|null} params.projectId - Proyecto de lectura y destino predeterminado.
 * @param {number} [params.refreshIntervalMs=0] - Polling en ms; cero lo desactiva.
 * @param {Object|null} params.user - Usuario para presentación; no valida permisos.
 * @returns {Object} comments, drawerComments, error, readError, loading, submitComment y refresh.
 * Las acciones devuelven Promise<void>; loading solo cubre lecturas. readError distingue
 * los fallos de carga de error, que conserva también el último fallo de envío.
 */
export function useProjectComments({
  enabled = true,
  projectId,
  refreshIntervalMs = 0,
  user,
}) {
  const [comments, setComments] = useState([]);
  const [readError, setReadError] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !projectId) {
      setComments([]);
      setReadError("");
      setLoading(false);
      return undefined;
    }

    // Fuente compartida (P1-1): una carga, una conexión SSE y un sondeo incremental por proyecto
    // para todos los hooks montados; el sondeo se detiene con la pestaña oculta.
    return projectCommentFeed.subscribe(projectId, {
      intervalMs: refreshIntervalMs,
      onChange: (snapshot) => {
        setComments(snapshot.comments);
        setLoading(snapshot.loading);
        setReadError(snapshot.error);
      },
    });
  }, [enabled, projectId, refreshIntervalMs]);

  /**
   * Publica una observación o respuesta y actualiza su fila por id.
   * Rechaza errores de API y destinos ausentes; conserva el mensaje sin activar
   * loading de lectura, porque cada compositor controla su propio envío pendiente.
   * @param {string|Object} input Texto o payload con proyecto, padre y referencias.
   * @returns {Promise<void>} Confirma la creación y actualiza las observaciones.
   * @throws {Error} Proyecto ausente o fallo de creación recibido de la API.
   */
  const submitComment = useCallback(
    async (input) => {
      // Support both `submitComment("text")` and `submitComment({ message, parentCommentId })`
      const payload =
        typeof input === "string"
          ? { message: input, parentCommentId: null }
          : input || {};

      const { message, parentCommentId } = payload;
      const targetProjectId =
        payload.projectId == null || payload.projectId === ""
          ? projectId
          : payload.projectId;

      if (!targetProjectId) {
        const requestError = new Error("No se encontro el proyecto para comentar.");
        setSubmissionError(requestError.message);
        throw requestError;
      }

      const normalizedParent =
        parentCommentId == null || parentCommentId === ""
          ? null
          : Number.isFinite(Number(parentCommentId))
            ? Number(parentCommentId)
            : parentCommentId;

      setSubmissionError("");

      try {
        const data = await api.projects.createComment({
          commentType: payload.commentType,
          content: message,
          image: payload.image,
          parentCommentId: normalizedParent,
          projectId: targetProjectId,
          selection: payload.selection,
          targetId: payload.targetId,
        });

        if (data && data.comment) {
          // La fuente compartida la muestra en todos los hooks del proyecto; si el destino es otro
          // proyecto no suscrito aquí, se conserva como antes en la lista local.
          if (String(targetProjectId) === String(projectId)) {
            projectCommentFeed.add(targetProjectId, data.comment);
          } else {
            setComments((current) => upsertCommentById(current, data.comment));
          }
        }
      } catch (requestError) {
        setSubmissionError(requestError.message || "No se pudo guardar la observación.");
        throw requestError;
      }
    },
    [projectId],
  );

  const refresh = useCallback(async () => {
    if (!projectId) {
      return;
    }

    setLoading(true);
    setReadError("");

    try {
      setComments((await projectCommentFeed.refresh(projectId)).comments);
    } catch (requestError) {
      setReadError(
        requestError.message || "No se pudieron cargar las observaciones.",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const drawerComments = useMemo(
    () =>
      comments.map((comment) => toDrawerComment(comment, user)),
    [comments, user],
  );

  return {
    comments,
    drawerComments,
    error: readError || submissionError,
    readError,
    loading,
    submitComment,
    refresh,
  };
}

/**
 * Agrega observaciones de proyectos cuando la política del usuario permite acceso.
 * Suscribe cada ID normalizado a la fuente compartida, que reutiliza cargas, conexiones SSE
 * (con un máximo global) y sondeo incremental; un fallo inicial expone error y los de fondo se
 * silencian. refresh recarga completo y captura fallos sin rechazar su promesa.
 * El cleanup cancela las suscripciones, sin abortar requests. Sin acceso o IDs programa un reset con window.setTimeout(0)
 * que también se limpia; drawerComments queda vacío inmediatamente sin acceso.
 * La guarda de montaje del efecto no cubre el refresco manual.
 *
 * @param {Object} params - Ámbito de proyectos y usuario.
 * @param {boolean} [params.enabled=true] - Habilita carga junto con canAccessObservations.
 * @param {Array} [params.projectIds=[]] - IDs convertidos a enteros positivos únicos.
 * @param {Object} [params.projectNamesById={}] - Nombres usados en la adaptación.
 * @param {number} [params.refreshIntervalMs=0] - Polling en ms; cero lo desactiva.
 * @param {Object|null} params.user - Usuario para política de acceso y presentación.
 * @returns {Object} comments, drawerComments, error, loading y refresh (Promise<void>), sin envío.
 */
export function useRecentProjectComments({
  enabled = true,
  projectIds = [],
  projectNamesById = {},
  refreshIntervalMs = 0,
  user,
}) {
  const observationsAllowed = enabled && canAccessObservations(user);
  const projectIdsKey = useMemo(
    () => normalizeProjectIds(projectIds).join(","),
    [projectIds],
  );
  const normalizedProjectIds = useMemo(
    () =>
      projectIdsKey
        ? projectIdsKey.split(",").map((projectId) => Number(projectId))
        : [],
    [projectIdsKey],
  );
  const [comments, setComments] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!observationsAllowed || normalizedProjectIds.length === 0) {
      const resetId = window.setTimeout(() => {
        setComments([]);
        setError("");
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(resetId);
    }

    // Fuente compartida (P1-1): cada proyecto se carga una vez y se mantiene con lecturas
    // incrementales; los proyectos que ya sigue otro hook no generan peticiones adicionales.
    return subscribeToProjects(normalizedProjectIds, refreshIntervalMs, ({ comments: nextComments, error: nextError, loading: nextLoading }) => {
      setComments(nextComments);
      setError(nextError);
      setLoading(nextLoading);
    });
  }, [normalizedProjectIds, observationsAllowed, refreshIntervalMs]);

  const refresh = useCallback(async () => {
    if (!observationsAllowed || normalizedProjectIds.length === 0) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const snapshots = await Promise.all(
        normalizedProjectIds.map((projectId) => projectCommentFeed.refresh(projectId)),
      );

      setComments(snapshots.flatMap((snapshot) => snapshot.comments));
    } catch (requestError) {
      setError(
        requestError.message || "No se pudieron cargar las observaciones.",
      );
    } finally {
      setLoading(false);
    }
  }, [normalizedProjectIds, observationsAllowed]);

  const drawerComments = useMemo(
    () => observationsAllowed
      ? comments.map((comment) => toDrawerComment(comment, user, projectNamesById))
      : [],
    [comments, observationsAllowed, projectNamesById, user],
  );

  return {
    comments,
    drawerComments,
    error,
    loading,
    refresh,
  };
}

/**
 * Gestiona observaciones del entorno con carga inicial, polling opcional y creación.
 * enabled controla solo el efecto automático; desactivarlo conserva el estado.
 * queueMicrotask inicia indicadores; window.setInterval combina lecturas por ID
 * sin exponer errores de polling. El cleanup limpia el intervalo e ignora resultados
 * y microtareas protegidas del efecto, sin abortar requests ni proteger acciones manuales.
 * submitComment acepta texto o { message, parentCommentId }, retira environment:
 * del padre y propaga errores de creación; refresh reemplaza filas y captura fallos.
 * No registra SSE ni verifica aquí la política de acceso por rol.
 *
 * @param {Object} params - Contexto de lectura y presentación.
 * @param {boolean} [params.enabled=true] - Habilita carga automática.
 * @param {number} [params.refreshIntervalMs=0] - Polling en ms; cero lo desactiva.
 * @param {Object|null} params.user - Usuario para decorar autor y avatar.
 * @returns {Object} comments, drawerComments, error, readError, loading, refresh y submitComment.
 * Las acciones devuelven Promise<void>; loading solo cubre lecturas. readError distingue
 * los fallos de carga de error, que conserva también el último fallo de envío.
 */
export function useEnvironmentComments({
  enabled = true,
  refreshIntervalMs = 0,
  user,
}) {
  const [comments, setComments] = useState([]);
  const [readError, setReadError] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchComments = useCallback(async () => {
    const data = await api.environmentComments.listAll();
    return Array.isArray(data.comments) ? data.comments : [];
  }, []);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let isMounted = true;

    queueMicrotask(() => {
      if (!isMounted) return;
      setLoading(true);
      setReadError("");
    });

    fetchComments()
      .then((nextComments) => {
        if (isMounted) setComments(nextComments);
      })
      .catch((requestError) => {
        if (isMounted) {
          setReadError(
            requestError.message || "No se pudieron cargar las observaciones.",
          );
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    // Sondeo solo con la pestaña visible (P1-1); al volver a ella se lee una vez para ponerse al día.
    const refreshWhileVisible = () => {
      if (document.visibilityState === "hidden") return;
      fetchComments()
        .then((nextComments) => {
          if (isMounted) {
            setComments((current) =>
              mergeCommentsById(current, nextComments),
            );
          }
        })
        .catch(() => {});
    };
    const refreshIntervalId =
      refreshIntervalMs > 0
        ? window.setInterval(refreshWhileVisible, refreshIntervalMs)
        : null;
    const handleVisibilityChange = refreshIntervalMs > 0 ? refreshWhileVisible : null;
    if (handleVisibilityChange) document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      if (refreshIntervalId) window.clearInterval(refreshIntervalId);
      if (handleVisibilityChange) document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, fetchComments, refreshIntervalMs]);

  /**
   * Crea una observación del entorno y normaliza el id de su padre.
   * Conserva y propaga errores; deja loading para las lecturas para no desmontar
   * compositores ni bloquear envíos independientes desde otro campo.
   * @param {string|Object} input Texto o payload de la observación.
   * @returns {Promise<void>} Confirma la creación y actualiza la colección por id.
   * @throws {Error} Rechazo de la API de observaciones del entorno.
   */
  const submitComment = useCallback(async (input) => {
    const payload =
      typeof input === "string"
        ? { message: input, parentCommentId: null }
        : input || {};
    const parentCommentId = payload.parentCommentId
      ? getEnvironmentCommentId(payload.parentCommentId)
      : null;

    setSubmissionError("");

    try {
      const data = await api.environmentComments.create({
        content: payload.message,
        parentCommentId,
      });

      if (data?.comment) {
        setComments((current) => upsertCommentById(current, data.comment));
      }
    } catch (requestError) {
      setSubmissionError(requestError.message || "No se pudo guardar la observación.");
      throw requestError;
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setReadError("");

    try {
      setComments(await fetchComments());
    } catch (requestError) {
      setReadError(
        requestError.message || "No se pudieron cargar las observaciones.",
      );
    } finally {
      setLoading(false);
    }
  }, [fetchComments]);

  const drawerComments = useMemo(
    () => comments.map((comment) => toDrawerComment(comment, user)),
    [comments, user],
  );

  return {
    comments,
    drawerComments,
    error: readError || submissionError,
    readError,
    loading,
    refresh,
    submitComment,
  };
}
