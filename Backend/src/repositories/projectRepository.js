import { query } from "../config/db.js";
import { normalizeProjectStatus, PROJECT_STATUS } from "../domain/projectStatus.js";
import { pageResult } from "../utils/pagination.js";

/**
 * Transforma el valor de number a la representación pública esperada.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function toNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Transforma la fila de proyecto en el contrato público preservando datos y responsables.
 * Emite finished como estado finalizado, incluso ante una lectura histórica con el alias antiguo.
 *
 * @param {unknown} row - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
function toProject(row) {
  const assignedArchitects = Array.isArray(row.assigned_employees)
    ? row.assigned_employees.map((assignee) => ({
        id: Number(assignee.id),
        name: assignee.name || "Empleado",
        roleCode: assignee.roleCode || null,
        roleName: assignee.roleName || "Empleado",
      }))
    : [];

  return {
    areaUnit: row.area_unit,
    assignees: assignedArchitects,
    assignedArchitect: row.assigned_architect_id
      ? {
          hasProfilePhoto: Boolean(row.architect_has_profile_photo),
          id: Number(row.assigned_architect_id),
          name: `${row.architect_first_name || ""} ${
            row.architect_last_name || ""
          }`.trim(),
        }
      : null,
    assignedArchitects,
    budget: toNumber(row.budget),
    city: row.city || null,
    client: {
      id: Number(row.client_id),
      name: row.client_name,
    },
    constructionArea: toNumber(row.construction_area),
    country: row.country || null,
    createdAt: row.created_at,
    createdBy: Number(row.created_by),
    description: row.description || null,
    endDate: row.end_date,
    generalArea: toNumber(row.general_area),
    hasPlans: Boolean(row.has_plans),
    id: Number(row.id),
    imageFileId: row.image_file_id ? Number(row.image_file_id) : null,
    imageFileVersionId: row.image_file_version_id
      ? Number(row.image_file_version_id)
      : null,
    hasImage: Boolean(row.image_file_id),
    isPublic: Boolean(row.is_public),
    location: row.location,
    locationCoordinates:
      row.location_latitude !== null &&
      row.location_latitude !== undefined &&
      row.location_longitude !== null &&
      row.location_longitude !== undefined
        ? {
            latitude: Number(row.location_latitude),
            longitude: Number(row.location_longitude),
          }
        : null,
    locationFormattedAddress: row.formatted_address || null,
    providerPlaceId: row.provider_place_id || null,
    name: row.name,
    progress: Number(row.progress),
    projectType: row.project_type,
    publicSlug: row.public_slug || null,
    startDate: row.start_date,
    state: row.state || null,
    status: normalizeProjectStatus(row.status),
    updatedAt: row.updated_at,
  };
}

/**
 * Transforma el valor de público proyecto archivo a la representación pública esperada.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} file - Valor de `file` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
function toPublicProjectFile(file) {
  return {
    available: Boolean(file.file_name),
    createdAt: file.created_at,
    currentVersion: Number(file.current_version),
    currentVersionId: file.current_version_id
      ? Number(file.current_version_id)
      : null,
    description: file.description || null,
    extension: file.file_extension || null,
    fileType: file.file_type,
    fileCategory: file.file_category,
    id: Number(file.id),
    size: file.file_size === null ? null : Number(file.file_size),
    title: file.title,
    uploadedBy: file.uploader_id
      ? {
          id: Number(file.uploader_id),
          name: `${file.uploader_first_name || ""} ${
            file.uploader_last_name || ""
          }`.trim(),
          hasProfilePhoto: Boolean(file.uploader_profile_photo_url),
        }
      : null,
  };
}

/**
 * Transforma el valor de recent proyecto documento a la representación pública esperada.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} file - Valor de `file` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function toRecentProjectDocument(file) {
  return toPublicProjectFile({
    ...file,
    created_at: file.file_created_at,
  });
}

/**
 * Obtiene el valor de proyecto access para que el flujo llamador pueda continuar.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {unknown} [projectAlias] - Valor de `projectAlias` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
function getProjectAccess(user, projectAlias = "p") {
  const roleCode = user?.role?.code;
  const params = [];
  let condition = "false";

  if (roleCode === "admin") {
    condition = "true";
  } else if (roleCode === "architect") {
    params.push(user.id);
    condition = `(${projectAlias}.assigned_architect_id = $${params.length} or exists (
      select 1 from public.project_assignees assignment
      where assignment.project_id = ${projectAlias}.id
        and assignment.user_id = $${params.length}
    ) or ${projectAlias}.is_public = true)`;
  } else if (roleCode === "client" && user.clientId) {
    params.push(user.clientId);
    condition = `(${projectAlias}.client_id = $${params.length} or ${projectAlias}.is_public = true)`;
  }

  return { condition, params };
}

/**
 * Obtiene el valor de direct proyecto access para que el flujo llamador pueda continuar.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {unknown} [projectAlias] - Valor de `projectAlias` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
function getDirectProjectAccess(user, projectAlias = "p") {
  const roleCode = user?.role?.code;

  if (roleCode === "admin") return { condition: "true", params: [] };
  if (roleCode === "architect") {
    return {
      condition: `(${projectAlias}.assigned_architect_id = $1 or exists (
        select 1 from public.project_assignees assignment
        where assignment.project_id = ${projectAlias}.id
          and assignment.user_id = $1
      ))`,
      params: [user.id],
    };
  }
  if (roleCode === "client" && user.clientId) {
    return {
      condition: `${projectAlias}.client_id = $1`,
      params: [user.clientId],
    };
  }

  return { condition: "false", params: [] };
}

/**
 * Procesa el valor de has direct proyecto access para completar la responsabilidad asignada al módulo.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} project - Valor de `project` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @returns {boolean} Resultado producido por la operación.
 */
function hasDirectProjectAccess(project, user) {
  const roleCode = user?.role?.code;
  if (roleCode === "admin") return true;
  if (roleCode === "architect") {
    return (
      Number(project.assigned_architect_id) === Number(user.id) ||
      (Array.isArray(project.assigned_employees) &&
        project.assigned_employees.some(
          (assignee) => Number(assignee.id) === Number(user.id),
        ))
    );
  }
  return Boolean(
    roleCode === "client" &&
      user.clientId &&
      Number(project.client_id) === Number(user.clientId),
  );
}

/**
 * Determina si el valor de público showcase archivo cumple la condición esperada.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} file - Valor de `file` requerido por esta operación.
 * @returns {boolean} Resultado producido por la operación.
 */
function isPublicShowcaseFile(file) {
  const type = String(file.file_type || "").toLowerCase();
  return type.startsWith("image/") || type.startsWith("video/");
}

/**
 * Busca el valor de assigned architect perfil foto for usuario y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} projectId - Valor de `projectId` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findAssignedArchitectProfilePhotoForUser(projectId, user) {
  const { condition, params } = getDirectProjectAccess(user);
  const projectIdParam = params.length + 1;
  const result = await query(
    `
      select architect.profile_photo_url
      from public.projects p
      inner join public.users architect
        on architect.id = p.assigned_architect_id
       and architect.deleted_at is null
      where p.id = $${projectIdParam}
        and p.deleted_at is null
        and (${condition})
      limit 1
    `,
    [...params, projectId],
  );

  return result.rows[0]?.profile_photo_url || null;
}

/**
 * Busca el valor de proyecto state by id y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} projectId - Valor de `projectId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findProjectStateById(projectId) {
  const result = await query(
    `
      select id, status
      from public.projects
      where id = $1
        and deleted_at is null
      limit 1
    `,
    [projectId],
  );

  return result.rows[0] || null;
}

/**
 * Busca el valor de direct proyecto state for usuario y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} projectId - Valor de `projectId` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findDirectProjectStateForUser(projectId, user) {
  const { condition, params } = getDirectProjectAccess(user);
  const projectIdParam = params.length + 1;
  const result = await query(
    `
      select p.id, p.status
      from public.projects p
      where p.id = $${projectIdParam}
        and p.deleted_at is null
        and (${condition})
      limit 1
    `,
    [...params, projectId],
  );

  return result.rows[0] || null;
}

/**
 * Lista el valor de proyectos for usuario respetando el alcance y la paginación solicitados.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {object} [options] - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} [options.cursor] - Valor de `options.cursor` requerido por esta operación.
 * @param {unknown} [options.directOnly] - Valor de `options.directOnly` requerido por esta operación.
 * @param {number} [options.limit] - Valor de `options.limit` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function listProjectsForUser(
  user,
  { cursor = null, directOnly = false, limit = 25 } = {},
) {
  const { condition: accessCondition, params } = directOnly
    ? getDirectProjectAccess(user)
    : getProjectAccess(user);
  const cursorDateParam = params.length + 1;
  const cursorIdParam = params.length + 2;
  const limitParam = params.length + 3;

  const result = await query(
    `
      select
        p.id,
        p.client_id,
        p.created_by,
        p.assigned_architect_id,
        p.name,
        p.public_slug,
        p.description,
        p.status,
        p.start_date,
        p.end_date,
        p.budget,
        p.progress,
        p.created_at,
        p.updated_at,
        p.project_type,
        p.location,
        p.city,
        p.state,
        p.country,
        p.has_plans,
        p.general_area,
        p.construction_area,
        p.area_unit,
        p.is_public,
        p.location_latitude,
        p.location_longitude,
        p.provider_place_id,
        p.formatted_address,
        c.name as client_name,
        architect.first_name as architect_first_name,
        architect.last_name as architect_last_name,
        (architect.profile_photo_url is not null) as architect_has_profile_photo,
        coalesce(employee_assignment.assignees, '[]'::json) as assigned_employees,
        image_version.file_id as image_file_id,
        image_version.version_id as image_file_version_id
      from public.projects p
      inner join public.clients c on c.id = p.client_id
      left join public.users architect on architect.id = p.assigned_architect_id
      left join lateral (
        select json_agg(
          json_build_object(
            'id', employee.id,
            'name', concat_ws(' ', employee.first_name, employee.last_name),
            'roleCode', role.code,
            'roleName', role.name
          )
          order by employee.first_name, employee.last_name, employee.id
        ) as assignees
        from public.project_assignees assignment
        inner join public.users employee on employee.id = assignment.user_id
        inner join public.roles role on role.id = employee.role_id
        where assignment.project_id = p.id
          and employee.deleted_at is null
      ) employee_assignment on true
      left join lateral (
        select file.id as file_id, version.id as version_id
        from public.files file
        inner join public.file_versions version
          on version.file_id = file.id
          and version.version_number = file.current_version
          and version.deleted_at is null
        where file.project_id = p.id
          and file.deleted_at is null
          and file.status <> 'deleted'
          and file.file_type like 'image/%'
        order by file.created_at desc, file.id desc
        limit 1
      ) image_version on true
      where p.deleted_at is null
        and c.deleted_at is null
        and (${accessCondition})
        and ($${cursorDateParam}::timestamptz is null or (p.updated_at, p.id) < ($${cursorDateParam}::timestamptz, $${cursorIdParam}::bigint))
      order by p.updated_at desc, p.id desc
      limit $${limitParam}
    `,
    [...params, cursor?.[0] || null, cursor?.[1] || null, limit + 1],
  );

  return pageResult(result.rows, limit, toProject, (row) => [row.updated_at, String(row.id)]);
}

/**
 * Busca el valor de proyecto detail by condition for usuario y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.conditionSql - Valor de `options.conditionSql` requerido por esta operación.
 * @param {unknown} options.conditionValue - Valor de `options.conditionValue` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @param {string} [options.fileCursor] - Valor de `options.fileCursor` requerido por esta operación.
 * @param {number} [options.fileLimit] - Valor de `options.fileLimit` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 */
async function findProjectDetailByConditionForUser({
  conditionSql,
  conditionValue,
  user,
  fileCursor = null,
  fileLimit = 25,
}) {
  const { condition: accessCondition, params } = getProjectAccess(user);
  params.push(conditionValue);
  const conditionParameter = `$${params.length}`;

  const projectResult = await query(
    `
      select
        p.id,
        p.client_id,
        p.created_by,
        p.assigned_architect_id,
        p.name,
        p.public_slug,
        p.description,
        p.status,
        p.start_date,
        p.end_date,
        p.budget,
        p.progress,
        p.created_at,
        p.updated_at,
        p.project_type,
        p.location,
        p.city,
        p.state,
        p.country,
        p.has_plans,
        p.general_area,
        p.construction_area,
        p.area_unit,
        p.is_public,
        p.location_latitude,
        p.location_longitude,
        p.provider_place_id,
        p.formatted_address,
        c.name as client_name,
        architect.first_name as architect_first_name,
        architect.last_name as architect_last_name,
        (architect.profile_photo_url is not null) as architect_has_profile_photo,
        coalesce(employee_assignment.assignees, '[]'::json) as assigned_employees,
        image_version.file_id as image_file_id,
        image_version.version_id as image_file_version_id
      from public.projects p
      inner join public.clients c on c.id = p.client_id
      left join public.users architect on architect.id = p.assigned_architect_id
      left join lateral (
        select json_agg(
          json_build_object(
            'id', employee.id,
            'name', concat_ws(' ', employee.first_name, employee.last_name),
            'roleCode', role.code,
            'roleName', role.name
          )
          order by employee.first_name, employee.last_name, employee.id
        ) as assignees
        from public.project_assignees assignment
        inner join public.users employee on employee.id = assignment.user_id
        inner join public.roles role on role.id = employee.role_id
        where assignment.project_id = p.id
          and employee.deleted_at is null
      ) employee_assignment on true
      left join lateral (
        select file.id as file_id, version.id as version_id
        from public.files file
        inner join public.file_versions version
          on version.file_id = file.id
          and version.version_number = file.current_version
          and version.deleted_at is null
        where file.project_id = p.id
          and file.deleted_at is null
          and file.status <> 'deleted'
          and file.file_type like 'image/%'
        order by file.created_at desc, file.id desc
        limit 1
      ) image_version on true
      where ${conditionSql(conditionParameter)}
        and p.deleted_at is null
        and c.deleted_at is null
        and (${accessCondition})
      limit 1
    `,
    params,
  );

  if (!projectResult.rows[0]) {
    return null;
  }

  const projectId = Number(projectResult.rows[0].id);

  const [
    requirementsResult,
    specificationsResult,
    filesResult,
    recentDocumentsResult,
  ] =
    await Promise.all([
      query(
        `
          select id, description, sort_order
          from public.project_requirements
          where project_id = $1
            and deleted_at is null
          order by sort_order, id
        `,
        [projectId],
      ),
      query(
        `
          select
            specification.id,
            specification.title,
            specification.description,
            specification.sort_order,
            specification.default_open,
            coalesce(
              json_agg(
                json_build_object(
                  'id', item.id,
                  'content', item.content,
                  'sortOrder', item.sort_order
                )
                order by item.sort_order, item.id
              ) filter (where item.id is not null),
              '[]'::json
            ) as items
          from public.project_technical_specifications specification
          left join public.project_technical_specification_items item
            on item.specification_id = specification.id
            and item.deleted_at is null
          where specification.project_id = $1
            and specification.deleted_at is null
          group by specification.id
          order by specification.sort_order, specification.id
        `,
        [projectId],
      ),
      query(
        `
          select
            file.id,
            file.title,
            file.description,
            file.file_type,
            file.file_category,
            file.current_version,
            version.id as current_version_id,
            version.file_extension,
            version.file_name,
            version.file_size,
            version.created_at,
            file.created_at as file_created_at,
            uploader.id as uploader_id,
            uploader.first_name as uploader_first_name,
            uploader.last_name as uploader_last_name,
            uploader.profile_photo_url as uploader_profile_photo_url
          from public.files file
          left join public.file_versions version
            on version.file_id = file.id
            and version.version_number = file.current_version
            and version.deleted_at is null
          left join public.users uploader
            on uploader.id = file.uploaded_by
            and uploader.deleted_at is null
          where file.project_id = $1
            and file.deleted_at is null
            and file.status <> 'deleted'
            and ($2::timestamptz is null or (file.created_at, file.id) < ($2::timestamptz, $3::bigint))
          order by file.created_at desc, file.id desc
          limit $4
        `,
        [projectId, fileCursor?.[0] || null, fileCursor?.[1] || null, fileLimit + 1],
      ),
      query(
        `
          select
            file.id,
            file.title,
            file.description,
            file.file_type,
            file.file_category,
            file.current_version,
            version.id as current_version_id,
            version.file_extension,
            version.file_name,
            version.file_size,
            version.created_at,
            file.created_at as file_created_at,
            uploader.id as uploader_id,
            uploader.first_name as uploader_first_name,
            uploader.last_name as uploader_last_name,
            uploader.profile_photo_url as uploader_profile_photo_url
          from public.files file
          left join public.file_versions version
            on version.file_id = file.id
            and version.version_number = file.current_version
            and version.deleted_at is null
          left join public.users uploader
            on uploader.id = file.uploaded_by
            and uploader.deleted_at is null
          where file.project_id = $1
            and file.deleted_at is null
            and file.status <> 'deleted'
            and file.file_type not like 'image/%'
            and file.file_type not like 'video/%'
          order by file.created_at desc, file.id desc
          limit 3
        `,
        [projectId],
      ),
    ]);

  const hasDirectAccess = hasDirectProjectAccess(projectResult.rows[0], user);
  const visibleFileRows = hasDirectAccess
    ? filesResult.rows
    : filesResult.rows.filter(isPublicShowcaseFile);
  const filePage = pageResult(
    visibleFileRows,
    fileLimit,
    toPublicProjectFile,
    (row) => [row.file_created_at, String(row.id)],
  );

  return {
    ...toProject(projectResult.rows[0]),
    files: filePage.items,
    filesNextCursor: filePage.nextCursor,
    recentDocuments: hasDirectAccess
      ? recentDocumentsResult.rows.map(toRecentProjectDocument)
      : [],
    requirements: requirementsResult.rows.map((requirement) => ({
      description: requirement.description,
      id: Number(requirement.id),
      sortOrder: Number(requirement.sort_order),
    })),
    technicalSpecifications: specificationsResult.rows.map((specification) => ({
      defaultOpen: Boolean(specification.default_open),
      description: specification.description || null,
      id: Number(specification.id),
      items: Array.isArray(specification.items)
        ? specification.items.map((item) => ({
            ...item,
            id: Number(item.id),
            sortOrder: Number(item.sortOrder),
          }))
        : [],
      sortOrder: Number(specification.sort_order),
      title: specification.title,
    })),
  };
}

/**
 * Busca el valor de proyecto detail for usuario y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} projectId - Valor de `projectId` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {unknown} [options] - Opciones agrupadas necesarias para ejecutar la operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findProjectDetailForUser(projectId, user, options = {}) {
  return findProjectDetailByConditionForUser({
        /**
     * Procesa el valor de condition sql para completar la responsabilidad asignada al módulo.
     * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
     *
     * @param {unknown} parameter - Valor de `parameter` requerido por esta operación.
     * @returns {void} Finalización de la operación.
     */
conditionSql: (parameter) => `p.id = ${parameter}`,
    conditionValue: projectId,
    user,
    ...options,
  });
}

/**
 * Busca el valor de proyecto detail by público slug for usuario y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} publicSlug - Valor de `publicSlug` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {unknown} [options] - Opciones agrupadas necesarias para ejecutar la operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findProjectDetailByPublicSlugForUser(publicSlug, user, options = {}) {
  return findProjectDetailByConditionForUser({
        /**
     * Procesa el valor de condition sql para completar la responsabilidad asignada al módulo.
     * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
     *
     * @param {unknown} parameter - Valor de `parameter` requerido por esta operación.
     * @returns {void} Finalización de la operación.
     */
conditionSql: (parameter) => `p.public_slug = ${parameter}`,
    conditionValue: publicSlug,
    user,
    ...options,
  });
}

/**
 * Actualiza la visibilidad de un proyecto finalizado con acceso directo autorizado.
 * Exige finished también en la escritura para impedir cambios concurrentes tras archivar el proyecto.
 *
 * @param {string} projectId - Valor de `projectId` requerido por esta operación.
 * @param {boolean} isPublic - Valor de `isPublic` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function updateProjectVisibility(projectId, isPublic, user) {
  const { condition, params } = getDirectProjectAccess(user);
  const projectIdParam = params.length + 1;
  const visibilityParam = params.length + 2;
  const result = await query(
    `
      with updated_project as (
        update public.projects
        set
          is_public = $${visibilityParam},
          updated_at = now()
        where id = $${projectIdParam}
          and deleted_at is null
          and status = '${PROJECT_STATUS.FINISHED}'::public.project_status
          and (${condition})
        returning *
      )
      select
        p.id,
        p.client_id,
        p.created_by,
        p.assigned_architect_id,
        p.name,
        p.public_slug,
        p.description,
        p.status,
        p.start_date,
        p.end_date,
        p.budget,
        p.progress,
        p.created_at,
        p.updated_at,
        p.project_type,
        p.location,
        p.city,
        p.state,
        p.country,
        p.has_plans,
        p.general_area,
        p.construction_area,
        p.area_unit,
        p.is_public,
        p.location_latitude,
        p.location_longitude,
        p.provider_place_id,
        p.formatted_address,
        c.name as client_name,
        architect.first_name as architect_first_name,
        architect.last_name as architect_last_name,
        (architect.profile_photo_url is not null) as architect_has_profile_photo,
        coalesce(employee_assignment.assignees, '[]'::json) as assigned_employees,
        image_version.file_id as image_file_id,
        image_version.version_id as image_file_version_id
      from updated_project p
      inner join public.clients c on c.id = p.client_id
      left join public.users architect on architect.id = p.assigned_architect_id
      left join lateral (
        select json_agg(
          json_build_object(
            'id', employee.id,
            'name', concat_ws(' ', employee.first_name, employee.last_name),
            'roleCode', role.code,
            'roleName', role.name
          )
          order by employee.first_name, employee.last_name, employee.id
        ) as assignees
        from public.project_assignees assignment
        inner join public.users employee on employee.id = assignment.user_id
        inner join public.roles role on role.id = employee.role_id
        where assignment.project_id = p.id
          and employee.deleted_at is null
      ) employee_assignment on true
      left join lateral (
        select file.id as file_id, version.id as version_id
        from public.files file
        inner join public.file_versions version
          on version.file_id = file.id
          and version.version_number = file.current_version
          and version.deleted_at is null
        where file.project_id = p.id
          and file.deleted_at is null
          and file.status <> 'deleted'
          and file.file_type like 'image/%'
        order by file.created_at desc, file.id desc
        limit 1
      ) image_version on true
    `,
    [...params, projectId, isPublic],
  );

  return result.rows[0] ? toProject(result.rows[0]) : null;
}
