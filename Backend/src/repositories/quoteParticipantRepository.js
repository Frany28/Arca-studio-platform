import { query } from "../config/db.js";
import { toContainsPattern } from "../utils/sqlPatterns.js";

/*
 * Clientes y proyectos que pueden asociarse a una cotización. Solo lectura y bloqueos de
 * validación: este módulo no modifica clientes ni proyectos.
 */

/**
 * Transforma una fila de cliente en la opción pública del selector. El usuario de contacto (el
 * primer usuario activo vinculado al cliente) solo aporta su foto para el avatar.
 *
 * @param {object} row - Fila de clients con el usuario de contacto.
 * @returns {object} Cliente seleccionable.
 */
function toClientOption(row) {
  return {
    companyName: row.company_name,
    contactUser: row.contact_user_id === null
      ? null
      : { hasProfilePhoto: row.contact_has_profile_photo, id: Number(row.contact_user_id) },
    email: row.email,
    id: Number(row.id),
    name: row.name,
  };
}

/**
 * Lista clientes activos y no eliminados en orden alfabético estable (nombre, id) con cursor.
 * Busca en nombre, empresa y correo. Pide un elemento adicional para detectar otra página.
 *
 * @param {object} options - Búsqueda y paginación validadas.
 * @param {string} [options.search] - Texto a buscar.
 * @param {Array<string>|null} options.cursor - [nombre, id] del último cliente visto.
 * @param {number} options.limit - Tamaño de página.
 * @returns {Promise<Array<object>>} Hasta limit + 1 clientes.
 */
export async function listQuoteClientOptions({ cursor, limit, search }) {
  const result = await query(
    `select c.id, c.name, c.company_name, c.email,
       contact.id as contact_user_id, contact.has_profile_photo as contact_has_profile_photo
     from public.clients c
     left join lateral (
       select u.id, (u.profile_photo_url is not null and btrim(u.profile_photo_url) <> '') as has_profile_photo
       from public.users u
       where u.client_id = c.id and u.deleted_at is null and u.status = 'active'
       order by u.id
       limit 1
     ) contact on true
     where c.deleted_at is null and c.status = 'active'
       and ($1::text is null or c.name ilike $1 escape '\\' or c.company_name ilike $1 escape '\\' or c.email ilike $1 escape '\\')
       and ($2::text is null or (c.name, c.id) > ($2::text, $3::bigint))
     order by c.name, c.id
     limit $4`,
    [search ? toContainsPattern(search) : null, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1],
  );
  return result.rows.map(toClientOption);
}

/**
 * Busca un cliente por id con su estado, incluidos los inactivos y eliminados, para que el
 * servicio distinga «no existe» de «no está disponible».
 *
 * @param {number} clientId - Identificador del cliente.
 * @param {{ query: Function }} [executor] - Cliente de una transacción; por defecto el pool.
 * @param {boolean} [lockForShare=false] - Bloquea la fila con FOR SHARE hasta el COMMIT.
 * @returns {Promise<{ id: number, name: string, isAvailable: boolean }|null>} Cliente o null.
 */
export async function findQuoteClient(clientId, executor = { query }, lockForShare = false) {
  const result = await executor.query(
    `select id, name, (deleted_at is null and status = 'active') as is_available
     from public.clients where id = $1 ${lockForShare ? "for share" : ""}`,
    [clientId],
  );
  const row = result.rows[0];
  return row ? { id: Number(row.id), isAvailable: row.is_available, name: row.name } : null;
}

/**
 * Lista los proyectos no eliminados de un cliente en orden alfabético estable con cursor.
 *
 * @param {object} options - Cliente, búsqueda y paginación validadas.
 * @param {number} options.clientId - Cliente propietario.
 * @param {string} [options.search] - Texto a buscar en el nombre.
 * @param {Array<string>|null} options.cursor - [nombre, id] del último proyecto visto.
 * @param {number} options.limit - Tamaño de página.
 * @returns {Promise<Array<{ id: number, name: string, status: string }>>} Hasta limit + 1 proyectos.
 */
export async function listClientProjectOptions({ clientId, cursor, limit, search }) {
  const result = await query(
    `select p.id, p.name, p.status
     from public.projects p
     where p.client_id = $1 and p.deleted_at is null
       and ($2::text is null or p.name ilike $2 escape '\\')
       and ($3::text is null or (p.name, p.id) > ($3::text, $4::bigint))
     order by p.name, p.id
     limit $5`,
    [clientId, search ? toContainsPattern(search) : null, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1],
  );
  return result.rows.map((row) => ({ id: Number(row.id), name: row.name, status: row.status }));
}

/**
 * Bloquea con FOR SHARE el proyecto elegido y devuelve su propietario y disponibilidad, para
 * comprobar en la transacción que pertenece al cliente y que nadie lo elimina mientras se cotiza.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} projectId - Proyecto.
 * @returns {Promise<{ id: number, name: string, clientId: number, isAvailable: boolean }|null>} Proyecto o null.
 */
export async function lockQuoteProject(client, projectId) {
  const result = await client.query(
    "select id, name, client_id, (deleted_at is null) as is_available from public.projects where id = $1 for share",
    [projectId],
  );
  const row = result.rows[0];
  return row ? { clientId: Number(row.client_id), id: Number(row.id), isAvailable: row.is_available, name: row.name } : null;
}
