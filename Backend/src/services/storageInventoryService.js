import {
  STORAGE_REFERENCE_SOURCES,
  assessBucketPrivacy,
  buildStorageInventoryReport,
  classifyReferences,
  findOrphanCandidates,
  isFolderPlaceholderKey,
  selectReferencesToConfirm,
  toSafeErrorCode,
  toStorageReferences,
} from "../domain/storageInventory.js";
import {
  BUCKET_PRIVACY_TABLE,
  SOURCE_TABLES,
  beginReadOnlySnapshot,
  createReadOnlyInventoryClient,
  endReadOnlySnapshot,
  readBucketPrivacy,
  readReferenceSource,
  readRowSecurityExposure,
} from "../repositories/storageInventoryRepository.js";

// Valores por defecto del inventario. Son límites de seguridad, no de negocio: si se alcanzan, el
// informe lo marca como comprobación incompleta en lugar de suponer un resultado.
export const STORAGE_INVENTORY_DEFAULTS = Object.freeze({
  headConcurrency: 4,
  idleTimeoutMs: 120_000,
  listPageSize: 1000,
  lockTimeoutMs: 2_000,
  maxFindings: 500,
  maxHead: 2_000,
  maxListedObjects: 500_000,
  sourcePageSize: 1000,
  statementTimeoutMs: 30_000,
});

/**
 * Ejecuta el inventario completo de solo lectura y devuelve el informe redactado.
 * Lee las referencias en una instantánea READ ONLY, lista cada bucket con paginación completa, confirma
 * con HEAD las referencias necesarias y compara; nunca descarga, crea, copia, modifica ni borra nada.
 *
 * @param {object} options - Dependencias explícitas y configuración.
 * @param {() => Promise<{ query: Function, end: Function }>} options.openDatabase - Abre el cliente PostgreSQL
 *   del destino confirmado.
 * @param {{ listPage: Function, headObject: Function }} options.storage - Inspector de solo lectura.
 * @param {{ buckets: { general: string|null, quotes: string|null }, supabaseUrl: string|null }} options.config -
 *   Buckets y URL base del destino.
 * @param {{ runId: string, target: object }} options.run - Identificación de la ejecución, sin secretos.
 * @param {Partial<typeof STORAGE_INVENTORY_DEFAULTS>} [options.limits] - Límites de la ejecución.
 * @param {() => Date} [options.now] - Reloj (inyectable en pruebas).
 * @param {string[]} [options.acceptedPublicBuckets] - Buckets cuya publicidad está aceptada para el
 *   entorno; deben ser buckets configurados.
 * @returns {Promise<object>} Informe del inventario.
 * @throws {Error} Si se acepta como público un bucket que no está configurado.
 */
export async function runStorageInventory({ acceptedPublicBuckets = [], config, limits = {}, now = () => new Date(), openDatabase, run, storage }) {
  const configured = new Set(configuredBuckets(config).map(({ bucket }) => bucket));
  const unknownAccepted = acceptedPublicBuckets.filter((bucket) => !configured.has(bucket));
  if (unknownAccepted.length) throw new Error("Solo se puede aceptar como público un bucket configurado del destino.");
  const settings = { ...STORAGE_INVENTORY_DEFAULTS, ...limits };
  const startedAt = now().toISOString();

  const database = await readDatabaseEvidence({ config, openDatabase, settings });
  const references = Object.entries(database.sources)
    .filter(([, source]) => source.status === "complete")
    .flatMap(([source, state]) => toStorageReferences(source, state.rows, config));

  const buckets = configuredBuckets(config);
  const listings = new Map();
  for (const { bucket, role } of buckets) {
    listings.set(bucket, await listEntireBucket(storage, bucket, role, settings));
  }

  const toConfirm = selectReferencesToConfirm(references, listings);
  const headResults = await confirmWithHead(storage, toConfirm, settings);
  const classified = classifyReferences(references, listings, headResults.results);
  const orphans = findOrphanCandidates({ listings, references: classified, sources: database.sourceStates });
  const privacy = assessBucketPrivacy(buckets.map(({ bucket }) => bucket), database.privacy);

  return buildStorageInventoryReport({
    acceptedPublicBuckets,
    head: { limitReached: headResults.limitReached, performed: headResults.performed, requested: toConfirm.length },
    listings,
    maxFindings: settings.maxFindings,
    orphans,
    privacy,
    references: classified,
    run: { ...run, finishedAt: now().toISOString(), startedAt },
    sources: database.sourceStates,
  });
}

/**
 * Lee todas las fuentes de referencias y la privacidad de los buckets en una sola instantánea.
 * La transacción termina siempre con ROLLBACK y la conexión se cierra aunque la lectura falle.
 *
 * @param {object} options - Dependencias y configuración.
 * @param {() => Promise<{ query: Function, end: Function }>} options.openDatabase - Apertura del cliente.
 * @param {{ buckets: object }} options.config - Buckets configurados.
 * @param {typeof STORAGE_INVENTORY_DEFAULTS} options.settings - Límites.
 * @returns {Promise<{ sources: Record<string, object>, sourceStates: Record<string, object>,
 *   privacy: { status: string, rows: Array<object>, errorCode?: string } }>} Evidencia de PostgreSQL.
 */
async function readDatabaseEvidence({ config, openDatabase, settings }) {
  const connection = await openDatabase();
  const client = createReadOnlyInventoryClient(connection);
  const sources = {};
  let privacy;
  let snapshotOpen = false;
  let readError = null;
  try {
    // Se marca antes de abrirla: si falla un SET LOCAL tras el BEGIN, la transacción también se
    // cierra con ROLLBACK. Un ROLLBACK sin transacción en curso solo produce un aviso en PostgreSQL.
    snapshotOpen = true;
    await beginReadOnlySnapshot(client, settings);
    // RLS filtra filas sin error: una fuente filtrada parecería completa con menos referencias y
    // convertiría objetos válidos en falsos huérfanos. Se comprueba antes de leer cada fuente.
    const rowSecurity = await readRowSecurityExposure(client, [...Object.values(SOURCE_TABLES).flat(), BUCKET_PRIVACY_TABLE]);
    for (const source of STORAGE_REFERENCE_SOURCES) {
      const blocked = rowSecurityBlock(rowSecurity, SOURCE_TABLES[source]);
      sources[source] = blocked || await readReferenceSource(client, source, { pageSize: settings.sourcePageSize });
    }
    const bucketNames = configuredBuckets(config).map(({ bucket }) => bucket);
    privacy = rowSecurityBlock(rowSecurity, [BUCKET_PRIVACY_TABLE]) || await readBucketPrivacy(client, bucketNames);
  } catch (error) {
    readError = error;
  }
  // El cierre se intenta siempre; si la lectura ya falló, se conserva ese primer error como causa.
  try {
    if (snapshotOpen) await endReadOnlySnapshot(client);
  } catch (error) {
    readError ??= error;
  } finally {
    await connection.end().catch((error) => {
      readError ??= error;
    });
  }
  if (readError) throw readError;
  const sourceStates = Object.fromEntries(Object.entries(sources).map(([source, state]) => [
    source,
    state.status === "complete"
      ? { pages: state.pages, rows: state.rows.length, status: "complete" }
      : { errorCode: toSafeErrorCode(state.error), status: "failed" },
  ]));
  return {
    privacy: privacy.status === "complete" ? privacy : { errorCode: toSafeErrorCode(privacy.error), rows: [], status: "failed" },
    sourceStates,
    sources,
  };
}

/**
 * Decide si una lectura debe omitirse porque RLS filtraría sus tablas o no se pudo comprobar.
 * Devuelve un resultado fallido con un código explícito; null si la lectura es fiable.
 *
 * @param {{ status: string, filtered: Set<string> }} rowSecurity - Resultado de `readRowSecurityExposure`.
 * @param {string[]} tables - Tablas que usa la lectura.
 * @returns {{ status: "failed", rows: [], pages: 0, error: { code: string } }|null} Bloqueo o null.
 */
function rowSecurityBlock(rowSecurity, tables) {
  if (rowSecurity.status !== "complete") return { error: { code: "ROW_SECURITY_UNVERIFIED" }, pages: 0, rows: [], status: "failed" };
  if (tables.some((table) => rowSecurity.filtered.has(table))) {
    return { error: { code: "ROW_LEVEL_SECURITY_FILTERS_ROWS" }, pages: 0, rows: [], status: "failed" };
  }
  return null;
}

/**
 * Enumera los buckets configurados con su rol, sin repetir uno compartido por error.
 * Un bucket de cotizaciones igual al general se inventaría una sola vez con el rol general.
 *
 * @param {{ buckets: { general: string|null, quotes: string|null } }} config - Configuración.
 * @returns {Array<{ bucket: string, role: "general"|"quotes" }>} Buckets a inventariar.
 */
function configuredBuckets(config) {
  const buckets = [];
  if (config.buckets.general) buckets.push({ bucket: config.buckets.general, role: "general" });
  if (config.buckets.quotes && config.buckets.quotes !== config.buckets.general) {
    buckets.push({ bucket: config.buckets.quotes, role: "quotes" });
  }
  return buckets;
}

/**
 * Recorre todas las páginas del listado de un bucket hasta agotar el token de continuación.
 * Un error, un token repetido o superar el máximo de objetos dejan el listado como incompleto.
 *
 * @param {{ listPage: Function }} storage - Inspector de solo lectura.
 * @param {string} bucket - Bucket a listar.
 * @param {"general"|"quotes"} role - Rol del bucket.
 * @param {typeof STORAGE_INVENTORY_DEFAULTS} settings - Límites.
 * @returns {Promise<{ status: "complete"|"incomplete", role: string, pages: number, placeholders: number,
 *   keys: Map<string, { size: number|null, lastModified: string|null }>, errorCode?: string }>} Listado.
 */
async function listEntireBucket(storage, bucket, role, settings) {
  const keys = new Map();
  const seenTokens = new Set();
  let continuationToken = null;
  let pages = 0;
  let placeholders = 0;
  try {
    for (;;) {
      const page = await storage.listPage({ bucket, continuationToken, maxKeys: settings.listPageSize });
      pages += 1;
      for (const object of page.objects) {
        if (isFolderPlaceholderKey(object.key)) placeholders += 1;
        else keys.set(object.key, { lastModified: object.lastModified, size: object.size });
      }
      if (keys.size > settings.maxListedObjects) {
        return { errorCode: "MAX_LISTED_OBJECTS_EXCEEDED", keys, pages, placeholders, role, status: "incomplete" };
      }
      if (!page.isTruncated) return { keys, pages, placeholders, role, status: "complete" };
      if (!page.nextToken || seenTokens.has(page.nextToken)) {
        return { errorCode: "INVALID_CONTINUATION_TOKEN", keys, pages, placeholders, role, status: "incomplete" };
      }
      seenTokens.add(page.nextToken);
      continuationToken = page.nextToken;
    }
  } catch (error) {
    return { errorCode: toSafeErrorCode(error), keys, pages, placeholders, role, status: "incomplete" };
  }
}

/**
 * Confirma referencias con HEAD (solo metadatos) con concurrencia y cantidad máximas.
 * Las que superan el máximo quedan sin comprobar y el informe lo indica como incompleto.
 *
 * @param {{ headObject: Function }} storage - Inspector de solo lectura.
 * @param {Array<{ bucket: string, key: string }>} targets - Objetos a confirmar.
 * @param {typeof STORAGE_INVENTORY_DEFAULTS} settings - Límites.
 * @returns {Promise<{ results: Map<string, object>, performed: number, limitReached: boolean }>} Resultados.
 */
async function confirmWithHead(storage, targets, settings) {
  const results = new Map();
  const allowed = targets.slice(0, settings.maxHead);
  let next = 0;

  /**
   * Toma objetos pendientes de la cola compartida hasta vaciarla.
   * Varias instancias en paralelo respetan el límite de concurrencia sin bibliotecas adicionales.
   *
   * @returns {Promise<void>} Finalización del trabajador.
   */
  async function worker() {
    while (next < allowed.length) {
      const target = allowed[next];
      next += 1;
      results.set(`${target.bucket}\n${target.key}`, await storage.headObject(target));
    }
  }

  const workers = Array.from({ length: Math.min(settings.headConcurrency, allowed.length) }, () => worker());
  await Promise.all(workers);
  return { limitReached: targets.length > allowed.length, performed: allowed.length, results };
}
