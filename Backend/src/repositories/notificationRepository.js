import { query } from "../config/db.js";
import { preciseCursorTimestampSql } from "../utils/pagination.js";

// Notificaciones del usuario autenticado (tabla `notifications`, que ya escriben las solicitudes y la
// revisión de archivos). Toda consulta se limita a `user_id = usuario de la sesión`: nunca se leen ni
// modifican notificaciones ajenas. El proyecto del evento solo se devuelve si el usuario TODAVÍA
// puede acceder a él, con la misma regla que la subida de archivos (findProjectForFileUpload):
// administrador, cualquiera; arquitecto, asignado o responsable; cliente, los de su cliente; un
// draft solo para administración. Así un enlace nunca revela un proyecto ajeno.

const ACCESSIBLE_PROJECT_SQL = `
  p.id is not null and p.deleted_at is null and (
    $2::text = 'admin' or (
      not (p.status::text = 'draft' or (p.status::text = 'archived' and p.archived_from_status::text = 'draft'))
      and (
        ($2::text = 'architect' and (p.assigned_architect_id = $1::bigint or exists (
          select 1 from public.project_assignees assignment where assignment.project_id = p.id and assignment.user_id = $1::bigint
        )))
        or ($2::text = 'client' and $3::bigint is not null and p.client_id = $3::bigint)
      )
    )
  )`;

/**
 * Lista una página de notificaciones del usuario, de la más reciente a la más antigua, con cursor.
 *
 * @param {{ userId: number, roleCode: string, clientId: number|null, cursor: [string, string]|null, limit: number }} options -
 *   Usuario de la sesión, su rol y cliente, cursor y tamaño de página.
 * @returns {Promise<Array<object>>} Hasta `limit + 1` filas.
 */
export async function listUserNotifications({ clientId, cursor, limit, roleCode, userId }) {
  const result = await query(
    `select n.id, n.title, n.message, n.type, n.entity_type, n.entity_id, n.is_read, n.read_at, n.created_at,
       ${preciseCursorTimestampSql("n.created_at")} as cursor_value,
       case when ${ACCESSIBLE_PROJECT_SQL} then p.id end as project_id,
       case when ${ACCESSIBLE_PROJECT_SQL} then p.name end as project_name
     from public.notifications n
     left join public.projects p on p.id = n.project_id
     where n.user_id = $1::bigint and n.deleted_at is null
       and ($4::text is null or (n.created_at, n.id) < ($4::timestamptz, $5::bigint))
     order by n.created_at desc, n.id desc
     limit $6`,
    [userId, roleCode, clientId, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1],
  );
  return result.rows;
}

/**
 * Cuenta las notificaciones no leídas del usuario.
 *
 * @param {number} userId - Usuario de la sesión.
 * @returns {Promise<number>} No leídas.
 */
export async function countUnreadNotifications(userId) {
  const result = await query(
    "select count(*)::int as unread from public.notifications where user_id = $1 and deleted_at is null and not is_read",
    [userId],
  );
  return Number(result.rows[0].unread);
}

/**
 * Marca como leída una notificación del usuario. Es idempotente: conserva la primera fecha de
 * lectura. Una notificación de otro usuario o inexistente no se modifica (null).
 *
 * @param {{ notificationId: number, userId: number }} target - Notificación y usuario de la sesión.
 * @returns {Promise<{ id: string, is_read: boolean, read_at: Date }|null>} Estado o null.
 */
export async function markNotificationRead({ notificationId, userId }) {
  const result = await query(
    `update public.notifications set is_read = true, read_at = coalesce(read_at, now())
     where id = $1 and user_id = $2 and deleted_at is null
     returning id, is_read, read_at`,
    [notificationId, userId],
  );
  return result.rows[0] ?? null;
}
