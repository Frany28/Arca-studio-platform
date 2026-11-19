import { canReceiveCommentAudience, classifyCommentAudience } from "./projectCommentAudience.js";
import { FILE_ACCESS_POLICY, FILE_STATUS, evaluateFileVersionAccess } from "./projectFileAccess.js";
import { resolveCurrentVersion } from "./projectFileReview.js";
import { PROJECT_STATUS, isProjectFinalized } from "./projectStatus.js";

// Compatibilidad de archivos heredados (Fase 1.2, B9). Dominio puro.
//
// Convertir un archivo heredado (`access_policy` NULL) a la política 1.2 consiste en:
// - `access_policy = 1`, sin tocar sus versiones: una versión heredada (estado NULL) ya cuenta como
//   aprobada, así que no se inventa ninguna aprobación;
// - una autorización activa del cliente para la versión vigente: todos los usuarios del cliente
//   conservan el acceso, porque la autorización es del cliente y no de un usuario;
// - una autorización del escaparate solo si hoy se ve en él (proyecto público y finalizado, imagen o
//   video vigente);
// - los comentarios de imagen, video o panorámica sin versión pasan a la versión que comentaban,
//   solo cuando es inequívoca (la vigente).
//
// La equivalencia se mide con las mismas funciones que usa la aplicación (evaluateFileVersionAccess y
// la audiencia de comentarios de B6), para cada actor, versión y comentario, en el estado actual del
// proyecto y, si es draft, también tras finalizar su configuración. Una pérdida de acceso, o una
// ganancia que no sea del equipo (historial) o del autor (sus versiones), deja el archivo en revisión.

export const COMPATIBILITY_REASONS = Object.freeze({
  ACCESS_GAIN_UNEXPECTED: "ACCESS_GAIN_UNEXPECTED",
  ACCESS_LOSS: "ACCESS_LOSS",
  COMMENT_ACCESS_LOSS: "COMMENT_ACCESS_LOSS",
  COMMENT_BEFORE_FIRST_VERSION: "COMMENT_BEFORE_FIRST_VERSION",
  COMMENT_ON_PREVIOUS_VERSION: "COMMENT_ON_PREVIOUS_VERSION",
  CURRENT_VERSION_MISMATCH: "CURRENT_VERSION_MISMATCH",
  DOCUMENT_COMMENT_ON_PREVIOUS_VERSION: "DOCUMENT_COMMENT_ON_PREVIOUS_VERSION",
  EXISTING_AUDIENCE_GRANTS: "EXISTING_AUDIENCE_GRANTS",
  FILE_ARCHIVED_DA1: "FILE_ARCHIVED_DA1",
  NO_CURRENT_VERSION: "NO_CURRENT_VERSION",
  POINT_COLLISION: "POINT_COLLISION",
  PROJECT_ARCHIVED_DA1: "PROJECT_ARCHIVED_DA1",
});

// Ganancias de acceso esperadas al pasar a la política 1.2 (no bloquean).
export const EXPECTED_GAINS = Object.freeze({
  AUTHOR_OWN_VERSION: "AUTHOR_OWN_VERSION",
  TEAM_VERSION_HISTORY: "TEAM_VERSION_HISTORY",
});

const SHOWCASE_MEDIA = /^(image|video)\//;
const GALLERY_COMMENT_TYPES = new Set(["image", "video", "panorama"]);
// Actores ajenos sintéticos: ids negativos que nunca coinciden con autores reales.
const OUTSIDERS = Object.freeze([
  { actor: { clientId: null, id: -2, role: "architect" }, key: "outsider:architect", kind: "outsider" },
  { actor: { clientId: -3, id: -3, role: "client" }, key: "outsider:client", kind: "outsider" },
]);

/**
 * Construye los actores cuya visión se compara: el administrador, el equipo asignado, cada usuario
 * del cliente del proyecto y dos ajenos (arquitecto y cliente) que representan el escaparate.
 *
 * @param {{ adminId?: number, staffIds: number[], clientUserIds: number[], clientId: number }} input - Personas del proyecto.
 * @returns {Array<{ key: string, kind: string, actor: object }>} Actores.
 */
export function buildCompatibilityActors({ adminId = -1, clientId, clientUserIds, staffIds }) {
  return [
    { actor: { clientId: null, id: adminId, role: "admin" }, key: "admin", kind: "staff" },
    ...[...new Set(staffIds.map(Number))].map((id) => ({ actor: { clientId: null, id, role: "architect" }, key: `staff:${id}`, kind: "staff" })),
    ...[...new Set(clientUserIds.map(Number))].map((id) => ({ actor: { clientId: Number(clientId), id, role: "client" }, key: `client:${id}`, kind: "client" })),
    ...OUTSIDERS,
  ];
}

/**
 * Estados del proyecto en que se compara el acceso: el actual y, en un draft, también el que tendrá
 * al finalizar la configuración (pending), para no aplazar una diferencia.
 *
 * @param {{ status: string }} project - Proyecto.
 * @returns {string[]} Estados.
 */
export function comparisonStatuses(project) {
  return project.status === PROJECT_STATUS.DRAFT ? [PROJECT_STATUS.DRAFT, PROJECT_STATUS.PENDING] : [project.status];
}

/**
 * Proyecto del dominio visto por un actor en un estado: marca si el actor es responsable asignado.
 * El estado puede ser el actual o el simulado tras finalizar la configuración de un draft.
 *
 * @param {object} project - Proyecto con `assigneeIds`.
 * @param {object} actor - Actor.
 * @param {string} status - Estado evaluado.
 * @returns {object} Proyecto para evaluateFileVersionAccess.
 */
function projectFor(project, actor, status) {
  return {
    archivedFromStatus: project.archivedFromStatus ?? null,
    assignedArchitectId: project.assignedArchitectId,
    clientId: project.clientId,
    isAssignee: (project.assigneeIds || []).map(Number).includes(Number(actor.id)),
    isPublic: project.isPublic === true,
    status,
  };
}

/**
 * Calcula qué ve cada actor de cada versión con una política: heredada (vigente = `files.current_version`)
 * o 1.2 (vigente = la aprobada de mayor número y autorizaciones indicadas).
 *
 * @param {object} input - Archivo, proyecto, versiones, actores y autorizaciones.
 * @param {object} input.file - Archivo (`status`, `fileType`, `currentVersion`).
 * @param {object} input.project - Proyecto.
 * @param {object[]} input.versions - Versiones.
 * @param {object[]} input.actors - Actores de buildCompatibilityActors.
 * @param {"legacy"|"converted"} input.mode - Política evaluada.
 * @param {{ clientVersionId?: number|null, showcaseVersionId?: number|null }} [input.grants] - Autorizaciones (1.2).
 * @returns {Record<string, "direct"|"anonymized">} Clave `estado|actor|versión` → forma de acceso.
 */
export function evaluateAccessMatrix({ actors, file, grants = {}, mode, project, versions }) {
  const legacyCurrent = versions.find((version) => version.versionNumber === file.currentVersion && !version.deletedAt) ?? null;
  const currentVersionId = mode === "legacy" ? legacyCurrent?.id ?? null : resolveCurrentVersion(versions)?.id ?? null;
  const domainFile = {
    accessPolicy: mode === "legacy" ? FILE_ACCESS_POLICY.LEGACY : FILE_ACCESS_POLICY.PHASE_1_2,
    clientVersionId: grants.clientVersionId ?? null,
    fileType: file.fileType,
    showcaseVersionId: grants.showcaseVersionId ?? null,
    status: file.status,
  };
  const matrix = {};
  for (const status of comparisonStatuses(project)) {
    for (const { actor, key } of actors) {
      for (const version of versions) {
        const access = evaluateFileVersionAccess({ actor, currentVersionId, file: domainFile, project: projectFor(project, actor, status), version });
        if (access.outcome === "allowed") matrix[`${status}|${key}|${version.id}`] = access.anonymized ? "anonymized" : "direct";
      }
    }
  }
  return matrix;
}

/**
 * Compara dos matrices de acceso. Pérdida: algo visible antes deja de serlo o pasa de directo a
 * anonimizado. Ganancia esperada: el equipo ve el historial o el autor sus propias versiones.
 *
 * @param {object} input - Matrices, actores y versiones.
 * @param {Record<string, string>} input.before - Acceso con la política heredada.
 * @param {Record<string, string>} input.after - Acceso con la política 1.2.
 * @param {object[]} input.actors - Actores.
 * @param {object[]} input.versions - Versiones (para reconocer al autor).
 * @returns {{ losses: string[], gains: Array<{ key: string, category: string }> }} Diferencias.
 */
export function compareAccessMatrices({ actors, after, before, versions }) {
  const actorsByKey = new Map(actors.map((entry) => [entry.key, entry]));
  const versionsById = new Map(versions.map((version) => [String(version.id), version]));
  const losses = Object.keys(before).filter((key) => !after[key] || (after[key] === "anonymized" && before[key] === "direct"));
  const gains = Object.keys(after).filter((key) => !before[key]).map((key) => {
    const [, actorKey, versionId] = key.split("|");
    const entry = actorsByKey.get(actorKey);
    if (entry?.kind === "staff") return { category: EXPECTED_GAINS.TEAM_VERSION_HISTORY, key };
    if (Number(versionsById.get(versionId)?.uploadedBy) === Number(entry?.actor.id)) return { category: EXPECTED_GAINS.AUTHOR_OWN_VERSION, key };
    return { category: COMPATIBILITY_REASONS.ACCESS_GAIN_UNEXPECTED, key };
  });
  return { gains, losses };
}

/**
 * Decide a qué versión pasa cada comentario histórico de galería sin versión. Un hilo sigue a su
 * raíz. Es inequívoca si el archivo tiene una sola versión o si, al crearse la raíz, la última
 * versión existente era ya la vigente; si no, el archivo queda en revisión.
 *
 * @param {object} input - Comentarios, versiones y versión vigente.
 * @param {object[]} input.comments - Comentarios que resuelven a este archivo.
 * @param {object[]} input.versions - Versiones no retiradas.
 * @param {number} input.currentVersionId - Versión vigente.
 * @returns {{ updates: Array<{ commentId: number, fileVersionId: number }>, reasons: string[] }} Asignaciones o motivos.
 */
export function mapHistoricalComments({ comments, currentVersionId, versions }) {
  const live = versions.filter((version) => !version.deletedAt).sort((left, right) => left.versionNumber - right.versionNumber);
  const reasons = new Set();
  const updates = [];
  const byId = new Map(comments.map((comment) => [Number(comment.id), comment]));
  for (const comment of comments) {
    if (comment.deletedAt) continue;
    const root = comment.parentCommentId ? byId.get(Number(comment.parentCommentId)) ?? comment : comment;
    if (comment.commentType === "document") {
      if (Number(comment.fileVersionId) !== Number(currentVersionId)) reasons.add(COMPATIBILITY_REASONS.DOCUMENT_COMMENT_ON_PREVIOUS_VERSION);
      continue;
    }
    if (!GALLERY_COMMENT_TYPES.has(comment.commentType) || comment.fileVersionId) continue;
    let mapped = live.length === 1 ? live[0] : null;
    if (!mapped) {
      const createdAt = new Date(root.createdAt).getTime();
      mapped = live.filter((version) => new Date(version.createdAt).getTime() <= createdAt).at(-1) ?? null;
      if (!mapped) {
        reasons.add(COMPATIBILITY_REASONS.COMMENT_BEFORE_FIRST_VERSION);
        continue;
      }
    }
    if (Number(mapped.id) !== Number(currentVersionId)) {
      reasons.add(COMPATIBILITY_REASONS.COMMENT_ON_PREVIOUS_VERSION);
      continue;
    }
    updates.push({ commentId: Number(comment.id), fileVersionId: Number(mapped.id) });
  }
  return { reasons: [...reasons], updates };
}

/**
 * Indica si un comentario es una raíz de panorámica vigente con número de punto: las únicas filas que
 * cubre el índice único de puntos.
 *
 * @param {object} comment - Comentario.
 * @returns {boolean} true si compite por un número de punto.
 */
function isNumberedPanoramaRoot(comment) {
  return comment.commentType === "panorama" && !comment.parentCommentId && !comment.deletedAt
    && comment.pointNumber !== null && comment.pointNumber !== undefined;
}

/**
 * Indica si asignar versión a las raíces de panorámica chocaría con un punto ya numerado en esa
 * versión (índice único por destino, versión y número de la migración de B6).
 *
 * @param {{ comments: object[], updates: Array<{ commentId: number, fileVersionId: number }> }} input - Comentarios y asignaciones.
 * @returns {boolean} true si alguna raíz chocaría.
 */
export function hasPointCollision({ comments, updates }) {
  const assigned = new Map(updates.map((update) => [update.commentId, update.fileVersionId]));
  const occupied = new Set(comments
    .filter((comment) => isNumberedPanoramaRoot(comment) && comment.fileVersionId && !assigned.has(Number(comment.id)))
    .map((comment) => `${comment.targetId}|${comment.fileVersionId}|${comment.pointNumber}`));
  const incoming = new Set();
  for (const comment of comments) {
    if (!isNumberedPanoramaRoot(comment) || !assigned.has(Number(comment.id))) continue;
    const key = `${comment.targetId}|${assigned.get(Number(comment.id))}|${comment.pointNumber}`;
    if (occupied.has(key) || incoming.has(key)) return true;
    incoming.add(key);
  }
  return false;
}

/**
 * Calcula qué miembros del proyecto reciben cada comentario, antes (archivo heredado: todo el
 * proyecto) o después (versión asignada y autorización del cliente), con la audiencia de B6.
 *
 * @param {object} input - Comentarios, actores y estado.
 * @param {object[]} input.comments - Comentarios no retirados del archivo.
 * @param {object[]} input.actors - Actores (solo cuentan los miembros: equipo y cliente).
 * @param {object[]} input.versions - Versiones (autor de cada una).
 * @param {"legacy"|"converted"} input.mode - Política.
 * @param {Map<number, number>} [input.assignments] - Comentario → versión asignada.
 * @param {number|null} [input.clientVersionId] - Versión autorizada al cliente.
 * @returns {Record<string, true>} Clave `comentario|actor` de los visibles.
 */
export function evaluateCommentMatrix({ actors, assignments = new Map(), clientVersionId = null, comments, mode, versions }) {
  const uploaderOf = new Map(versions.map((version) => [Number(version.id), Number(version.uploadedBy)]));
  const matrix = {};
  for (const comment of comments) {
    if (comment.deletedAt) continue;
    const fileVersionId = comment.fileVersionId ?? assignments.get(Number(comment.id)) ?? null;
    const audience = classifyCommentAudience({
      authorId: Number(comment.userId),
      clientVersionId,
      file: { accessPolicy: mode === "legacy" ? null : FILE_ACCESS_POLICY.PHASE_1_2 },
      fileVersionId,
      versionUploadedBy: fileVersionId ? uploaderOf.get(Number(fileVersionId)) ?? null : null,
    });
    for (const { actor, key, kind } of actors) {
      if (kind === "outsider") continue;
      if (canReceiveCommentAudience(audience, { id: actor.id, role: { code: actor.role } })) matrix[`${comment.id}|${key}`] = true;
    }
  }
  return matrix;
}

/**
 * Planifica la conversión de un archivo heredado o explica por qué queda en revisión. No escribe
 * nada: devuelve las acciones, la visión anterior (para verificar después) y las diferencias.
 *
 * @param {object} input - Estado leído del archivo.
 * @param {object} input.file - Archivo (`id`, `status`, `fileType`, `currentVersion`).
 * @param {object} input.project - Proyecto (`status`, `archivedFromStatus`, `isPublic`, `clientId`, `assignedArchitectId`, `assigneeIds`).
 * @param {object[]} input.versions - Versiones del archivo.
 * @param {object[]} input.comments - Comentarios que resuelven al archivo.
 * @param {object[]} input.actors - Actores.
 * @param {number} [input.existingGrantCount] - Autorizaciones ya registradas para el archivo.
 * @returns {object} Plan del archivo: `decision` (`convert`|`review`), motivos, acciones y matrices.
 */
export function planLegacyFileConversion({ actors, comments, existingGrantCount = 0, file, project, versions }) {
  const reasons = new Set();
  const live = versions.filter((version) => !version.deletedAt);
  const legacyCurrent = live.find((version) => version.versionNumber === file.currentVersion) ?? null;
  const resolved = resolveCurrentVersion(versions);
  if (!legacyCurrent) reasons.add(COMPATIBILITY_REASONS.NO_CURRENT_VERSION);
  else if (Number(resolved?.id) !== Number(legacyCurrent.id)) reasons.add(COMPATIBILITY_REASONS.CURRENT_VERSION_MISMATCH);
  if (file.status === FILE_STATUS.ARCHIVED) reasons.add(COMPATIBILITY_REASONS.FILE_ARCHIVED_DA1);
  if (project.status === PROJECT_STATUS.ARCHIVED) reasons.add(COMPATIBILITY_REASONS.PROJECT_ARCHIVED_DA1);
  if (existingGrantCount > 0) reasons.add(COMPATIBILITY_REASONS.EXISTING_AUDIENCE_GRANTS);
  if (reasons.size) return { decision: "review", reasons: [...reasons].sort() };

  const currentVersionId = Number(legacyCurrent.id);
  const mapping = mapHistoricalComments({ comments, currentVersionId, versions });
  mapping.reasons.forEach((reason) => reasons.add(reason));
  if (hasPointCollision({ comments, updates: mapping.updates })) reasons.add(COMPATIBILITY_REASONS.POINT_COLLISION);
  const mediaType = legacyCurrent.contentType ?? file.fileType ?? "";
  const showcaseVersionId = project.isPublic === true && isProjectFinalized(project.status) && SHOWCASE_MEDIA.test(String(mediaType)) ? currentVersionId : null;
  const grants = { clientVersionId: currentVersionId, showcaseVersionId };

  const beforeAccess = evaluateAccessMatrix({ actors, file, mode: "legacy", project, versions });
  const afterAccess = evaluateAccessMatrix({ actors, file, grants, mode: "converted", project, versions });
  const access = compareAccessMatrices({ actors, after: afterAccess, before: beforeAccess, versions });
  if (access.losses.length) reasons.add(COMPATIBILITY_REASONS.ACCESS_LOSS);
  if (access.gains.some((gain) => gain.category === COMPATIBILITY_REASONS.ACCESS_GAIN_UNEXPECTED)) reasons.add(COMPATIBILITY_REASONS.ACCESS_GAIN_UNEXPECTED);

  const assignments = new Map(mapping.updates.map((update) => [update.commentId, update.fileVersionId]));
  const beforeComments = evaluateCommentMatrix({ actors, comments, mode: "legacy", versions });
  const afterComments = evaluateCommentMatrix({ actors, assignments, clientVersionId: currentVersionId, comments, mode: "converted", versions });
  const commentLosses = Object.keys(beforeComments).filter((key) => !afterComments[key]);
  if (commentLosses.length) reasons.add(COMPATIBILITY_REASONS.COMMENT_ACCESS_LOSS);

  const differences = { accessLosses: access.losses, commentLosses, gains: access.gains };
  if (reasons.size) return { decision: "review", differences, reasons: [...reasons].sort() };
  return {
    actions: { commentUpdates: mapping.updates, grants },
    beforeAccess,
    beforeComments,
    decision: "convert",
    differences,
    reasons: [],
  };
}
