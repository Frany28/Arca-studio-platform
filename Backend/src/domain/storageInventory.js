import { createHash } from "node:crypto";

import { describeStorageReference } from "../utils/storageObjectKey.js";

// Inventario de solo lectura del almacenamiento (E0, Fase 1.2). Este módulo es puro: recibe filas de
// PostgreSQL, listados y metadatos ya obtenidos y produce un informe sin claves completas, nombres de
// archivo, URLs ni credenciales. Nunca decide borrar: un objeto sin referencia es solo un candidato.

export const STORAGE_INVENTORY_REPORT_VERSION = 1;

// Fuentes de referencias conocidas. Cada una se lee completa con paginación por id.
export const STORAGE_REFERENCE_SOURCES = Object.freeze([
  "file_versions",
  "support_request_files",
  "users",
  "quote_pdf_documents",
]);

// Bucket que corresponde a cada fuente. Los PDF de cotizaciones viven en su bucket privado propio.
const SOURCE_BUCKET_ROLE = Object.freeze({
  file_versions: "general",
  quote_pdf_documents: "quotes",
  support_request_files: "general",
  users: "general",
});

// Segmentos estructurales que generan los constructores de claves del backend; cualquier otro texto
// puede contener datos personales y se sustituye en la forma de la clave.
const STRUCTURAL_KEY_SEGMENTS = new Set([
  "_processing",
  "files",
  "models",
  "profile-photo",
  "project-requests",
  "projects",
  "quotes",
  "support-requests",
  "users",
  "versions",
]);

// Supabase crea este marcador al crear carpetas desde su panel; no es un archivo de la aplicación.
const FOLDER_PLACEHOLDER_SUFFIX = ".emptyFolderPlaceholder";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

// Contextos con datos de personas: su exposición en un bucket público tiene mayor impacto.
const PERSONAL_DATA_CONTEXTS = new Set(["profile_photo", "project_request", "support", "project", "signature"]);

// Procedimiento de corrección que se documenta si un bucket resulta público. El inventario no lo
// ejecuta: cambiar la privacidad requiere una decisión y una ventana autorizadas.
export const PUBLIC_BUCKET_CORRECTION_PROCEDURE = Object.freeze([
  "No cambiar la privacidad desde este inventario: registrar el hallazgo y avisar al responsable del proyecto.",
  "Confirmar en el panel de Supabase (Storage → bucket → configuración) que el bucket figura como público.",
  "Verificar que el backend sirve todos los archivos por la API autenticada (claves S3 del servidor) y que ningún cliente usa URLs públicas directas del bucket.",
  "Preparar la ventana autorizada: respaldo de metadatos de storage.buckets, comunicación y plan de reversión.",
  "Marcar el bucket como privado desde el panel o con una migración revisada; no borrar ni mover objetos.",
  "Comprobar después: descarga autenticada correcta, acceso anónimo a una URL pública rechazado y nuevo inventario con privacidad confirmada.",
  "Evaluar si hubo exposición: revisar los registros de acceso del proveedor durante el periodo público y decidir las notificaciones que correspondan.",
]);

/**
 * Calcula una huella corta y estable de una clave para correlacionar hallazgos sin revelarla.
 * Incluye el bucket para que la misma clave en buckets distintos no produzca la misma huella.
 *
 * @param {string} bucket - Bucket del objeto.
 * @param {string} key - Clave completa del objeto.
 * @returns {string} Primeros 16 caracteres hexadecimales del SHA-256.
 */
export function fingerprintStorageKey(bucket, key) {
  return createHash("sha256").update(`${bucket}\n${key}`).digest("hex").slice(0, 16);
}

/**
 * Describe la estructura de una clave sustituyendo ids, nombres y textos libres por marcadores.
 * Permite reconocer el constructor que la generó sin exponer el nombre original ni datos personales.
 *
 * @param {string} key - Clave completa del objeto.
 * @returns {string} Forma de la clave, por ejemplo `projects/<n>/users/<n>/<n>/<n>/files/<n>/v<n>/<archivo>.pdf`.
 */
export function describeStorageKeyShape(key) {
  const segments = String(key || "").split("/");
  const last = segments.pop() ?? "";
  const shapedSegments = segments.map(describeKeySegment);
  shapedSegments.push(describeFileSegment(last));
  return shapedSegments.join("/");
}

/**
 * Sustituye un segmento intermedio por un marcador salvo que sea una palabra estructural conocida.
 * Los números (ids, años y meses), versiones y UUID se conservan solo como tipo.
 *
 * @param {string} segment - Segmento de la clave.
 * @returns {string} Segmento seguro para el informe.
 */
function describeKeySegment(segment) {
  if (/^\d+$/.test(segment)) return "<n>";
  if (/^v\d+$/.test(segment)) return "v<n>";
  // Versiones nuevas de la Fase 1.2 (B4): número más identificador del intento de carga.
  if (/^v\d+-[a-z0-9]+$/.test(segment)) return "v<n>-<id>";
  if (UUID_PATTERN.test(segment)) return "<uuid>";
  return STRUCTURAL_KEY_SEGMENTS.has(segment) ? segment : "<texto>";
}

/**
 * Sustituye el nombre del archivo por un marcador y conserva solo una extensión corta.
 * El nombre original puede contener nombres de personas y nunca se incluye en el informe.
 *
 * @param {string} segment - Último segmento de la clave.
 * @returns {string} Marcador del archivo.
 */
function describeFileSegment(segment) {
  if (segment.endsWith(FOLDER_PLACEHOLDER_SUFFIX)) return "<marcador-carpeta>";
  const extension = /\.([a-z0-9]{1,8})$/i.exec(segment)?.[1];
  return extension ? `<archivo>.${extension.toLowerCase()}` : "<archivo>";
}

/**
 * Indica si una clave listada es el marcador de carpeta que crea el panel de Supabase.
 * Esos marcadores no son archivos de la aplicación y se cuentan aparte de los huérfanos.
 *
 * @param {string} key - Clave listada.
 * @returns {boolean} true si es un marcador de carpeta.
 */
export function isFolderPlaceholderKey(key) {
  return String(key || "").endsWith(FOLDER_PLACEHOLDER_SUFFIX);
}

/**
 * Reduce un error a un código estable y seguro para el informe, sin mensajes del proveedor.
 * Los mensajes de S3 o PostgreSQL pueden contener claves, hosts o nombres y se descartan.
 *
 * @param {unknown} error - Error capturado.
 * @returns {string} Código seguro o `UNKNOWN`.
 */
export function toSafeErrorCode(error) {
  const candidate = error?.code ?? error?.name ?? null;
  return candidate && SAFE_CODE_PATTERN.test(String(candidate)) ? String(candidate) : "UNKNOWN";
}

/**
 * Convierte las filas leídas de una fuente en referencias normalizadas al almacenamiento.
 * Interpreta claves y URLs con la regla del backend y conserva solo ids, contexto y estado de la fila.
 *
 * @param {string} source - Fuente de `STORAGE_REFERENCE_SOURCES`.
 * @param {Array<object>} rows - Filas devueltas por el repositorio de solo lectura.
 * @param {{ buckets: { general: string|null, quotes: string|null }, supabaseUrl: string|null }} config -
 *   Buckets configurados y URL base para interpretar referencias.
 * @returns {Array<object>} Referencias con bucket, clave (solo en memoria), estado y comprobaciones.
 * @throws {Error} Si la fuente no es conocida.
 */
export function toStorageReferences(source, rows, config) {
  if (source === "file_versions" || source === "support_request_files") {
    return rows.map((row) => toKeyedReference(source, row, config));
  }
  if (source === "users") return rows.flatMap((row) => toUserReferences(row, config));
  if (source === "quote_pdf_documents") return rows.map((row) => toQuoteReference(row, config));
  throw new Error(`Fuente de referencias desconocida: ${source}`);
}

/**
 * Normaliza una fila que guarda la clave y además una URL formada (archivos y soporte).
 * La clave guardada es la referencia; la URL solo se contrasta para detectar incoherencias.
 *
 * @param {string} source - Fuente de la fila.
 * @param {object} row - Fila con `id`, `storage_key`, `file_url`, tamaño y estado.
 * @param {{ buckets: object, supabaseUrl: string|null }} config - Configuración de buckets.
 * @returns {object} Referencia normalizada.
 */
function toKeyedReference(source, row, config) {
  const bucket = config.buckets.general;
  const key = String(row.storage_key || "").trim() || null;
  const fromUrl = describeStorageReference(row.file_url, { bucket, supabaseUrl: config.supabaseUrl });
  return {
    active: !row.version_deleted && !row.owner_deleted,
    bucket,
    context: row.context || (source === "support_request_files" ? "support" : "unknown"),
    expectedSize: toNullableNumber(row.file_size),
    field: "storage_key",
    key,
    reason: key ? (bucket ? "ok" : "no_bucket") : "empty",
    rowId: Number(row.id),
    source,
    urlKeyMismatch: Boolean(key && fromUrl.key !== key),
  };
}

/**
 * Normaliza las referencias de un usuario: foto de perfil y firma (columna sin uso actual).
 * Ambas se guardan como URL formada y se interpretan con la misma regla del backend.
 *
 * @param {object} row - Fila con `id`, `profile_photo_url`, `signature_url` y estado.
 * @param {{ buckets: object, supabaseUrl: string|null }} config - Configuración de buckets.
 * @returns {Array<object>} Referencias presentes en la fila.
 */
function toUserReferences(row, config) {
  const bucket = config.buckets.general;
  return [
    ["profile_photo_url", "profile_photo"],
    ["signature_url", "signature"],
  ]
    .filter(([field]) => row[field])
    .map(([field, context]) => {
      const described = describeStorageReference(row[field], { bucket, supabaseUrl: config.supabaseUrl });
      return {
        active: !row.owner_deleted,
        bucket,
        context,
        expectedSize: null,
        field,
        key: described.key,
        reason: described.reason,
        rowId: Number(row.id),
        source: "users",
        urlKeyMismatch: false,
      };
    });
}

/**
 * Normaliza la referencia de un PDF de cotización en su bucket privado.
 * Un documento que no está `available` puede no tener objeto todavía y no se trata como pérdida.
 *
 * @param {object} row - Fila con `id`, `storage_key`, `bucket`, tamaño y `status`.
 * @param {{ buckets: object }} config - Configuración de buckets.
 * @returns {object} Referencia normalizada.
 */
function toQuoteReference(row, config) {
  const bucket = row.bucket || config.buckets.quotes || null;
  const key = String(row.storage_key || "").trim() || null;
  return {
    active: true,
    bucket,
    context: "quote_pdf",
    expectAbsent: row.status !== "available",
    expectedSize: toNullableNumber(row.file_size),
    field: "object_key",
    key,
    reason: !key ? "empty" : bucket ? "ok" : "no_bucket",
    rowId: Number(row.id),
    source: "quote_pdf_documents",
    urlKeyMismatch: false,
  };
}

/**
 * Convierte un valor numérico de PostgreSQL (bigint como texto) en número o null.
 * Los tamaños ausentes no participan en la comparación de tamaño.
 *
 * @param {unknown} value - Valor leído.
 * @returns {number|null} Número o null.
 */
function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Indica a qué bucket pertenecen las fuentes de una lista de roles configurados.
 * Sirve para decidir si la detección de huérfanos de un bucket tiene todas sus fuentes completas.
 *
 * @param {"general"|"quotes"} role - Rol del bucket.
 * @returns {string[]} Fuentes que guardan referencias a ese bucket.
 */
export function sourcesForBucketRole(role) {
  return STORAGE_REFERENCE_SOURCES.filter((source) => SOURCE_BUCKET_ROLE[source] === role);
}

/**
 * Determina qué referencias deben confirmarse con una consulta de metadatos (HEAD).
 * Con listado completo solo las ausentes del listado; con listado incompleto, todas las interpretables.
 *
 * @param {Array<object>} references - Referencias normalizadas.
 * @param {Map<string, { status: string, keys: Map<string, object> }>} listings - Listados por bucket.
 * @returns {Array<object>} Referencias a confirmar, sin duplicar pares bucket/clave.
 */
export function selectReferencesToConfirm(references, listings) {
  const selected = new Map();
  for (const reference of references) {
    if (!reference.key || !reference.bucket) continue;
    const listing = listings.get(reference.bucket);
    const listedComplete = listing?.status === "complete";
    if (listedComplete && listing.keys.has(reference.key)) continue;
    selected.set(`${reference.bucket}\n${reference.key}`, { bucket: reference.bucket, key: reference.key });
  }
  return [...selected.values()];
}

/**
 * Clasifica cada referencia con la evidencia disponible: listado completo, HEAD o ninguna.
 * Distingue confirmados (presente o ausente), inaccesibles y no comprobados; nunca supone ausencia.
 *
 * @param {Array<object>} references - Referencias normalizadas.
 * @param {Map<string, { status: string, keys: Map<string, object> }>} listings - Listados por bucket.
 * @param {Map<string, object>} headResults - Resultados de HEAD por `bucket\nclave`.
 * @returns {Array<object>} Referencias con `status`, `sizeMismatch` y `objectSize`.
 */
export function classifyReferences(references, listings, headResults) {
  return references.map((reference) => {
    if (!reference.key && reference.reason === "no_bucket") {
      return { ...reference, objectSize: null, sizeMismatch: false, status: "not_checked" };
    }
    if (!reference.key) {
      return { ...reference, objectSize: null, sizeMismatch: false, status: reference.reason === "foreign_bucket" ? "foreign_bucket" : "unparseable" };
    }
    // Una clave sin bucket configurado no se puede comprobar: es una comprobación incompleta.
    if (!reference.bucket) return { ...reference, objectSize: null, sizeMismatch: false, status: "not_checked" };
    const listing = listings.get(reference.bucket);
    const listed = listing?.status === "complete" ? listing.keys.get(reference.key) : null;
    const head = headResults.get(`${reference.bucket}\n${reference.key}`);
    let status = "not_checked";
    let objectSize = null;
    if (listed) {
      status = "present";
      objectSize = listed.size;
    } else if (head?.status === "present") {
      status = "present";
      objectSize = head.size ?? null;
    } else if (head?.status === "missing") {
      status = reference.expectAbsent || !reference.active ? "expected_absent" : "missing";
    } else if (head?.status === "inaccessible") {
      status = "inaccessible";
    }
    const sizeMismatch = status === "present" && reference.expectedSize !== null && objectSize !== null && reference.expectedSize !== objectSize;
    return { ...reference, objectSize, sizeMismatch, status };
  });
}

/**
 * Busca objetos listados sin ninguna referencia y objetos que solo referencian filas eliminadas.
 * Solo concluye en buckets con listado completo y todas sus fuentes leídas; en otro caso, incompleto.
 *
 * @param {object} options - Datos de la comparación.
 * @param {Array<object>} options.references - Referencias clasificadas.
 * @param {Map<string, { status: string, role: string, keys: Map<string, object>, placeholders: number }>} options.listings -
 *   Listados por bucket.
 * @param {Record<string, { status: string }>} options.sources - Estado de lectura de cada fuente.
 * @returns {Map<string, { status: string, reason: string|null, orphanCandidates: Array<object>,
 *   deletedRowObjects: Array<object> }>} Resultado por bucket.
 */
export function findOrphanCandidates({ listings, references, sources }) {
  const result = new Map();
  for (const [bucket, listing] of listings) {
    const missingSources = sourcesForBucketRole(listing.role).filter((source) => sources[source]?.status !== "complete");
    if (listing.status !== "complete" || missingSources.length > 0) {
      result.set(bucket, {
        deletedRowObjects: [],
        orphanCandidates: [],
        reason: listing.status !== "complete" ? "listing_incomplete" : `sources_incomplete:${missingSources.join(",")}`,
        status: "incomplete",
      });
      continue;
    }
    const activeKeys = new Set();
    const inactiveKeys = new Set();
    for (const reference of references) {
      if (reference.bucket !== bucket || !reference.key) continue;
      (reference.active ? activeKeys : inactiveKeys).add(reference.key);
    }
    const orphanCandidates = [];
    const deletedRowObjects = [];
    for (const [key, object] of listing.keys) {
      if (activeKeys.has(key)) continue;
      const entry = { bucket, key, lastModified: object.lastModified, size: object.size };
      (inactiveKeys.has(key) ? deletedRowObjects : orphanCandidates).push(entry);
    }
    result.set(bucket, { deletedRowObjects, orphanCandidates, reason: null, status: "complete" });
  }
  return result;
}

/**
 * Interpreta la privacidad declarada de los buckets en `storage.buckets`.
 * Solo `public = false` confirma privacidad; filas ausentes o consultas fallidas quedan sin confirmar.
 *
 * @param {string[]} buckets - Buckets configurados.
 * @param {{ status: "complete"|"failed", rows: Array<{ id: string, public: boolean }>, errorCode?: string }} privacyRead -
 *   Resultado de la consulta de privacidad.
 * @returns {Array<{ bucket: string, status: "private"|"public"|"unknown", reason: string|null }>} Estado por bucket.
 */
export function assessBucketPrivacy(buckets, privacyRead) {
  return buckets.map((bucket) => {
    if (privacyRead.status !== "complete") {
      return { bucket, reason: `privacy_query_failed:${privacyRead.errorCode || "UNKNOWN"}`, status: "unknown" };
    }
    const row = privacyRead.rows.find((candidate) => candidate.id === bucket);
    if (!row) return { bucket, reason: "bucket_not_found_in_storage_buckets", status: "unknown" };
    if (row.public === false) return { bucket, reason: null, status: "private" };
    if (row.public === true) return { bucket, reason: null, status: "public" };
    return { bucket, reason: "privacy_value_unrecognized", status: "unknown" };
  });
}

/**
 * Cuenta referencias por estado y contexto para el resumen, sin incluir ningún dato del objeto.
 * Separa filas activas de eliminadas para no mezclar pérdidas reales con restos esperados.
 *
 * @param {Array<object>} references - Referencias clasificadas.
 * @returns {Record<string, Record<string, number>>} Recuentos `fuente:campo` → estado → cantidad.
 */
function countReferences(references) {
  const counts = {};
  for (const reference of references) {
    const group = `${reference.source}.${reference.field}`;
    counts[group] ??= {};
    const status = `${reference.active ? "active" : "deleted_row"}:${reference.status}`;
    counts[group][status] = (counts[group][status] || 0) + 1;
  }
  return counts;
}

/**
 * Representa una referencia en el informe solo con ids, contexto, huella y forma de la clave.
 * Nunca incluye la clave completa, el nombre del archivo ni la URL guardada.
 *
 * @param {object} reference - Referencia clasificada.
 * @returns {object} Hallazgo redactado.
 */
function toRedactedReference(reference) {
  return {
    active: reference.active,
    bucket: reference.bucket,
    context: reference.context,
    field: reference.field,
    keyFingerprint: reference.key && reference.bucket ? fingerprintStorageKey(reference.bucket, reference.key) : null,
    keyShape: reference.key ? describeStorageKeyShape(reference.key) : null,
    reason: reference.status === "unparseable" || reference.status === "foreign_bucket" ? reference.reason : undefined,
    rowId: reference.rowId,
    source: reference.source,
    status: reference.status,
  };
}

/**
 * Representa un objeto listado en el informe con su huella, forma, tamaño y fecha.
 * Igual que las referencias, nunca incluye la clave completa.
 *
 * @param {{ bucket: string, key: string, size: number|null, lastModified: string|null }} object - Objeto.
 * @returns {object} Objeto redactado.
 */
function toRedactedObject(object) {
  return {
    bucket: object.bucket,
    keyFingerprint: fingerprintStorageKey(object.bucket, object.key),
    keyShape: describeStorageKeyShape(object.key),
    lastModified: object.lastModified,
    size: object.size,
  };
}

/**
 * Limita una lista de hallazgos para mantener el informe acotado, conservando el total real.
 * El informe indica si se truncó para que nadie interprete la muestra como la lista completa.
 *
 * @param {Array<object>} items - Hallazgos ya redactados.
 * @param {number} limit - Máximo de elementos a incluir.
 * @returns {{ total: number, truncated: boolean, items: Array<object> }} Lista acotada.
 */
function bounded(items, limit) {
  return { items: items.slice(0, limit), total: items.length, truncated: items.length > limit };
}

/**
 * Resume el impacto de un bucket público con recuentos por contexto, sin datos de objetos.
 * Incluye el procedimiento de corrección, que el inventario documenta pero nunca ejecuta.
 *
 * @param {string} bucket - Bucket público.
 * @param {Array<object>} references - Referencias clasificadas.
 * @param {{ status: string, keys: Map<string, object> }|undefined} listing - Listado del bucket.
 * @returns {object} Impacto y procedimiento.
 */
function buildPublicBucketImpact(bucket, references, listing) {
  const referencesByContext = {};
  for (const reference of references) {
    if (reference.bucket !== bucket || reference.status !== "present") continue;
    referencesByContext[reference.context] = (referencesByContext[reference.context] || 0) + 1;
  }
  return {
    bucket,
    exposedPersonalDataContexts: Object.keys(referencesByContext).filter((context) => PERSONAL_DATA_CONTEXTS.has(context)),
    listedObjects: listing?.status === "complete" ? listing.keys.size : null,
    presentReferencesByContext: referencesByContext,
    procedure: PUBLIC_BUCKET_CORRECTION_PROCEDURE,
    procedureExecuted: false,
  };
}

/**
 * Construye el informe final redactado, separando confirmados, inaccesibles e incompletos.
 * El resultado global es `complete` solo si se leyeron todas las fuentes, listados y privacidad.
 *
 * @param {object} input - Datos del inventario.
 * @param {object} input.run - `runId`, `startedAt`, `finishedAt` y `target` sin secretos.
 * @param {Record<string, object>} input.sources - Estado de lectura por fuente.
 * @param {Array<object>} input.references - Referencias clasificadas.
 * @param {Map<string, object>} input.listings - Listados por bucket.
 * @param {Map<string, object>} input.orphans - Resultado de `findOrphanCandidates`.
 * @param {Array<object>} input.privacy - Resultado de `assessBucketPrivacy`.
 * @param {{ requested: number, performed: number, limitReached: boolean }} input.head - Uso de HEAD.
 * @param {number} [input.maxFindings] - Máximo de elementos por lista de hallazgos.
 * @param {string[]} [input.acceptedPublicBuckets] - Buckets cuya publicidad aceptó el responsable para
 *   el entorno inventariado: se registran como característica del entorno, no como hallazgo crítico.
 * @returns {object} Informe serializable y sin datos sensibles.
 */
export function buildStorageInventoryReport({ acceptedPublicBuckets = [], head, listings, maxFindings = 500, orphans, privacy, references, run, sources }) {
  /**
   * Selecciona y redacta las referencias de un estado concreto.
   * Evita repetir el filtro para cada lista de hallazgos del informe.
   *
   * @param {string} status - Estado de la referencia.
   * @returns {Array<object>} Referencias redactadas.
   */
  const byStatus = (status) => references.filter((reference) => reference.status === status).map(toRedactedReference);
  const missingActive = byStatus("missing");
  const inaccessible = byStatus("inaccessible");
  const notChecked = byStatus("not_checked");
  const unparseable = [...byStatus("unparseable"), ...byStatus("foreign_bucket")];
  const sizeMismatches = references.filter((reference) => reference.sizeMismatch).map(toRedactedReference);
  const urlKeyMismatches = references.filter((reference) => reference.urlKeyMismatch).map(toRedactedReference);
  const duplicates = findDuplicateReferences(references);

  const listingSummary = [...listings].map(([bucket, listing]) => ({
    bucket,
    errorCode: listing.errorCode || null,
    folderPlaceholders: listing.placeholders || 0,
    objects: listing.keys.size,
    pages: listing.pages,
    role: listing.role,
    status: listing.status,
  }));
  const orphanSummary = [...orphans].map(([bucket, orphan]) => ({
    bucket,
    deletedRowObjects: bounded(orphan.deletedRowObjects.map(toRedactedObject), maxFindings),
    orphanCandidates: bounded(orphan.orphanCandidates.map(toRedactedObject), maxFindings),
    reason: orphan.reason,
    status: orphan.status,
  }));

  const incompleteChecks = [
    ...Object.entries(sources).filter(([, source]) => source.status !== "complete").map(([source, state]) => `source:${source}:${state.errorCode || "UNKNOWN"}`),
    ...listingSummary.filter((listing) => listing.status !== "complete").map((listing) => `listing:${listing.bucket}:${listing.errorCode || listing.status}`),
    ...privacy.filter((bucket) => bucket.status === "unknown").map((bucket) => `privacy:${bucket.bucket}:${bucket.reason}`),
    ...orphanSummary.filter((orphan) => orphan.status !== "complete").map((orphan) => `orphans:${orphan.bucket}:${orphan.reason}`),
    ...(head.limitReached ? ["head:limit_reached"] : []),
    ...(notChecked.length ? [`references_not_checked:${notChecked.length}`] : []),
  ];
  const accepted = new Set(acceptedPublicBuckets);
  const privacyWithAcceptance = privacy.map((bucket) => (
    bucket.status === "public" ? { ...bucket, publicAccepted: accepted.has(bucket.bucket) } : bucket
  ));
  const publicBuckets = privacyWithAcceptance.filter((bucket) => bucket.status === "public");
  const critical = [
    ...publicBuckets.filter((bucket) => !bucket.publicAccepted).map((bucket) => `public_bucket:${bucket.bucket}`),
    ...(missingActive.length ? [`missing_objects_for_active_rows:${missingActive.length}`] : []),
  ];

  return {
    completeness: {
      head,
      incompleteChecks,
      listings: listingSummary,
      outcome: incompleteChecks.length ? "incomplete" : "complete",
      privacy: privacyWithAcceptance,
      sources,
    },
    environment: {
      acceptedPublicBuckets: [...accepted],
      notes: publicBuckets.filter((bucket) => bucket.publicAccepted).map((bucket) => `public_bucket_accepted:${bucket.bucket}`),
    },
    confirmed: {
      missingObjectsForActiveRows: bounded(missingActive, maxFindings),
      orphanDetection: orphanSummary,
      referenceCounts: countReferences(references),
      sizeMismatches: bounded(sizeMismatches, maxFindings),
      urlKeyMismatches: bounded(urlKeyMismatches, maxFindings),
      duplicateReferences: bounded(duplicates, maxFindings),
    },
    critical,
    inaccessible: bounded(inaccessible, maxFindings),
    notChecked: bounded(notChecked, maxFindings),
    publicBucketImpact: publicBuckets.map((bucket) => ({
      ...buildPublicBucketImpact(bucket.bucket, references, listings.get(bucket.bucket)),
      accepted: bucket.publicAccepted,
    })),
    readOnly: {
      database: "Transacción READ ONLY con ROLLBACK; solo sentencias SELECT permitidas.",
      notes: "Un objeto sin referencia es un candidato a revisión, nunca una autorización para borrarlo.",
      storage: "Solo ListObjectsV2 y HeadObject; ningún contenido descargado ni objeto modificado.",
    },
    reportVersion: STORAGE_INVENTORY_REPORT_VERSION,
    run,
    unparseableReferences: bounded(unparseable, maxFindings),
  };
}

/**
 * Detecta pares bucket/clave referenciados por más de una fila activa.
 * Puede indicar una copia de referencias que, al borrar una fila, eliminaría el objeto de la otra.
 *
 * @param {Array<object>} references - Referencias clasificadas.
 * @returns {Array<object>} Un hallazgo redactado por clave duplicada, con las filas implicadas.
 */
function findDuplicateReferences(references) {
  const groups = new Map();
  for (const reference of references) {
    if (!reference.active || !reference.key || !reference.bucket) continue;
    const group = `${reference.bucket}\n${reference.key}`;
    groups.set(group, [...(groups.get(group) || []), reference]);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      keyFingerprint: fingerprintStorageKey(group[0].bucket, group[0].key),
      keyShape: describeStorageKeyShape(group[0].key),
      rows: group.map((reference) => ({ field: reference.field, rowId: reference.rowId, source: reference.source })),
    }));
}
