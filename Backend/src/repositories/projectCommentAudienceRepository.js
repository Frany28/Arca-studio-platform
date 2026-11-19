import { pool } from "../config/db.js";
import { PROJECT_STATUS } from "../domain/projectStatus.js";
import { getProjectAccessCondition } from "../utils/projectCommentAccessSql.js";
import {
  buildCommentVersionAccessSql,
  buildCommentVisibilitySql,
  commentTargetJoinSql,
} from "../utils/projectCommentAudienceSql.js";
import { activeGrantSql, buildVisibleFileVersionSql } from "../utils/projectFileAudienceSql.js";

// Audiencias de los comentarios (Fase 1.2, B6): consultas que solo se usan con la revisión activada.
// Las escrituras llaman a estas funciones dentro de su transacción y después de bloquear el proyecto
// (FOR UPDATE): cambiar una autorización bloquea el proyecto FOR SHARE, así que cada comprobación ve
// las autorizaciones ya confirmadas y no puede cruzarse con una revocación simultánea.

const FILE_TARGET_COMMENT_TYPES = new Set(["image", "video", "panorama"]);
const GALLERY_TARGET_PATTERN = /^(?:project-file-)?(\d{1,18})$/;

/**
 * Interpreta el `target_id` de un comentario de imagen, video o panorámica como id de archivo,
 * con el mismo criterio que `commentTargetFileIdSql`. Cualquier otro destino no es un archivo.
 *
 * @param {string} commentType - Tipo del comentario.
 * @param {string|null} targetId - Destino enviado por la galería.
 * @returns {number|null} Id del archivo o null.
 */
export function parseCommentTargetFileId(commentType, targetId) {
  if (!FILE_TARGET_COMMENT_TYPES.has(commentType)) return null;
  const match = String(targetId ?? "").match(GALLERY_TARGET_PATTERN);
  return match ? Number(match[1]) : null;
}

/**
 * Bloquea el proyecto en la transacción si el usuario puede comentar en él (acceso vigente y
 * proyecto operativo: ni draft, ni archivado, ni finalizado). Es el primer paso de cada escritura.
 *
 * @param {{ query: Function }} client - Cliente de la transacción.
 * @param {{ projectId: number, user: object }} options - Proyecto y usuario.
 * @returns {Promise<boolean>} true si el proyecto quedó bloqueado y admite el comentario.
 */
export async function lockCommentableProject(client, { projectId, user }) {
  const access = getProjectAccessCondition(user);
  const result = await client.query(
    `select p.id
     from public.projects p
     where p.id = $${access.params.length + 1}
       and p.deleted_at is null
       and p.status not in (
         '${PROJECT_STATUS.DRAFT}'::public.project_status,
         'archived'::public.project_status,
         '${PROJECT_STATUS.FINISHED}'::public.project_status
       )
       and (${access.sql})
     for update of p`,
    [...access.params, projectId],
  );
  return Boolean(result.rows[0]);
}

/**
 * Indica si un comentario existente del proyecto es visible para el usuario con la política de
 * audiencias (por ejemplo, antes de responderlo). Un comentario oculto se trata como inexistente.
 *
 * @param {{ query: Function }} executor - Pool o cliente de la transacción.
 * @param {{ commentId: number, projectId: number, user: object }} options - Comentario y usuario.
 * @returns {Promise<boolean>} true si el usuario puede verlo.
 */
export async function isCommentVisibleTo(executor, { commentId, projectId, user }) {
  const visibility = buildCommentVisibilitySql({ enabled: true, firstParam: 3, user });
  const result = await executor.query(
    `select pc.id
     from public.project_comments pc
     ${visibility.join}
     where pc.id = $1 and pc.project_id = $2 and pc.deleted_at is null
       and ${visibility.condition}`,
    [commentId, projectId, ...visibility.params],
  );
  return Boolean(result.rows[0]);
}

/**
 * Comprueba que el usuario puede ver una versión concreta de un archivo del proyecto para comentarla
 * o leer sus comentarios de documento: acceso al proyecto y audiencia de la versión (archivos
 * heredados: la regla histórica de proyecto).
 *
 * @param {{ query: Function }} executor - Pool o cliente de la transacción.
 * @param {{ projectId: number, fileId: number, fileVersionId: number, user: object }} options - Versión y usuario.
 * @returns {Promise<boolean>} true si la versión es accesible.
 */
export async function canUserAccessCommentVersion(executor, { fileId, fileVersionId, projectId, user }) {
  const access = getProjectAccessCondition(user);
  const offset = access.params.length;
  const versionAccess = buildCommentVersionAccessSql({ enabled: true, firstParam: offset + 4, user });
  const result = await executor.query(
    `select fv.id
     from public.projects p
     inner join public.files f on f.project_id = p.id and f.id = $${offset + 2} and f.deleted_at is null
     inner join public.file_versions fv on fv.file_id = f.id and fv.id = $${offset + 3} and fv.deleted_at is null
     where p.id = $${offset + 1}
       and p.deleted_at is null
       and (${access.sql})
       and ${versionAccess.condition}`,
    [...access.params, projectId, fileId, fileVersionId, ...versionAccess.params],
  );
  return Boolean(result.rows[0]);
}

/**
 * Resuelve el archivo y la versión que comenta una observación nueva de imagen, video o panorámica.
 * Sin archivo del proyecto, o con un archivo heredado, no guarda referencias (como siempre). En un
 * archivo 1.2 guarda la versión pedida, si el usuario puede verla, o la versión que le muestra la
 * galería según la política común; sin versión visible, el comentario no se admite.
 *
 * @param {{ query: Function }} client - Cliente de la transacción, con el proyecto ya bloqueado.
 * @param {object} options - Destino y usuario.
 * @param {number} options.projectId - Proyecto.
 * @param {string} options.commentType - Tipo del comentario.
 * @param {string|null} options.targetId - Destino de la galería.
 * @param {number|null} options.fileVersionId - Versión pedida explícitamente (opcional).
 * @param {object} options.user - Usuario autenticado.
 * @returns {Promise<{ fileId: number|null, fileVersionId: number|null }|null>} Referencias o null si no es accesible.
 */
export async function resolveCommentFileTarget(client, { commentType, fileVersionId, projectId, targetId, user }) {
  const none = { fileId: null, fileVersionId: null };
  const fileId = parseCommentTargetFileId(commentType, targetId);
  if (!fileId) return none;
  const file = (await client.query(
    "select id, access_policy, deleted_at from public.files where id = $1 and project_id = $2",
    [fileId, projectId],
  )).rows[0];
  if (!file || file.access_policy === null) return none;
  if (file.deleted_at) return null;

  if (fileVersionId) {
    const allowed = await canUserAccessCommentVersion(client, { fileId, fileVersionId, projectId, user });
    return allowed ? { fileId, fileVersionId: Number(fileVersionId) } : null;
  }
  const audience = buildVisibleFileVersionSql({ enabled: true, firstParam: 3, user });
  const visible = (await client.query(
    `select version.id
     from public.files file
     inner join public.projects p on p.id = file.project_id
     ${audience.join}
     where file.id = $1 and file.project_id = $2 and ${audience.requireVersion}`,
    [fileId, projectId, ...audience.params],
  )).rows[0];
  return visible ? { fileId, fileVersionId: Number(visible.id) } : null;
}

/**
 * Lee lo necesario para decidir a quién se entrega un comentario por SSE: autor, archivo comentado
 * (con la misma resolución que los listados), versión, autor de la versión y autorización activa
 * del cliente en el momento de publicar.
 *
 * @param {number} commentId - Comentario recién confirmado.
 * @param {{ query: Function }} [executor] - Pool o cliente; por defecto, el pool compartido.
 * @returns {Promise<object|null>} Datos para `classifyCommentAudience` o null si no existe.
 */
export async function findCommentAudienceTarget(commentId, executor = pool) {
  const result = await executor.query(
    `select pc.user_id, pc.file_version_id, comment_file.id as file_id, comment_file.access_policy,
       comment_version.uploaded_by as version_uploaded_by,
       ${activeGrantSql("comment_file", "client_owner")} as client_version_id
     from public.project_comments pc
     ${commentTargetJoinSql("pc")}
     where pc.id = $1 and pc.deleted_at is null`,
    [commentId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    authorId: Number(row.user_id),
    clientVersionId: row.client_version_id === null ? null : Number(row.client_version_id),
    file: row.file_id === null ? null : { accessPolicy: row.access_policy === null ? null : Number(row.access_policy) },
    fileVersionId: row.file_version_id === null ? null : Number(row.file_version_id),
    versionUploadedBy: row.version_uploaded_by === null ? null : Number(row.version_uploaded_by),
  };
}
