import { pool, query } from "../config/db.js";
import { createSession, revokeUserSessions } from "./sessionRepository.js";

const USER_SELECT = `
  select
    u.id,
    u.client_id,
    u.role_id,
    u.email,
    u.first_name,
    u.last_name,
    u.password_hash,
    u.profile_photo_url,
    u.phone,
    u.status,
    u.last_login_at,
    u.updated_at,
    r.code as role_code,
    r.name as role_name,
    coalesce(role_permissions.permissions, '[]'::json) as permissions
  from public.users u
  inner join public.roles r on r.id = u.role_id
  left join lateral (
    select json_agg(
      json_build_object(
        'id', p.id,
        'code', p.code,
        'name', p.name,
        'description', p.description,
        'module', p.module
      )
      order by p.module, p.code
    ) as permissions
    from public.role_permissions rp
    inner join public.permissions p on p.id = rp.permission_id
    where rp.role_id = u.role_id
      and rp.is_active = true
      and p.is_active = true
  ) role_permissions on true
  where u.deleted_at is null
    and r.is_active = true
`;

/**
 * Normaliza los permisos del sistema para mantener un formato interno consistente.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {Array<unknown>} Resultado producido por la operación.
 */
function normalizePermissions(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Transforma el valor de safe usuario a la representación pública esperada.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} row - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
function toSafeUser(row) {
  if (!row) {
    return null;
  }

  const permissions = normalizePermissions(row.permissions).map((permission) => ({
    code: permission.code,
    description: permission.description || null,
    id: Number(permission.id),
    module: permission.module,
    name: permission.name,
  }));

  return {
    clientId: row.client_id ? Number(row.client_id) : null,
    email: row.email,
    firstName: row.first_name,
    id: Number(row.id),
    lastLoginAt: row.last_login_at,
    lastName: row.last_name,
    name: `${row.first_name} ${row.last_name}`.trim(),
    phone: row.phone,
    profilePhotoUrl: row.profile_photo_url,
    role: {
      code: row.role_code,
      id: Number(row.role_id),
      name: row.role_name,
    },
    permissions,
    permissionCodes: permissions.map((permission) => permission.code),
    status: row.status,
    updatedAt: row.updated_at || null,
  };
}

/**
 * Busca el valor de usuario by correo y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} email - Valor de `email` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findUserByEmail(email) {
  const result = await query(
    `
      ${USER_SELECT}
        and lower(u.email) = lower($1)
      limit 1
    `,
    [email],
  );

  return result.rows[0] || null;
}

/**
 * Busca el valor de active usuario by id y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} id - Valor de `id` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findActiveUserById(id) {
  const result = await query(
    `
      ${USER_SELECT}
        and u.id = $1
        and u.status = 'active'
      limit 1
    `,
    [id],
  );

  return toSafeUser(result.rows[0]);
}

/**
 * Busca el usuario activo de una sesión vigente en una sola consulta indexada (hallazgo B-3).
 * Devuelve null si la sesión no existe, pertenece a otro usuario, fue revocada o caducó, o si la
 * cuenta o su rol dejaron de estar activos; así cada instancia ve la revocación de inmediato.
 *
 * @param {object} options - Identificadores tomados del JWT ya verificado.
 * @param {string} options.sessionId - Identificador de la sesión (`sid`).
 * @param {string|number} options.userId - Usuario del token (`sub`).
 * @returns {Promise<object|null>} Usuario seguro con permisos, o null.
 */
export async function findActiveSessionUser({ sessionId, userId }) {
  const result = await query(
    `
      ${USER_SELECT}
        and u.id = $1
        and u.status = 'active'
        and exists (
          select 1
          from public.user_sessions s
          where s.id = $2::uuid
            and s.user_id = u.id
            and s.revoked_at is null
            and s.expires_at > now()
        )
      limit 1
    `,
    [userId, sessionId],
  );

  return toSafeUser(result.rows[0]);
}

/**
 * Busca el valor de active usuario credentials by id y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} id - Valor de `id` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findActiveUserCredentialsById(id) {
  const result = await query(
    `
      select id, password_hash
      from public.users
      where id = $1
        and status = 'active'
        and deleted_at is null
      limit 1
    `,
    [id],
  );

  return result.rows[0] || null;
}

/**
 * Actualiza el valor de last login at conservando las reglas de acceso e integridad.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} id - Valor de `id` requerido por esta operación.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function updateLastLoginAt(id) {
  await query(
    `
      update public.users
      set last_login_at = now()
      where id = $1
    `,
    [id],
  );
}

/**
 * Sustituye la contraseña y revoca todas las sesiones del usuario en una única transacción (B-3).
 * Opcionalmente crea en la misma transacción la sesión que conservará quien hizo el cambio, de modo
 * que nunca queda una contraseña nueva con sesiones antiguas activas ni un usuario sin sesión válida.
 *
 * @param {object} options - Datos del cambio.
 * @param {number|string} options.userId - Usuario cuya contraseña cambia.
 * @param {string} options.passwordHash - Hash bcrypt de la nueva contraseña.
 * @param {string} options.revocationReason - Motivo registrado en las sesiones revocadas.
 * @param {number|null} [options.newSessionExpiresInSeconds] - Vigencia de la sesión nueva, o null para no crearla.
 * @returns {Promise<{ updated: boolean, newSessionId: string|null }>} Resultado del cambio.
 * @throws {Error} Cuando PostgreSQL falla; la transacción se revierte por completo.
 */
export async function updateUserPasswordRevokingSessions({
  newSessionExpiresInSeconds = null,
  passwordHash,
  revocationReason,
  userId,
}) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const updated = await client.query(
      `
        update public.users
        set password_hash = $2, updated_at = now()
        where id = $1
      `,
      [userId, passwordHash],
    );

    if (updated.rowCount === 0) {
      await client.query("rollback");
      return { newSessionId: null, updated: false };
    }

    await revokeUserSessions({ reason: revocationReason, userId }, client);
    const newSession = newSessionExpiresInSeconds
      ? await createSession({ expiresInSeconds: newSessionExpiresInSeconds, userId }, client)
      : null;
    await client.query("commit");

    return { newSessionId: newSession?.id || null, updated: true };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Actualiza el valor de usuario perfil foto URL conservando las reglas de acceso e integridad.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} id - Valor de `id` requerido por esta operación.
 * @param {string} profilePhotoUrl - Valor de `profilePhotoUrl` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function updateUserProfilePhotoUrl(id, profilePhotoUrl) {
  await query(
    `
      update public.users
      set profile_photo_url = $2, updated_at = now()
      where id = $1
        and status = 'active'
        and deleted_at is null
    `,
    [id, profilePhotoUrl],
  );

  return findActiveUserById(id);
}

/**
 * Sanea el usuario antes de exponerlo fuera del backend.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} row - Fila obtenida desde PostgreSQL.
 * @returns {unknown} Resultado producido por la operación.
 */
export function sanitizeUser(row) {
  return toSafeUser(row);
}

/**
 * Transforma el valor de público usuario a la representación pública esperada.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @returns {object} Resultado producido por la operación.
 */
export function toPublicUser(user) {
  if (!user) return null;

  const { profilePhotoUrl, ...publicUser } = user;
  return {
    ...publicUser,
    hasProfilePhoto: Boolean(profilePhotoUrl),
  };
}
