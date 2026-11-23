import { query } from "../config/db.js";
import { PROJECT_SYSTEM_FOLDERS, QUOTE_DOCUMENTS_FOLDER_KEY } from "../domain/projectFolderCatalog.js";
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

// Ordenaciones admitidas sobre la fila unificada (`item`): expresión, tipo para comparar con el cursor
// y expresión del cursor. Desempate: origen (`source_rank`: 0 archivos, 1 cotizaciones) e id.
const SORTS = Object.freeze({
  date: { cast: "timestamptz", cursorSql: preciseCursorTimestampSql("item.created_at"), sql: "item.created_at" },
  name: { cast: "text", cursorSql: "lower(item.name)", sql: "lower(item.name)" },
  size: { cast: "bigint", cursorSql: "coalesce(item.file_size, 0)::text", sql: "coalesce(item.file_size, 0)" },
});

/**
 * Subconsulta con la carpeta lógica de las cotizaciones de un proyecto: «Documentos › Cotizaciones» o,
 * si el proyecto aún no se sincronizó con el catálogo ampliado, «Documentos». El PDF sigue en su bucket
 * privado; toda consulta que ubique cotizaciones usa esta misma regla (domain/documentClassification.js).
 *
 * @param {string} projectSql - Expresión SQL con el proyecto de la versión vigente.
 * @param {string} keyParam - Parámetro SQL con QUOTE_DOCUMENTS_FOLDER_KEY (p. ej. `$11`).
 * @returns {string} Fragmento `(select folder.id, folder.name, folder.system_key ...)`.
 */
function quoteFolderSql(projectSql, keyParam) {
  // Alias propio (`quote_target`): con `folder` sombrearía la carpeta de la consulta exterior y
  // `projectSql` (p. ej. `folder.project_id`) se compararía consigo mismo.
  return `(
    select quote_target.id, quote_target.name, quote_target.system_key
    from public.project_folders quote_target
    where quote_target.project_id = ${projectSql} and quote_target.deleted_at is null
      and quote_target.system_key in (${keyParam}::text, 'documents')
    order by (quote_target.system_key = ${keyParam}::text) desc, quote_target.id
    limit 1
  )`;
}

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
 * - archivos: archivos vigentes (no versiones) más las cotizaciones (una por cotización) del ámbito;
 * - espacio usado: suma de los objetos almacenados distintos de sus versiones no retiradas; un objeto
 *   reutilizado por restauraciones (misma clave) cuenta una sola vez; incluye los PDF de cotizaciones
 *   disponibles de todas sus versiones (bucket privado), sin consultar el almacenamiento;
 * - última carga: la versión más reciente con objeto propio (las restauraciones no son cargas; los PDF
 *   generados por Cotizaciones tampoco).
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
      ),
      -- Cotizaciones del ámbito (una por cotización, en su carpeta lógica) y sus PDF almacenados.
      scoped_quotes as (
        select quote_version.quote_id
        from public.quote_versions quote_version
        inner join public.projects project on project.id = quote_version.project_id and project.deleted_at is null
        left join lateral ${quoteFolderSql("quote_version.project_id", "$3")} quote_folder on true
        where quote_version.is_current
          and ($1::bigint is null or quote_version.project_id = $1::bigint)
          and ($2::bigint is null or quote_folder.id in (select id from scope_folders))
      ),
      quote_objects as (
        select doc.size_bytes
        from public.quote_pdf_documents doc
        inner join public.quote_versions version on version.id = doc.quote_version_id
        where doc.status = 'available' and version.quote_id in (select quote_id from scoped_quotes)
      )
      select
        ((select count(*) from scoped_files) + (select count(*) from scoped_quotes))::bigint as total_files,
        ((select coalesce(sum(object_size), 0) from stored_objects) + (select coalesce(sum(size_bytes), 0) from quote_objects))::bigint as used_bytes,
        ((select count(*) from stored_objects) + (select count(*) from quote_objects))::bigint as object_count,
        (select max(created_at) from scoped_versions where restored_from_version_id is null) as last_upload_at
    `,
    [projectId, folderId, QUOTE_DOCUMENTS_FOLDER_KEY],
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
 * archivos (incluidas sus cotizaciones). La búsqueda opcional compara el nombre del proyecto o del cliente.
 *
 * @param {{ cursor: [string, string]|null, limit: number, search?: string|null }} options - Página y búsqueda.
 * @returns {Promise<Array<object>>} Hasta `limit + 1` filas.
 */
export async function listFileManagerProjects({ cursor, limit, search = null }) {
  const result = await query(
    `
      select project.id, project.name, project.status, client.name as client_name, lower(project.name) as sort_name,
        ((select count(*) from public.files file where file.project_id = project.id and ${ACTIVE_FILE_SQL})
          + (select count(*) from public.quote_versions quote_version where quote_version.project_id = project.id and quote_version.is_current))::bigint as file_count
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
 * Lee las carpetas vigentes de varios proyectos con su nombre visible y su número de archivos directos
 * (en la carpeta lógica de las cotizaciones, también sus cotizaciones).
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
        ((select count(*) from public.files file where file.folder_id = folder.id and ${ACTIVE_FILE_SQL})
          + (select count(*) from public.quote_versions quote_version
             where quote_version.project_id = folder.project_id and quote_version.is_current
               and folder.id = (select quote_folder.id from ${quoteFolderSql("folder.project_id", "$4")} quote_folder)))::bigint as file_count
      from public.project_folders folder
      left join unnest($2::text[], $3::text[]) as catalog(key, name) on catalog.key = folder.system_key
      where folder.project_id = any($1::bigint[]) and folder.deleted_at is null
    `,
    [projectIds, keys, names, QUOTE_DOCUMENTS_FOLDER_KEY],
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
 * ordenación, el origen y el id de la fila como desempate.
 *
 * En Aprobados se incluyen, además, los PDF de cotizaciones (`source = 'quote'`): uno por cotización,
 * el de su versión comercial vigente, en «Documentos › Cotizaciones» del proyecto de esa versión (o en
 * «Documentos» si el proyecto aún no se sincronizó con el catálogo ampliado). No se
 * copian a `files`: se leen de `quote_versions` y `quote_pdf_documents`, con su estado (`pending`,
 * `available` o `error`; sin fila, la versión es anterior a la persistencia y se recupera al abrirla).
 * Las cotizaciones no pasan por revisión, por eso no aparecen en Pendientes ni Rechazados.
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
 * @param {[string, number, string]|null} options.cursor - Valor de ordenación, origen e id de la última fila.
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
      select item.*, ${sortDefinition.cursorSql} as cursor_value
      from (
        select
          'file'::text as source, 0 as source_rank,
          version.id as version_id, version.version_number, version.file_extension, version.file_size, version.created_at,
          version.review_status::text as review_status, version.review_reason, version.reviewed_at, version.restored_from_version_id,
          coalesce(version.content_type, file.file_type) as content_type,
          coalesce(version.original_name, file.title) as name,
          (version.version_number = file.current_version) as is_current,
          file.id as file_id, file.access_policy, file.folder_id, file.file_category::text as file_category,
          coalesce(catalog.name, folder.name) as folder_name, classification.system_key as folder_classification_key,
          project.id as project_id, project.name as project_name, project.status as project_status,
          uploader.id as uploader_id, concat_ws(' ', uploader.first_name, uploader.last_name) as uploader_name,
          concat_ws(' ', reviewer.first_name, reviewer.last_name) as reviewer_name,
          null::bigint as quote_id, null::text as quote_code, null::text as pdf_status, null::text as pdf_error_code
        from public.file_versions version
        inner join public.files file on file.id = version.file_id
        inner join public.projects project on project.id = file.project_id and project.deleted_at is null
        left join public.project_folders folder on folder.id = file.folder_id
        left join unnest($9::text[], $10::text[]) as catalog(key, name) on catalog.key = folder.system_key
        -- Carpeta predeterminada más cercana (la propia o un ancestro): define la sección funcional.
        left join lateral (
          with recursive chain as (
            select ancestor.id, ancestor.parent_id, ancestor.system_key, 0 as depth
            from public.project_folders ancestor where ancestor.id = file.folder_id
            union all
            select parent.id, parent.parent_id, parent.system_key, chain.depth + 1
            from public.project_folders parent inner join chain on parent.id = chain.parent_id
            where chain.depth < 64
          )
          select chain.system_key from chain where chain.system_key is not null order by chain.depth limit 1
        ) classification on true
        left join public.users uploader on uploader.id = version.uploaded_by
        left join public.users reviewer on reviewer.id = version.reviewed_by
        where ${ACTIVE_FILE_SQL}
          and version.deleted_at is null
          and ${FILE_MANAGER_TAB_SQL[tab]}

        union all

        -- PDF de cotizaciones (solo en Aprobados): versión comercial vigente de cada cotización.
        select
          'quote'::text as source, 1 as source_rank,
          quote_version.id as version_id, quote_version.version_number, 'pdf'::text as file_extension,
          case when doc.status = 'available' then doc.size_bytes::bigint end as file_size, quote_version.created_at,
          null::text as review_status, null::text as review_reason, null::timestamptz as reviewed_at, null::bigint as restored_from_version_id,
          'application/pdf'::text as content_type,
          coalesce(doc.file_name, quote.code || '-v' || quote_version.version_number || '.pdf') as name,
          true as is_current,
          null::bigint as file_id, null::smallint as access_policy, quote_folder.id as folder_id, null::text as file_category,
          coalesce(quote_catalog.name, quote_folder.name) as folder_name, quote_folder.system_key as folder_classification_key,
          project.id as project_id, project.name as project_name, project.status as project_status,
          author.id as uploader_id, concat_ws(' ', author.first_name, author.last_name) as uploader_name,
          null::text as reviewer_name,
          quote.id as quote_id, quote.code as quote_code, coalesce(doc.status::text, 'pending') as pdf_status, doc.error_code as pdf_error_code
        from public.quote_versions quote_version
        inner join public.quotes quote on quote.id = quote_version.quote_id
        inner join public.projects project on project.id = quote_version.project_id and project.deleted_at is null
        left join public.quote_pdf_documents doc on doc.quote_version_id = quote_version.id
        left join lateral ${quoteFolderSql("quote_version.project_id", "$11")} quote_folder on true
        left join unnest($9::text[], $10::text[]) as quote_catalog(key, name) on quote_catalog.key = quote_folder.system_key
        left join public.users author on author.id = quote_version.created_by
        where $12::boolean and quote_version.is_current
      ) item
      where ($1::bigint is null or item.project_id = $1::bigint)
        and ($2::bigint is null or item.folder_id in (select id from scope_folders))
        and ($4::text is null or item.name ilike $4)
        and (cardinality($5::text[]) = 0 or lower(item.file_extension) = any($5::text[]))
        and ($6::text is null or (${sortDefinition.sql}, item.source_rank, item.version_id) ${comparison} ($6::${sortDefinition.cast}, $13::int, $7::bigint))
      order by ${sortDefinition.sql} ${order}, item.source_rank ${order}, item.version_id ${order}
      limit $8
    `,
    [
      projectId, folderId, includeSubfolders, search ? toContainsPattern(search) : null, extensions,
      cursor?.[0] ?? null, cursor?.[2] ?? null, limit + 1, keys, names,
      QUOTE_DOCUMENTS_FOLDER_KEY, tab === "approved", cursor?.[1] ?? 0,
    ],
  );
  return result.rows;
}

/**
 * Lee el destino de una subida del administrador: la carpeta del proyecto (no retirada), su clave
 * propia, la clave de la carpeta predeterminada más cercana (la propia o un ancestro, que decide su
 * sección) y cuántos archivos activos contiene. Con `executor` de una transacción se lee bajo el
 * bloqueo del proyecto que toma la carga.
 *
 * @param {{ projectId: number, folderId: number }} target - Proyecto y carpeta.
 * @param {{ query: Function }} [executor] - Cliente o pool.
 * @returns {Promise<{ systemKey: string|null, classificationKey: string|null, fileCount: number }|null>}
 *   Destino o null si la carpeta no pertenece al proyecto o fue retirada.
 */
export async function findFolderUploadTarget({ folderId, projectId }, executor = { query }) {
  const result = await executor.query(
    `
      with recursive chain as (
        select folder.id, folder.parent_id, folder.system_key, 0 as depth
        from public.project_folders folder
        where folder.id = $1::bigint and folder.project_id = $2::bigint and folder.deleted_at is null
        union all
        select parent.id, parent.parent_id, parent.system_key, chain.depth + 1
        from public.project_folders parent inner join chain on parent.id = chain.parent_id
        where chain.depth < 64
      )
      select
        (select chain.system_key from chain where chain.depth = 0) as system_key,
        (select chain.system_key from chain where chain.system_key is not null order by chain.depth limit 1) as classification_key,
        (select count(*) from public.files file where file.folder_id = $1::bigint and ${ACTIVE_FILE_SQL})::int as file_count
      where exists (select 1 from chain)
    `,
    [folderId, projectId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { classificationKey: row.classification_key ?? null, fileCount: Number(row.file_count), systemKey: row.system_key ?? null };
}
