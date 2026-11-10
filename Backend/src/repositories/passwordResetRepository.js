import { query } from "../config/db.js";

const poolExecutor = { query };

/**
 * Invalida los enlaces de recuperación pendientes del usuario marcándolos como usados, igual que al
 * emitir uno nuevo. Se ejecuta en la transacción de cada cambio de seguridad de la cuenta (contraseña,
 * correo, rol o estado) para que un enlace emitido antes del cambio no pueda consumirse después.
 *
 * @param {object} options - Datos de la invalidación.
 * @param {number|string} options.userId - Usuario cuyos enlaces pendientes se invalidan.
 * @param {{ query: Function }} [executor] - Cliente transaccional; por defecto el pool compartido.
 * @returns {Promise<number>} Número de enlaces invalidados.
 */
export async function invalidatePasswordResetTokens({ userId }, executor = poolExecutor) {
  const result = await executor.query(
    `
      update public.password_recovery_tokens
      set used_at = now()
      where user_id = $1
        and used_at is null
    `,
    [userId],
  );
  return result.rowCount;
}

/**
 * Crea el valor de contraseña restablecimiento token con los datos validados recibidos.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} userId - Valor de `userId` requerido por esta operación.
 * @param {string} tokenHash - Valor de `tokenHash` requerido por esta operación.
 * @param {unknown} expiresAt - Valor de `expiresAt` requerido por esta operación.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function createPasswordResetToken(userId, tokenHash, expiresAt) {
  await query(
    `
      update public.password_recovery_tokens
      set used_at = now()
      where user_id = $1
        and used_at is null
    `,
    [userId],
  );

  await query(
    `
      insert into public.password_recovery_tokens (
        user_id,
        token_hash,
        expires_at,
        created_at
      ) values ($1, $2, $3, now())
    `,
    [userId, tokenHash, expiresAt],
  );
}

/**
 * Elimina el valor de contraseña restablecimiento tokens for usuario después de comprobar acceso y existencia.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} userId - Valor de `userId` requerido por esta operación.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function deletePasswordResetTokensForUser(userId) {
  await query(`delete from public.password_recovery_tokens where user_id = $1`, [userId]);
}

/**
 * Busca el valor de valid contraseña restablecimiento token y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} userId - Valor de `userId` requerido por esta operación.
 * @param {string} tokenHash - Valor de `tokenHash` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findValidPasswordResetToken(userId, tokenHash) {
  const result = await query(
    `
      select id, expires_at
      from public.password_recovery_tokens
      where user_id = $1
        and token_hash = $2
        and used_at is null
        and expires_at > now()
      limit 1
    `,
    [userId, tokenHash],
  );

  return result.rows[0] || null;
}

/**
 * Consume el valor de contraseña restablecimiento token de forma que no pueda volver a utilizarse.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} userId - Valor de `userId` requerido por esta operación.
 * @param {string} tokenHash - Valor de `tokenHash` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function consumePasswordResetToken(userId, tokenHash) {
  const result = await query(
    `
      update public.password_recovery_tokens
      set used_at = now()
      where id = (
        select id
        from public.password_recovery_tokens
        where user_id = $1
          and token_hash = $2
          and used_at is null
          and expires_at > now()
        limit 1
      )
      returning id
    `,
    [userId, tokenHash],
  );

  return result.rowCount > 0;
}
