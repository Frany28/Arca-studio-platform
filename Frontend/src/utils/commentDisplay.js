import { getApiUrl } from "../api/http.js";

/**
 * Construye la URL de foto de autor según el ámbito de la observación.
 * Exige indicador de foto e ID de autor positivo; proyectos también exigen projectId
 * positivo, mientras el entorno usa su endpoint independiente. No carga la foto.
 *
 * @param {Object|null} comment - Observación con autor, scope y proyecto.
 * @returns {string} URL de API o vacío.
 */
export function buildCommentAuthorAvatarUrl(comment) {
  const authorUserId = Number(comment?.author?.id);
  const projectId = Number(comment?.projectId);

  if (!comment?.author?.hasProfilePhoto || !Number.isInteger(authorUserId) || authorUserId <= 0) {
    return "";
  }

  if (comment?.scope === "environment") {
    return getApiUrl(
      `/environment-comments/authors/${authorUserId}/profile-photo`,
    );
  }

  if (!Number.isInteger(projectId) || projectId <= 0) return "";

  return getApiUrl(
    `/projects/${projectId}/comment-authors/${authorUserId}/profile-photo`,
  );
}

/**
 * Compara identidad del autor y usuario como texto para admitir IDs string o number.
 * IDs ausentes se convierten en vacío y no se consideran coincidencia.
 *
 * @param {Object|null} comment - Observación con author.id.
 * @param {Object|null} user - Usuario actual.
 * @returns {boolean} Si ambas identidades no vacías coinciden.
 */
export function isCommentFromCurrentUser(comment, user) {
  const author = comment?.author;
  const authorId = author?.id == null ? "" : String(author.id);
  const userId = user?.id == null ? "" : String(user.id);

  return Boolean(authorId && userId && authorId === userId);
}

/**
 * Resuelve foto del autor priorizando la foto actual del propio usuario.
 * Para otros autores prioriza la URL de API sobre avatarSrc; para el propio usuario
 * no usa avatarSrc del comentario como fallback.
 *
 * @param {Object|null} comment - Observación con autor y avatar opcional.
 * @param {Object|null} user - Usuario actual.
 * @returns {string} Fuente de avatar o vacío.
 */
export function getCommentAuthorAvatarSrc(comment, user) {
  if (isCommentFromCurrentUser(comment, user)) {
    return user?.profilePhotoUrl || buildCommentAuthorAvatarUrl(comment) || "";
  }

  return buildCommentAuthorAvatarUrl(comment) || comment?.avatarSrc || "";
}

export const OBSERVATION_TYPE_LABELS = Object.freeze({
  general: "Observación general",
  image: "Observación sobre imagen",
  video: "Observación sobre video",
  panorama: "Observación en panorámica 360",
  document: "Observación sobre documento",
});

export const AUTHOR_ROLE_LABELS = Object.freeze({
  admin: "Administrador",
  architect: "Arquitecto",
  client: "Cliente",
});

/**
 * Presenta Tú para el autor autenticado; para otros conserva el nombre disponible.
 * Prioriza author.name sobre name y usa Usuario como alternativa.
 *
 * @param {Object|null} comment - Observación original.
 * @param {Object|null} user - Usuario actual.
 * @returns {string} Nombre visible.
 */
export function getCommentAuthorName(comment, user) {
  if (isCommentFromCurrentUser(comment, user)) return "Tú";
  return comment?.author?.name || comment?.name || "Usuario";
}

/**
 * Resuelve el rol visible desde el usuario actual si es autor o desde author.roleCode.
 * Traduce admin, architect y client; códigos desconocidos usan Usuario.
 *
 * @param {Object|null} comment - Observación con autor.
 * @param {Object|null} user - Usuario actual.
 * @returns {string} Rol visible.
 */
export function getCommentAuthorRoleLabel(comment, user) {
  const roleCode = isCommentFromCurrentUser(comment, user)
    ? user?.role || user?.roleDetails?.code
    : comment?.author?.roleCode;

  return AUTHOR_ROLE_LABELS[roleCode] || "Usuario";
}

export function getObservationTypeLabel(commentType) {
  return OBSERVATION_TYPE_LABELS[commentType] || OBSERVATION_TYPE_LABELS.general;
}

function getCommentTime(comment) {
  const time = new Date(comment.createdAt || 0).getTime();

  return Number.isNaN(time) ? 0 : time;
}

/**
 * Ordena raíces de más recientes a antiguas y adjunta sus respuestas cronológicas.
 * Un límite entero positivo recorta solo raíces; respuestas de raíces recortadas
 * también quedan fuera. Añade al final respuestas cuyo padre no está entre las
 * raíces originales, de más recientes a antiguas; no recorre hilos recursivamente.
 *
 * @param {Array} comments - Observaciones con IDs, parentCommentId y createdAt.
 * @param {Object} [options={}] - Opciones de presentación.
 * @param {number} [options.limitRootThreads] - Máximo de conversaciones raíz.
 * @returns {Array} Observaciones ordenadas por conversación.
 */
export function orderCommentsByThread(comments, { limitRootThreads } = {}) {
  const repliesByParent = new Map();
  const rootComments = [];
  const rootIds = new Set();

  comments.forEach((comment) => {
    if (comment.parentCommentId) {
      const key = String(comment.parentCommentId);
      repliesByParent.set(key, [...(repliesByParent.get(key) ?? []), comment]);
      return;
    }

    rootIds.add(String(comment.id));
    rootComments.push(comment);
  });

  const sortedRootComments = [...rootComments].sort(
    (left, right) => getCommentTime(right) - getCommentTime(left),
  );
  const visibleRootComments =
    Number.isInteger(limitRootThreads) && limitRootThreads > 0
      ? sortedRootComments.slice(0, limitRootThreads)
      : sortedRootComments;
  const orderedThreads = visibleRootComments.flatMap((comment) => [
    comment,
    ...(repliesByParent.get(String(comment.id)) ?? []).sort(
      (left, right) => getCommentTime(left) - getCommentTime(right),
    ),
  ]);
  const orphanReplies = comments.filter(
    (comment) =>
      comment.parentCommentId && !rootIds.has(String(comment.parentCommentId)),
  );

  return [
    ...orderedThreads,
    ...orphanReplies.sort(
      (left, right) => getCommentTime(right) - getCommentTime(left),
    ),
  ];
}

export function getProjectNamesById(projects = []) {
  return Object.fromEntries(
    projects
      .filter((project) => project?.id != null)
      .map((project) => [String(project.id), project.name || project.title || "Proyecto"]),
  );
}

/**
 * Selecciona proyectos por rol para el flujo de comentarios del consumidor.
 * admin recibe todos; architect solo asignados; client solo proyectos de su clientId;
 * otros roles reciben []. No sustituye permisos de API ni la exclusión de admin
 * del panel global definida por observationAccess.
 *
 * @param {Array} [projects=[]] - Proyectos candidatos.
 * @param {Object|null} user - Usuario con rol e IDs.
 * @returns {Array} Proyectos seleccionados.
 */
export function getCommentableProjectsForUser(projects = [], user) {
  const roleCode = user?.role || user?.roleDetails?.code;

  if (roleCode === "admin") return projects;
  if (roleCode === "architect") {
    return projects.filter(
      (project) =>
        String(project?.assignedArchitect?.id || "") === String(user?.id || "") ||
        (project?.assignees || project?.assignedArchitects)?.some(
          (assignee) => String(assignee?.id || "") === String(user?.id || ""),
        ),
    );
  }
  if (roleCode === "client") {
    return projects.filter(
      (project) => String(project?.client?.id || "") === String(user?.clientId || ""),
    );
  }

  return [];
}

/**
 * Extiende la observación conservando sus campos y añadiendo datos de presentación.
 * Resuelve autor, avatar, rol y tipo mediante helpers; projectName usa el mapa por ID
 * o texto vacío, sin modificar la observación original.
 *
 * @param {Object} comment - Observación recibida de la API.
 * @param {Object|null} user - Usuario actual para presentación del autor.
 * @param {Object} [projectNamesById={}] - Nombres indexados por ID de proyecto.
 * @returns {Object} Observación decorada para la interfaz.
 */
export function decorateCommentForDisplay(comment, user, projectNamesById = {}) {
  return {
    ...comment,
    avatarSrc: getCommentAuthorAvatarSrc(comment, user),
    authorRoleLabel: getCommentAuthorRoleLabel(comment, user),
    name: getCommentAuthorName(comment, user),
    observationTypeLabel: getObservationTypeLabel(comment?.commentType),
    projectName: projectNamesById[String(comment?.projectId)] || "",
  };
}
