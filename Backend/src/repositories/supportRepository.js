import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { objectStorage } from "../services/objectStorage.js";

import {
  buildStorageFileUrl,
  buildStorageObjectKey,
  getFileExtension,
  getSupabaseS3Client,
  getSupabaseStorageConfig,
} from "../config/storage.js";
import { pool, query } from "../config/db.js";

// Las tablas support_requests y support_request_files se gestionan solo mediante
// la migración 20261014120000_support_tables. Este repositorio no ejecuta DDL:
// si la migración no está aplicada, las consultas fallan con 42P01 y se
// informan como error interno en lugar de alterar el esquema en runtime.

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

  return getFileExtension(originalName) || "application/octet-stream";
}

/**
 * Crea el valor de soporte solicitud for usuario con los datos validados recibidos.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.description - Valor de `options.description` requerido por esta operación.
 * @param {string} options.issueType - Valor de `options.issueType` requerido por esta operación.
 * @param {string} options.subject - Valor de `options.subject` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 */
export async function createSupportRequestForUser({
  description,
  issueType,
  subject,
  user,
}) {
  const result = await query(
    `
      insert into public.support_requests (
        user_id,
        issue_type,
        subject,
        description
      )
      values ($1, $2, $3, $4)
      returning id, user_id, issue_type, subject, description, status, created_at
    `,
    [
      user.id,
      String(issueType || "").trim() || null,
      String(subject || "").trim(),
      String(description || "").trim(),
    ],
  );

  const row = result.rows[0];

  return {
    createdAt: row.created_at,
    description: row.description,
    id: Number(row.id),
    issueType: row.issue_type,
    status: row.status,
    subject: row.subject,
    userId: Number(row.user_id),
  };
}

/**
 * Busca el valor de soporte solicitud for carga y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} supportRequestId - Valor de `supportRequestId` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 */
export async function findSupportRequestForUpload(supportRequestId, user) {
  const result = await query(
    `
      select id, user_id, status
      from public.support_requests
      where id = $1
        and deleted_at is null
      limit 1
    `,
    [supportRequestId],
  );
  const supportRequest = result.rows[0];

  if (!supportRequest) {
    return null;
  }

  const isOwner = Number(supportRequest.user_id) === Number(user.id);
  const isAdmin = user.role?.code === "admin";

  return isOwner || isAdmin ? supportRequest : null;
}

/**
 * Carga el valor de soporte solicitud archivo coordinando la persistencia y el almacenamiento.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.body - Valor de `options.body` requerido por esta operación.
 * @param {string} options.contentType - Valor de `options.contentType` requerido por esta operación.
 * @param {string} options.originalName - Valor de `options.originalName` requerido por esta operación.
 * @param {number} options.size - Valor de `options.size` requerido por esta operación.
 * @param {string} options.supportRequestId - Valor de `options.supportRequestId` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function uploadSupportRequestFile({
  body,
  contentType,
  originalName,
  size,
  supportRequestId,
  user,
}) {
  const storageConfig = getSupabaseStorageConfig();

  if (!storageConfig.bucket) {
    throw new Error("SUPABASE_STORAGE_BUCKET is required");
  }

  const s3Client = getSupabaseS3Client();
  const uploadedAt = new Date();
  const safeOriginalName = String(originalName || "archivo").trim();
  const fileType = getFileType(contentType, safeOriginalName);
  const fileExtension = getFileExtension(safeOriginalName);
  const client = await pool.connect();
  let uploadedStorageKey = null;

  try {
    await client.query("begin");

    const fileResult = await client.query(
      `
        insert into public.support_request_files (
          support_request_id,
          uploaded_by,
          original_name,
          file_type,
          file_extension,
          file_size,
          storage_key,
          file_url
        )
        values ($1, $2, $3, $4, $5, $6, '', '')
        returning id
      `,
      [
        supportRequestId,
        user.id,
        safeOriginalName,
        fileType,
        fileExtension,
        size,
      ],
    );
    const fileId = Number(fileResult.rows[0].id);
    const storageKey = buildStorageObjectKey({
      belongsTo: "support-requests",
      fileId,
      originalName: safeOriginalName,
      ownerId: user.id,
      parentId: supportRequestId,
      uploadedAt,
      versionNumber: 1,
    });
    const fileUrl = buildStorageFileUrl(storageKey);
    uploadedStorageKey = storageKey;

    await objectStorage.put({
        body,
        contentLength: size,
        contentType: fileType,
        key: storageKey,
        metadata: {
          belongs_to: "support_request",
          support_request_file_id: String(fileId),
          support_request_id: String(supportRequestId),
          uploaded_by: String(user.id),
          uploaded_year: String(uploadedAt.getUTCFullYear()),
        },
    });

    const updatedResult = await client.query(
      `
        update public.support_request_files
        set storage_key = $2,
            file_url = $3
        where id = $1
        returning
          id,
          support_request_id,
          uploaded_by,
          original_name,
          file_type,
          file_extension,
          file_size,
          storage_key,
          file_url,
          created_at
      `,
      [fileId, storageKey, fileUrl],
    );

    await client.query("commit");

    const row = updatedResult.rows[0];

    return {
      createdAt: row.created_at,
      fileExtension: row.file_extension,
      fileSize: Number(row.file_size),
      fileType: row.file_type,
      id: Number(row.id),
      originalName: row.original_name,
      supportRequestId: Number(row.support_request_id),
    };
  } catch (error) {
    await client.query("rollback");

    if (uploadedStorageKey) {
      await s3Client
        .send(
          new DeleteObjectCommand({
            Bucket: storageConfig.bucket,
            Key: uploadedStorageKey,
          }),
        )
        .catch(() => {});
    }

    throw error;
  } finally {
    client.release();
  }
}
