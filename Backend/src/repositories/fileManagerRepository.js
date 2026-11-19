import { query } from "../config/db.js";
import { PROJECT_SYSTEM_FOLDERS } from "../domain/projectFolderCatalog.js";
import { preciseCursorTimestampSql } from "../utils/pagination.js";

// Administrador de archivos (Fase 1.2, B7): lecturas de PostgreSQL para métricas, árbol de proyectos
// y carpetas, búsqueda de carpetas y listados por estado de revisión. Solo archivos de proyectos
// vigentes (`files.project_id`, sin `deleted_at` ni estado `deleted`); los adjuntos que siguen en una
// solicitud no forman parte del administrador hasta que pasan a su proyecto.
//
// Los nombres visibles de las carpetas predeterminadas salen del catálogo (p. ej. «Panorámicas» para
// `renders.models`, aunque el proyecto guardara el nombre anterior), igual que resolveFolderDisplayName;
// por eso el catálogo entra como parámetro y la búsqueda encuentra el nombre que se muestra.

const ACTIVE_FILE_SQL = "file.deleted_at is null and file.status <> 'deleted' and file.project_id is not null";

// Criterio de cada pestaña sobre una versión (`version`) de un archivo (`file`):
// - approved: la versión vigente del archivo (`files.current_version`), aprobada o heredada (sin
//   revisión). Una versión heredada cuenta como aprobada tanto en un archivo heredado como en uno
//   convertido a la política 1.2 por la compatibilidad de B9, que no inventa aprobaciones.
// - pending / rejected: cada versión pendiente o rechazada, aunque el archivo tenga otra vigente.
export const FILE_MANAGER_TAB_SQL = Object.freeze({
  approved: `version.version_number = file.current_version
    and (version.review_status = 'approved'::public.file_version_review_status or version.review_status is null)`,
  pending: "version.review_status = 'pending'::public.file_version_review_status",
  rejected: "version.review_status = 'rejected'::public.file_version_review_status",
});

// Ordenaciones admitidas: expresión, tipo para comparar con el cursor y expresión del cursor.
const SORTS = Object.freeze({
  date: { cast: "timestamptz", cursorSql: preciseCursorTimestampSql("version.created_at"), sql: "version.created_at" },
  name: { cast: "text", cursorSql: "lower(coalesce(version.original_name, file.title))", sql: "lower(coalesce(version.original_name, file.title))" },
  size: { cast: "bigint", cursorSql: "coalesce(version.file_size, 0)::text", sql: "coalesce(version.file_size, 0)" },
});

/**
 * Parámetros con el catálogo de carpetas predeterminadas (claves y nombres visibles) para unirlos
 * en SQL con `unnest`. Es la misma fuente que resolveFolderDisplayName.
 *
 * @returns {[string[], string[]]} Claves y nombres en el mismo orden.
 */
function catalogParams() {
  return [PROJECT_SYSTEM_FOLDERS.map((folder) => folder.key), PROJECT_SYSTEM_FOLDERS.map((folder) => folder.name)];
}

/**
 * Escapa un texto de búsqueda para ILIKE: `%`, `_` y `\` se buscan de forma literal.
 *
 * @param {string} text - Texto introducido por el usuario.
 * @returns {string} Patrón `%texto%`.
 */
export function toContainsPattern(text) {
  return `%${String(text).replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Calcula las métricas del administrador en un ámbito: todos los proyectos, un proyecto o una carpeta
 * con sus subcarpetas. Criterios (documentados en Backend/ARCHITECTURE.md, B7):
 * - archivos: archivos vigentes (no versiones);
 * - espacio usado: suma de los objetos almacenados distintos de sus versiones no retiradas; un objeto
 *   reutilizado por restauraciones (misma clave) cuenta una sola vez;
 * - última carga: la versión más reciente con objeto propio (las restauraciones no son cargas).
 *
 * @param {{ projectId?: number|null, folderId?: number|null }} scope - Ámbito.
 * @returns {Promise<{ totalFiles: number, usedBytes: number, objectCount: number, lastUploadAt: Date|null }>} Métricas.
 */
export async function readFileManagerMetrics({ folderId = null, projectId = null }) {
  const result = await query(
    `
      with recursive scope_folders as (
        select folder.id from public.project_folders folder
        where folder.id = $2::bigint and folder.project_id = $1::bigint and folder.deleted_at is null
        union all
        select child.id from public.project_folders child
        inner join scope_folders parent on child.parent_id = parent.id
        where child.deleted_at is null
      ),
      scoped_files as (
        select file.id
        from public.files file
        inner join public.projects project on project.id = file.project_id and project.deleted_at is null
        where ${ACTIVE_FILE_SQL}
          and ($1::bigint is null or file.project_id = $1::bigint)
          and ($2::bigint is null or file.folder_id in (select id from scope_folders))
      ),
      scoped_versions as (
        select version.file_name, version.file_size, version.created_at, version.restored_from_version_id
        from public.file_versions version
        inner join scoped_files on scoped_files.id = version.file_id
        where version.deleted_at is null
      ),
      stored_objects as (
        select distinct on (file_name) file_name, coalesce(file_size, 0) as object_size
        from scoped_versions
        where file_name is not null
        order by file_name
      )
      select
        (select count(*) from scoped_files)::bigint as total_files,
        (select coalesce(sum(object_size), 0) from stored_objects)::bigint as used_bytes,
        (select count(*) from stored_objects)::bigint as object_count,
        (select max(created_at) from scoped_versions where restored_from_version_id is null) as last_upload_at
    `,
    [projectId, folderId],
  );
  const row = result.rows[0];
  return {
    lastUploadAt: row.last_upload_at,
    objectCount: Number(row.object_count),
    totalFiles: Number(row.total_files),
    usedBytes: Number(row.used_bytes),
  };
}

/**
 * Lista una página de proyectos del árbol, ordenados por nombre e id, con su cliente y su número de
 * archivos. La búsqueda opcional compara el nombre del proyecto o del cliente.
 *
 * @param {{ cursor: [string, string]|null, limit: number, search?: string|null }} options - Página y búsqueda.
 * @returns {Promise<Array<object>>} Hasta `limit + 1` filas.
 */
export async function listFileManagerProjects({ cursor, limit, search = null }) {
  const result = await query(
    `
      select project.id, project.name, project.status, client.name as client_name, lower(project.name) as sort_name,
        (select count(*) from public.files file where file.project_id = project.id and ${ACTIVE_FILE_SQL})::bigint as file_count
      from public.projects project
      inner join public.clients client on client.id = project.client_id
      where project.deleted_at is null
        and ($1::text is null or project.name ilike $1 or client.name ilike $1)
        and ($2::text is null or (lower(project.name), project.id) > ($2::text, $3::bigint))
      order by lower(project.name), project.id
      limit $4
    `,
    [search ? toContainsPattern(search) : null, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1],
  );
  return result.rows;
}

/**
 * Lee las carpetas vigentes de varios proyectos con su nombre visible y su número de archivos directos.
 * El servicio las ordena por proyecto con orderFolderTree.
 *
 * @param {number[]} projectIds - Proyectos de la página.
 * @returns {Promise<Array<object>>} Filas de carpetas.
 */
export async function listFoldersOfProjects(projectIds) {
  if (!projectIds.length) return [];
  const [keys, names] = catalogParams();
  const result = await query(
    `
      select folder.id, folder.project_id, folder.parent_id, folder.system_key,
        coalesce(catalog.name, folder.name) as name,
        (select count(*) from public.files file where file.folder_id = folder.id and ${ACTIVE_FILE_SQL})::bigint as file_count
      from public.project_folders folder
      left join unnest($2::text[], $3::text[]) as catalog(key, name) on catalog.key = folder.system_key
      where folder.project_id = any($1::bigint[]) and folder.deleted_at is null
    `,
    [projectIds, keys, names],
  );
  return result.rows;
}

/**
 * Busca carpetas por su nombre visible en todos los proyectos o en uno, ordenadas por nombre, proyecto
 * e id con cursor. Devuelve también proyecto y cliente para mostrar su ubicación legible.
 *
 * @param {{ search: string, projectId?: number|null, cursor: [string, string, string]|null, limit: number }} options - Búsqueda y página.
 * @returns {Promise<Array<object>>} Hasta `limit + 1` filas.
 */
export async function searchFileManagerFolders({ cursor, limit, projectId = null, search }) {
  const [keys, names] = catalogParams();
  const result = await query(
    `
      with visible as (
        select folder.id, folder.project_id, folder.parent_id, folder.system_key,
          coalesce(catalog.name, folder.name) as name, lower(coalesce(catalog.name, folder.name)) as sort_name,
          project.name as project_name, client.name as client_name
        from public.project_folders folder
        inner join public.projects project on project.id = folder.project_id and project.deleted_at is null
        inner join public.clients client on client.id = project.client_id
        left join unnest($3::text[], $4::text[]) as catalog(key, name) on catalog.key = folder.system_key
        where folder.deleted_at is null and ($2::bigint is null or folder.project_id = $2::bigint)
      )
      select * from visible
      where name ilike $1
        and ($5::text is null or (sort_name, project_id, id) > ($5::text, $6::bigint, $7::bigint))
      order by sort_name, project_id, id
      limit $8
    `,
    [toContainsPattern(search), projectId, keys, names, cursor?.[0] ?? null, cursor?.[1] ?? null, cursor?.[2] ?? null, limit + 1],
  );
  return result.rows;
}

/**
 * Lee las carpetas antecesoras (incluida la propia) de varias carpetas, con su nombre visible, para
 * construir su ruta legible.
 *
 * @param {number[]} folderIds - Carpetas de partida.
 * @returns {Promise<Array<{ origin_id: string, id: string, name: string, depth: number }>>} Cadenas de antecesoras.
 */
export async function listFolderAncestors(folderIds) {
  if (!folderIds.length) return [];
  const [keys, names] = catalogParams();
  const result = await query(
    `
      with recursive chain as (
        select folder.id as origin_id, folder.id, folder.parent_id, folder.name, folder.system_key, 0 as depth
        from public.project_folders folder where folder.id = any($1::bigint[])
        union all
        select chain.origin_id, parent.id, parent.parent_id, parent.name, parent.system_key, chain.depth + 1
        from public.project_folders parent
        inner join chain on parent.id = chain.parent_id
        where chain.depth < 64
      )
      select chain.origin_id, chain.id, chain.depth, coalesce(catalog.name, chain.name) as name
      from chain
      left join unnest($2::text[], $3::text[]) as catalog(key, name) on catalog.key = chain.system_key
      order by chain.origin_id, chain.depth desc
    `,
    [folderIds, keys, names],
  );
  return result.rows;
}

/**
 * Lista una página de versiones de una pestaña (aprobados, pendientes o rechazados) con filtros,
 * ordenación y cursor. Todos los filtros van antes del LIMIT; el cursor guarda el valor de la
 * ordenación y el id de la versión como desempate.
 *
 * @param {object} options - Pestaña, ámbito, filtros, orden y página.
 * @param {"approved"|"pending"|"rejected"} options.tab - Pestaña.
 * @param {number|null} [options.projectId] - Proyecto.
 * @param {number|null} [options.folderId] - Carpeta.
 * @param {boolean} [options.includeSubfolders] - Incluye las subcarpetas de la carpeta.
 * @param {string|null} [options.search] - Texto en el nombre del archivo.
 * @param {string[]} [options.extensions] - Extensiones admitidas (en minúsculas).
 * @param {"date"|"name"|"size"} options.sort - Ordenación.
 * @param {"asc"|"desc"} options.order - Sentido.
 * @param {[string, string]|null} options.cursor - Valor de ordenación e id de la última fila.
 * @param {number} options.limit - Tamaño de página.
 * @returns {Promise<Array<object>>} Hasta `limit + 1` filas.
 */
export async function listFileManagerItems({
  cursor, extensions = [], folderId = null, includeSubfolders = false, limit, order, projectId = null, search = null, sort, tab,
}) {
  const sortDefinition = SORTS[sort];
  const comparison = order === "asc" ? ">" : "<";
  const [keys, names] = catalogParams();
  const result = await query(
    `
      with recursive scope_folders as (
        select folder.id from public.project_folders folder
        where folder.id = $2::bigint and folder.project_id = $1::bigint and folder.deleted_at is null
        union all
        select child.id from public.project_folders child
        inner join scope_folders parent on child.parent_id = parent.id
        where $3::boolean and child.deleted_at is null
      )
      select
        version.id as version_id, version.version_number, version.file_extension, version.file_size, version.created_at,
        version.review_status::text as review_status, version.review_reason, version.reviewed_at, version.restored_from_version_id,
        coalesce(version.content_type, file.file_type) as content_type,
        coalesce(version.original_name, file.title) as name,
        (version.version_number = file.current_version) as is_current,
        file.id as file_id, file.access_policy, file.folder_id,
        coalesce(catalog.name, folder.name) as folder_name,
        project.id as project_id, project.name as project_name, project.status as project_status,
        uploader.id as uploader_id, concat_ws(' ', uploader.first_name, uploader.last_name) as uploader_name,
        concat_ws(' ', reviewer.first_name, reviewer.last_name) as reviewer_name,
        ${sortDefinition.cursorSql} as cursor_value
      from public.file_versions version
      inner join public.files file on file.id = version.file_id
      inner join public.projects project on project.id = file.project_id and project.deleted_at is null
      left join public.project_folders folder on folder.id = file.folder_id
      left join unnest($9::text[], $10::text[]) as catalog(key, name) on catalog.key = folder.system_key
      left join public.users uploader on uploader.id = version.uploaded_by
      left join public.users reviewer on reviewer.id = version.reviewed_by
      where ${ACTIVE_FILE_SQL}
        and version.deleted_at is null
        and ${FILE_MANAGER_TAB_SQL[tab]}
        and ($1::bigint is null or file.project_id = $1::bigint)
        and ($2::bigint is null or file.folder_id in (select id from scope_folders))
        and ($4::text is null or coalesce(version.original_name, file.title) ilike $4)
        and (cardinality($5::text[]) = 0 or lower(version.file_extension) = any($5::text[]))
        and ($6::text is null or (${sortDefinition.sql}, version.id) ${comparison} ($6::${sortDefinition.cast}, $7::bigint))
      order by ${sortDefinition.sql} ${order}, version.id ${order}
      limit $8
    `,
    [
      projectId, folderId, includeSubfolders, search ? toContainsPattern(search) : null, extensions,
      cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1, keys, names,
    ],
  );
  return result.rows;
}
