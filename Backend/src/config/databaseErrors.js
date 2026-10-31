// Clasificación de errores de PostgreSQL (P1-2). Módulo puro, sin pool, para que el manejo global de
// errores pueda usarlo sin crear conexiones.
//
// - Corte de conexión (red, reinicio, conexión cerrada): un único reintento con espera aleatoria,
//   solo en lecturas.
// - Saturación (pool agotado, demasiadas conexiones, plazo de consulta agotado): nunca se reintenta,
//   porque repetir multiplica la carga justo cuando la base no da abasto; se responde 503 con
//   Retry-After para que el cliente espere.

const CONNECTION_LOSS_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "57P01",
  "57P02",
  "57P03",
]);

// 53300: demasiadas conexiones. 57014: consulta cancelada por statement_timeout.
const SATURATION_CODES = new Set(["53300", "57014", "POOL_QUEUE_FULL"]);

const SATURATION_MESSAGES = [
  "timeout exceeded when trying to connect",
  "connection terminated due to connection timeout",
  "query read timeout",
  "cannot acquire a client",
  "emaxconnsession",
  "max clients reached",
];

// Códigos de socket de Node: solo cuentan cuando el error se originó en una consulta a PostgreSQL
// (ver markDatabaseError); un ECONNRESET del almacenamiento no es un problema de la base.
const SOCKET_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"]);
const DATABASE_ERROR = Symbol.for("arca.databaseError");

/**
 * Normaliza el mensaje del error para compararlo sin distinguir mayúsculas.
 * Tolera errores sin mensaje o valores que no son Error.
 *
 * @param {unknown} error - Error capturado.
 * @returns {string} Mensaje en minúsculas.
 */
function messageOf(error) {
  return String(error?.message || "").toLowerCase();
}

/**
 * Marca un error como originado en una consulta a PostgreSQL.
 * Permite tratar los códigos de socket de Node como fallos de la base solo cuando proceden de ella.
 *
 * @param {unknown} error - Error capturado en la capa de base de datos.
 * @returns {unknown} El mismo error, marcado si es un objeto.
 */
export function markDatabaseError(error) {
  if (error && typeof error === "object" && !Object.isFrozen(error)) error[DATABASE_ERROR] = true;
  return error;
}

/**
 * Indica si la base no puede atender más trabajo ahora mismo.
 * Abarca el pool agotado, la cola de espera llena, el límite de conexiones y los plazos de consulta.
 *
 * @param {unknown} error - Error capturado.
 * @returns {boolean} true si es saturación.
 */
export function isDatabaseSaturationError(error) {
  if (SATURATION_CODES.has(error?.code)) return true;
  const message = messageOf(error);
  return SATURATION_MESSAGES.some((pattern) => message.includes(pattern));
}

/**
 * Indica si la conexión con PostgreSQL se perdió y una lectura puede repetirse una vez.
 * Excluye la saturación, que no debe reintentarse.
 *
 * @param {unknown} error - Error capturado.
 * @returns {boolean} true si es un corte de conexión recuperable.
 */
export function isConnectionLossError(error) {
  if (isDatabaseSaturationError(error)) return false;
  if (CONNECTION_LOSS_CODES.has(error?.code)) return true;
  if (error?.[DATABASE_ERROR] && SOCKET_CODES.has(error?.code)) return true;
  const message = messageOf(error);
  return message.includes("connection terminated") || message.includes("connection timeout");
}

/**
 * Indica si un error de PostgreSQL es transitorio (corte de conexión o saturación).
 * Mantiene la semántica anterior de db.js para quien lo consulta.
 *
 * @param {unknown} error - Error capturado.
 * @returns {boolean} true si el error es transitorio.
 */
export function isTransientDatabaseError(error) {
  if (["ECONNRESET", "ETIMEDOUT"].includes(error?.code)) return true;
  return isDatabaseSaturationError(error) || isConnectionLossError(error);
}

/**
 * Indica si la petición debe responderse con 503: la base está saturada o momentáneamente inaccesible.
 * Los errores de datos o de programación (restricciones, sintaxis) siguen siendo 4xx/500.
 *
 * @param {unknown} error - Error capturado.
 * @returns {boolean} true si corresponde una respuesta 503.
 */
export function isDatabaseUnavailableError(error) {
  if (isDatabaseSaturationError(error) || isConnectionLossError(error)) return true;
  return Boolean(error?.[DATABASE_ERROR] && SOCKET_CODES.has(error?.code));
}
