import { query } from "../config/db.js";
import { buildVisibleFileVersionSql } from "../utils/projectFileAudienceSql.js";

// Garantías y sus documentos (Fase 1.2, B8): consultas de PostgreSQL. Las escrituras se llaman dentro
// de una transacción con el proyecto ya bloqueado (FOR UPDATE), el mismo orden (proyecto → archivo)
// que las demás escrituras de archivos, así que guardar garantías, vincular, desvincular y mover
// archivos se serializan por proyecto.
//
// Vínculo activo: fila de project_warranty_documents con `unlinked_at` NULL cuya garantía sigue vigente
// (`deleted_at` NULL). Una fila cerrada (`unlinked_at`) es un vínculo deshecho; una fila abierta de una
// garantía retirada es evidencia de lo que respaldaba al retirarse. Ninguna se borra.

const ACTIVE_LINK_SQL = `link.unlinked_at is null and exists (
  select 1 from public.project_warranties active_warranty
  where active_warranty.id = link.warranty_id and active_warranty.deleted_at is null)`;

/**
 * Lee las garantías vigentes del proyecto bloqueado, bloqueando también sus filas.
 * Solo usa columnas anteriores a la Fase 1.2: sirve también con la revisión apagada.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {number} projectId - Proyecto.
 * @returns {Promise<Array<{ id: number }>>} Garantías vigentes.
 */
export async function lockActiveWarranties(client, projectId) {
  const result = await client.query(
    "select id from public.project_warranties where project_id = $1 and deleted_at is null order by id for update",
    [projectId],
  );
  return result.rows.map((row) => ({ id: Number(row.id) }));
}

/**
 * Cuenta los vínculos activos de varias garantías (requiere la migración de B3).
 *
 * @param {import("pg").PoolClient|{ query: Function }} executor - Cliente o pool.
 * @param {number[]} warrantyIds - Garantías.
 * @returns {Promise<Map<number, number>>} Garantía → vínculos activos.
 */
export async function countActiveLinksByWarranty(executor, warrantyIds) {
  if (!warrantyIds.length) return new Map();
  const result = await executor.query(
    `select link.warranty_id, count(*)::int as total from public.project_warranty_documents link
     where link.warranty_id = any($1::bigint[]) and ${ACTIVE_LINK_SQL} group by link.warranty_id`,
    [warrantyIds],
  );
  return new Map(result.rows.map((row) => [Number(row.warranty_id), row.total]));
}

/**
 * Actualiza una garantía vigente por id; solo toca la fila (y `updated_at`) si algo cambió.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{ projectId: number, warranty: object }} options - Garantía validada con `id` y `sortOrder`.
 * @returns {Promise<void>}
 */
export async function updateWarranty(client, { projectId, warranty }) {
  await client.query(
    `update public.project_warranties
     set product = $3, model = $4, code = $5, start_date = $6, service_date = $7, end_date = $8, sort_order = $9, updated_at = now()
     where id = $1 and project_id = $2 and deleted_at is null
       and (product, model, code, start_date, service_date, end_date, sort_order)
         is distinct from ($3, $4, $5, $6::date, $7::date, $8::date, $9::int)`,
    [warranty.id, projectId, warranty.product, warranty.model, warranty.code, warranty.startDate, warranty.serviceDate, warranty.endDate, warranty.sortOrder],
  );
}

/**
 * Inserta una garantía nueva del proyecto.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{ projectId: number, createdBy: number, warranty: object }} options - Garantía validada con `sortOrder`.
 * @returns {Promise<number>} Id asignado.
 */
export async function insertWarranty(client, { createdBy, projectId, warranty }) {
  const result = await client.query(
    `insert into public.project_warranties (project_id, product, model, code, start_date, service_date, end_date, sort_order, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [projectId, warranty.product, warranty.model, warranty.code, warranty.startDate, warranty.serviceDate, warranty.endDate, warranty.sortOrder, createdBy],
  );
  return Number(result.rows[0].id);
}

/**
 * Retira garantías vigentes (borrado lógico). Conserva la fila y no toca sus vínculos ni archivos.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{ projectId: number, ids: number[] }} options - Garantías a retirar.
 * @returns {Promise<void>}
 */
export async function retireWarranties(client, { ids, projectId }) {
  if (!ids.length) return;
  await client.query(
    "update public.project_warranties set deleted_at = now(), updated_at = now() where project_id = $1 and id = any($2::bigint[]) and deleted_at is null",
    [projectId, ids],
  );
}

/**
 * Busca una garantía del proyecto (vigente o retirada) para vincular o desvincular documentos.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{ projectId: number, warrantyId: number }} options - Garantía.
 * @returns {Promise<{ id: number, projectId: number, retired: boolean }|null>} Garantía o null.
 */
export async function findProjectWarranty(client, { projectId, warrantyId }) {
  const result = await client.query(
    "select id, project_id, deleted_at is not null as retired from public.project_warranties where id = $1 and project_id = $2",
    [warrantyId, projectId],
  );
  const row = result.rows[0];
  return row ? { id: Number(row.id), projectId: Number(row.project_id), retired: row.retired } : null;
}

/**
 * Lee un archivo del proyecto con su estado y su carpeta, bloqueando su fila para el vínculo.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{ projectId: number, fileId: number }} options - Archivo.
 * @returns {Promise<{ id: number, projectId: number, status: string, folderId: number|null }|null>} Archivo o null.
 */
export async function lockProjectFileForLink(client, { fileId, projectId }) {
  const result = await client.query(
    `select id, project_id, case when deleted_at is not null then 'deleted' else status::text end as status, folder_id
     from public.files where id = $1 and project_id = $2 for update`,
    [fileId, projectId],
  );
  const row = result.rows[0];
  return row ? { folderId: row.folder_id === null ? null : Number(row.folder_id), id: Number(row.id), projectId: Number(row.project_id), status: row.status } : null;
}

/**
 * Devuelve la cadena de carpetas desde la raíz hasta la indicada, con su clave funcional, para decidir
 * si una ubicación está dentro de «Documentos › Garantías». Sin carpeta, la cadena es vacía.
 *
 * @param {import("pg").PoolClient|{ query: Function }} executor - Cliente o pool.
 * @param {number|null} folderId - Carpeta.
 * @returns {Promise<Array<{ id: number, systemKey: string|null }>>} Cadena raíz → carpeta.
 */
export async function listFolderChain(executor, folderId) {
  if (!folderId) return [];
  const result = await executor.query(
    `with recursive chain as (
       select id, parent_id, system_key, 0 as depth from public.project_folders where id = $1
       union all
       select parent.id, parent.parent_id, parent.system_key, chain.depth + 1
       from public.project_folders parent inner join chain on parent.id = chain.parent_id
       where chain.depth < 64
     )
     select id, system_key from chain order by depth desc`,
    [folderId],
  );
  return result.rows.map((row) => ({ id: Number(row.id), systemKey: row.system_key ?? null }));
}

/**
 * Lista las garantías vigentes con vínculo activo con un archivo.
 *
 * @param {import("pg").PoolClient|{ query: Function }} executor - Cliente o pool.
 * @param {number} fileId - Archivo.
 * @returns {Promise<number[]>} Ids de garantías.
 */
export async function listActiveWarrantyIdsForFile(executor, fileId) {
  const result = await executor.query(
    `select link.warranty_id from public.project_warranty_documents link where link.file_id = $1 and ${ACTIVE_LINK_SQL}`,
    [fileId],
  );
  return result.rows.map((row) => Number(row.warranty_id));
}

/**
 * Crea el vínculo activo entre una garantía y un documento del mismo proyecto. Las claves compuestas
 * impiden mezclar proyectos y el índice parcial único impide dos vínculos activos iguales.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{ projectId: number, warrantyId: number, fileId: number, linkedBy: number }} options - Vínculo.
 * @returns {Promise<{ id: number, linkedAt: Date }>} Vínculo creado.
 */
export async function insertWarrantyDocumentLink(client, { fileId, linkedBy, projectId, warrantyId }) {
  const result = await client.query(
    `insert into public.project_warranty_documents (project_id, warranty_id, file_id, linked_by, linked_at)
     values ($1, $2, $3, $4, clock_timestamp()) returning id, linked_at`,
    [projectId, warrantyId, fileId, linkedBy],
  );
  return { id: Number(result.rows[0].id), linkedAt: result.rows[0].linked_at };
}

/**
 * Cierra el vínculo abierto entre una garantía y un documento. Conserva la fila como historial.
 *
 * @param {import("pg").PoolClient} client - Cliente de la transacción.
 * @param {{ projectId: number, warrantyId: number, fileId: number, unlinkedBy: number }} options - Vínculo.
 * @returns {Promise<{ id: number }|null>} Vínculo cerrado o null si no había uno abierto.
 */
export async function closeWarrantyDocumentLink(client, { fileId, projectId, unlinkedBy, warrantyId }) {
  const result = await client.query(
    `update public.project_warranty_documents
     set unlinked_at = greatest(clock_timestamp(), linked_at), unlinked_by = $4
     where project_id = $1 and warranty_id = $2 and file_id = $3 and unlinked_at is null
     returning id`,
    [projectId, warrantyId, fileId, unlinkedBy],
  );
  return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
}

/**
 * Lee las garantías vigentes de un proyecto y, para cada una, sus documentos con vínculo abierto en la
 * versión que el usuario puede ver según la política común (utils/projectFileAudienceSql.js): equipo,
 * la vigente; cliente propietario, la autorizada para él o una suya; heredados, la vigente. Un
 * documento sin versión visible para el usuario no aparece (sin revelar por qué).
 *
 * @param {{ projectId: number, user: object }} options - Proyecto y usuario con acceso directo.
 * @returns {Promise<{ warranties: object[], documents: object[] }>} Filas de garantías y documentos.
 */
export async function listWarrantiesWithVisibleDocuments({ projectId, user }) {
  const audience = buildVisibleFileVersionSql({ enabled: true, firstParam: 2, user });
  const [warranties, documents] = await Promise.all([
    query(
      `select id, product, model, code, to_char(start_date, 'YYYY-MM-DD') as start_date,
         to_char(service_date, 'YYYY-MM-DD') as service_date, to_char(end_date, 'YYYY-MM-DD') as end_date
       from public.project_warranties where project_id = $1 and deleted_at is null order by sort_order, id`,
      [projectId],
    ),
    query(
      `select link.warranty_id, link.linked_at, file.id as file_id, version.id as version_id, version.version_number,
         coalesce(version.original_name, file.title) as name, version.file_extension, version.file_size,
         ${audience.fileTypeSql} as content_type
       from public.project_warranty_documents link
       inner join public.project_warranties warranty on warranty.id = link.warranty_id and warranty.deleted_at is null
       inner join public.files file on file.id = link.file_id and file.project_id = link.project_id
       inner join public.projects p on p.id = file.project_id
       ${audience.join}
       where link.project_id = $1 and link.unlinked_at is null
         and file.deleted_at is null and file.status <> 'deleted'
         and ${audience.requireVersion}
       order by link.warranty_id, link.linked_at, file.id`,
      [projectId, ...audience.params],
    ),
  ]);
  return { documents: documents.rows, warranties: warranties.rows };
}
