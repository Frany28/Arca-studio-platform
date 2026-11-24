import { query } from "../config/db.js";

// Versiones y revisión de archivos de proyecto (Fase 1.2, B4). Solo PostgreSQL, con consultas
// parametrizadas. Las reglas viven en domain/projectFileReview.js y domain/projectFileAccess.js; el
// orden y la coordinación con el almacenamiento, en services/projectFileVersionService.js.
// Requiere la migración 20261118120000_project_file_review_audience_expand. Nunca borra ni retira
// versiones ni objetos (regla de conservación).

const poolExecutor = { query };

const FILE_CONTEXT_SQL = `
  select
    f.id, f.project_id, f.uploaded_by, f.status, f.deleted_at, f.access_policy, f.file_type,
    f.title, f.current_version,
    p.status as project_status, p.archived_from_status, p.client_id, p.assigned_architect_id, p.is_public,
    exists (
      select 1 from public.project_assignees assignment
      where assignment.project_id = p.id and assignment.user_id = $3
    ) as is_assignee
  from public.files f
  inner join public.projects p on p.id = f.project_id
  where f.id = $1
    and f.project_id = $2
    and p.deleted_at is null
`;

const VERSION_COLUMNS = `
  v.id, v.file_id, v.version_number, v.file_name, v.original_name, v.file_url, v.file_extension,
  v.file_size, v.is_current, v.created_at, v.uploaded_by, v.content_type, v.review_status,
  v.reviewed_by, v.reviewed_at, v.review_reason, v.restored_from_version_id, v.change_note, v.deleted_at
`;

/**
 * Convierte la fila de contexto en el archivo y el proyecto que usan las reglas del dominio.
 * El proyecto incluye si el usuario consultado es responsable asignado (`isAssignee`).
 *
 * @param {object} row - Fila de `FILE_CONTEXT_SQL`.
 * @returns {{ file: object, project: object }} Archivo y proyecto.
 */
function toFileContext(row) {
  return {
    file: {
      accessPolicy: row.access_policy === null ? null : Number(row.access_policy),
      currentVersion: row.current_version === null ? null : Number(row.current_version),
      deletedAt: row.deleted_at,
      fileType: row.file_type,
      id: Number(row.id),
      projectId: Number(row.project_id),
      status: row.status,
      title: row.title,
      uploadedBy: Number(row.uploaded_by),
    },
    project: {
      archivedFromStatus: row.archived_from_status,
      assignedArchitectId: row.assigned_architect_id === null ? null : Number(row.assigned_architect_id),
      clientId: Number(row.client_id),
      id: Number(row.project_id),
      isAssignee: row.is_assignee === true,
      isPublic: row.is_public === true,
      status: row.project_status,
    },
  };
}

/**
 * Convierte una fila de versión en la representación del dominio y del servicio.
 * `storageKey` es la clave del objeto (`file_name`), que una restauración reutiliza.
 *
 * @param {object} row - Fila con `VERSION_COLUMNS` y, opcionalmente, nombres de autor y revisor.
 * @returns {object} Versión.
 */
function toVersion(row) {
  return {
    changeNote: row.change_note ?? null,
    contentType: row.content_type ?? null,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    extension: row.file_extension,
    fileId: Number(row.file_id),
    fileUrl: row.file_url,
    id: Number(row.id),
    isCurrent: row.is_current === true,
    originalName: row.original_name,
    restoredFromVersionId: row.restored_from_version_id === null ? null : Number(row.restored_from_version_id),
    reviewReason: row.review_reason ?? null,
    reviewStatus: row.review_status ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewedBy: row.reviewed_by === null || row.reviewed_by === undefined ? null : Number(row.reviewed_by),
    reviewerName: row.reviewer_name ?? null,
    size: Number(row.file_size),
    storageKey: row.file_name,
    uploadedBy: Number(row.uploaded_by),
    uploaderName: row.uploader_name ?? null,
    versionNumber: Number(row.version_number),
  };
}

/**
 * Lee un archivo de proyecto con los datos de su proyecto necesarios para decidir acceso y estado.
 * Con `lock`, bloquea la fila del proyecto (FOR SHARE) y después la del archivo (FOR UPDATE) para
 * serializar versiones, revisiones y audiencias frente a cambios de estado y a los comentarios.
 * El orden importa (B6): crear un comentario bloquea el proyecto FOR UPDATE y, al insertar, su clave
 * foránea toma FOR KEY SHARE sobre el archivo. Si aquí se tomara antes el archivo, ambos caminos se
 * esperarían en ciclo (40P01). Proyecto → archivo es el orden único de todas estas escrituras.
 *
 * @param {{ fileId: number, projectId: number, userId: number, lock?: boolean }} options - Archivo, proyecto y usuario.
 * @param {{ query: Function }} [executor] - Cliente de la transacción (obligatorio con `lock`).
 * @returns {Promise<{ file: object, project: object }|null>} Contexto o null si no existe.
 */
export async function findProjectFileContext({ fileId, lock = false, projectId, userId }, executor = poolExecutor) {
  if (lock) await executor.query("select id from public.projects where id = $1 for share", [projectId]);
  const sql = lock ? `${FILE_CONTEXT_SQL} for update of f for share of p` : FILE_CONTEXT_SQL;
  const result = await executor.query(sql, [fileId, projectId, userId]);
  return result.rows[0] ? toFileContext(result.rows[0]) : null;
}

/**
 * Lista todas las versiones de un archivo, de la más reciente a la más antigua, con los nombres de
 * su autor y su revisor. Incluye las rechazadas y las retiradas heredadas: la numeración y el
 * historial completo dependen de ellas.
 *
 * @param {number} fileId - Archivo.
 * @param {{ query: Function }} [executor] - Pool o cliente de transacción.
 * @returns {Promise<object[]>} Versiones.
 */
export async function listFileVersions(fileId, executor = poolExecutor) {
  const result = await executor.query(
    `
      select ${VERSION_COLUMNS},
        nullif(concat_ws(' ', uploader.first_name, uploader.last_name), '') as uploader_name,
        nullif(concat_ws(' ', reviewer.first_name, reviewer.last_name), '') as reviewer_name
      from public.file_versions v
      left join public.users uploader on uploader.id = v.uploaded_by
      left join public.users reviewer on reviewer.id = v.reviewed_by
      where v.file_id = $1
      order by v.version_number desc, v.id desc
    `,
    [fileId],
  );
  return result.rows.map(toVersion);
}

/**
 * Lee las autorizaciones de audiencia activas de un archivo (versión compartida con el cliente y
 * versiones autorizadas en el escaparate). B4 no las crea; las respeta al servir versiones.
 *
 * @param {number} fileId - Archivo.
 * @param {{ query: Function }} [executor] - Pool o cliente.
 * @returns {Promise<{ clientVersionId: number|null, showcaseVersionIds: number[] }>} Autorizaciones activas.
 */
export async function findActiveAudienceGrants(fileId, executor = poolExecutor) {
  const result = await executor.query(
    `select audience::text as audience, file_version_id from public.project_file_audience_grants
     where file_id = $1 and ended_at is null`,
    [fileId],
  );
  const client = result.rows.find((row) => row.audience === "client_owner");
  return {
    clientVersionId: client ? Number(client.file_version_id) : null,
    showcaseVersionIds: result.rows.filter((row) => row.audience === "showcase").map((row) => Number(row.file_version_id)),
  };
}

/**
 * Inserta una versión nueva pendiente de revisión (reemplazo o restauración). Nunca es vigente al
 * nacer (`is_current = false`); una restauración repite la clave del objeto de su origen.
 *
 * @param {{ query: Function }} client - Cliente de la transacción con el archivo bloqueado.
 * @param {object} version - Datos de la versión.
 * @param {number} version.fileId - Archivo.
 * @param {number} version.uploadedBy - Usuario que la crea.
 * @param {number} version.versionNumber - Número planificado por el dominio.
 * @param {string} version.storageKey - Clave del objeto (nueva o reutilizada).
 * @param {string} version.originalName - Nombre normalizado del objeto.
 * @param {string} version.fileUrl - URL derivada de la clave.
 * @param {string} version.extension - Extensión.
 * @param {number} version.size - Tamaño en bytes.
 * @param {string|null} version.contentType - Formato de esta versión.
 * @param {string} version.changeNote - Motivo del cambio.
 * @param {number|null} version.restoredFromVersionId - Versión de origen de una restauración.
 * @returns {Promise<object>} Versión creada.
 */
export async function insertPendingFileVersion(client, version) {
  const result = await client.query(
    `
      insert into public.file_versions (
        file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension,
        file_size, is_current, content_type, review_status, change_note, restored_from_version_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, 'pending', $10, $11)
      returning ${VERSION_COLUMNS.replaceAll("v.", "")}
    `,
    [
      version.fileId,
      version.uploadedBy,
      version.versionNumber,
      version.storageKey,
      version.originalName,
      version.fileUrl,
      version.extension,
      version.size,
      version.contentType,
      version.changeNote,
      version.restoredFromVersionId,
    ],
  );
  await client.query("update public.files set updated_at = now() where id = $1", [version.fileId]);
  return toVersion(result.rows[0]);
}

/**
 * Registra la aprobación de una versión pendiente y la convierte en la vigente del archivo: la
 * anterior deja de ser `is_current` antes de marcar la nueva (índice único de la vigente) y
 * `files.current_version` pasa a su número. No toca autorizaciones de audiencia.
 *
 * @param {{ query: Function }} client - Cliente de la transacción con el archivo bloqueado.
 * @param {{ fileId: number, versionId: number, reviewerId: number }} review - Versión y revisor.
 * @returns {Promise<object|null>} Versión aprobada o null si ya no estaba pendiente.
 */
export async function approvePendingFileVersion(client, { fileId, reviewerId, versionId }) {
  const approved = await client.query(
    `update public.file_versions
     set review_status = 'approved', reviewed_by = $3, reviewed_at = now()
     where id = $1 and file_id = $2 and review_status = 'pending' and deleted_at is null
     returning ${VERSION_COLUMNS.replaceAll("v.", "")}`,
    [versionId, fileId, reviewerId],
  );
  if (!approved.rows[0]) return null;
  await client.query(
    "update public.file_versions set is_current = false where file_id = $1 and is_current = true and id <> $2",
    [fileId, versionId],
  );
  await client.query("update public.file_versions set is_current = true where id = $1", [versionId]);
  await client.query(
    "update public.files set current_version = $2, updated_at = now() where id = $1",
    [fileId, Number(approved.rows[0].version_number)],
  );
  return toVersion({ ...approved.rows[0], is_current: true });
}

/**
 * Registra el rechazo de una versión pendiente con su motivo. La versión vigente no cambia y la
 * rechazada se conserva con su objeto.
 *
 * @param {{ query: Function }} client - Cliente de la transacción con el archivo bloqueado.
 * @param {{ fileId: number, versionId: number, reviewerId: number, reason: string }} review - Versión, revisor y motivo.
 * @returns {Promise<object|null>} Versión rechazada o null si ya no estaba pendiente.
 */
export async function rejectPendingFileVersion(client, { fileId, reason, reviewerId, versionId }) {
  const result = await client.query(
    `update public.file_versions
     set review_status = 'rejected', reviewed_by = $3, reviewed_at = now(), review_reason = $4
     where id = $1 and file_id = $2 and review_status = 'pending' and deleted_at is null
     returning ${VERSION_COLUMNS.replaceAll("v.", "")}`,
    [versionId, fileId, reviewerId, reason],
  );
  if (!result.rows[0]) return null;
  await client.query("update public.files set updated_at = now() where id = $1", [fileId]);
  return toVersion(result.rows[0]);
}

/**
 * Notifica a quien subió una versión que el administrador la aprobó o rechazó. Se inserta en la misma
 * transacción que la decisión: como la transición desde `pending` ocurre una sola vez (bloqueo y
 * actualización condicional), nunca se duplica. Solo se notifica a un usuario activo distinto del revisor.
 *
 * @param {{ query: Function }} client - Cliente de la transacción de la revisión.
 * @param {object} notification - Destinatario, autor, proyecto, versión, textos y tipo.
 * @param {number} notification.userId - Usuario que subió la versión.
 * @param {number} notification.createdBy - Administrador que decidió.
 * @param {number} notification.projectId - Proyecto.
 * @param {number} notification.versionId - Versión revisada.
 * @param {string} notification.title - Título (≤150).
 * @param {string} notification.message - Mensaje.
 * @param {string} notification.type - Tipo estable (`project_file.version_approved` o `_rejected`).
 * @returns {Promise<boolean>} true si se registró.
 */
export async function insertFileReviewNotification(client, { createdBy, message, projectId, title, type, userId, versionId }) {
  const result = await client.query(
    `insert into public.notifications (user_id, project_id, created_by, title, message, type, entity_type, entity_id)
     select u.id, $2, $3, $4, $5, $6, 'file_version', $7
     from public.users u
     where u.id = $1 and u.id <> $3 and u.deleted_at is null and u.status = 'active'`,
    [userId, projectId, createdBy, title, message, type, versionId],
  );
  return result.rowCount === 1;
}
