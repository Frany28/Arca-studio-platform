import { S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

let s3Client = null;

/**
 * Obtiene el valor de required env para que el flujo llamador pueda continuar.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {string} name - Valor de `name` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

/**
 * Obtiene la configuración de almacenamiento Supabase para que el flujo llamador pueda continuar.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @returns {object} Resultado producido por la operación.
 */
export function getSupabaseStorageConfig() {
  return {
    accessKeyId: getRequiredEnv("SUPABASE_STORAGE_S3_ACCESS_KEY_ID"),
    bucket: process.env.SUPABASE_STORAGE_BUCKET || null,
    endpoint: getRequiredEnv("SUPABASE_STORAGE_S3_ENDPOINT"),
    region: process.env.SUPABASE_STORAGE_S3_REGION || "us-east-1",
    secretAccessKey: getRequiredEnv("SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY"),
  };
}

/**
 * Obtiene el cliente S3 compatible de Supabase para que el flujo llamador pueda continuar.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @returns {unknown} Resultado producido por la operación.
 */
export function getSupabaseS3Client() {
  if (s3Client) {
    return s3Client;
  }

  const config = getSupabaseStorageConfig();

  s3Client = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: true,
    // Un reintento como máximo: limita la carga añadida cuando el proveedor está degradado.
    // Las cargas con cuerpo en flujo no se pueden repetir; las lecturas y borrados son idempotentes.
    maxAttempts: 2,
    region: config.region,
    // Plazo de conexión TCP/TLS; los plazos de cada operación los aplica services/objectStorage.js.
    requestHandler: {
      connectionTimeout: Number(process.env.STORAGE_CONNECTION_TIMEOUT_MS) > 0
        ? Number(process.env.STORAGE_CONNECTION_TIMEOUT_MS)
        : 5000,
    },
  });

  return s3Client;
}

/**
 * Convierte el valor de segment en un identificador legible y seguro para URL.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @param {unknown} fallback - Valor de `fallback` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function slugifySegment(value, fallback) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return normalized || fallback;
}

/**
 * Sanea el nombre seguro para almacenamiento antes de exponerlo fuera del backend.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {string} fileName - Valor de `fileName` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
export function sanitizeStorageFileName(fileName) {
  const normalized = String(fileName || "").trim();
  const lastDotIndex = normalized.lastIndexOf(".");
  const hasExtension = lastDotIndex > 0 && lastDotIndex < normalized.length - 1;
  const baseName = hasExtension
    ? normalized.slice(0, lastDotIndex)
    : normalized;
  const extension = hasExtension ? normalized.slice(lastDotIndex + 1) : "";
  const safeBaseName = slugifySegment(baseName, "archivo");
  const safeExtension = slugifySegment(extension, "");

  return safeExtension ? `${safeBaseName}.${safeExtension}` : safeBaseName;
}

/**
 * Obtiene la extensión segura del archivo para que el flujo llamador pueda continuar.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {string} fileName - Valor de `fileName` requerido por esta operación.
 * @returns {string} Resultado producido por la operación.
 */
export function getFileExtension(fileName) {
  const safeName = sanitizeStorageFileName(fileName);
  const lastDotIndex = safeName.lastIndexOf(".");

  if (lastDotIndex <= 0 || lastDotIndex === safeName.length - 1) {
    return "";
  }

  return safeName.slice(lastDotIndex + 1);
}

/**
 * Construye la clave del objeto en almacenamiento a partir de datos previamente validados.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.belongsTo - Valor de `options.belongsTo` requerido por esta operación.
 * @param {string} options.ownerId - Valor de `options.ownerId` requerido por esta operación.
 * @param {string} options.parentId - Valor de `options.parentId` requerido por esta operación.
 * @param {string} options.fileId - Valor de `options.fileId` requerido por esta operación.
 * @param {unknown} options.versionNumber - Valor de `options.versionNumber` requerido por esta operación.
 * @param {string} options.originalName - Valor de `options.originalName` requerido por esta operación.
 * @param {unknown} [options.uploadedAt] - Valor de `options.uploadedAt` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
export function buildStorageObjectKey({
  belongsTo,
  ownerId,
  parentId,
  fileId,
  versionNumber,
  originalName,
  uploadedAt = new Date(),
}) {
  const date = uploadedAt instanceof Date ? uploadedAt : new Date(uploadedAt);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const safeName = sanitizeStorageFileName(originalName);

  return [
    slugifySegment(belongsTo, "general"),
    String(parentId),
    "users",
    String(ownerId),
    year,
    month,
    "files",
    String(fileId),
    `v${Number(versionNumber) || 1}`,
    safeName,
  ].join("/");
}

/**
 * Construye el valor de usuario perfil foto objeto key a partir de datos previamente validados.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.originalName - Valor de `options.originalName` requerido por esta operación.
 * @param {unknown} [options.uploadedAt] - Valor de `options.uploadedAt` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
export function buildUserProfilePhotoObjectKey({
  originalName,
  uploadedAt = new Date(),
  userId,
}) {
  const date = uploadedAt instanceof Date ? uploadedAt : new Date(uploadedAt);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const timestamp = String(date.getTime());
  const safeName = sanitizeStorageFileName(originalName);

  return [
    "users",
    String(userId),
    "profile-photo",
    year,
    month,
    `${timestamp}-${safeName}`,
  ].join("/");
}

/**
 * Construye la URL pública del archivo almacenado a partir de datos previamente validados.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {string} objectKey - Valor de `objectKey` requerido por esta operación.
 * @returns {string} Resultado producido por la operación.
 */
export function buildStorageFileUrl(objectKey) {
  const { bucket } = getSupabaseStorageConfig();

  if (process.env.SUPABASE_URL && bucket) {
    const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");
    return `${baseUrl}/storage/v1/object/public/${bucket}/${objectKey}`;
  }

  return bucket ? `s3://${bucket}/${objectKey}` : objectKey;
}

/**
 * Construye el valor de model staging objeto key a partir de datos previamente validados.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.originalName - Valor de `options.originalName` requerido por esta operación.
 * @param {string} options.projectId - Valor de `options.projectId` requerido por esta operación.
 * @param {unknown} [options.uploadedAt] - Valor de `options.uploadedAt` requerido por esta operación.
 * @param {unknown} options.uploadedBy - Valor de `options.uploadedBy` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
export function buildModelStagingObjectKey({
  originalName,
  projectId,
  uploadedAt = new Date(),
  uploadedBy,
}) {
  const year = String(uploadedAt.getUTCFullYear());
  const month = String(uploadedAt.getUTCMonth() + 1).padStart(2, "0");
  const safeName = sanitizeStorageFileName(originalName);

  return [
    "_processing",
    "models",
    String(projectId),
    String(uploadedBy),
    year,
    month,
    randomUUID(),
    safeName,
  ].join("/");
}

/**
 * Obtiene el valor de almacenamiento objeto key from archivo URL para que el flujo llamador pueda continuar.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {string} fileUrl - Valor de `fileUrl` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
export function getStorageObjectKeyFromFileUrl(fileUrl) {
  const { bucket } = getSupabaseStorageConfig();
  const normalizedFileUrl = String(fileUrl || "").trim();

  if (!normalizedFileUrl || !bucket) {
    return null;
  }

  const publicPrefix = process.env.SUPABASE_URL
    ? `${process.env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/`
    : null;

  if (publicPrefix && normalizedFileUrl.startsWith(publicPrefix)) {
    return normalizedFileUrl.slice(publicPrefix.length);
  }

  const s3Prefix = `s3://${bucket}/`;

  if (normalizedFileUrl.startsWith(s3Prefix)) {
    return normalizedFileUrl.slice(s3Prefix.length);
  }

  try {
    const url = new URL(normalizedFileUrl);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const objectSegmentIndex = pathSegments.findIndex(
      (segment, index) =>
        segment === "object" && pathSegments[index - 1] === "v1",
    );
    const visibility = pathSegments[objectSegmentIndex + 1];
    const urlBucket = pathSegments[objectSegmentIndex + 2];

    if (
      objectSegmentIndex >= 0 &&
      (visibility === "public" || visibility === "sign") &&
      decodeURIComponent(urlBucket || "") === bucket
    ) {
      const encodedKey = pathSegments.slice(objectSegmentIndex + 3).join("/");
      return encodedKey ? decodeURIComponent(encodedKey) : null;
    }
  } catch {
    // Non-URL values are not valid persisted storage references.
  }

  return null;
}
