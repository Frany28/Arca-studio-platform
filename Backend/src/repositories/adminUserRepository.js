import { pool, query } from "../config/db.js";
import { mapAdminUserMetrics } from "../utils/adminUsers.js";
import { SESSION_REVOCATION_REASONS, revokeUserSessions } from "./sessionRepository.js";

/**
 * Decide si una edición administrativa cambia la seguridad de la cuenta y con qué motivo deben
 * revocarse sus sesiones (B-3). Cambiar nombre, teléfonos o empresa no cierra sesiones; sí lo hacen
 * una contraseña nueva, otro rol, otro correo o cualquier cambio de estado.
 *
 * @param {object} options - Estado anterior y nuevo de la cuenta.
 * @param {{ email: string, role_id: number|string, status: string }} options.current - Fila previa bloqueada.
 * @param {string} options.email - Correo nuevo.
 * @param {string|null} options.passwordHash - Hash de la contraseña nueva, o null si no cambia.
 * @param {number|string} options.roleId - Rol nuevo.
 * @param {string} options.status - Estado nuevo.
 * @returns {string|null} Motivo de revocación, o null si no hay cambio de seguridad.
 */
export function resolveAdminEditRevocationReason({ current, email, passwordHash, roleId, status }) {
  if (status !== "active") return SESSION_REVOCATION_REASONS.userDisabled;
  if (passwordHash) return SESSION_REVOCATION_REASONS.passwordChanged;
  if (
    String(current.role_id) !== String(roleId)
    || String(current.email).toLowerCase() !== String(email).toLowerCase()
    || current.status !== status
  ) {
    return SESSION_REVOCATION_REASONS.securityProfileChanged;
  }
  return null;
}

/**
 * Busca el valor de administrativo usuario conflict y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.email - Valor de `options.email` requerido por esta operación.
 * @param {string} [options.excludeUserId] - Valor de `options.excludeUserId` requerido por esta operación.
 * @param {unknown} options.phone - Valor de `options.phone` requerido por esta operación.
 * @param {unknown} options.secondaryPhone - Valor de `options.secondaryPhone` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findAdminUserConflict({ email, excludeUserId = null, phone, secondaryPhone }) {
  const phones = [phone, secondaryPhone].filter(Boolean);
  const result = await query(
    `
      select
        exists(
          select 1 from public.users
          where deleted_at is null
            and lower(email) = lower($1)
            and ($3::bigint is null or id <> $3)
        ) as email_exists,
        exists(
          select 1 from public.users
          where deleted_at is null
            and ($3::bigint is null or id <> $3)
            and $2::text[] <> '{}'::text[]
            and (phone = any($2::text[]) or secondary_phone = any($2::text[]))
        ) as phone_exists
    `,
    [email, phones, excludeUserId],
  );
  return result.rows[0] || { email_exists: false, phone_exists: false };
}

/**
 * Busca el valor de administrativo usuario access registro y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} userId - Valor de `userId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findAdminUserAccessRecord(userId) {
  const result = await query(
    `
      select u.status, r.code as role_code
      from public.users u
      inner join public.roles r on r.id = u.role_id
      where u.id = $1 and u.deleted_at is null
      limit 1
    `,
    [userId],
  );
  return result.rows[0] || null;
}

/**
 * Actualiza el valor de administrativo usuario registro conservando las reglas de acceso e integridad.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.companyName - Valor de `options.companyName` requerido por esta operación.
 * @param {string} options.email - Valor de `options.email` requerido por esta operación.
 * @param {string} options.firstName - Valor de `options.firstName` requerido por esta operación.
 * @param {string} options.lastName - Valor de `options.lastName` requerido por esta operación.
 * @param {string} options.passwordHash - Valor de `options.passwordHash` requerido por esta operación.
 * @param {unknown} options.phone - Valor de `options.phone` requerido por esta operación.
 * @param {string} options.roleCode - Valor de `options.roleCode` requerido por esta operación.
 * @param {unknown} options.secondaryPhone - Valor de `options.secondaryPhone` requerido por esta operación.
 * @param {unknown} options.status - Valor de `options.status` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {Promise<object>} Usuario actualizado y `revokedSessions`: las sesiones se revocan en la misma
 *   transacción cuando cambian contraseña, rol, correo o estado (B-3).
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function updateAdminUserRecord({
  companyName,
  email,
  firstName,
  lastName,
  passwordHash,
  phone,
  roleCode,
  secondaryPhone,
  status,
  userId,
}) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const currentResult = await client.query(
      `select client_id, role_id, email, status from public.users where id = $1 and deleted_at is null for update`,
      [userId],
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("rollback");
      return { reason: "user", user: null };
    }

    const roleResult = await client.query(
      `select id, code, name from public.roles where code = $1 and is_active = true limit 1`,
      [roleCode],
    );
    const role = roleResult.rows[0];
    if (!role) {
      await client.query("rollback");
      return { reason: "role", user: null };
    }

    let clientId = role.code === "client" ? current.client_id : null;
    if (role.code === "client" && clientId) {
      const clientResult = await client.query(
        `
          update public.clients
          set name = $2, company_name = $3, email = $4, phone = $5,
            status = $6::public.client_status, updated_at = now()
          where id = $1 and deleted_at is null
          returning id
        `,
        [clientId, `${firstName} ${lastName}`, companyName, email, phone, status === "active" ? "active" : "inactive"],
      );
      clientId = clientResult.rows[0]?.id || null;
    }
    if (role.code === "client" && !clientId) {
      const clientResult = await client.query(
        `
          insert into public.clients (name, company_name, email, phone, status)
          values ($1, $2, $3, $4, $5::public.client_status)
          returning id
        `,
        [`${firstName} ${lastName}`, companyName, email, phone, status === "active" ? "active" : "inactive"],
      );
      clientId = clientResult.rows[0].id;
    }

    const userResult = await client.query(
      `
        update public.users u
        set client_id = $2, role_id = $3, email = $4, first_name = $5,
          last_name = $6, phone = $7, secondary_phone = $8,
          company_name = $9, status = $10::public.user_status,
          password_hash = coalesce($11, u.password_hash), updated_at = now()
        where u.id = $1 and u.deleted_at is null
        returning u.id, u.email, u.first_name, u.last_name, u.status,
          (u.profile_photo_url is not null and btrim(u.profile_photo_url) <> '') as has_profile_photo,
          u.last_login_at, u.created_at
      `,
      [userId, clientId, role.id, email, firstName, lastName, phone, secondaryPhone, companyName, status, passwordHash],
    );
    const revocationReason = resolveAdminEditRevocationReason({
      current,
      email,
      passwordHash,
      roleId: role.id,
      status,
    });
    const revokedSessions = revocationReason
      ? await revokeUserSessions({ reason: revocationReason, userId }, client)
      : 0;
    await client.query("commit");
    return {
      reason: null,
      revokedSessions,
      user: { ...userResult.rows[0], role_code: role.code, role_name: role.name },
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Crea el valor de administrativo usuario registro con los datos validados recibidos.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.companyName - Valor de `options.companyName` requerido por esta operación.
 * @param {string} options.email - Valor de `options.email` requerido por esta operación.
 * @param {string} options.firstName - Valor de `options.firstName` requerido por esta operación.
 * @param {string} options.lastName - Valor de `options.lastName` requerido por esta operación.
 * @param {string} options.passwordHash - Valor de `options.passwordHash` requerido por esta operación.
 * @param {unknown} options.phone - Valor de `options.phone` requerido por esta operación.
 * @param {string} options.roleCode - Valor de `options.roleCode` requerido por esta operación.
 * @param {unknown} options.secondaryPhone - Valor de `options.secondaryPhone` requerido por esta operación.
 * @param {unknown} options.status - Valor de `options.status` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function createAdminUserRecord({
  companyName,
  email,
  firstName,
  lastName,
  passwordHash,
  phone,
  roleCode,
  secondaryPhone,
  status,
}) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const roleResult = await client.query(
      `select id, code, name from public.roles where code = $1 and is_active = true limit 1`,
      [roleCode],
    );
    const role = roleResult.rows[0];
    if (!role) {
      await client.query("rollback");
      return null;
    }

    let clientId = null;
    if (role.code === "client") {
      const clientResult = await client.query(
        `
          insert into public.clients (name, company_name, email, phone, status)
          values ($1, $2, $3, $4, $5::public.client_status)
          returning id
        `,
        [
          `${firstName} ${lastName}`,
          companyName,
          email,
          phone,
          status === "active" ? "active" : "inactive",
        ],
      );
      clientId = clientResult.rows[0].id;
    }

    const userResult = await client.query(
      `
        insert into public.users (
          client_id, role_id, email, first_name, last_name, password_hash,
          phone, secondary_phone, company_name, status
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning id, email, first_name, last_name, phone, secondary_phone,
          company_name, status, created_at
      `,
      [clientId, role.id, email, firstName, lastName, passwordHash, phone, secondaryPhone, companyName, status],
    );
    await client.query("commit");
    return { ...userResult.rows[0], client_id: clientId, role_code: role.code, role_name: role.name };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Elimina el valor de created administrativo usuario después de comprobar acceso y existencia.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @param {string} options.clientId - Valor de `options.clientId` requerido por esta operación.
 * @returns {Promise<void>} Finalización de la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function deleteCreatedAdminUser({ userId, clientId }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`delete from public.users where id = $1`, [userId]);
    if (clientId) await client.query(`delete from public.clients where id = $1`, [clientId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Obtiene el valor de administrativo usuario métricas para que el flujo llamador pueda continuar.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function getAdminUserMetrics() {
  const result = await query(`
    select
      count(*)::int as total,
      count(*) filter (where status = 'active')::int as active,
      count(*) filter (where status = 'blocked')::int as suspended,
      count(*) filter (where status = 'inactive')::int as disabled
    from public.users
    where deleted_at is null
  `);
  return mapAdminUserMetrics(result.rows[0]);
}

/**
 * Lista el valor de administrativo usuarios respetando el alcance y la paginación solicitados.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.cursor - Valor de `options.cursor` requerido por esta operación.
 * @param {number} options.limit - Valor de `options.limit` requerido por esta operación.
 * @param {string} options.role - Valor de `options.role` requerido por esta operación.
 * @param {unknown} options.search - Valor de `options.search` requerido por esta operación.
 * @param {unknown} options.status - Valor de `options.status` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function listAdminUsers({ cursor, limit, role, search, status }) {
  const result = await query(
    `
      select
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.status,
        (u.profile_photo_url is not null and btrim(u.profile_photo_url) <> '') as has_profile_photo,
        u.last_login_at,
        u.created_at,
        r.code as role_code,
        r.name as role_name
      from public.users u
      inner join public.roles r on r.id = u.role_id
      where u.deleted_at is null
        and ($1::text is null or (
          u.email ilike '%' || $1 || '%'
          or concat_ws(' ', u.first_name, u.last_name) ilike '%' || $1 || '%'
        ))
        and ($2::text[] is null or r.code = any($2::text[]))
        and ($3::public.user_status[] is null or u.status = any($3::public.user_status[]))
        and ($4::timestamptz is null or (u.created_at, u.id) < ($4, $5::bigint))
      order by u.created_at desc, u.id desc
      limit $6
    `,
    [
      search || null,
      role?.length ? role : null,
      status?.length ? status : null,
      cursor?.[0] || null,
      cursor?.[1] || null,
      limit + 1,
    ],
  );

  return result.rows;
}

/**
 * Busca el detalle de un usuario administrado y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.actorUserId - Valor de `options.actorUserId` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findAdminUserDetails({ actorUserId, userId }) {
  const result = await query(
    `
      select
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.phone,
        u.secondary_phone,
        coalesce(u.company_name, c.company_name) as company_name,
        u.status,
        u.created_at,
        r.code as role_code,
        r.name as role_name,
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', private_note.id,
              'content', private_note.content,
              'created_at', private_note.created_at,
              'updated_at', private_note.updated_at
            ) order by private_note.created_at desc, private_note.id desc
          )
          from (
            select id, content, created_at, updated_at
            from public.admin_user_notes
            where admin_user_id = $2 and target_user_id = u.id
              and archived_at is null
            order by created_at desc, id desc
            limit 2
          ) private_note
        ), '[]'::jsonb) as notes,
        (
          select count(*)::int
          from public.admin_user_notes
          where admin_user_id = $2 and target_user_id = u.id
            and archived_at is null
        ) as notes_total,
        coalesce((
          select jsonb_agg(
            jsonb_build_object('id', related_project.id, 'name', related_project.name)
            order by related_project.created_at desc, related_project.id desc
          )
          from (
            select distinct p.id, p.name, p.created_at
            from public.projects p
            where p.deleted_at is null
              and (
                (u.client_id is not null and p.client_id = u.client_id)
                or p.assigned_architect_id = u.id
                or exists (
                  select 1
                  from public.project_assignees assignment
                  where assignment.project_id = p.id
                    and assignment.user_id = u.id
                )
              )
          ) related_project
        ), '[]'::jsonb) as projects
      from public.users u
      inner join public.roles r on r.id = u.role_id
      left join public.clients c on c.id = u.client_id and c.deleted_at is null
      where u.id = $1
        and u.deleted_at is null
      limit 1
    `,
    [userId, actorUserId],
  );

  return result.rows[0] || null;
}

/**
 * Procesa el valor de administrativo usuario exists para completar la responsabilidad asignada al módulo.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} userId - Valor de `userId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function adminUserExists(userId) {
  const result = await query(
    `select exists(select 1 from public.users where id = $1 and deleted_at is null) as exists`,
    [userId],
  );
  return Boolean(result.rows[0]?.exists);
}

/**
 * Lista el valor de administrativo usuario notes respetando el alcance y la paginación solicitados.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.adminUserId - Valor de `options.adminUserId` requerido por esta operación.
 * @param {string} options.cursor - Valor de `options.cursor` requerido por esta operación.
 * @param {number} options.limit - Valor de `options.limit` requerido por esta operación.
 * @param {string} options.targetUserId - Valor de `options.targetUserId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function listAdminUserNotes({ adminUserId, cursor, limit, targetUserId }) {
  const result = await query(
    `
      select id, content, created_at, updated_at
      from public.admin_user_notes
      where admin_user_id = $1
        and target_user_id = $2
        and archived_at is null
        and ($3::timestamptz is null or (created_at, id) < ($3, $4::bigint))
      order by created_at desc, id desc
      limit $5
    `,
    [adminUserId, targetUserId, cursor?.[0] || null, cursor?.[1] || null, limit + 1],
  );
  return result.rows;
}

/**
 * Crea el valor de administrativo usuario note registro con los datos validados recibidos.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.adminUserId - Valor de `options.adminUserId` requerido por esta operación.
 * @param {string} options.content - Valor de `options.content` requerido por esta operación.
 * @param {string} options.targetUserId - Valor de `options.targetUserId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function createAdminUserNoteRecord({ adminUserId, content, targetUserId }) {
  const result = await query(
    `
      insert into public.admin_user_notes (admin_user_id, target_user_id, content)
      select $1, u.id, $3
      from public.users u
      where u.id = $2 and u.deleted_at is null
      returning id, content, created_at, updated_at
    `,
    [adminUserId, targetUserId, content],
  );
  return result.rows[0] || null;
}

/**
 * Actualiza el valor de administrativo usuario note registro conservando las reglas de acceso e integridad.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.adminUserId - Valor de `options.adminUserId` requerido por esta operación.
 * @param {string} options.content - Valor de `options.content` requerido por esta operación.
 * @param {string} options.noteId - Valor de `options.noteId` requerido por esta operación.
 * @param {string} options.targetUserId - Valor de `options.targetUserId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function updateAdminUserNoteRecord({ adminUserId, content, noteId, targetUserId }) {
  const result = await query(
    `
      update public.admin_user_notes
      set content = $4, updated_at = now()
      where id = $3 and admin_user_id = $1 and target_user_id = $2
        and archived_at is null
      returning id, content, created_at, updated_at
    `,
    [adminUserId, targetUserId, noteId, content],
  );
  return result.rows[0] || null;
}

/**
 * Archiva el valor de administrativo usuario note registro y conserva su historial sin eliminarlo físicamente.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.adminUserId - Valor de `options.adminUserId` requerido por esta operación.
 * @param {string} options.noteId - Valor de `options.noteId` requerido por esta operación.
 * @param {string} options.targetUserId - Valor de `options.targetUserId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function archiveAdminUserNoteRecord({ adminUserId, noteId, targetUserId }) {
  const result = await query(
    `
      update public.admin_user_notes
      set archived_at = now(), updated_at = now()
      where id = $3 and admin_user_id = $1 and target_user_id = $2
        and archived_at is null
      returning id, archived_at
    `,
    [adminUserId, targetUserId, noteId],
  );
  return result.rows[0] || null;
}

/**
 * Actualiza el estado persistido de un usuario administrado y de su cliente asociado. Si el estado
 * deja de ser activo revoca todas sus sesiones en la misma transacción (B-3).
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.status - Valor de `options.status` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function updateAdminUserStatusRecord({ status, userId }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `
        update public.users u
        set status = $2::public.user_status, updated_at = now()
        from public.roles r
        where u.id = $1
          and u.deleted_at is null
          and r.id = u.role_id
        returning u.id, u.client_id, u.email, u.first_name, u.last_name,
          u.status,
          (u.profile_photo_url is not null and btrim(u.profile_photo_url) <> '') as has_profile_photo,
          u.last_login_at, u.created_at,
          r.code as role_code, r.name as role_name
      `,
      [userId, status],
    );
    const updatedUser = result.rows[0] || null;

    if (updatedUser?.client_id) {
      await client.query(
        `
          update public.clients
          set status = $2::public.client_status, updated_at = now()
          where id = $1 and deleted_at is null
        `,
        [updatedUser.client_id, status === "active" ? "active" : "inactive"],
      );
    }

    if (updatedUser && status !== "active") {
      await revokeUserSessions({ reason: SESSION_REVOCATION_REASONS.userDisabled, userId }, client);
    }

    await client.query("commit");
    return updatedUser;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Busca la foto de perfil de un usuario administrado y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} userId - Valor de `userId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findAdminUserProfilePhoto(userId) {
  const result = await query(
    `
      select profile_photo_url
      from public.users
      where id = $1
        and deleted_at is null
      limit 1
    `,
    [userId],
  );

  return result.rows[0]?.profile_photo_url || null;
}
