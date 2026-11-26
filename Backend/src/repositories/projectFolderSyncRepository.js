// Sincronización de carpetas y clasificación documental de proyectos existentes. Lecturas para el
// plan (solo SELECT) y la única escritura sobre archivos: asignar su carpeta lógica. Nunca toca
// file_versions, objetos de almacenamiento, audiencias ni documentos de cotizaciones.

/**
 * Lee los proyectos vigentes con sus carpetas vigentes (predeterminadas y personalizadas).
 *
 * @param {{ query: Function }} client - Cliente PostgreSQL.
 * @returns {Promise<{ projects: Array<object>, folders: Array<object> }>} Proyectos y carpetas.
 */
export async function loadProjectFolders(client) {
  const projects = await client.query("select id, name, status::text as status from public.projects where deleted_at is null order by id");
  const folders = await client.query(`
    select folder.id, folder.project_id, folder.parent_id, folder.system_key, folder.name
    from public.project_folders folder
    inner join public.projects project on project.id = folder.project_id and project.deleted_at is null
    where folder.deleted_at is null
    order by folder.project_id, folder.id`);
  return { folders: folders.rows, projects: projects.rows };
}

/**
 * Lee los archivos vigentes de proyectos vigentes que aún no tienen carpeta (ubicación lógica).
 *
 * @param {{ query: Function }} client - Cliente PostgreSQL.
 * @returns {Promise<Array<object>>} Archivos sin clasificar.
 */
export async function loadUnfolderedFiles(client) {
  const result = await client.query(`
    select file.id, file.project_id, file.title, file.file_category::text as file_category, file.origin_project_request_id
    from public.files file
    inner join public.projects project on project.id = file.project_id and project.deleted_at is null
    where file.folder_id is null and file.deleted_at is null and file.status <> 'deleted'
    order by file.project_id, file.id`);
  return result.rows;
}

/**
 * Lee los nombres lógicos de los archivos vigentes ubicados en carpetas predeterminadas, para que el
 * plan no proponga ubicar un archivo donde ya existe otro con el mismo nombre (unicidad por carpeta).
 *
 * @param {{ query: Function }} client - Cliente PostgreSQL.
 * @returns {Promise<Array<{ project_id: string, system_key: string, title: string }>>} Nombres ocupados.
 */
export async function loadSystemFolderFileTitles(client) {
  const result = await client.query(`
    select file.project_id, folder.system_key, file.title
    from public.files file
    inner join public.project_folders folder on folder.id = file.folder_id and folder.deleted_at is null and folder.system_key is not null
    inner join public.projects project on project.id = file.project_id and project.deleted_at is null
    where file.deleted_at is null and file.status <> 'deleted'
    order by file.project_id, file.id`);
  return result.rows;
}

/**
 * Cuenta las cotizaciones (versión comercial vigente) de cada proyecto vigente.
 *
 * @param {{ query: Function }} client - Cliente PostgreSQL.
 * @returns {Promise<Array<{ project_id: string, quotes: number }>>} Cotizaciones por proyecto.
 */
export async function countProjectQuotes(client) {
  const result = await client.query(`
    select quote_version.project_id, count(*)::int as quotes
    from public.quote_versions quote_version
    inner join public.projects project on project.id = quote_version.project_id and project.deleted_at is null
    where quote_version.is_current
    group by quote_version.project_id`);
  return result.rows;
}

/**
 * Ubica archivos sin carpeta en la carpeta predeterminada indicada de su proyecto. Solo afecta a los
 * que siguen sin carpeta y cumplen la condición de origen del plan (adjuntos de la solicitud de
 * origen): un archivo ya ubicado por otra vía no se mueve. No crea versiones ni toca objetos.
 * Asigna a la vez el nombre lógico planificado (el original o uno con sufijo, único en la carpeta);
 * el nombre original sigue en sus versiones. Si un plan desactualizado chocara con un archivo ya
 * ubicado allí, ese archivo se omite (sigue sin carpeta) en lugar de violar
 * `uq_files_project_folder_title`; dos nombres iguales del mismo lote solo dejan entrar el de menor id.
 *
 * @param {{ query: Function }} client - Cliente de la transacción.
 * @param {{ projectId: number, files: Array<{ fileId: number, title: string }>, systemKey: string }} move -
 *   Proyecto, archivos con su nombre lógico y destino.
 * @returns {Promise<number[]>} Archivos ubicados ahora.
 */
export async function assignRequestAttachmentsToFolder(client, { files, projectId, systemKey }) {
  if (!files.length) return [];
  const result = await client.query(`
    with planned as (
      select planned.id, planned.title
      from unnest($1::bigint[], $4::text[]) as planned(id, title)
    )
    update public.files file
    set folder_id = target.id, title = planned.title, updated_at = now()
    from public.project_folders target, planned
    where target.project_id = $2 and target.system_key = $3 and target.deleted_at is null
      and planned.id = file.id and file.project_id = $2 and file.folder_id is null
      and file.origin_project_request_id is not null and file.deleted_at is null and file.status <> 'deleted'
      and not exists (
        select 1 from public.files homonym
        where homonym.project_id = $2 and homonym.folder_id = target.id and homonym.id <> file.id
          and homonym.deleted_at is null and homonym.status <> 'deleted'
          and lower(homonym.title) = lower(planned.title)
      )
      and not exists (
        select 1 from planned other
        where other.id < planned.id and lower(other.title) = lower(planned.title)
      )
    returning file.id`, [files.map((file) => file.fileId), projectId, systemKey, files.map((file) => file.title)]);
  return result.rows.map((row) => Number(row.id));
}

/**
 * Registra en la auditoría la sincronización de un proyecto, dentro de su transacción. Se escribe
 * aquí (y no con auditLogRepository) para no cargar el pool global en el comando de mantenimiento.
 *
 * @param {{ query: Function }} client - Cliente de la transacción.
 * @param {{ action: string, projectId: number, userId: number, newValues: object }} entry - Registro.
 * @returns {Promise<void>}
 */
export async function insertFolderSyncAudit(client, { action, newValues, projectId, userId }) {
  await client.query(
    `insert into public.audit_logs (user_id, action, entity_type, entity_id, description, new_values)
     values ($1, $2, 'project', $3, $4, $5::jsonb)`,
    [userId, action, projectId, "Sincronización de carpetas predeterminadas y clasificación documental del proyecto.", JSON.stringify(newValues)],
  );
}
