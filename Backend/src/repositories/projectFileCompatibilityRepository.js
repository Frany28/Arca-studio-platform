import { commentTargetFileIdSql } from "../utils/projectCommentAudienceSql.js";

// Compatibilidad de archivos heredados (Fase 1.2, B9): consultas de PostgreSQL. Todas reciben el
// cliente de la herramienta (nunca el pool de la API) para trabajar dentro de su transacción: el plan
// y la verificación en una instantánea READ ONLY y la aplicación archivo por archivo.

const FILE_ACTION = "project_file.compatibility_converted";

/**
 * Lee el estado de archivos de proyectos vigentes: por defecto todos los heredados; con `fileIds`,
 * exactamente esos (también ya convertidos), para comprobar un plan o verificarlo.
 *
 * @param {{ query: Function }} client - Cliente de la herramienta.
 * @param {{ fileIds?: number[]|null }} [options] - Archivos concretos.
 * @returns {Promise<object>} Filas de archivos, versiones, equipo, usuarios del cliente, comentarios, autorizaciones y vínculos.
 */
export async function loadFileStates(client, { fileIds = null } = {}) {
  const files = (await client.query(
    `select f.id, f.project_id, f.status::text as status, f.file_type, f.current_version, f.access_policy, f.folder_id,
       f.origin_project_request_id, p.status::text as project_status, p.archived_from_status::text as archived_from_status,
       p.is_public, p.client_id, p.assigned_architect_id,
       to_char(req.reviewed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as origin_reviewed_at
     from public.files f
     inner join public.projects p on p.id = f.project_id and p.deleted_at is null
     left join public.project_requests req on req.id = f.origin_project_request_id
     where f.project_id is not null and f.deleted_at is null and f.status <> 'deleted'
       and (case when $1::bigint[] is null then f.access_policy is null else f.id = any($1::bigint[]) end)
     order by f.id`,
    [fileIds],
  )).rows;
  const ids = files.map((row) => Number(row.id));
  const projectIds = [...new Set(files.map((row) => Number(row.project_id)))];
  const clientIds = [...new Set(files.map((row) => Number(row.client_id)))];
  if (!ids.length) return { assignees: [], clientUsers: [], comments: [], files, grants: [], links: [], versions: [] };
  const [versions, assignees, clientUsers, comments, grants, links] = await Promise.all([
    client.query(
      `select id, file_id, version_number, uploaded_by, review_status::text as review_status,
         to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
         deleted_at is not null as deleted, content_type, file_name, file_size, restored_from_version_id
       from public.file_versions where file_id = any($1::bigint[]) order by file_id, version_number`,
      [ids],
    ),
    client.query("select project_id, user_id from public.project_assignees where project_id = any($1::bigint[]) order by project_id, user_id", [projectIds]),
    client.query(
      `select u.id, u.client_id from public.users u inner join public.roles r on r.id = u.role_id
       where r.code = 'client' and u.deleted_at is null and u.client_id = any($1::bigint[]) order by u.id`,
      [clientIds],
    ),
    client.query(
      `select pc.id, pc.user_id, pc.parent_comment_id, pc.comment_type::text as comment_type, pc.file_id, pc.file_version_id,
         pc.target_id, (pc.target_metadata->>'pointNumber')::int as point_number, pc.deleted_at is not null as deleted,
         to_char(pc.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at, resolved.file_id as resolved_file_id
       from public.project_comments pc
       cross join lateral (select ${commentTargetFileIdSql("pc")} as file_id) resolved
       inner join public.files target_file on target_file.id = resolved.file_id and target_file.project_id = pc.project_id
       where resolved.file_id = any($1::bigint[])
       order by pc.id`,
      [ids],
    ),
    client.query(
      `select id, file_id, file_version_id, audience::text as audience, ended_at is not null as ended
       from public.project_file_audience_grants where file_id = any($1::bigint[]) order by id`,
      [ids],
    ),
    client.query(
      `select id, warranty_id, file_id, unlinked_at is not null as unlinked
       from public.project_warranty_documents where file_id = any($1::bigint[]) order by id`,
      [ids],
    ),
  ]);
  return {
    assignees: assignees.rows,
    clientUsers: clientUsers.rows,
    comments: comments.rows,
    files,
    grants: grants.rows,
    links: links.rows,
    versions: versions.rows,
  };
}

/**
 * Bloquea, en este orden, el proyecto (FOR SHARE) y el archivo (FOR UPDATE): el mismo orden que las
 * demás escrituras de archivos, comentarios y audiencias, para no formar ciclos de espera.
 *
 * @param {{ query: Function }} client - Cliente en transacción.
 * @param {{ projectId: number, fileId: number }} target - Proyecto y archivo.
 * @returns {Promise<boolean>} true si ambos existen.
 */
export async function lockFileForCompatibility(client, { fileId, projectId }) {
  const project = await client.query("select id from public.projects where id = $1 for share", [projectId]);
  if (!project.rowCount) return false;
  const file = await client.query("select id from public.files where id = $1 and project_id = $2 for update", [fileId, projectId]);
  return file.rowCount > 0;
}

/**
 * Indica si un plan ya convirtió un archivo (marca de auditoría de la conversión con su huella).
 *
 * @param {{ query: Function }} client - Cliente.
 * @param {{ fileId: number, planSha256: string }} marker - Archivo y huella del plan.
 * @returns {Promise<boolean>} true si ya se aplicó.
 */
export async function hasConversionMarker(client, { fileId, planSha256 }) {
  const result = await client.query(
    "select 1 from public.audit_logs where action = $1 and entity_type = 'file' and entity_id = $2 and new_values->>'planSha256' = $3 limit 1",
    [FILE_ACTION, fileId, planSha256],
  );
  return result.rowCount > 0;
}

/**
 * Pasa un archivo heredado a la política 1.2. Solo cambia `access_policy` y solo si sigue heredado.
 *
 * @param {{ query: Function }} client - Cliente en transacción.
 * @param {number} fileId - Archivo.
 * @returns {Promise<boolean>} true si cambió.
 */
export async function setPhaseOnePolicy(client, fileId) {
  const result = await client.query("update public.files set access_policy = 1 where id = $1 and access_policy is null", [fileId]);
  return result.rowCount === 1;
}

/**
 * Asigna archivo y versión a comentarios históricos sin versión. Solo toca los indicados que siguen
 * sin versión; devuelve cuántos cambió para comprobarlo contra el plan.
 *
 * @param {{ query: Function }} client - Cliente en transacción.
 * @param {{ fileId: number, updates: Array<{ commentId: number, fileVersionId: number }> }} input - Asignaciones.
 * @returns {Promise<number>} Comentarios actualizados.
 */
export async function assignCommentVersions(client, { fileId, updates }) {
  if (!updates.length) return 0;
  const result = await client.query(
    `update public.project_comments pc set file_id = $1, file_version_id = assignment.version_id
     from unnest($2::bigint[], $3::bigint[]) as assignment(comment_id, version_id)
     where pc.id = assignment.comment_id and pc.file_version_id is null`,
    [fileId, updates.map((update) => update.commentId), updates.map((update) => update.fileVersionId)],
  );
  return result.rowCount;
}

/**
 * Crea una autorización activa (cliente o escaparate) firmada por el operador. Es la misma fila que
 * crea la API de audiencias; se escribe aquí para que la herramienta no cargue el pool de la API.
 *
 * @param {{ query: Function }} client - Cliente en transacción.
 * @param {{ projectId: number, fileId: number, versionId: number, audience: "client_owner"|"showcase", grantedBy: number }} grant - Autorización.
 * @returns {Promise<number>} Id creado.
 */
export async function insertCompatibilityGrant(client, { audience, fileId, grantedBy, projectId, versionId }) {
  const result = await client.query(
    `insert into public.project_file_audience_grants (project_id, file_id, file_version_id, audience, granted_by, granted_at)
     values ($1, $2, $3, $4::public.project_file_audience, $5, clock_timestamp()) returning id`,
    [projectId, fileId, versionId, audience, grantedBy],
  );
  return Number(result.rows[0].id);
}

/**
 * Registra la marca de auditoría de la conversión, en la misma transacción. Su huella del plan es
 * la marca de idempotencia: una repetición con el mismo plan la encuentra y no vuelve a aplicar.
 *
 * @param {{ query: Function }} client - Cliente en transacción.
 * @param {{ fileId: number, userId: number, newValues: object }} entry - Datos de la conversión.
 * @returns {Promise<void>}
 */
export async function insertConversionAudit(client, { fileId, newValues, userId }) {
  await client.query(
    `insert into public.audit_logs (user_id, action, entity_type, entity_id, description, new_values, old_values, user_agent)
     values ($1, $2, 'file', $3, 'Archivo heredado convertido a la política de archivos de la Fase 1.2.', $4::jsonb, $5::jsonb, 'maintenance:project-file-compatibility')`,
    [userId, FILE_ACTION, fileId, JSON.stringify(newValues), JSON.stringify({ accessPolicy: null })],
  );
}

/**
 * Comprueba que el operador sea un administrador activo.
 *
 * @param {{ query: Function }} client - Cliente.
 * @param {number} userId - Operador.
 * @returns {Promise<boolean>} true si puede firmar la conversión.
 */
export async function isActiveAdmin(client, userId) {
  const result = await client.query(
    `select 1 from public.users u inner join public.roles r on r.id = u.role_id
     where u.id = $1 and r.code = 'admin' and u.deleted_at is null and u.status = 'active'`,
    [userId],
  );
  return result.rowCount > 0;
}

export const COMPATIBILITY_AUDIT_ACTION = FILE_ACTION;
