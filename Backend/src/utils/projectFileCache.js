const IMMUTABLE_CACHE_SECONDS = 31_536_000;
const FALLBACK_CACHE_SECONDS = 300;

/**
 * Transforma el valor de positive integer a la representación pública esperada.
 * Centraliza este comportamiento para que sus consumidores utilicen el mismo criterio.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function toPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * Obtiene los encabezados de caché del archivo de proyecto para que el flujo llamador pueda continuar.
 * Centraliza este comportamiento para que sus consumidores utilicen el mismo criterio.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.currentVersionId - Valor de `options.currentVersionId` requerido por esta operación.
 * @param {string} options.fileId - Valor de `options.fileId` requerido por esta operación.
 * @param {string} options.requestedVersionId - Valor de `options.requestedVersionId` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
export function getProjectFileCacheHeaders({
  currentVersionId,
  fileId,
  requestedVersionId,
}) {
  const safeCurrentVersionId = toPositiveInteger(currentVersionId);
  const safeRequestedVersionId = toPositiveInteger(requestedVersionId);
  const safeFileId = toPositiveInteger(fileId);
  const isCurrentVersion =
    safeCurrentVersionId !== null &&
    safeRequestedVersionId === safeCurrentVersionId;

  return {
    cacheControl: isCurrentVersion
      ? `private, max-age=${IMMUTABLE_CACHE_SECONDS}, immutable`
      : `private, max-age=${FALLBACK_CACHE_SECONDS}`,
    etag:
      safeFileId && safeCurrentVersionId
        ? `"project-file-${safeFileId}-version-${safeCurrentVersionId}"`
        : null,
  };
}

/**
 * Cabeceras de caché de un archivo de proyecto con la revisión de versiones activada (Fase 1.2, B5).
 * Compatibles con la revocación: `private, no-cache` obliga a revalidar en cada uso, y el servidor
 * solo responde 304 después de volver a autorizar al usuario. La ETag identifica la versión servida
 * y la representación (directa o anonimizada del escaparate), que cambian el contenido o su nombre.
 *
 * @param {{ fileId: number, versionId: number, anonymized: boolean }} options - Archivo, versión y representación.
 * @returns {{ cacheControl: string, etag: string }} Cabeceras.
 */
export function getProjectFileRevalidationHeaders({ anonymized, fileId, versionId }) {
  return {
    cacheControl: "private, no-cache",
    etag: `"project-file-${toPositiveInteger(fileId)}-version-${toPositiveInteger(versionId)}-${anonymized ? "showcase" : "direct"}"`,
  };
}

/**
 * Indica si la cabecera If-None-Match de la petición coincide con la ETag actual.
 * Admite listas separadas por comas, `*` y etiquetas débiles (`W/`), como la comparación débil de HTTP.
 *
 * @param {string|undefined} ifNoneMatch - Valor de la cabecera de la petición.
 * @param {string} etag - ETag actual de la versión servida.
 * @returns {boolean} true si el cliente ya tiene esa misma versión.
 */
export function matchesIfNoneMatch(ifNoneMatch, etag) {
  if (!ifNoneMatch || !etag) return false;
  return ifNoneMatch.split(",").some((candidate) => candidate.trim() === "*" || weakEtag(candidate) === weakEtag(etag));
}

/**
 * Normaliza una ETag para la comparación débil: sin espacios ni prefijo `W/`.
 * Las versiones servidas son idénticas byte a byte, así que la comparación débil basta.
 *
 * @param {string} value - ETag.
 * @returns {string} ETag normalizada.
 */
function weakEtag(value) {
  return value.trim().replace(/^W\//, "");
}
