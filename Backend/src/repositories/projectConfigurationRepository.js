import { query } from "../config/db.js";

/**
 * Convierte un identificador o número de PostgreSQL (bigint como texto) a número, conservando
 * los valores ausentes como null para no inventar ceros.
 *
 * @param {unknown} value - Valor de la fila.
 * @returns {number|null} Número o null.
 */
function toNumberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Normaliza una columna DATE a texto `AAAA-MM-DD`, el formato del contrato. Evita desplazamientos
 * de zona horaria al serializar un Date de medianoche.
 *
 * @param {Date|string|null} value - Fecha de la fila.
 * @returns {string|null} Fecha ISO o null.
 */
function toDateText(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Bloquea FOR UPDATE el proyecto a configurar y devuelve su estado vigente, o null si no existe.
 * Todas las escrituras de la configuración pasan por este bloqueo, de modo que dos guardados o un
 * guardado y la finalización quedan serializados.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {number} projectId - Proyecto.
 * @returns {Promise<{id: number, status: string, clientId: number}|null>} Estado bloqueado.
 */
export async function lockProjectForConfiguration(client, projectId) {
  const result = await client.query(
    `select id, status, client_id from public.projects where id = $1 and deleted_at is null for update`,
    [projectId],
  );
  const row = result.rows[0];
  return row ? { clientId: Number(row.client_id), id: Number(row.id), status: row.status } : null;
}

/**
 * Lee la configuración completa de un proyecto: datos generales, cliente, responsables, fases,
 * hitos, garantías y la solicitud de origen (si el borrador nació de una aprobación) con los
 * responsables que la revisaron. Consulta PostgreSQL con parámetros.
 *
 * @param {number} projectId - Proyecto.
 * @param {{query: Function}} [executor] - Pool o cliente de una transacción.
 * @returns {Promise<object|null>} Configuración o null si el proyecto no existe.
 */
export async function findProjectConfiguration(projectId, executor = { query }) {
  const projectResult = await executor.query(
    `
      select p.id, p.name, p.status, p.description, p.project_type, p.location, p.formatted_address,
        p.provider_place_id, p.location_latitude, p.location_longitude, p.has_plans, p.general_area,
        p.construction_area, p.area_unit, p.zoning, p.procedures, p.conditions, p.equipment,
        p.start_date, p.end_date, p.progress, p.client_id, p.updated_at, c.name as client_name
      from public.projects p
      inner join public.clients c on c.id = p.client_id
      where p.id = $1 and p.deleted_at is null
    `,
    [projectId],
  );
  const project = projectResult.rows[0];
  if (!project) return null;

  const [assignees, stages, milestones, warranties, request] = await Promise.all([
    executor.query(
      `
        select u.id, concat_ws(' ', u.first_name, u.last_name) as name, r.code as role_code
        from public.project_assignees a
        inner join public.users u on u.id = a.user_id
        inner join public.roles r on r.id = u.role_id
        where a.project_id = $1 and u.deleted_at is null
        order by u.first_name, u.last_name, u.id
      `,
      [projectId],
    ),
    executor.query(
      `select id, name, status, start_date, end_date, sort_order from public.project_stages
       where project_id = $1 and deleted_at is null order by sort_order, id`,
      [projectId],
    ),
    executor.query(
      `select id, title, due_date from public.project_milestones
       where project_id = $1 and deleted_at is null order by due_date, id`,
      [projectId],
    ),
    executor.query(
      `select id, product, model, code, start_date, service_date, end_date from public.project_warranties
       where project_id = $1 and deleted_at is null order by sort_order, id`,
      [projectId],
    ),
    executor.query(
      `
        select request.id, request.investment_range, request.project_size, request.capital_availability,
          request.expected_start_time, request.first_contact_at,
          coalesce(array_agg(assignment.user_id order by assignment.created_at, assignment.user_id)
            filter (where assignment.user_id is not null), '{}') as assignee_ids
        from public.project_requests request
        left join public.project_request_assignees assignment on assignment.project_request_id = request.id
        where request.converted_project_id = $1 and request.deleted_at is null
        group by request.id
        limit 1
      `,
      [projectId],
    ),
  ]);

  return {
    assignees: assignees.rows.map((row) => ({ id: Number(row.id), name: row.name || "Usuario", roleCode: row.role_code })),
    milestones: milestones.rows.map((row) => ({ dueDate: toDateText(row.due_date), id: Number(row.id), title: row.title })),
    project,
    request: request.rows[0] || null,
    stages: stages.rows.map((row) => ({
      endDate: toDateText(row.end_date),
      id: Number(row.id),
      name: row.name,
      startDate: toDateText(row.start_date),
      status: row.status,
    })),
    warranties: warranties.rows.map((row) => ({
      code: row.code,
      endDate: toDateText(row.end_date),
      id: Number(row.id),
      model: row.model,
      product: row.product,
      serviceDate: toDateText(row.service_date),
      startDate: toDateText(row.start_date),
    })),
  };
}

/**
 * Guarda la sección «Información general» de un proyecto bloqueado. El cliente no se modifica: lo
 * fijan la solicitud aprobada o la cotización que creó el borrador.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción (proyecto ya bloqueado).
 * @param {number} projectId - Proyecto.
 * @param {object} data - Campos validados de la sección.
 * @returns {Promise<void>} Finaliza al guardar.
 */
export async function updateProjectGeneralConfiguration(client, projectId, data) {
  await client.query(
    `
      update public.projects
      set name = $2, project_type = $3::public.project_type, general_area = $4, construction_area = $5,
        location = $6, formatted_address = $7, provider_place_id = $8, location_latitude = $9,
        location_longitude = $10, zoning = $11, procedures = $12, conditions = $13, equipment = $14,
        has_plans = coalesce($15, has_plans), updated_at = now()
      where id = $1
    `,
    [
      projectId, data.name, data.projectType, data.generalArea, data.constructionArea, data.location,
      data.formattedAddress, data.providerPlaceId, data.latitude, data.longitude, data.zoning,
      data.procedures, data.conditions, data.equipment, data.hasPlans,
    ],
  );
}

/**
 * Sustituye los responsables del proyecto bloqueado por administradores o arquitectos activos,
 * con la misma regla de elegibilidad que la asignación del dashboard. Actualiza
 * `assigned_architect_id` con el primer arquitecto de la lista.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{assignedBy: number, assigneeIds: number[], projectId: number}} params - Responsables.
 * @returns {Promise<boolean>} false si algún usuario no es elegible (no escribe nada).
 */
export async function replaceConfigurationAssignees(client, { assignedBy, assigneeIds, projectId }) {
  const eligible = await client.query(
    `
      select u.id, r.code as role_code
      from public.users u inner join public.roles r on r.id = u.role_id
      where u.id = any($1::bigint[]) and u.status = 'active' and u.deleted_at is null
        and r.is_active = true and r.code in ('admin', 'architect')
    `,
    [assigneeIds],
  );
  if (eligible.rowCount !== new Set(assigneeIds).size) return false;
  await client.query(
    `delete from public.project_assignees where project_id = $1 and not (user_id = any($2::bigint[]))`,
    [projectId, assigneeIds],
  );
  await client.query(
    `
      insert into public.project_assignees (project_id, user_id, assigned_by)
      select $1, unnest($2::bigint[]), $3
      on conflict (project_id, user_id) do nothing
    `,
    [projectId, assigneeIds, assignedBy],
  );
  const architect = eligible.rows
    .filter((row) => row.role_code === "architect")
    .map((row) => Number(row.id))
    .sort((a, b) => a - b)[0] ?? null;
  await client.query(`update public.projects set assigned_architect_id = $2 where id = $1`, [projectId, architect]);
  return true;
}

/**
 * Sustituye fases e hitos del proyecto bloqueado (se retiran los anteriores con deleted_at, sin
 * borrar historial) y guarda la fecha de entrega estimada y el progreso calculado.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {object} params - Proyecto, fases, hitos, entrega estimada y progreso.
 * @param {string|null} params.estimatedDeliveryDate - Fecha de entrega estimada (end_date).
 * @param {Array<{title: string, dueDate: string}>} params.milestones - Hitos validados.
 * @param {number} params.progress - Progreso calculado desde las fases.
 * @param {number} params.projectId - Proyecto bloqueado.
 * @param {Array<object>} params.stages - Fases validadas, en orden.
 * @returns {Promise<void>} Finaliza al guardar.
 */
export async function replaceTrackingConfiguration(client, { estimatedDeliveryDate, milestones, progress, projectId, stages }) {
  await client.query(`update public.project_milestones set deleted_at = now(), updated_at = now() where project_id = $1 and deleted_at is null`, [projectId]);
  await client.query(`update public.project_stages set deleted_at = now(), updated_at = now() where project_id = $1 and deleted_at is null`, [projectId]);
  for (const [index, stage] of stages.entries()) {
    await client.query(
      `insert into public.project_stages (project_id, name, status, sort_order, start_date, end_date, completed_at)
       values ($1, $2, $3::public.project_status, $4, $5, $6, case when $3 = 'finished' then now() else null end)`,
      [projectId, stage.name, stage.status, index + 1, stage.startDate, stage.endDate],
    );
  }
  for (const milestone of milestones) {
    await client.query(
      `insert into public.project_milestones (project_id, title, due_date, status) values ($1, $2, $3, 'pending')`,
      [projectId, milestone.title, milestone.dueDate],
    );
  }
  await client.query(
    `update public.projects set end_date = $2, progress = $3, updated_at = now() where id = $1`,
    [projectId, estimatedDeliveryDate, progress],
  );
}

/**
 * Sustituye las garantías del proyecto bloqueado (las anteriores quedan con deleted_at).
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{createdBy: number, projectId: number, warranties: object[]}} params - Garantías validadas.
 * @returns {Promise<void>} Finaliza al guardar.
 */
export async function replaceProjectWarranties(client, { createdBy, projectId, warranties }) {
  await client.query(`update public.project_warranties set deleted_at = now(), updated_at = now() where project_id = $1 and deleted_at is null`, [projectId]);
  for (const [index, warranty] of warranties.entries()) {
    await client.query(
      `insert into public.project_warranties (project_id, product, model, code, start_date, service_date, end_date, sort_order, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [projectId, warranty.product, warranty.model, warranty.code, warranty.startDate, warranty.serviceDate, warranty.endDate, index + 1, createdBy],
    );
  }
}

/**
 * Confirma la configuración: draft → pending con la fecha de inicio indicada, planos «no» si nunca
 * se informaron (PostgreSQL los exige fuera de draft), historial de estado y auditoría. Si el
 * borrador procede de una solicitud, notifica al cliente que su proyecto ya está disponible.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción (proyecto bloqueado en draft).
 * @param {{changedBy: number, projectId: number, startDate: string}} params - Transición.
 * @returns {Promise<{id: number, name: string, status: string}>} Proyecto actualizado.
 */
export async function finalizeProjectConfiguration(client, { changedBy, projectId, startDate }) {
  const updated = await client.query(
    `
      update public.projects
      set status = 'pending'::public.project_status, start_date = $2, has_plans = coalesce(has_plans, false), updated_at = now()
      where id = $1 and status = 'draft'::public.project_status
      returning id, name, status, client_id
    `,
    [projectId, startDate],
  );
  const project = updated.rows[0];
  await client.query(
    `insert into public.project_status_history (project_id, changed_by, previous_status, new_status, note)
     values ($1, $2, 'draft', 'pending', 'Configuración del proyecto finalizada')`,
    [projectId, changedBy],
  );
  await client.query(
    `
      insert into public.audit_logs (user_id, action, entity_type, entity_id, description, old_values, new_values)
      values ($1, 'project.configuration_finalized', 'project', $2, 'Configuración del proyecto finalizada', $3::jsonb, $4::jsonb)
    `,
    [changedBy, projectId, JSON.stringify({ status: "draft" }), JSON.stringify({ startDate, status: "pending" })],
  );
  await client.query(
    `
      insert into public.notifications (user_id, project_id, created_by, title, message, type, entity_type, entity_id)
      select request.requested_by, $1, $2, 'Proyecto disponible',
        'Tu proyecto ' || $3 || ' ya está disponible.', 'project.configuration_finalized', 'project', $1
      from public.project_requests request
      where request.converted_project_id = $1 and request.deleted_at is null
    `,
    [projectId, changedBy, project.name],
  );
  return { id: Number(project.id), name: project.name, status: project.status };
}

/**
 * Registra el primer contacto real con el cliente de una solicitud aprobada. Es idempotente: si ya
 * existe, conserva la fecha y el autor originales. Audita el registro.
 *
 * @param {{projectRequestId: number, userId: number}} params - Solicitud y administrador.
 * @returns {Promise<{outcome: "recorded"|"already_recorded"|"invalid_state"|"not_found", firstContactAt?: string}>} Resultado del registro.
 */
export async function recordProjectRequestFirstContact({ projectRequestId, userId }) {
  const result = await query(
    `
      with target as (
        select id, status, first_contact_at from public.project_requests
        where id = $1 and deleted_at is null for update
      ),
      updated as (
        update public.project_requests request
        set first_contact_at = now(), first_contact_by = $2, updated_at = now()
        from target
        where request.id = target.id and target.status = 'converted' and target.first_contact_at is null
        returning request.first_contact_at
      ),
      audit as (
        insert into public.audit_logs (user_id, action, entity_type, entity_id, description, new_values)
        select $2, 'project_request.first_contact', 'project_request', $1, 'Primer contacto registrado',
          jsonb_build_object('firstContactAt', updated.first_contact_at)
        from updated
        returning id
      )
      select target.status, target.first_contact_at as previous, (select first_contact_at from updated) as recorded
      from target
    `,
    [projectRequestId, userId],
  );
  const row = result.rows[0];
  if (!row) return { outcome: "not_found" };
  if (row.recorded) return { firstContactAt: row.recorded, outcome: "recorded" };
  if (row.previous) return { firstContactAt: row.previous, outcome: "already_recorded" };
  return { outcome: "invalid_state", status: row.status };
}

/**
 * Lista las carpetas vigentes de un proyecto con el número de archivos de cada una.
 *
 * @param {number} projectId - Proyecto.
 * @param {{query: Function}} [executor] - Pool o cliente.
 * @returns {Promise<Array<{id: number, parentId: number|null, name: string, fileCount: number}>>} Carpetas.
 */
export async function listProjectFolders(projectId, executor = { query }) {
  const result = await executor.query(
    `
      select folder.id, folder.parent_id, folder.name,
        (select count(*) from public.files file where file.folder_id = folder.id and file.deleted_at is null and file.status <> 'deleted') as file_count
      from public.project_folders folder
      where folder.project_id = $1 and folder.deleted_at is null
      order by lower(folder.name), folder.id
    `,
    [projectId],
  );
  return result.rows.map((row) => ({
    fileCount: Number(row.file_count),
    id: Number(row.id),
    name: row.name,
    parentId: toNumberOrNull(row.parent_id),
  }));
}

/**
 * Busca una carpeta vigente del proyecto.
 *
 * @param {import("pg").PoolClient|{query: Function}} executor - Cliente o pool.
 * @param {number} projectId - Proyecto.
 * @param {number} folderId - Carpeta.
 * @returns {Promise<{id: number, parentId: number|null}|null>} Carpeta o null.
 */
export async function findProjectFolder(executor, projectId, folderId) {
  const result = await executor.query(
    `select id, parent_id from public.project_folders where id = $1 and project_id = $2 and deleted_at is null`,
    [folderId, projectId],
  );
  const row = result.rows[0];
  return row ? { id: Number(row.id), parentId: toNumberOrNull(row.parent_id) } : null;
}

/**
 * Crea una carpeta en el proyecto bloqueado. El índice único de hermanas rechaza nombres repetidos
 * (23505), que el servicio traduce.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{createdBy: number, name: string, parentId: number|null, projectId: number}} params - Carpeta.
 * @returns {Promise<{id: number, name: string, parentId: number|null, fileCount: number}>} Carpeta creada.
 */
export async function insertProjectFolder(client, { createdBy, name, parentId, projectId }) {
  const result = await client.query(
    `insert into public.project_folders (project_id, parent_id, name, created_by) values ($1, $2, $3, $4) returning id, parent_id, name`,
    [projectId, parentId, name, createdBy],
  );
  const row = result.rows[0];
  return { fileCount: 0, id: Number(row.id), name: row.name, parentId: toNumberOrNull(row.parent_id) };
}

/**
 * Renombra una carpeta del proyecto bloqueado.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{folderId: number, name: string, projectId: number}} params - Carpeta y nombre.
 * @returns {Promise<boolean>} false si la carpeta no existe.
 */
export async function renameProjectFolder(client, { folderId, name, projectId }) {
  const result = await client.query(
    `update public.project_folders set name = $3, updated_at = now() where id = $1 and project_id = $2 and deleted_at is null`,
    [folderId, projectId, name],
  );
  return result.rowCount > 0;
}

/**
 * Retira una carpeta vacía (sin subcarpetas ni archivos vigentes) del proyecto bloqueado.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{folderId: number, projectId: number}} params - Carpeta.
 * @returns {Promise<"deleted"|"not_found"|"not_empty">} Resultado.
 */
export async function deleteEmptyProjectFolder(client, { folderId, projectId }) {
  const folder = await findProjectFolder(client, projectId, folderId);
  if (!folder) return "not_found";
  const usage = await client.query(
    `
      select exists (select 1 from public.project_folders where parent_id = $1 and deleted_at is null) as has_children,
        exists (select 1 from public.files where folder_id = $1 and deleted_at is null and status <> 'deleted') as has_files
    `,
    [folderId],
  );
  if (usage.rows[0].has_children || usage.rows[0].has_files) return "not_empty";
  await client.query(`update public.project_folders set deleted_at = now(), updated_at = now() where id = $1`, [folderId]);
  return "deleted";
}

/**
 * Lista los archivos vigentes de un proyecto con su versión actual, carpeta y autor, para la
 * gestión de archivos de la configuración. `origin_project_request_id` identifica los adjuntos de
 * la solicitud («Archivos del cliente»).
 *
 * @param {number} projectId - Proyecto.
 * @returns {Promise<Array<object>>} Archivos.
 */
export async function listProjectConfigurationFiles(projectId) {
  const result = await query(
    `
      select file.id, file.title, file.file_type, file.folder_id, file.origin_project_request_id, file.current_version,
        file.created_at, version.id as version_id, version.file_size, version.original_name,
        concat_ws(' ', uploader.first_name, uploader.last_name) as uploaded_by_name
      from public.files file
      left join public.file_versions version
        on version.file_id = file.id and version.version_number = file.current_version and version.deleted_at is null
      left join public.users uploader on uploader.id = file.uploaded_by
      where file.project_id = $1 and file.deleted_at is null and file.status <> 'deleted'
      order by file.created_at desc, file.id desc
    `,
    [projectId],
  );
  return result.rows.map((row) => ({
    createdAt: row.created_at,
    fileType: row.file_type,
    folderId: toNumberOrNull(row.folder_id),
    fromClientRequest: row.origin_project_request_id !== null,
    id: Number(row.id),
    name: row.original_name || row.title,
    size: toNumberOrNull(row.file_size),
    uploadedBy: row.uploaded_by_name || null,
    version: toNumberOrNull(row.current_version),
    versionId: toNumberOrNull(row.version_id),
  }));
}

/**
 * Mueve un archivo del proyecto bloqueado a una carpeta (o a la raíz con null).
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{fileId: number, folderId: number|null, projectId: number}} params - Archivo y destino.
 * @returns {Promise<boolean>} false si el archivo no pertenece al proyecto.
 */
export async function moveProjectFileToFolder(client, { fileId, folderId, projectId }) {
  const result = await client.query(
    `update public.files set folder_id = $3, updated_at = now() where id = $1 and project_id = $2 and deleted_at is null and status <> 'deleted'`,
    [fileId, projectId, folderId],
  );
  return result.rowCount > 0;
}
