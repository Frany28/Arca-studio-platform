import { pool, query } from "../config/db.js";
import { isProjectFinalized, normalizeProjectStatus, PROJECT_STATUS } from "../domain/projectStatus.js";
import { mapAdminDashboardMetrics } from "../utils/adminDashboardMetrics.js";
import {
  mapAdminDashboardActivity,
  mapAdminDashboardRequest,
} from "../utils/adminDashboardOverview.js";

/**
 * Transforma el valor de responsable a la representación estable utilizada por la aplicación.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} [row] - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
function mapAssignee(row = {}) {
  return {
    hasProfilePhoto: Boolean(row.has_profile_photo ?? row.hasProfilePhoto),
    id: Number(row.id),
    name: row.name || "Empleado",
    roleCode: row.role_code || row.roleCode || null,
    roleName: row.role_name || row.roleName || "Empleado",
  };
}

/**
 * Transforma el valor de assignment result a la representación estable utilizada por la aplicación.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} [row] - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
function mapAssignmentResult(row = {}) {
  return {
    allEligible: Boolean(row.all_eligible),
    assignees: Array.isArray(row.assignees)
      ? row.assignees.map(mapAssignee)
      : [],
    targetExists: Boolean(row.target_exists),
  };
}

/**
 * Transforma el valor de solicitud assignment result a la representación estable utilizada por la aplicación.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} [row] - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
function mapRequestAssignmentResult(row = {}) {
  return {
    ...mapAssignmentResult(row),
    assignmentAllowed: Boolean(row.assignment_allowed),
    mutable: Boolean(row.mutable),
    status: row.status || null,
  };
}

/**
 * Traduce el resultado administrativo a la respuesta pública de estado y visibilidad.
 * Emite finished para la finalización histórica y conserva los indicadores de archivo existentes.
 *
 * @param {unknown} [row] - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
function mapManagedProject(row = {}) {
  return {
    archived: row.status === "archived",
    archivedAt: null,
    id: Number(row.id),
    isPublic: Boolean(row.is_public),
    status: normalizeProjectStatus(row.status),
  };
}

/**
 * Aplica visibilidad, archivado o recuperación en una transacción con bloqueo de proyectos.
 * Exige finalización para visibilidad y conserva el estado previo al archivo, incluidos finished.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.action - Valor de `options.action` requerido por esta operación.
 * @param {boolean} options.isPublic - Valor de `options.isPublic` requerido por esta operación.
 * @param {Array<unknown>} options.projectIds - Valor de `options.projectIds` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function applyAdminProjectBulkAction({
  action,
  isPublic,
  projectIds,
  userId,
}) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const lockedResult = await client.query(
      `
        select id, status, archived_from_status, is_public, deleted_at
        from public.projects
        where id = any($1::bigint[])
        order by id
        for update
      `,
      [projectIds],
    );
    const foundIds = new Set(lockedResult.rows.map((row) => Number(row.id)));
    const missingIds = projectIds.filter((id) => !foundIds.has(id));

    if (missingIds.length) {
      await client.query("rollback");
      return { missingIds, outcome: "not_found", projects: [] };
    }

    if (
      action === "change_visibility"
      && lockedResult.rows.some(
        (project) => !isProjectFinalized(project.status) || project.deleted_at,
      )
    ) {
      await client.query("rollback");
      return { missingIds: [], outcome: "visibility_requires_finished", projects: [] };
    }

    if (
      action === "unarchive"
      && lockedResult.rows.some((project) => project.status !== "archived")
    ) {
      await client.query("rollback");
      return { missingIds: [], outcome: "unarchive_requires_archived", projects: [] };
    }

    let updateSql;
    let updateParams = [projectIds];

    if (action === "change_visibility") {
      updateSql = `
        update public.projects
        set is_public = $2, updated_at = now()
        where id = any($1::bigint[])
        returning id, status, archived_from_status, is_public, deleted_at
      `;
      updateParams = [projectIds, isPublic];
    } else if (action === "archive") {
      updateSql = `
        update public.projects
        set
          archived_from_status = case
            when status = 'archived'::public.project_status
              then archived_from_status
            else status
          end,
          status = 'archived'::public.project_status,
          deleted_at = null,
          is_public = false,
          updated_at = now()
        where id = any($1::bigint[])
        returning id, status, archived_from_status, is_public, deleted_at
      `;
    } else {
      updateSql = `
        update public.projects
        set
          status = coalesce(
            archived_from_status,
            'pending'::public.project_status
          ),
          archived_from_status = null,
          deleted_at = null,
          is_public = false,
          updated_at = now()
        where id = any($1::bigint[])
        returning id, status, archived_from_status, is_public, deleted_at
      `;
    }

    const updatedResult = await client.query(updateSql, updateParams);
    const previousById = new Map(
      lockedResult.rows.map((project) => [Number(project.id), project]),
    );

    for (const project of updatedResult.rows) {
      const previous = previousById.get(Number(project.id));
      await client.query(
        `
          insert into public.audit_logs (
            user_id,
            action,
            entity_type,
            entity_id,
            description,
            old_values,
            new_values
          ) values ($1, $2, 'project', $3, $4, $5::jsonb, $6::jsonb)
        `,
        [
          userId,
          `project.${action}`,
          project.id,
          `Accion administrativa masiva: ${action}`,
          JSON.stringify({
            archivedAt: previous.deleted_at,
            isPublic: previous.is_public,
            status: previous.status,
          }),
          JSON.stringify({
            archivedAt: project.deleted_at,
            isPublic: project.is_public,
            status: project.status,
          }),
        ],
      );
    }

    await client.query("commit");
    return {
      missingIds: [],
      outcome: "updated",
      projects: updatedResult.rows.map(mapManagedProject),
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Lista los responsables disponibles para administración respetando el alcance y la paginación solicitados.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function listAdminAssignees() {
  const result = await query(`
    select
      user_account.id,
      concat_ws(' ', user_account.first_name, user_account.last_name) as name,
      (user_account.profile_photo_url is not null and btrim(user_account.profile_photo_url) <> '') as has_profile_photo,
      role.code as role_code,
      role.name as role_name
    from public.users user_account
    inner join public.roles role on role.id = user_account.role_id
    where user_account.status = 'active'
      and user_account.deleted_at is null
      and role.is_active = true
      and role.code in ('admin', 'architect')
    order by user_account.first_name, user_account.last_name, user_account.id
  `);

  return result.rows.map(mapAssignee);
}

/**
 * Busca la foto de perfil del responsable administrativo y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} userId - Valor de `userId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findAdminAssigneeProfilePhoto(userId) {
  const result = await query(
    `
      select user_account.profile_photo_url
      from public.users user_account
      inner join public.roles role on role.id = user_account.role_id
      where user_account.id = $1
        and user_account.status = 'active'
        and user_account.deleted_at is null
        and role.is_active = true
        and role.code in ('admin', 'architect')
      limit 1
    `,
    [userId],
  );

  return result.rows[0]?.profile_photo_url || null;
}

/**
 * Reemplaza responsables elegibles únicamente en proyectos operativamente abiertos.
 * Excluye archived y finished bajo bloqueo PostgreSQL para conservar asignaciones al finalizar.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {Array<unknown>} options.assigneeIds - Valor de `options.assigneeIds` requerido por esta operación.
 * @param {unknown} options.assignedBy - Valor de `options.assignedBy` requerido por esta operación.
 * @param {string} options.projectId - Valor de `options.projectId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function replaceProjectAssignees({
  assigneeIds,
  assignedBy,
  projectId,
}) {
  const result = await query(
    `
      with target as (
        select id
        from public.projects
        where id = $1
          and deleted_at is null
          and status not in (
            'archived'::public.project_status,
            '${PROJECT_STATUS.FINISHED}'::public.project_status
          )
        for update
      ),
      requested as (
        select distinct unnest($2::bigint[]) as user_id
      ),
      eligible as (
        select
          user_account.id,
          concat_ws(' ', user_account.first_name, user_account.last_name) as name,
          (user_account.profile_photo_url is not null and btrim(user_account.profile_photo_url) <> '') as has_profile_photo,
          role.code as role_code,
          role.name as role_name
        from requested
        inner join public.users user_account on user_account.id = requested.user_id
        inner join public.roles role on role.id = user_account.role_id
        where user_account.status = 'active'
          and user_account.deleted_at is null
          and role.is_active = true
          and role.code in ('admin', 'architect')
      ),
      validation as (
        select
          (select count(*) from requested) = (select count(*) from eligible)
            as all_eligible
      ),
      upserted as (
        insert into public.project_assignees (
          project_id,
          user_id,
          assigned_by
        )
        select target.id, eligible.id, $3
        from target
        cross join eligible
        where (select all_eligible from validation)
        on conflict (project_id, user_id) do update
          set assigned_by = excluded.assigned_by
        returning user_id
      ),
      removed as (
        delete from public.project_assignees assignment
        using target
        where assignment.project_id = target.id
          and (select all_eligible from validation)
          and not (assignment.user_id = any($2::bigint[]))
        returning assignment.user_id
      ),
      updated as (
        update public.projects project
        set
          assigned_architect_id = (
            select eligible.id
            from eligible
            where eligible.role_code = 'architect'
            order by eligible.id
            limit 1
          ),
          updated_at = now()
        from target
        where project.id = target.id
          and (select all_eligible from validation)
        returning project.id
      )
      select
        exists(select 1 from target) as target_exists,
        (select all_eligible from validation) as all_eligible,
        coalesce(
          (
            select json_agg(
              json_build_object(
                'id', eligible.id,
                'name', eligible.name,
                'hasProfilePhoto', eligible.has_profile_photo,
                'roleCode', eligible.role_code,
                'roleName', eligible.role_name
              )
              order by eligible.name, eligible.id
            )
            from eligible
          ),
          '[]'::json
        ) as assignees
    `,
    [projectId, assigneeIds, assignedBy],
  );

  return mapAssignmentResult(result.rows[0]);
}

/**
 * Reemplaza el valor de proyecto solicitud responsables de forma atómica con los valores solicitados.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {Array<unknown>} options.assigneeIds - Valor de `options.assigneeIds` requerido por esta operación.
 * @param {unknown} options.assignedBy - Valor de `options.assignedBy` requerido por esta operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function replaceProjectRequestAssignees({
  assigneeIds,
  assignedBy,
  projectRequestId,
}) {
  const result = await query(
    `
      with target as (
        select id, status
        from public.project_requests
        where id = $1
          and deleted_at is null
        for update
      ),
      mutable_target as (
        select id, status
        from target
        where status in ('pending_verification', 'pending_review')
      ),
      requested as (
        select distinct unnest($2::bigint[]) as user_id
      ),
      eligible as (
        select
          user_account.id,
          concat_ws(' ', user_account.first_name, user_account.last_name) as name,
          (user_account.profile_photo_url is not null and btrim(user_account.profile_photo_url) <> '') as has_profile_photo,
          role.code as role_code,
          role.name as role_name
        from requested
        inner join public.users user_account on user_account.id = requested.user_id
        inner join public.roles role on role.id = user_account.role_id
        where user_account.status = 'active'
          and user_account.deleted_at is null
          and role.is_active = true
          and role.code in ('admin', 'architect')
      ),
      validation as (
        select
          (select count(*) from requested) = (select count(*) from eligible)
            as all_eligible,
          exists(select 1 from eligible where role_code = 'architect')
            as has_architect
      ),
      permission as (
        select
          (select all_eligible from validation)
          and (
            mutable_target.status = 'pending_verification'
            or (select has_architect from validation)
          ) as assignment_allowed
        from mutable_target
      ),
      upserted as (
        insert into public.project_request_assignees (
          project_request_id,
          user_id,
          assigned_by
        )
        select mutable_target.id, eligible.id, $3
        from mutable_target
        cross join eligible
        where (select assignment_allowed from permission)
        on conflict (project_request_id, user_id) do update
          set assigned_by = excluded.assigned_by
        returning user_id
      ),
      removed as (
        delete from public.project_request_assignees assignment
        using mutable_target
        where assignment.project_request_id = mutable_target.id
          and (select assignment_allowed from permission)
          and not (assignment.user_id = any($2::bigint[]))
        returning assignment.user_id
      ),
      updated as (
        update public.project_requests request
        set
          status = case
            when (select has_architect from validation)
              then 'pending_review'::public.project_request_status
            else request.status
          end,
          updated_at = now()
        from mutable_target
        where request.id = mutable_target.id
          and (select assignment_allowed from permission)
        returning request.id, request.status
      ),
      audited as (
        insert into public.audit_logs (
          user_id, action, entity_type, entity_id, description, old_values, new_values
        )
        select
          $3,
          'project_request.assign',
          'project_request',
          target.id,
          'Responsables de solicitud actualizados',
          jsonb_build_object('status', target.status),
          jsonb_build_object(
            'assigneeIds', $2::bigint[],
            'status', updated.status
          )
        from target
        inner join updated on updated.id = target.id
        returning id
      )
      select
        exists(select 1 from target) as target_exists,
        exists(select 1 from mutable_target) as mutable,
        (select all_eligible from validation) as all_eligible,
        coalesce((select assignment_allowed from permission), false) as assignment_allowed,
        coalesce(
          (select status::text from updated),
          (select status::text from target)
        ) as status,
        coalesce(
          (
            select json_agg(
              json_build_object(
                'id', eligible.id,
                'name', eligible.name,
                'hasProfilePhoto', eligible.has_profile_photo,
                'roleCode', eligible.role_code,
                'roleName', eligible.role_name
              )
              order by eligible.name, eligible.id
            )
            from eligible
          ),
          '[]'::json
        ) as assignees
    `,
    [projectRequestId, assigneeIds, assignedBy],
  );

  return mapRequestAssignmentResult(result.rows[0]);
}

/**
 * Obtiene las métricas del panel administrativo para que el flujo llamador pueda continuar.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function getAdminDashboardMetrics() {
  const result = await query(`
    select
      (select count(*) from public.users
        where status = 'active' and deleted_at is null) as active_users_total,
      (select count(*) from public.users
        where status = 'active' and deleted_at is null
          and created_at >= date_trunc('month', current_timestamp)) as active_users_this_month,
      (select count(*) from public.projects
        where status in ('pending', 'in_process') and deleted_at is null) as active_projects_total,
      (select count(*) from public.projects
        where status in ('pending', 'in_process') and deleted_at is null
          and created_at >= date_trunc('month', current_timestamp)) as active_projects_this_month,
      (select count(*) from public.files
        where status <> 'deleted' and deleted_at is null) as files_total,
      (select coalesce(sum(file_version.file_size), 0)
        from public.files file
        inner join public.file_versions file_version
          on file_version.file_id = file.id
          and file_version.is_current = true
          and file_version.deleted_at is null
        where file.status <> 'deleted' and file.deleted_at is null) as files_total_bytes,
      (select max(file_version.created_at)
        from public.files file
        inner join public.file_versions file_version
          on file_version.file_id = file.id
          and file_version.deleted_at is null
        where file.status <> 'deleted' and file.deleted_at is null) as files_latest_upload_at,
      (select count(*) from public.project_requests
        where status in ('pending_verification', 'pending_review')
          and deleted_at is null) as requests_total,
      (select count(*) from public.project_requests
        where status in ('pending_verification', 'pending_review')
          and deleted_at is null
          and created_at >= date_trunc('day', current_timestamp)) as requests_today,
      0::bigint as critical_events_total,
      null::timestamptz as latest_critical_event_at
  `);

  return mapAdminDashboardMetrics(result.rows[0]);
}

/**
 * Reúne actividad reciente y solicitudes pendientes para el resumen administrativo.
 * Consulta PostgreSQL e identifica entregas finalizadas por el código canónico finished del historial.
 *
 * @returns {Promise<object>} Resultado producido por la operación.
 */
export async function getAdminDashboardOverview() {
  const [activityResult, requestsResult] = await Promise.all([
    query(`
      select
        activity_kind,
        activity_id,
        project_id,
        project_name,
        activity_title,
        user_name,
        created_at
      from (
        select
          'status'::text as activity_kind,
          history.id as activity_id,
          history.project_id,
          project.name as project_name,
          case
            when history.new_status = '${PROJECT_STATUS.FINISHED}' then 'Entrega finalizada'
            else 'Estado actualizado'
          end as activity_title,
          concat_ws(' ', actor.first_name, actor.last_name) as user_name,
          role.code as user_role_code,
          history.changed_at as created_at
        from public.project_status_history history
        inner join public.projects project on project.id = history.project_id
        inner join public.users actor on actor.id = history.changed_by
        inner join public.roles role on role.id = actor.role_id
        where project.deleted_at is null

        union all

        select
          'file'::text as activity_kind,
          file.id as activity_id,
          file.project_id,
          project.name as project_name,
          'Archivo agregado'::text as activity_title,
          concat_ws(' ', actor.first_name, actor.last_name) as user_name,
          role.code as user_role_code,
          file.created_at
        from public.files file
        inner join public.projects project on project.id = file.project_id
        inner join public.users actor on actor.id = file.uploaded_by
        inner join public.roles role on role.id = actor.role_id
        where file.project_id is not null
          and file.deleted_at is null
          and file.status <> 'deleted'
          and project.deleted_at is null
      ) recent_activity
      order by created_at desc, activity_id desc
      limit 8
    `),
    query(`
      select
        request.id,
        request.project_name,
        request.project_type,
        request.status,
        request.created_at,
        coalesce(assignment.assignees, '[]'::json) as assignees
      from public.project_requests request
      left join lateral (
        select json_agg(
          json_build_object(
            'id', employee.id,
            'name', concat_ws(' ', employee.first_name, employee.last_name),
            'hasProfilePhoto', (employee.profile_photo_url is not null and btrim(employee.profile_photo_url) <> ''),
            'roleCode', role.code,
            'roleName', role.name
          )
          order by employee.first_name, employee.last_name, employee.id
        ) as assignees
        from public.project_request_assignees request_assignment
        inner join public.users employee on employee.id = request_assignment.user_id
        inner join public.roles role on role.id = employee.role_id
        where request_assignment.project_request_id = request.id
          and employee.deleted_at is null
      ) assignment on true
      where request.status in ('pending_verification', 'pending_review')
        and request.deleted_at is null
      order by request.created_at desc, request.id desc
      limit 4
    `),
  ]);

  return {
    newRequests: requestsResult.rows.map(mapAdminDashboardRequest),
    recentActivity: activityResult.rows.map(mapAdminDashboardActivity),
  };
}
