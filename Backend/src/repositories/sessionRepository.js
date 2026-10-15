import { query } from "../config/db.js";

// Sesiones revocables (hallazgo B-3). Todas las funciones aceptan un ejecutor opcional con método
// `query` (por ejemplo, el cliente de una transacción) para revocar en la misma transacción que el
// cambio de seguridad que la provoca. Sin ejecutor usan el pool compartido.
const poolExecutor = { query };

// Motivos de revocación persistidos en `user_sessions.revoked_reason` (máximo 40 caracteres).
export const SESSION_REVOCATION_REASONS = Object.freeze({
  adminRevoked: "admin_revoked",
  logout: "logout",
  passwordChanged: "password_changed",
  passwordReset: "password_reset",
  revokedByUser: "revoked_by_user",
  securityProfileChanged: "security_profile_changed",
  userDisabled: "user_disabled",
});

/**
 * Crea una sesión para el usuario y devuelve su identificador, que viaja en el JWT como `sid`.
 * La caducidad se calcula con el reloj de PostgreSQL para que todas las instancias la evalúen igual.
 *
 * @param {object} options - Datos de la sesión.
 * @param {number|string} options.userId - Usuario autenticado.
 * @param {number} options.expiresInSeconds - Vigencia de la sesión, igual a la del JWT.
 * @param {{ query: Function }} [executor] - Pool o cliente de transacción.
 * @returns {Promise<{ id: string, expiresAt: Date }>} Sesión creada.
 */
export async function createSession({ userId, expiresInSeconds }, executor = poolExecutor) {
  const result = await executor.query(
    `
      insert into public.user_sessions (user_id, expires_at)
      values ($1, now() + ($2::integer * interval '1 second'))
      returning id, expires_at
    `,
    [userId, Math.max(1, Math.round(expiresInSeconds))],
  );
  return { expiresAt: result.rows[0].expires_at, id: result.rows[0].id };
}

/**
 * Revoca una sesión concreta si sigue activa; las demás sesiones del usuario no se ven afectadas.
 *
 * @param {object} options - Datos de la revocación.
 * @param {string} options.sessionId - Identificador de la sesión (`sid`).
 * @param {string} options.reason - Motivo breve (logout, rotated…).
 * @param {{ query: Function }} [executor] - Pool o cliente de transacción.
 * @returns {Promise<boolean>} true si la sesión estaba activa y quedó revocada.
 */
export async function revokeSession({ sessionId, reason }, executor = poolExecutor) {
  const result = await executor.query(
    `
      update public.user_sessions
      set revoked_at = now(), revoked_reason = $2
      where id = $1 and revoked_at is null
    `,
    [sessionId, reason],
  );
  return result.rowCount > 0;
}

/**
 * Revoca todas las sesiones activas de un usuario, opcionalmente salvo la sesión actual.
 * Es una única sentencia atómica: una sesión creada después no se ve afectada.
 *
 * @param {object} options - Datos de la revocación.
 * @param {number|string} options.userId - Usuario cuyas sesiones se revocan.
 * @param {string} options.reason - Motivo breve (password_changed, user_disabled…).
 * @param {string|null} [options.exceptSessionId] - Sesión que se conserva, o null para revocarlas todas.
 * @param {{ query: Function }} [executor] - Pool o cliente de transacción.
 * @returns {Promise<number>} Número de sesiones revocadas.
 */
export async function revokeUserSessions({ userId, reason, exceptSessionId = null }, executor = poolExecutor) {
  const result = await executor.query(
    `
      update public.user_sessions
      set revoked_at = now(), revoked_reason = $2
      where user_id = $1
        and revoked_at is null
        and ($3::uuid is null or id <> $3::uuid)
    `,
    [userId, reason, exceptSessionId],
  );
  return result.rowCount;
}

/**
 * Elimina por lotes sesiones caducadas desde hace más de un día (o revocadas desde hace más de un día).
 * Limita las filas por ejecución para no bloquear la tabla ni alargar la petición que la dispara.
 *
 * @param {object} [options] - Opciones de limpieza.
 * @param {number} [options.limit=500] - Máximo de filas a eliminar.
 * @returns {Promise<number>} Filas eliminadas.
 */
export async function deleteExpiredSessions({ limit = 500 } = {}) {
  const result = await query(
    `
      delete from public.user_sessions
      where id in (
        select id
        from public.user_sessions
        where expires_at < now() - interval '1 day'
           or revoked_at < now() - interval '1 day'
        order by expires_at
        limit $1
        for update skip locked
      )
    `,
    [limit],
  );
  return result.rowCount || 0;
}
