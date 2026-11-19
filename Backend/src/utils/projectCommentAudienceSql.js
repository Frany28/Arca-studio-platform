import { isProjectFileReviewEnabled } from "../config/projectFileReview.js";
import { activeGrantSql } from "./projectFileAudienceSql.js";

/*
 * Política de audiencias de los comentarios de proyecto en SQL (Fase 1.2, B6). Traduce
 * domain/projectCommentAudience.js para listados, creación y autores, con la misma regla que las
 * descargas de B5 aplicada a la versión concreta que comenta cada observación:
 *
 * - Sin archivo (general, o `target_id` que no identifica un archivo del proyecto): todo el proyecto.
 * - Archivo heredado (`access_policy` NULL): todo el proyecto, como siempre (significado histórico).
 * - Archivo 1.2 con versión (`file_version_id`): el equipo; el cliente propietario si es la versión
 *   con autorización activa del cliente o la subió él.
 * - Archivo 1.2 sin versión inequívoca (comentario de imagen anterior a B6): el equipo y su autor.
 *
 * Las condiciones suponen que la consulta ya limita al usuario a proyectos accesibles para comentar
 * (administrador, arquitecto asignado o responsable, cliente propietario; nunca drafts salvo el
 * administrador): dentro de ese alcance, «equipo» equivale a los roles admin y architect.
 * Con la activación apagada no añaden uniones ni condiciones: el SQL es exactamente el anterior.
 */

const FILE_TARGET_COMMENT_TYPES = "('image'::comment_type, 'video'::comment_type, 'panorama'::comment_type)";
const STAFF_ROLES = "('admin', 'architect')";

/**
 * Expresión con el id del archivo al que se refiere un comentario: `file_id` en los comentarios de
 * documento y en los de imagen desde B6; en los anteriores, el `target_id` numérico de la galería
 * (`<id>` o `project-file-<id>`). Cualquier otro `target_id` no identifica un archivo.
 *
 * @param {string} commentAlias - Alias de public.project_comments.
 * @returns {string} Expresión SQL de tipo bigint o NULL.
 */
export function commentTargetFileIdSql(commentAlias) {
  const c = commentAlias;
  return `coalesce(${c}.file_id, case
      when ${c}.comment_type in ${FILE_TARGET_COMMENT_TYPES} and ${c}.target_id ~ '^(project-file-)?[0-9]{1,18}$'
        then substring(${c}.target_id from '([0-9]+)$')::bigint
    end)`;
}

/**
 * Condición de acceso a una versión de un archivo 1.2 para comentar o leer sus comentarios: el
 * equipo, o el cliente si es la versión con autorización activa del cliente o la subió él.
 *
 * @param {object} options - Alias y parámetros.
 * @param {string} options.fileAlias - Alias del archivo.
 * @param {string} options.versionIdSql - Expresión con el id de la versión.
 * @param {string} options.uploaderSql - Expresión con el autor de la versión.
 * @param {string} options.role - Parámetro posicional del rol.
 * @param {string} options.userId - Parámetro posicional del usuario.
 * @returns {string} Condición SQL.
 */
function policyVersionAccessSql({ fileAlias, role, uploaderSql, userId, versionIdSql }) {
  return `(${role} in ${STAFF_ROLES}
    or ${versionIdSql} = ${activeGrantSql(fileAlias, "client_owner")}
    or ${uploaderSql} = ${userId})`;
}

/**
 * Construye la unión y la condición que filtran comentarios por la audiencia de la versión que
 * comentan. La condición va en el WHERE antes de LIMIT y del cursor, para que las páginas, los
 * cursores de sincronización y los números de punto visibles no dependan de comentarios ocultos.
 *
 * @param {object} options - Alias, usuario y primer parámetro libre.
 * @param {{ id: number, role?: { code?: string } }} options.user - Usuario autenticado.
 * @param {number} options.firstParam - Número del primer parámetro posicional libre.
 * @param {string} [options.commentAlias] - Alias de public.project_comments.
 * @param {boolean} [options.enabled] - Activación de la revisión (por defecto, la del entorno).
 * @returns {{ join: string, condition: string, params: unknown[] }} Fragmentos SQL y parámetros.
 */
export function buildCommentVisibilitySql({ commentAlias = "pc", enabled = isProjectFileReviewEnabled(), firstParam, user }) {
  if (!enabled) return { condition: "true", join: "", params: [] };
  const c = commentAlias;
  const role = `$${firstParam}`;
  const userId = `$${firstParam + 1}::bigint`;
  return {
    condition: `(comment_file.id is null
      or comment_file.access_policy is null
      or (${c}.file_version_id is null and (${role} in ${STAFF_ROLES} or ${c}.user_id = ${userId}))
      or (${c}.file_version_id is not null and ${policyVersionAccessSql({
        fileAlias: "comment_file",
        role,
        uploaderSql: "comment_version.uploaded_by",
        userId,
        versionIdSql: `${c}.file_version_id`,
      })}))`,
    join: commentTargetJoinSql(c),
    params: [user?.role?.code ?? "", Number(user?.id) || null],
  };
}

/**
 * Uniones que exponen el archivo comentado (`comment_file`, solo del mismo proyecto) y la versión
 * comentada (`comment_version`) de un comentario. Las comparten los listados y la audiencia SSE.
 *
 * @param {string} commentAlias - Alias de public.project_comments.
 * @returns {string} Fragmento SQL con dos uniones izquierdas.
 */
export function commentTargetJoinSql(commentAlias) {
  const c = commentAlias;
  return `left join lateral (
        select target_file.id, target_file.access_policy
        from public.files target_file
        where target_file.project_id = ${c}.project_id
          and target_file.id = ${commentTargetFileIdSql(c)}
      ) comment_file on true
      left join public.file_versions comment_version
        on comment_version.id = ${c}.file_version_id`;
}

/**
 * Condición de acceso a una versión concreta para comentar en ella o leer sus comentarios de
 * documento. En archivos heredados no restringe nada (regla histórica: acceso al proyecto).
 *
 * @param {object} options - Alias, usuario y primer parámetro libre.
 * @param {{ id: number, role?: { code?: string } }} options.user - Usuario autenticado.
 * @param {number} options.firstParam - Número del primer parámetro posicional libre.
 * @param {string} [options.fileAlias] - Alias de public.files.
 * @param {string} [options.versionAlias] - Alias de public.file_versions.
 * @param {boolean} [options.enabled] - Activación de la revisión (por defecto, la del entorno).
 * @returns {{ condition: string, params: unknown[] }} Condición SQL y parámetros.
 */
export function buildCommentVersionAccessSql({ enabled = isProjectFileReviewEnabled(), fileAlias = "f", firstParam, user, versionAlias = "fv" }) {
  if (!enabled) return { condition: "true", params: [] };
  return {
    condition: `(${fileAlias}.access_policy is null or ${policyVersionAccessSql({
      fileAlias,
      role: `$${firstParam}`,
      uploaderSql: `${versionAlias}.uploaded_by`,
      userId: `$${firstParam + 1}::bigint`,
      versionIdSql: `${versionAlias}.id`,
    })})`,
    params: [user?.role?.code ?? "", Number(user?.id) || null],
  };
}
