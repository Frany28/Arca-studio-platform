import { query, withTransaction } from "../config/db.js";
import { insertAuditLog } from "./auditLogRepository.js";
import { invalidatePasswordResetTokens } from "./passwordResetRepository.js";

/*
 * Activación de cuentas pendientes (clientes creados desde una cotización). Reutiliza la tabla de
 * tokens de un solo uso de la recuperación de contraseña: el propósito lo fija el JWT firmado
 * (`account_activation`), cuyo hash es lo único que se guarda.
 */

/**
 * Lee una cuenta no eliminada con su estado y correo para decidir si puede recibir o usar un
 * enlace de activación.
 *
 * @param {number} userId - Usuario.
 * @returns {Promise<{ id: number, email: string|null, firstName: string, lastName: string, status: string }|null>} Cuenta o null.
 */
export async function findActivationAccount(userId) {
  const result = await query(
    `select id, email, first_name, last_name, status::text as status
     from public.users
     where id = $1 and deleted_at is null`,
    [userId],
  );
  const row = result.rows[0];
  return row
    ? { email: row.email, firstName: row.first_name, id: Number(row.id), lastName: row.last_name, status: row.status }
    : null;
}

/**
 * Comprueba sin consumirlo que el enlace siga vigente para una cuenta pendiente con ese correo.
 *
 * @param {{ email: string, tokenHash: string, userId: number }} options - Datos del token verificado.
 * @returns {Promise<boolean>} true si la cuenta y el enlace son válidos.
 */
export async function hasValidActivationToken({ email, tokenHash, userId }) {
  const result = await query(
    `select 1
     from public.users u
     join public.password_recovery_tokens t on t.user_id = u.id
     where u.id = $1 and u.deleted_at is null and u.status = 'pending'
       and lower(u.email) = lower($2)
       and t.token_hash = $3 and t.used_at is null and t.expires_at > now()
     limit 1`,
    [userId, email, tokenHash],
  );
  return result.rowCount > 0;
}

/**
 * Activa una cuenta pendiente en una transacción: bloquea la cuenta, exige que siga pendiente con
 * el mismo correo del enlace, consume el token, guarda la contraseña, pasa a `active`, invalida
 * los demás enlaces y registra la auditoría. Cualquier condición incumplida no cambia nada.
 *
 * @param {object} options - Datos de la activación.
 * @param {string} options.email - Correo incluido en el enlace firmado.
 * @param {string} options.passwordHash - Hash bcrypt de la contraseña elegida por el titular.
 * @param {string} options.tokenHash - SHA-256 del enlace.
 * @param {number} options.userId - Usuario del enlace.
 * @returns {Promise<boolean>} true si la cuenta quedó activa.
 */
export async function activatePendingAccount({ email, passwordHash, tokenHash, userId }) {
  return withTransaction(async (client) => {
    const account = await client.query(
      `select id from public.users
       where id = $1 and deleted_at is null and status = 'pending' and lower(email) = lower($2)
       for update`,
      [userId, email],
    );
    if (!account.rowCount) return false;

    const consumed = await client.query(
      `update public.password_recovery_tokens set used_at = now()
       where user_id = $1 and token_hash = $2 and used_at is null and expires_at > now()
       returning id`,
      [userId, tokenHash],
    );
    if (!consumed.rowCount) return false;

    await client.query(
      `update public.users
       set password_hash = $2, status = 'active'::public.user_status, updated_at = now()
       where id = $1`,
      [userId, passwordHash],
    );
    await invalidatePasswordResetTokens({ userId }, client);
    await insertAuditLog({
      action: "user.activate",
      description: "Cuenta pendiente activada por su titular mediante el enlace enviado a su correo.",
      entityId: userId,
      entityType: "user",
      newValues: { status: "active" },
      oldValues: { status: "pending" },
      userId,
    }, client);
    return true;
  });
}
