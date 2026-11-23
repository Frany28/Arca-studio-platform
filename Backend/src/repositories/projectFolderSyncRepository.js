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
 *
 * @param {{ query: Function }} client - Cliente de la transacción.
 * @param {{ projectId: number, fileIds: number[], systemKey: string }} move - Proyecto, archivos y destino.
 * @returns {Promise<number[]>} Archivos ubicados ahora.
 */
export async function assignRequestAttachmentsToFolder(client, { fileIds, projectId, systemKey }) {
  if (!fileIds.length) return [];
  const result = await client.query(`
    update public.files file
    set folder_id = target.id, updated_at = now()
    from public.project_folders target
    where target.project_id = $2 and target.system_key = $3 and target.deleted_at is null
      and file.id = any($1::bigint[]) and file.project_id = $2 and file.folder_id is null
      and file.origin_project_request_id is not null and file.deleted_at is null and file.status <> 'deleted'
    returning file.id`, [fileIds, projectId, systemKey]);
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
