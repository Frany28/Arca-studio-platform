import { objectStorage } from "../services/objectStorage.js";

import {
  buildStorageFileUrl,
  buildStorageObjectKey,
  getFileExtension,
  getSupabaseStorageConfig,
  sanitizeStorageFileName,
} from "../config/storage.js";
import { pool, query, withTransaction } from "../config/db.js";
import { getShowcaseFileName } from "../domain/projectPublicView.js";
import { NotFoundError } from "../errors/appError.js";
import { storeThenRecord } from "../services/storedUpload.js";
import { isProjectFinalized, isProjectOperationallyReadOnly } from "../domain/projectStatus.js";

const DEFAULT_FILE_STATUS = "active";

/**
 * Distingue los conflictos operativos de proyectos archivados y finalizados con finished.
 * Conserva el código público de error para las escrituras protegidas por bloqueo PostgreSQL.
 *
 * @param {unknown} status - Valor de `status` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function createProjectReadOnlyError(status) {
  const finalized = isProjectFinalized(status);
  const error = new Error("Read-only project");
  error.code = finalized ? "PROJECT_FINALIZED" : "PROJECT_ARCHIVED";
  error.status = 409;
  error.publicMessage = finalized
    ? "El proyecto finalizado es de solo lectura."
    : "Desarchiva el proyecto antes de realizar cambios.";
  return error;
}

/**
 * Obtiene el tipo funcional del archivo para que el flujo llamador pueda continuar.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} contentType - Valor de `contentType` requerido por esta operación.
 * @param {string} originalName - Valor de `originalName` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function getFileType(contentType, originalName) {
  if (contentType) {
    return String(contentType).split(";")[0].trim().toLowerCase();
  }

  const extension = getFileExtension(originalName);
  return extension || "application/octet-stream";
}

/**
 * Transforma los datos públicos del archivo cargado a la representación pública esperada.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} row - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
function toFileUpload(row) {
  return {
    fileCategory: row.file_category,
    fileSize: Number(row.file_size),
    fileType: row.file_type,
    id: Number(row.id),
    originalName: row.original_name,
  };
}

// Ejecutor por defecto de las consultas que también pueden ejecutarse dentro de una transacción.
const poolExecutor = { query };

/**
 * Crea el error de archivo duplicado con el código que los controladores traducen a 409.
 * Conserva la forma del error anterior para no cambiar el contrato HTTP.
 *
 * @param {"DUPLICATE_PROJECT_FILE"|"DUPLICATE_PROJECT_REQUEST_FILE"} code - Código del duplicado.
 * @returns {Error} Error con el código indicado.
 */
function createDuplicateFileError(code) {
  const error = new Error(code === "DUPLICATE_PROJECT_FILE" ? "Duplicate project file" : "Duplicate project request file");
  error.code = code;
  return error;
}

/**
 * Clasifica el archivo según su tipo MIME para la galería y los documentos.
 * Es la misma regla que aplicaban las cargas antes de reorganizarlas.
 *
 * @param {string} fileType - Tipo MIME normalizado.
 * @returns {"image"|"video"|"document"} Categoría del archivo.
 */
function getFileCategory(fileType) {
  if (fileType.startsWith("image/")) return "image";
  if (fileType.startsWith("video/")) return "video";
  return "document";
}

/**
 * Reserva el identificador del archivo antes de transferirlo, sin abrir transacciones ni bloqueos.
 * La clave del objeto conserva así su formato (incluye el id) y la carga no retiene conexiones.
 * Una reserva sin registro solo deja un hueco en la secuencia.
 *
 * @returns {Promise<number>} Identificador reservado para `public.files`.
 */
async function reserveFileId() {
  const result = await query("select nextval(pg_get_serial_sequence('public.files', 'id')) as id");
  return Number(result.rows[0].id);
}

/**
 * Indica si el archivo con el identificador reservado llegó a registrarse.
 * Decide la compensación: solo se elimina el objeto de una fila que no existe.
 *
 * @param {number} fileId - Identificador reservado.
 * @returns {Promise<boolean>} true si la fila existe.
 */
async function isFileRecorded(fileId) {
  const result = await query("select 1 from public.files where id = $1", [fileId]);
  return result.rows.length > 0;
}

/**
 * Busca el valor de proyecto solicitud for archivo carga y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} projectRequestId - Valor de `projectRequestId` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 */
export async function findProjectRequestForFileUpload(projectRequestId, user) {
  const result = await query(
    `
      select id, client_id, requested_by, status
      from public.project_requests
      where id = $1
        and deleted_at is null
        and status in ('draft', 'changes_requested')
      limit 1
    `,
    [projectRequestId],
  );
  const projectRequest = result.rows[0];

  if (!projectRequest) {
    return null;
  }

  const isOwner =
    Number(projectRequest.requested_by) === Number(user.id) ||
    (user.clientId &&
      Number(projectRequest.client_id) === Number(user.clientId));
  const isAdmin = user.role?.code === "admin";

  return isOwner || isAdmin ? projectRequest : null;
}

/**
 * Obtiene el uso de archivos de la solicitud para que el flujo llamador pueda continuar.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} projectRequestId - Valor de `projectRequestId` requerido por esta operación.
 * @param {{ query: Function }} [executor] - Cliente de una transacción; por defecto, el pool compartido.
 * @returns {Promise<object>} Resultado producido por la operación.
 */
export async function getProjectRequestFileUsage(projectRequestId, executor = poolExecutor) {
  const result = await executor.query(
    `
      select count(*)::integer as file_count, coalesce(sum(fv.file_size), 0)::bigint as total_bytes
      from public.files f
      inner join public.file_versions fv
        on fv.file_id = f.id and fv.is_current = true
      where f.project_request_id = $1
        and f.deleted_at is null
        and f.status <> 'deleted'
    `,
    [projectRequestId],
  );
  return {
    count: Number(result.rows[0]?.file_count || 0),
    totalBytes: Number(result.rows[0]?.total_bytes || 0),
  };
}

/**
 * Busca el archivo existente de la solicitud y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.originalName - Valor de `options.originalName` requerido por esta operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @param {{ query: Function }} [executor] - Cliente de una transacción; por defecto, el pool compartido.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findExistingProjectRequestFile({
  originalName,
  projectRequestId,
  userId,
}, executor = poolExecutor) {
  const result = await executor.query(
    `
      select id, title
      from public.files
      where project_request_id = $1
        and uploaded_by = $2
        and deleted_at is null
        and status <> 'deleted'
        and lower(title) = lower($3)
      limit 1
    `,
    [projectRequestId, userId, String(originalName || "").trim()],
  );

  return result.rows[0] || null;
}

/**
 * Carga el archivo de la solicitud de proyecto coordinando la persistencia y el almacenamiento.
 * Transfiere el objeto sin conexiones abiertas y lo registra en una transacción corta que bloquea la
 * solicitud y repite, ya serializadas, las comprobaciones de estado, duplicado y límites (P0-1).
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {(usage: { count: number, totalBytes: number }) => void} [options.assertWithinLimits] - Comprueba
 *   los límites de la solicitud con el uso leído bajo bloqueo; lanza el error público si se superan.
 * @param {unknown} options.body - Valor de `options.body` requerido por esta operación.
 * @param {string} options.contentType - Valor de `options.contentType` requerido por esta operación.
 * @param {string} options.originalName - Valor de `options.originalName` requerido por esta operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @param {number} options.size - Valor de `options.size` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function uploadProjectRequestFile({
  assertWithinLimits,
  body,
  contentType,
  originalName,
  projectRequestId,
  size,
  user,
}) {
  const storageConfig = getSupabaseStorageConfig();

  if (!storageConfig.bucket) {
    throw new Error("SUPABASE_STORAGE_BUCKET is required");
  }

  const uploadedAt = new Date();
  const versionNumber = 1;
  const safeOriginalName = String(originalName || "archivo").trim();
  const fileType = getFileType(contentType, safeOriginalName);
  const fileExtension = getFileExtension(safeOriginalName);
  const existingFile = await findExistingProjectRequestFile({
    originalName: safeOriginalName,
    projectRequestId,
    userId: user.id,
  });

  if (existingFile) {
    throw createDuplicateFileError("DUPLICATE_PROJECT_REQUEST_FILE");
  }

  const fileId = await reserveFileId();
  const storageKey = buildStorageObjectKey({
    belongsTo: "project-requests",
    fileId,
    originalName: safeOriginalName,
    ownerId: user.id,
    parentId: projectRequestId,
    uploadedAt,
    versionNumber,
  });
  const fileUrl = buildStorageFileUrl(storageKey);

  return storeThenRecord({
    /**
     * Comprueba si la fila del identificador reservado existe antes de compensar.
     * Evita eliminar el objeto de una carga confirmada con resultado incierto.
     *
     * @returns {Promise<boolean>} true si el archivo quedó registrado.
     */
    isRecorded: () => isFileRecorded(fileId),
    key: storageKey,
    scope: "project_request_file",
    /**
     * Transfiere el contenido al almacenamiento sin conexiones de PostgreSQL abiertas.
     * Usa la clave derivada del identificador reservado.
     *
     * @returns {Promise<unknown>} Respuesta del almacenamiento.
     */
    store: () => objectStorage.put({
      body,
      contentLength: size,
      contentType: fileType,
      key: storageKey,
      metadata: {
        belongs_to: "project_request",
        file_id: String(fileId),
        project_request_id: String(projectRequestId),
        uploaded_by: String(user.id),
        uploaded_year: String(uploadedAt.getUTCFullYear()),
      },
    }),
    /**
     * Registra el archivo y su versión en una transacción corta, tras la transferencia.
     * Repite bajo bloqueo las comprobaciones que pudieron cambiar durante la carga.
     *
     * @returns {Promise<object>} Archivo registrado.
     */
    record: () => withTransaction(async (client) => {
      // Mismo bloqueo que el envío de la solicitud: si se envió o eliminó durante la transferencia,
      // el adjunto se rechaza en lugar de añadirse a una solicitud que ya no es editable.
      const requestResult = await client.query(
        `
          select id
          from public.project_requests
          where id = $1
            and deleted_at is null
            and status in ('draft', 'changes_requested')
          for update
        `,
        [projectRequestId],
      );

      if (!requestResult.rows[0]) {
        throw new NotFoundError(
          "PROJECT_REQUEST_NOT_FOUND",
          "No se encontró un borrador disponible para adjuntar archivos.",
        );
      }

      const duplicate = await findExistingProjectRequestFile({
        originalName: safeOriginalName,
        projectRequestId,
        userId: user.id,
      }, client);

      if (duplicate) {
        throw createDuplicateFileError("DUPLICATE_PROJECT_REQUEST_FILE");
      }

      // Con la solicitud bloqueada, dos cargas simultáneas no pueden superar juntas los límites.
      assertWithinLimits?.(await getProjectRequestFileUsage(projectRequestId, client));

      const fileResult = await client.query(
        `
          insert into public.files (
            id,
            project_request_id,
            uploaded_by,
            title,
            file_type,
            file_category,
            current_version,
            status
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::file_status)
          returning id, project_id, project_request_id, uploaded_by, file_type, file_category, current_version
        `,
        [
          fileId,
          projectRequestId,
          user.id,
          safeOriginalName,
          fileType,
          getFileCategory(fileType),
          versionNumber,
          DEFAULT_FILE_STATUS,
        ],
      );
      const versionResult = await client.query(
        `
          insert into public.file_versions (
            file_id,
            uploaded_by,
            version_number,
            file_name,
            original_name,
            file_url,
            file_extension,
            file_size,
            is_current
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, true)
          returning id, version_number, file_name, original_name, file_url, file_size
        `,
        [
          fileId,
          user.id,
          versionNumber,
          storageKey,
          sanitizeStorageFileName(safeOriginalName),
          fileUrl,
          fileExtension,
          size,
        ],
      );
      const version = versionResult.rows[0];

      return toFileUpload({
        ...fileResult.rows[0],
        file_name: version.file_name,
        file_size: version.file_size,
        file_url: version.file_url,
        original_name: version.original_name,
        version_id: version.id,
        version_number: version.version_number,
      });
    }),
  });
}

/**
 * Elimina el archivo de la solicitud de proyecto después de comprobar acceso y existencia.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.fileId - Valor de `options.fileId` requerido por esta operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function deleteProjectRequestFile({
  fileId,
  projectRequestId,
  user,
}) {
  const storageConfig = getSupabaseStorageConfig();
  const client = await pool.connect();
  let storageKeys = [];

  try {
    await client.query("begin");

    const fileResult = await client.query(
      `
        select f.id, f.uploaded_by, f.project_request_id, pr.client_id, pr.requested_by, pr.status
        from public.files f
        inner join public.project_requests pr
          on pr.id = f.project_request_id
        where f.id = $1
          and f.project_request_id = $2
          and f.deleted_at is null
          and f.status <> 'deleted'
          and pr.deleted_at is null
          and pr.status in ('draft', 'changes_requested')
        limit 1
      `,
      [fileId, projectRequestId],
    );
    const file = fileResult.rows[0];

    if (!file) {
      await client.query("rollback");
      return null;
    }

    const isOwner =
      Number(file.requested_by) === Number(user.id) ||
      Number(file.uploaded_by) === Number(user.id) ||
      (user.clientId && Number(file.client_id) === Number(user.clientId));
    const isAdmin = user.role?.code === "admin";

    if (!isOwner && !isAdmin) {
      await client.query("rollback");
      return null;
    }

    const versionsResult = await client.query(
      `
        select file_name
        from public.file_versions
        where file_id = $1
          and deleted_at is null
      `,
      [fileId],
    );
    storageKeys = versionsResult.rows
      .map((row) => row.file_name)
      .filter(Boolean);

    await client.query(
      `
        update public.file_versions
        set deleted_at = now()
        where file_id = $1
          and deleted_at is null
      `,
      [fileId],
    );

    await client.query(
      `
        update public.files
        set status = 'deleted'::file_status,
            deleted_at = now(),
            updated_at = now()
        where id = $1
      `,
      [fileId],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  if (storageConfig.bucket) {
    await Promise.all(
      // objectStorage aplica el plazo del almacenamiento: un borrado colgado no retiene la respuesta.
      storageKeys.map((storageKey) => objectStorage.delete(storageKey).catch(() => {})),
    );
  }

  return { deleted: true, fileId: Number(fileId) };
}

/**
 * Busca el valor de proyecto for archivo carga y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} projectId - Valor de `projectId` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {{ query: Function }} [executor] - Cliente de una transacción; por defecto, el pool compartido.
 * @returns {Promise<object>} Resultado producido por la operación.
 */
export async function findProjectForFileUpload(projectId, user, executor = poolExecutor) {
  const result = await executor.query(
    `
      select
        project.id,
        project.client_id,
        project.assigned_architect_id,
        project.is_public,
        project.status,
        exists (
          select 1 from public.project_assignees assignment
          where assignment.project_id = project.id
            and assignment.user_id = $2
        ) as is_assignee
      from public.projects project
      where project.id = $1
        and deleted_at is null
      limit 1
    `,
    [projectId, user.id],
  );
  const project = result.rows[0];

  if (!project) {
    return null;
  }

  const roleCode = user?.role?.code;
  const hasAccess =
    roleCode === "admin" ||
    (roleCode === "architect" &&
      (Number(project.assigned_architect_id) === Number(user.id) ||
        project.is_assignee === true)) ||
    (roleCode === "client" &&
      user.clientId &&
      Number(project.client_id) === Number(user.clientId));

  return hasAccess ? project : null;
}

/**
 * Busca el archivo existente del proyecto y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.originalName - Valor de `options.originalName` requerido por esta operación.
 * @param {string} options.projectId - Valor de `options.projectId` requerido por esta operación.
 * @param {{ query: Function }} [executor] - Cliente de una transacción; por defecto, el pool compartido.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findExistingProjectFile({
  originalName,
  projectId,
}, executor = poolExecutor) {
  const result = await executor.query(
    `
      select id, title
      from public.files
      where project_id = $1
        and deleted_at is null
        and status <> 'deleted'
        and lower(title) = lower($2)
      limit 1
    `,
    [projectId, String(originalName || "").trim()],
  );

  return result.rows[0] || null;
}

/**
 * Guarda el archivo y su versión coordinando PostgreSQL con el almacenamiento existente.
 * Transfiere el objeto sin conexiones ni bloqueos abiertos (P0-1) y lo registra en una transacción
 * corta que bloquea el proyecto y rechaza, ya serializados, archived, finished, eliminado y duplicados.
 * El controlador comprueba el estado antes de la transferencia para no aceptar cargas inútiles.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.body - Valor de `options.body` requerido por esta operación.
 * @param {string} options.contentType - Valor de `options.contentType` requerido por esta operación.
 * @param {string} options.originalName - Valor de `options.originalName` requerido por esta operación.
 * @param {string} options.projectId - Valor de `options.projectId` requerido por esta operación.
 * @param {number} options.size - Valor de `options.size` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function uploadProjectFile({
  body,
  contentType,
  originalName,
  projectId,
  size,
  user,
}) {
  const storageConfig = getSupabaseStorageConfig();

  if (!storageConfig.bucket) {
    throw new Error("SUPABASE_STORAGE_BUCKET is required");
  }

  const uploadedAt = new Date();
  const versionNumber = 1;
  const safeOriginalName = String(originalName || "archivo").trim();
  const fileType = getFileType(contentType, safeOriginalName);
  const fileExtension = getFileExtension(safeOriginalName);
  const existingFile = await findExistingProjectFile({
    originalName: safeOriginalName,
    projectId,
  });

  if (existingFile) {
    throw createDuplicateFileError("DUPLICATE_PROJECT_FILE");
  }

  const fileId = await reserveFileId();
  const storageKey = buildStorageObjectKey({
    belongsTo: "projects",
    fileId,
    originalName: safeOriginalName,
    ownerId: user.id,
    parentId: projectId,
    uploadedAt,
    versionNumber,
  });
  const fileUrl = buildStorageFileUrl(storageKey);

  return storeThenRecord({
    /**
     * Comprueba si la fila del identificador reservado existe antes de compensar.
     * Evita eliminar el objeto de una carga confirmada con resultado incierto.
     *
     * @returns {Promise<boolean>} true si el archivo quedó registrado.
     */
    isRecorded: () => isFileRecorded(fileId),
    key: storageKey,
    scope: "project_file",
    /**
     * Transfiere el contenido al almacenamiento sin conexiones de PostgreSQL abiertas.
     * Usa la clave derivada del identificador reservado.
     *
     * @returns {Promise<unknown>} Respuesta del almacenamiento.
     */
    store: () => objectStorage.put({
      body,
      contentLength: size,
      contentType: fileType,
      key: storageKey,
      metadata: {
        belongs_to: "project",
        file_id: String(fileId),
        project_id: String(projectId),
        uploaded_by: String(user.id),
        uploaded_year: String(uploadedAt.getUTCFullYear()),
      },
    }),
    /**
     * Registra el archivo y su versión en una transacción corta, tras la transferencia.
     * Repite bajo bloqueo las comprobaciones que pudieron cambiar durante la carga.
     *
     * @returns {Promise<object>} Archivo registrado.
     */
    record: () => withTransaction(async (client) => {
      const projectStateResult = await client.query(
        `
          select status
          from public.projects
          where id = $1
            and deleted_at is null
          for update
        `,
        [projectId],
      );
      const project = projectStateResult.rows[0];

      // El estado se comprueba de nuevo con el proyecto bloqueado: si se archivó, finalizó o eliminó
      // durante la transferencia, la carga se rechaza y su objeto se compensa.
      if (!project) {
        throw new NotFoundError("PROJECT_NOT_FOUND", "No se encontro el proyecto.");
      }

      // El acceso se vuelve a comprobar con el proyecto bloqueado, con la misma regla del controlador:
      // quien dejó de estar asignado durante la transferencia no registra el archivo. La sustitución
      // de responsables bloquea la misma fila, así que ambas operaciones quedan serializadas.
      if (!(await findProjectForFileUpload(projectId, user, client))) {
        throw new NotFoundError("PROJECT_NOT_FOUND", "No se encontro el proyecto.");
      }

      if (isProjectOperationallyReadOnly(project.status)) {
        throw createProjectReadOnlyError(project.status);
      }

      // Bajo el bloqueo del proyecto, las cargas simultáneas con el mismo nombre se serializan aquí.
      if (await findExistingProjectFile({ originalName: safeOriginalName, projectId }, client)) {
        throw createDuplicateFileError("DUPLICATE_PROJECT_FILE");
      }

      const fileResult = await client.query(
        `
          insert into public.files (
            id,
            project_id,
            uploaded_by,
            title,
            file_type,
            file_category,
            current_version,
            status
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::file_status)
          returning id, project_id, project_request_id, uploaded_by, file_type, file_category, current_version
        `,
        [
          fileId,
          projectId,
          user.id,
          safeOriginalName,
          fileType,
          getFileCategory(fileType),
          versionNumber,
          DEFAULT_FILE_STATUS,
        ],
      );
      const versionResult = await client.query(
        `
          insert into public.file_versions (
            file_id,
            uploaded_by,
            version_number,
            file_name,
            original_name,
            file_url,
            file_extension,
            file_size,
            is_current
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, true)
          returning id, version_number, file_name, original_name, file_url, file_size, created_at
        `,
        [
          fileId,
          user.id,
          versionNumber,
          storageKey,
          sanitizeStorageFileName(safeOriginalName),
          fileUrl,
          fileExtension,
          size,
        ],
      );
      const version = versionResult.rows[0];

      return {
        ...toFileUpload({
          ...fileResult.rows[0],
          file_name: version.file_name,
          file_size: version.file_size,
          file_url: version.file_url,
          original_name: version.original_name,
          version_id: version.id,
          version_number: version.version_number,
        }),
        createdAt: version.created_at,
        extension: fileExtension,
        title: safeOriginalName,
      };
    }),
  });
}

/**
 * Elimina el archivo del proyecto después de comprobar acceso, existencia y estado operativo.
 * Bloquea la fila y rechaza archived y finished antes de modificar PostgreSQL y almacenamiento.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.fileId - Valor de `options.fileId` requerido por esta operación.
 * @param {string} options.projectId - Valor de `options.projectId` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function deleteProjectFile({ fileId, projectId, user }) {
  const storageConfig = getSupabaseStorageConfig();
  const client = await pool.connect();
  let storageKeys = [];

  try {
    await client.query("begin");

    const fileResult = await client.query(
      `
        select
          f.id,
          f.uploaded_by,
          f.project_id,
          p.client_id,
          p.assigned_architect_id,
          p.is_public,
          p.status as project_status,
          exists (
            select 1 from public.project_assignees assignment
            where assignment.project_id = p.id
              and assignment.user_id = $3
          ) as is_assignee
        from public.files f
        inner join public.projects p
          on p.id = f.project_id
        where f.id = $1
          and f.project_id = $2
          and f.deleted_at is null
          and f.status <> 'deleted'
          and p.deleted_at is null
        limit 1
        for update of p, f
      `,
      [fileId, projectId, user.id],
    );
    const file = fileResult.rows[0];

    if (!file) {
      await client.query("rollback");
      return null;
    }

    if (isProjectOperationallyReadOnly(file.project_status)) {
      throw createProjectReadOnlyError(file.project_status);
    }

    const roleCode = user?.role?.code;
    const hasProjectAccess =
      roleCode === "admin" ||
      (roleCode === "architect" &&
        (Number(file.assigned_architect_id) === Number(user.id) ||
          file.is_assignee === true ||
          file.is_public === true)) ||
      (roleCode === "client" &&
        user.clientId &&
        Number(file.client_id) === Number(user.clientId));
    const canDelete =
      roleCode === "admin" || Number(file.uploaded_by) === Number(user.id);

    if (!hasProjectAccess || !canDelete) {
      await client.query("rollback");
      return null;
    }

    const versionsResult = await client.query(
      `
        select file_name
        from public.file_versions
        where file_id = $1
          and deleted_at is null
      `,
      [fileId],
    );
    storageKeys = versionsResult.rows
      .map((row) => row.file_name)
      .filter(Boolean);

    await client.query(
      `
        update public.file_versions
        set deleted_at = now()
        where file_id = $1
          and deleted_at is null
      `,
      [fileId],
    );

    await client.query(
      `
        update public.files
        set status = 'deleted'::file_status,
            deleted_at = now(),
            updated_at = now()
        where id = $1
      `,
      [fileId],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  if (storageConfig.bucket) {
    await Promise.all(
      // objectStorage aplica el plazo del almacenamiento: un borrado colgado no retiene la respuesta.
      storageKeys.map((storageKey) => objectStorage.delete(storageKey).catch(() => {})),
    );
  }

  return { deleted: true, fileId: Number(fileId) };
}

/**
 * Busca un archivo de proyecto descargable por el usuario y devuelve null si no tiene acceso.
 * Con acceso directo admite cualquier tipo; si el proyecto solo es visible por ser público, únicamente
 * imágenes y videos, y sustituye el nombre original por uno genérico para no exponer metadatos (P-1).
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.fileId - Identificador del archivo.
 * @param {string} options.projectId - Identificador del proyecto.
 * @param {object} options.user - Usuario autenticado que solicita la descarga.
 * @returns {Promise<object|null>} Datos de almacenamiento y presentación del archivo, o null.
 */
export async function findProjectFileForDownload({ fileId, projectId, user }) {
  const params = [projectId, fileId];
  const roleCode = user?.role?.code;
  const publicShowcaseCondition = `(
    project.is_public = true and (
      file.file_type like 'image/%' or
      file.file_type like 'video/%'
    )
  )`;
  let directCondition = "false";
  let accessCondition = "false";

  if (roleCode === "admin") {
    directCondition = "true";
    accessCondition = "true";
  } else if (roleCode === "architect") {
    params.push(user.id);
    directCondition = `(project.assigned_architect_id = $3 or exists (
      select 1 from public.project_assignees assignment
      where assignment.project_id = project.id
        and assignment.user_id = $3
    ))`;
    accessCondition = `(${directCondition} or ${publicShowcaseCondition})`;
  } else if (roleCode === "client" && user.clientId) {
    params.push(user.clientId);
    directCondition = "(project.client_id = $3)";
    accessCondition = `(${directCondition} or ${publicShowcaseCondition})`;
  }

  const result = await query(
    `
      select
        file.id,
        file.title,
        file.file_type,
        version.id as version_id,
        version.file_name,
        version.original_name,
        version.file_extension,
        version.file_size,
        (${directCondition}) as direct_access
      from public.files file
      inner join public.projects project
        on project.id = file.project_id
      left join public.file_versions version
        on version.file_id = file.id
        and version.version_number = file.current_version
        and version.deleted_at is null
      where file.project_id = $1
        and file.id = $2
        and file.deleted_at is null
        and file.status <> 'deleted'
        and project.deleted_at is null
        and (${accessCondition})
      limit 1
    `,
    params,
  );

  const file = result.rows[0];

  if (!file?.file_name) {
    return null;
  }

  const directAccess = Boolean(file.direct_access);
  const showcaseName = getShowcaseFileName({ extension: file.file_extension, fileType: file.file_type, id: file.id });

  return {
    fileName: file.file_name,
    fileSize: file.file_size === null ? null : Number(file.file_size),
    fileType: file.file_type,
    id: Number(file.id),
    currentVersionId: Number(file.version_id),
    directAccess,
    originalName: directAccess ? file.original_name || file.title || "archivo" : showcaseName,
    title: directAccess ? file.title : showcaseName,
  };
}

/**
 * Busca el valor de proyecto solicitud archivo for download y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.fileId - Valor de `options.fileId` requerido por esta operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 */
export async function findProjectRequestFileForDownload({ fileId, projectRequestId, user }) {
  const params = [projectRequestId, fileId];
  const roleCode = user?.role?.code;
  let accessCondition = "false";

  if (roleCode === "admin") {
    accessCondition = "true";
  } else if (roleCode === "architect") {
    params.push(user.id);
    accessCondition = `exists (
      select 1
      from public.project_request_assignees assignment
      where assignment.project_request_id = request.id
        and assignment.user_id = $3
    )`;
  } else if (roleCode === "client" && user.clientId) {
    params.push(user.id, user.clientId);
    accessCondition = `(request.requested_by = $3 or request.client_id = $4)`;
  }

  const result = await query(
    `
      select
        file.id,
        file.title,
        file.file_type,
        version.id as version_id,
        version.file_name,
        version.original_name,
        version.file_size
      from public.files file
      inner join public.project_requests request
        on request.id = file.project_request_id
      left join public.file_versions version
        on version.file_id = file.id
        and version.version_number = file.current_version
        and version.deleted_at is null
      where file.project_request_id = $1
        and file.id = $2
        and file.deleted_at is null
        and file.status <> 'deleted'
        and request.deleted_at is null
        and (${accessCondition})
      limit 1
    `,
    params,
  );
  const file = result.rows[0];
  if (!file?.file_name) return null;
  return {
    fileName: file.file_name,
    fileSize: file.file_size === null ? null : Number(file.file_size),
    fileType: file.file_type,
    id: Number(file.id),
    currentVersionId: Number(file.version_id),
    originalName: file.original_name || file.title || "archivo",
    title: file.title,
  };
}

/**
 * Obtiene el objeto almacenado del archivo de proyecto para que el flujo llamador pueda continuar.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.fileName - Valor de `options.fileName` requerido por esta operación.
 * @param {string} options.range - Valor de `options.range` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function getProjectFileObject({ fileName, range }) {
  return objectStorage.get(fileName, { range });
}
