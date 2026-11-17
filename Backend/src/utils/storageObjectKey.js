/**
 * Interpreta una referencia persistida (URL pública formada, URL firmada o `s3://`) y la describe.
 * Es una función pura: recibe bucket y URL base explícitos, sin leer variables de entorno, para que
 * el backend y el inventario de solo lectura apliquen exactamente la misma regla.
 *
 * @param {string|null|undefined} fileUrl - Referencia guardada en PostgreSQL.
 * @param {{ bucket: string|null|undefined, supabaseUrl?: string|null }} options - Bucket esperado y
 *   URL base del proyecto de Supabase, si se conoce.
 * @returns {{ key: string|null, reason: "ok"|"empty"|"no_bucket"|"foreign_bucket"|"unrecognized" }}
 *   Clave del objeto dentro del bucket esperado, o el motivo por el que no se pudo obtener.
 */
export function describeStorageReference(fileUrl, { bucket, supabaseUrl = null }) {
  const normalizedFileUrl = String(fileUrl || "").trim();

  if (!normalizedFileUrl) return { key: null, reason: "empty" };
  if (!bucket) return { key: null, reason: "no_bucket" };

  const publicPrefix = supabaseUrl
    ? `${String(supabaseUrl).replace(/\/$/, "")}/storage/v1/object/public/${bucket}/`
    : null;

  if (publicPrefix && normalizedFileUrl.startsWith(publicPrefix)) {
    return withKey(normalizedFileUrl.slice(publicPrefix.length));
  }

  const s3Prefix = `s3://${bucket}/`;

  if (normalizedFileUrl.startsWith(s3Prefix)) {
    return withKey(normalizedFileUrl.slice(s3Prefix.length));
  }
  if (normalizedFileUrl.startsWith("s3://")) return { key: null, reason: "foreign_bucket" };

  try {
    const url = new URL(normalizedFileUrl);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const objectSegmentIndex = pathSegments.findIndex(
      (segment, index) =>
        segment === "object" && pathSegments[index - 1] === "v1",
    );
    const visibility = pathSegments[objectSegmentIndex + 1];
    const urlBucket = pathSegments[objectSegmentIndex + 2];

    if (objectSegmentIndex >= 0 && (visibility === "public" || visibility === "sign")) {
      if (decodeURIComponent(urlBucket || "") !== bucket) return { key: null, reason: "foreign_bucket" };
      const encodedKey = pathSegments.slice(objectSegmentIndex + 3).join("/");
      return withKey(encodedKey ? decodeURIComponent(encodedKey) : "");
    }
  } catch {
    // Un valor que no es URL no es una referencia de almacenamiento persistida válida.
  }

  return { key: null, reason: "unrecognized" };
}

/**
 * Obtiene la clave del objeto con la regla histórica del backend, o null si no es interpretable.
 * Conserva el contrato de `getStorageObjectKeyFromFileUrl`: misma aceptación de formatos y hosts.
 *
 * @param {string|null|undefined} fileUrl - Referencia guardada en PostgreSQL.
 * @param {{ bucket: string|null|undefined, supabaseUrl?: string|null }} options - Bucket y URL base.
 * @returns {string|null} Clave del objeto o null.
 */
export function parseStorageObjectKey(fileUrl, options) {
  return describeStorageReference(fileUrl, options).key;
}

/**
 * Normaliza el resultado positivo: una clave vacía no identifica ningún objeto.
 * Evita repetir la comprobación en cada formato de referencia aceptado.
 *
 * @param {string} key - Clave extraída de la referencia.
 * @returns {{ key: string|null, reason: "ok"|"unrecognized" }} Resultado descrito.
 */
function withKey(key) {
  return key ? { key, reason: "ok" } : { key: null, reason: "unrecognized" };
}
