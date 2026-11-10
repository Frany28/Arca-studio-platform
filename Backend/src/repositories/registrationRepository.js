import { pool, query, withTransaction } from "../config/db.js";

/**
 * Busca el valor de registro usuario conflict y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.email - Valor de `options.email` requerido por esta operación.
 * @param {unknown} options.phone - Valor de `options.phone` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findRegistrationUserConflict({ email, phone }) {
  const result = await query(
    `
      select
        exists(select 1 from public.users where deleted_at is null and lower(email) = lower($1)) as email_exists,
        exists(select 1 from public.users where deleted_at is null and phone = $2) as phone_exists
    `,
    [email, phone],
  );
  return result.rows[0] || { email_exists: false, phone_exists: false };
}

/**
 * Busca el valor de pending registro by correo y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} email - Valor de `email` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findPendingRegistrationByEmail(email) {
  const result = await query(
    `select id, email from public.user_registrations where lower(email) = lower($1) limit 1`,
    [email],
  );
  return result.rows[0] || null;
}

/**
 * Crea o renueva el registro pendiente de un correo y, en la misma transacción, libera el teléfono si lo
 * retiene un pendiente vencido y no completado de OTRO correo (el índice único no distingue vencidos y
 * permitía bloquear un número ajeno indefinidamente). Los registros completados se conservan.
 *
 * @param {object} payload - Datos validados del registro (nombre, correo, teléfono, token y vencimiento).
 * @returns {Promise<{ id: number|string, email: string, expires_at: Date }>} Registro pendiente vigente.
 * @throws {Error} Cuando PostgreSQL falla o el teléfono pertenece a un registro pendiente vigente.
 */
export async function upsertPendingRegistration(payload) {
  return withTransaction(async (client) => {
    await client.query(
      `
        delete from public.user_registrations
        where phone = $1
          and lower(email) <> lower($2)
          and used_at is null
          and expires_at <= now()
      `,
      [payload.phone, payload.email],
    );
    return insertPendingRegistration(client, payload);
  });
}

/**
 * Inserta o actualiza (por correo) el registro pendiente dentro de la transacción indicada.
 * Un correo ya pendiente renueva sus datos, su token y su vencimiento.
 *
 * @param {{ query: Function }} client - Cliente transaccional.
 * @param {object} payload - Datos validados del registro.
 * @returns {Promise<{ id: number|string, email: string, expires_at: Date }>} Registro pendiente vigente.
 */
async function insertPendingRegistration(client, payload) {
  const result = await client.query(
    `
      insert into public.user_registrations (
        first_name, last_name, email, phone, company_name, referral_source,
        token_hash, expires_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict ((lower(email))) do update set
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        phone = excluded.phone,
        company_name = excluded.company_name,
        referral_source = excluded.referral_source,
        token_hash = excluded.token_hash,
        expires_at = excluded.expires_at,
        used_at = null,
        updated_at = now()
      returning id, email, expires_at
    `,
    [
      payload.firstName,
      payload.lastName,
      payload.email,
      payload.phone,
      payload.company || null,
      payload.referralSource,
      payload.tokenHash,
      payload.expiresAt,
    ],
  );
  return result.rows[0];
}

/**
 * Procesa el valor de refresh pending registro para completar la responsabilidad asignada al módulo.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.email - Valor de `options.email` requerido por esta operación.
 * @param {string} options.tokenHash - Valor de `options.tokenHash` requerido por esta operación.
 * @param {unknown} options.expiresAt - Valor de `options.expiresAt` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function refreshPendingRegistration({ email, tokenHash, expiresAt }) {
  const result = await query(
    `
      update public.user_registrations
      set token_hash = $2, expires_at = $3, used_at = null, updated_at = now()
      where lower(email) = lower($1)
      returning id, email, expires_at
    `,
    [email, tokenHash, expiresAt],
  );
  return result.rows[0] || null;
}

/**
 * Busca el valor de valid pending registro y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.email - Valor de `options.email` requerido por esta operación.
 * @param {string} options.tokenHash - Valor de `options.tokenHash` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findValidPendingRegistration({ email, tokenHash }) {
  const result = await query(
    `
      select id, email
      from public.user_registrations
      where lower(email) = lower($1)
        and token_hash = $2
        and used_at is null
        and expires_at > now()
      limit 1
    `,
    [email, tokenHash],
  );
  return result.rows[0] || null;
}

/**
 * Procesa el valor de complete pending registro para completar la responsabilidad asignada al módulo.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.email - Valor de `options.email` requerido por esta operación.
 * @param {string} options.tokenHash - Valor de `options.tokenHash` requerido por esta operación.
 * @param {string} options.passwordHash - Valor de `options.passwordHash` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function completePendingRegistration({ email, tokenHash, passwordHash }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const pendingResult = await client.query(
      `
        select * from public.user_registrations
        where lower(email) = lower($1)
          and token_hash = $2
          and used_at is null
          and expires_at > now()
        for update
      `,
      [email, tokenHash],
    );
    const pending = pendingResult.rows[0];
    if (!pending) {
      await client.query("rollback");
      return null;
    }

    const conflictResult = await client.query(
      `select email, phone from public.users where deleted_at is null and (lower(email) = lower($1) or phone = $2) limit 1`,
      [pending.email, pending.phone],
    );
    if (conflictResult.rows[0]) {
      const error = new Error("Registration identity already exists");
      error.code = conflictResult.rows[0].email?.toLowerCase() === pending.email.toLowerCase()
        ? "EMAIL_ALREADY_EXISTS"
        : "PHONE_ALREADY_EXISTS";
      throw error;
    }

    const roleResult = await client.query(
      `select id from public.roles where code = 'client' and is_active = true limit 1`,
    );
    if (!roleResult.rows[0]) throw Object.assign(new Error("Client role is not configured"), { code: "CLIENT_ROLE_NOT_CONFIGURED" });

    const clientResult = await client.query(
      `
        insert into public.clients (name, company_name, email, phone, referral_source)
        values ($1, $2, $3, $4, $5)
        returning id
      `,
      [
        `${pending.first_name} ${pending.last_name}`,
        pending.company_name,
        pending.email,
        pending.phone,
        pending.referral_source,
      ],
    );
    const userResult = await client.query(
      `
        insert into public.users (client_id, role_id, email, first_name, last_name, password_hash, phone)
        values ($1, $2, $3, $4, $5, $6, $7)
        returning id
      `,
      [
        clientResult.rows[0].id,
        roleResult.rows[0].id,
        pending.email,
        pending.first_name,
        pending.last_name,
        passwordHash,
        pending.phone,
      ],
    );
    await client.query(`update public.user_registrations set used_at = now(), updated_at = now() where id = $1`, [pending.id]);
    await client.query("commit");
    return { userId: Number(userResult.rows[0].id) };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
