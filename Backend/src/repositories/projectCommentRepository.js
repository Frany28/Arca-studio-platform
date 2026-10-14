import { pool, query } from "../config/db.js";
import { PROJECT_STATUS } from "../domain/projectStatus.js";
import { sanitizeCommentMetadata } from "../utils/commentMetadata.js";
import { pageResult } from "../utils/pagination.js";

const GENERAL_COMMENT_TYPE = "general";
const ACTIVE_COMMENT_STATUS = "active";

/**
 * Transforma el comentario del proyecto a la representación pública esperada.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} row - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
function toProjectComment(row) {
  const authorName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
  const targetMetadata = sanitizeCommentMetadata(row.target_metadata) || null;
  const commentType = row.comment_type || GENERAL_COMMENT_TYPE;

  return {
    author: {
      hasProfilePhoto: Boolean(row.has_profile_photo),
      id: Number(row.user_id),
      name: authorName || "Usuario",
      roleCode: row.role_code,
    },
    commentType,
    content: row.content,
    createdAt: row.created_at,
    id: Number(row.id),
    image: targetMetadata?.image || null,
    parentCommentId: row.parent_comment_id
      ? Number(row.parent_comment_id)
      : null,
    pointNumber:
      commentType === "panorama"
        ? Number(targetMetadata?.pointNumber ?? targetMetadata?.point_number) ||
          null
        : null,
    projectId: Number(row.project_id),
    selection: targetMetadata?.selection || null,
    targetId: row.target_id || null,
    type: row.parent_comment_id ? "reply" : "comment",
  };
}

/**
 * Transforma el comentario de documento a la representación pública esperada.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} row - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
function toDocumentComment(row) {
  const comment = toProjectComment(row);
  const anchorContext = row.anchor_context_json || null;
  const anchorKind = anchorContext?.kind || "document-point";
  return {
    ...comment,
    fileId: Number(row.file_id),
    fileType: String(row.file_extension || "FILE").toUpperCase(),
    fileVersionId: Number(row.file_version_id),
    pageNumber: row.page_number === null ? null : Number(row.page_number),
    pointNumber:
      Number(row.target_metadata?.pointNumber ?? row.target_metadata?.point_number) || null,
    selection:
      row.pos_x === null || row.pos_y === null
        ? null
        : {
            ...anchorContext,
            kind: anchorKind,
            normalizedX: Number(row.pos_x),
            normalizedY: Number(row.pos_y),
            ...(row.page_number === null ? {} : { pageNumber: Number(row.page_number) }),
          },
  };
}

/**
 * Obtiene la condición SQL de acceso al proyecto para que el flujo llamador pueda continuar.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {unknown} [projectAlias] - Valor de `projectAlias` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
function getProjectAccessCondition(user, projectAlias = "p") {
  const roleCode = user?.role?.code;

  if (roleCode === "admin") {
    return {
      params: [],
      sql: "true",
    };
  }

  if (roleCode === "architect") {
    return {
      params: [user.id],
      sql: `(${projectAlias}.assigned_architect_id = $1 or exists (
        select 1 from public.project_assignees assignment
        where assignment.project_id = ${projectAlias}.id
          and assignment.user_id = $1
      ))`,
    };
  }

  if (roleCode === "client" && user.clientId) {
    return {
      params: [user.clientId],
      sql: `${projectAlias}.client_id = $1`,
    };
  }

  return {
    params: [],
    sql: "false",
  };
}

/**
 * Determina si se permite el valor de access proyecto comentarios según las reglas de acceso vigentes.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} projectId - Valor de `projectId` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @returns {Promise<boolean>} Resultado producido por la operación.
 */
export async function canAccessProjectComments(projectId, user) {
  const access = getProjectAccessCondition(user);
  const result = await query(
    `
      select p.id
      from public.projects p
      where p.id = $${access.params.length + 1}
        and p.deleted_at is null
        and (${access.sql})
      limit 1
    `,
    [...access.params, projectId],
  );

  return Boolean(result.rows[0]);
}

/**
 * Busca la foto del autor del comentario de proyecto y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} projectId - Valor de `projectId` requerido por esta operación.
 * @param {string} authorUserId - Valor de `authorUserId` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findProjectCommentAuthorProfilePhoto(
  projectId,
  authorUserId,
  user,
) {
  const access = getProjectAccessCondition(user);
  const projectIdParam = access.params.length + 1;
  const authorUserIdParam = access.params.length + 2;
  const statusParam = access.params.length + 3;
  const result = await query(
    `
      select u.profile_photo_url
      from public.projects p
      inner join public.users u
        on u.id = $${authorUserIdParam}
       and u.deleted_at is null
      where p.id = $${projectIdParam}
        and p.deleted_at is null
        and (${access.sql})
        and exists (
          select 1
          from public.project_comments pc
          where pc.project_id = p.id
            and pc.user_id = u.id
            and pc.deleted_at is null
            and pc.status = $${statusParam}::comment_status
        )
      limit 1
    `,
    [...access.params, projectId, authorUserId, ACTIVE_COMMENT_STATUS],
  );

  return result.rows[0]?.profile_photo_url || null;
}

/**
 * Lista los comentarios del proyecto respetando el alcance y la paginación solicitados.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} projectId - Valor de `projectId` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {object} [options] - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} [options.cursor] - Valor de `options.cursor` requerido por esta operación.
 * @param {number} [options.limit] - Valor de `options.limit` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function listProjectComments(projectId, user, { cursor = null, limit = 25 } = {}) {
  const access = getProjectAccessCondition(user);
  const result = await query(
    `
      select
        pc.id,
        pc.project_id,
        pc.user_id,
        pc.parent_comment_id,
        pc.comment_type,
        pc.content,
        pc.file_id,
        pc.file_version_id,
        fv.file_extension,
        pc.target_id,
        pc.target_metadata,
        pc.created_at,
        ca.page_number,
        ca.pos_x,
        ca.pos_y,
        ca.anchor_context_json,
        u.first_name,
        u.last_name,
        (u.profile_photo_url is not null) as has_profile_photo,
        r.code as role_code
      from public.project_comments pc
      inner join public.projects p
        on p.id = pc.project_id
      inner join public.users u
        on u.id = pc.user_id
      inner join public.roles r
        on r.id = u.role_id
      left join public.comment_anchors ca
        on ca.comment_id = coalesce(pc.parent_comment_id, pc.id)
       and ca.anchor_type = 'document'::anchor_type
      left join public.files f
        on f.id = pc.file_id
       and f.project_id = pc.project_id
      left join public.file_versions fv
        on fv.id = pc.file_version_id
       and fv.file_id = f.id
       and fv.deleted_at is null
      where pc.project_id = $${access.params.length + 1}
        and pc.deleted_at is null
        and pc.status = $${access.params.length + 2}::comment_status
        and p.deleted_at is null
        and (${access.sql})
        and ($${access.params.length + 3}::timestamptz is null or (pc.created_at, pc.id) > ($${access.params.length + 3}::timestamptz, $${access.params.length + 4}::bigint))
      order by pc.created_at asc, pc.id asc
      limit $${access.params.length + 5}
    `,
    [...access.params, projectId, ACTIVE_COMMENT_STATUS, cursor?.[0] || null, cursor?.[1] || null, limit + 1],
  );

  return pageResult(
    result.rows,
    limit,
    (row) => row.comment_type === "document" ? toDocumentComment(row) : toProjectComment(row),
    (row) => [row.created_at, String(row.id)],
  );
}

/**
 * Crea un comentario únicamente en proyectos accesibles y operativamente abiertos.
 * Bloquea la fila en PostgreSQL y excluye archivados y finished para evitar carreras de cierre.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} [options.commentType] - Valor de `options.commentType` requerido por esta operación.
 * @param {string} options.content - Valor de `options.content` requerido por esta operación.
 * @param {string} [options.parentCommentId] - Valor de `options.parentCommentId` requerido por esta operación.
 * @param {string} options.projectId - Valor de `options.projectId` requerido por esta operación.
 * @param {string} [options.targetId] - Valor de `options.targetId` requerido por esta operación.
 * @param {unknown} [options.targetMetadata] - Valor de `options.targetMetadata` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function createProjectCommentRecord({
  commentType = GENERAL_COMMENT_TYPE,
  content,
  parentCommentId = null,
  projectId,
  targetId = null,
  targetMetadata = null,
  user,
}) {
  const access = getProjectAccessCondition(user);
  const params = [
    ...access.params,
    projectId,
    user.id,
    parentCommentId,
    content,
    commentType,
    ACTIVE_COMMENT_STATUS,
    targetId,
    targetMetadata,
  ];
  const projectIdParam = access.params.length + 1;
  const userIdParam = access.params.length + 2;
  const parentIdParam = access.params.length + 3;
  const contentParam = access.params.length + 4;
  const typeParam = access.params.length + 5;
  const statusParam = access.params.length + 6;
  const targetIdParam = access.params.length + 7;
  const targetMetadataParam = access.params.length + 8;

  const result = await query(
    `
      with accessible_project as (
        select p.id
        from public.projects p
        where p.id = $${projectIdParam}
          and p.deleted_at is null
          and p.status not in (
            'archived'::public.project_status,
            '${PROJECT_STATUS.FINISHED}'::public.project_status
          )
          and (${access.sql})
        limit 1
        for update of p
      ),
      parent_comment as (
        select
          coalesce(parent_pc.id, pc.id) as id,
          coalesce(parent_pc.comment_type, pc.comment_type) as comment_type,
          coalesce(parent_pc.target_id, pc.target_id) as target_id,
          coalesce(parent_pc.target_metadata, pc.target_metadata) as target_metadata
        from public.project_comments pc
        left join public.project_comments parent_pc
          on parent_pc.id = pc.parent_comment_id
          and parent_pc.project_id = pc.project_id
          and parent_pc.deleted_at is null
          and parent_pc.status = $${statusParam}::comment_status
          and parent_pc.file_id is null
          and parent_pc.file_version_id is null
        where pc.id = $${parentIdParam}
          and pc.project_id = $${projectIdParam}
          and pc.deleted_at is null
          and pc.status = $${statusParam}::comment_status
          and pc.file_id is null
          and pc.file_version_id is null
      ),
      target_lock as materialized (
        select pg_advisory_xact_lock(
          hashtextextended(concat_ws(':', $${projectIdParam}::text, $${typeParam}::text, coalesce($${targetIdParam}::text, '')), 0)
        )
      ),
      target_point_number as (
        select count(*) + 1 as point_number
        from public.project_comments existing_pc
        where existing_pc.project_id = $${projectIdParam}
          and existing_pc.parent_comment_id is null
          and existing_pc.comment_type = $${typeParam}::comment_type
          and existing_pc.target_id is not distinct from $${targetIdParam}::text
          and existing_pc.deleted_at is null
          and existing_pc.status = $${statusParam}::comment_status
          and existing_pc.file_id is null
          and existing_pc.file_version_id is null
      ),
      inserted_comment as (
        insert into public.project_comments (
          project_id,
          user_id,
          parent_comment_id,
          comment_type,
          content,
          target_id,
          target_metadata,
          status
        )
        select
          ap.id,
          $${userIdParam},
          case
            when $${parentIdParam}::bigint is null then null
            else pc.id
          end,
          case
            when $${parentIdParam}::bigint is null then $${typeParam}::comment_type
            else pc.comment_type
          end,
          $${contentParam},
          case
            when $${parentIdParam}::bigint is null then $${targetIdParam}::text
            else pc.target_id
          end,
          case
            when $${parentIdParam}::bigint is null and $${typeParam}::comment_type = 'general'::comment_type then null
            when $${parentIdParam}::bigint is null and $${typeParam}::comment_type = 'panorama'::comment_type then jsonb_set(
              coalesce($${targetMetadataParam}::jsonb, '{}'::jsonb),
              '{pointNumber}',
              to_jsonb(tpn.point_number),
              true
            )
            when $${parentIdParam}::bigint is null then $${targetMetadataParam}::jsonb
            else pc.target_metadata
          end,
          $${statusParam}::comment_status
        from accessible_project ap
        left join parent_comment pc on true
        cross join target_lock
        cross join target_point_number tpn
        where $${parentIdParam}::bigint is null or pc.id is not null
        returning *
      )
      select
        ic.id,
        ic.project_id,
        ic.user_id,
        ic.parent_comment_id,
        ic.comment_type,
        ic.content,
        ic.target_id,
        ic.target_metadata,
        ic.created_at,
        u.first_name,
        u.last_name,
        (u.profile_photo_url is not null) as has_profile_photo,
        r.code as role_code
      from inserted_comment ic
      inner join public.users u
        on u.id = ic.user_id
      inner join public.roles r
        on r.id = u.role_id
    `,
    params,
  );

  return result.rows[0] ? toProjectComment(result.rows[0]) : null;
}

/**
 * Lista los comentarios de documento respetando el alcance y la paginación solicitados.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} [options.cursor] - Valor de `options.cursor` requerido por esta operación.
 * @param {string} options.fileId - Valor de `options.fileId` requerido por esta operación.
 * @param {string} options.fileVersionId - Valor de `options.fileVersionId` requerido por esta operación.
 * @param {number} [options.limit] - Valor de `options.limit` requerido por esta operación.
 * @param {string} options.projectId - Valor de `options.projectId` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function listDocumentComments({
  cursor = null,
  fileId,
  fileVersionId,
  limit = 25,
  projectId,
  user,
}) {
  const access = getProjectAccessCondition(user);
  const offset = access.params.length;
  const result = await query(
    `
      select pc.*, ca.page_number, ca.pos_x, ca.pos_y, ca.anchor_context_json,
        u.first_name, u.last_name,
        (u.profile_photo_url is not null) as has_profile_photo,
        r.code as role_code
      from public.project_comments pc
      inner join public.projects p on p.id = pc.project_id
      inner join public.users u on u.id = pc.user_id
      inner join public.roles r on r.id = u.role_id
      left join public.comment_anchors ca
        on ca.comment_id = coalesce(pc.parent_comment_id, pc.id)
       and ca.anchor_type = 'document'::anchor_type
      where pc.project_id = $${offset + 1}
        and pc.file_id = $${offset + 2}
        and pc.file_version_id = $${offset + 3}
        and pc.comment_type = 'document'::comment_type
        and pc.deleted_at is null
        and pc.status = $${offset + 4}::comment_status
        and p.deleted_at is null
        and (${access.sql})
        and ($${offset + 5}::timestamptz is null or (pc.created_at, pc.id) > ($${offset + 5}::timestamptz, $${offset + 6}::bigint))
      order by pc.created_at asc, pc.id asc
      limit $${offset + 7}
    `,
    [
      ...access.params,
      projectId,
      fileId,
      fileVersionId,
      ACTIVE_COMMENT_STATUS,
      cursor?.[0] || null,
      cursor?.[1] || null,
      limit + 1,
    ],
  );
  return pageResult(result.rows, limit, toDocumentComment, (row) => [row.created_at, String(row.id)]);
}

/**
 * Crea una observación documental conservando las referencias de archivo y versión autorizadas.
 * Excluye archivados y finished bajo bloqueo PostgreSQL para preservar el cierre operativo.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.content - Valor de `options.content` requerido por esta operación.
 * @param {string} options.fileId - Valor de `options.fileId` requerido por esta operación.
 * @param {string} options.fileVersionId - Valor de `options.fileVersionId` requerido por esta operación.
 * @param {string} [options.parentCommentId] - Valor de `options.parentCommentId` requerido por esta operación.
 * @param {string} options.projectId - Valor de `options.projectId` requerido por esta operación.
 * @param {unknown} options.selection - Valor de `options.selection` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function createDocumentCommentRecord({
  content,
  fileId,
  fileVersionId,
  parentCommentId = null,
  projectId,
  selection,
  user,
}) {
  const access = getProjectAccessCondition(user);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const params = [...access.params, projectId, fileId, fileVersionId];
    const offset = access.params.length;
    const target = await client.query(
      `
        select f.id as file_id, fv.id as file_version_id
        from public.projects p
        inner join public.files f
          on f.project_id = p.id and f.id = $${offset + 2}
         and f.deleted_at is null and f.status = 'active'::file_status
        inner join public.file_versions fv
          on fv.file_id = f.id and fv.id = $${offset + 3} and fv.deleted_at is null
        where p.id = $${offset + 1}
          and p.deleted_at is null
          and p.status not in (
            'archived'::public.project_status,
            '${PROJECT_STATUS.FINISHED}'::public.project_status
          )
          and (${access.sql})
        limit 1
        for update of p
      `,
      params,
    );
    if (!target.rows[0]) {
      await client.query("rollback");
      return null;
    }

    await client.query(
      "select pg_advisory_xact_lock(hashtextextended(concat_ws(':', $1::text, $2::text, $3::text, 'document'), 0))",
      [projectId, fileId, fileVersionId],
    );

    let root = null;
    if (parentCommentId) {
      const parent = await client.query(
        `select coalesce(parent.id, child.id) as id,
                coalesce(parent.target_metadata, child.target_metadata) as target_metadata
         from public.project_comments child
         left join public.project_comments parent
           on parent.id = child.parent_comment_id and parent.deleted_at is null
         where child.id = $1 and child.project_id = $2 and child.file_id = $3
           and child.file_version_id = $4 and child.comment_type = 'document'::comment_type
           and child.deleted_at is null and child.status = 'active'::comment_status
         limit 1`,
        [parentCommentId, projectId, fileId, fileVersionId],
      );
      root = parent.rows[0] || null;
      if (!root) {
        await client.query("rollback");
        return null;
      }
    }

    const pointNumber = root
      ? Number(root.target_metadata?.pointNumber)
      : Number((await client.query(
          `select coalesce(max((target_metadata->>'pointNumber')::integer), 0) + 1 as point_number from public.project_comments
           where project_id = $1 and file_id = $2 and file_version_id = $3
             and parent_comment_id is null and comment_type = 'document'::comment_type
             and deleted_at is null`,
          [projectId, fileId, fileVersionId],
        )).rows[0].point_number);
    const inserted = await client.query(
      `insert into public.project_comments (
         project_id, user_id, file_id, file_version_id, parent_comment_id,
         comment_type, content, target_id, target_metadata, status
       ) values ($1, $2, $3, $4, $5, 'document'::comment_type, $6, $7, $8::jsonb, 'active'::comment_status)
       returning *`,
      [
        projectId,
        user.id,
        fileId,
        fileVersionId,
        root?.id || null,
        content,
        String(fileId),
        JSON.stringify({ pointNumber }),
      ],
    );
    const row = inserted.rows[0];
    if (!root) {
      const anchorContext = selection.kind === "document-point"
        ? { kind: selection.kind, pageCount: selection.pageCount }
        : selection.kind === "document-section-point"
          ? { kind: selection.kind, sectionIndex: selection.sectionIndex, sectionCount: selection.sectionCount }
          : { kind: selection.kind, sheetName: selection.sheetName, cell: selection.cell };
      await client.query(
        `insert into public.comment_anchors
          (comment_id, anchor_type, pos_x, pos_y, page_number, anchor_context_json)
         values ($1, 'document'::anchor_type, $2, $3, $4, $5::jsonb)`,
        [row.id, selection.normalizedX, selection.normalizedY, selection.pageNumber || null, JSON.stringify(anchorContext)],
      );
    }
    const hydrated = await client.query(
       `select pc.*, ca.page_number, ca.pos_x, ca.pos_y, ca.anchor_context_json,
        u.first_name, u.last_name, (u.profile_photo_url is not null) as has_profile_photo,
        r.code as role_code
       from public.project_comments pc
       inner join public.users u on u.id = pc.user_id
       inner join public.roles r on r.id = u.role_id
       left join public.comment_anchors ca
         on ca.comment_id = coalesce(pc.parent_comment_id, pc.id)
        and ca.anchor_type = 'document'::anchor_type
       where pc.id = $1`,
      [row.id],
    );
    await client.query("commit");
    return toDocumentComment(hydrated.rows[0]);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
