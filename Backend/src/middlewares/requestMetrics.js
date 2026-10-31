import crypto from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { getPoolStats } from "../config/db.js";

// Métricas de ejecución (P1-3), activadas con REQUEST_METRICS_ENABLED=true. Dos registros JSON:
// - `http_request`: una línea por petición (REQUEST_METRICS_LOG_REQUESTS=false la omite).
// - `runtime_metrics`: un resumen cada RUNTIME_METRICS_INTERVAL_MS (10 s) con CPU, memoria, retraso
//   del event loop, pool de PostgreSQL, duración por percentiles, errores HTTP, 429 y 503.
// Coste acotado: el temporizador no mantiene vivo el proceso y las duraciones se guardan en un
// reservorio de tamaño fijo. Nunca se registran cabeceras, cookies, cuerpos ni la URL con su
// consulta: la ruta es la plantilla de Express (sin ids) o "unmatched".

const DURATION_SAMPLE_LIMIT = 2000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

let sampler = null;

/**
 * Determina si está habilitado la operación enabled según la configuración del entorno.
 * Participa en la cadena HTTP y continúa o rechaza la solicitud según el resultado.
 *
 * @returns {boolean} Resultado producido por la operación.
 */
function enabled() {
  return String(process.env.REQUEST_METRICS_ENABLED || "false").toLowerCase() === "true";
}

/**
 * Indica si se registra una línea por petición además del resumen periódico.
 * Con tráfico alto puede desactivarse y conservar solo el resumen.
 *
 * @returns {boolean} true salvo REQUEST_METRICS_LOG_REQUESTS=false.
 */
function logEachRequest() {
  return String(process.env.REQUEST_METRICS_LOG_REQUESTS || "true").toLowerCase() !== "false";
}

/**
 * Crea los contadores de un intervalo de muestreo vacío.
 * Cada resumen parte de cero para describir solo su propio intervalo.
 *
 * @returns {object} Contadores del intervalo.
 */
function emptyInterval() {
  return {
    aborted: 0,
    byStatusClass: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
    count: 0,
    durations: [],
    rateLimited: 0,
    saturated: 0,
    seen: 0,
  };
}

/**
 * Calcula un percentil sobre una lista ordenada de duraciones.
 * Devuelve null si no hay muestras en el intervalo.
 *
 * @param {Array<number>} sorted - Duraciones ordenadas de menor a mayor.
 * @param {number} percentile - Percentil entre 0 y 100.
 * @returns {number|null} Duración en milisegundos.
 */
function percentileOf(sorted, percentile) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1);
  return Number(sorted[Math.max(0, index)].toFixed(2));
}

/**
 * Convierte un valor del histograma de retraso (nanosegundos) a milisegundos.
 * Los valores no finitos o vacíos (histograma sin muestras) se devuelven como 0.
 *
 * @param {number} nanoseconds - Valor del histograma.
 * @returns {number} Milisegundos con dos decimales.
 */
function toMs(nanoseconds) {
  return Number.isFinite(nanoseconds) && nanoseconds > 0 ? Number((nanoseconds / 1e6).toFixed(2)) : 0;
}

/**
 * Crea el muestreador del proceso: histograma del event loop, CPU e intervalo de peticiones.
 * Es único por proceso y se inicia con la primera petición medida.
 *
 * @returns {object} Estado del muestreador.
 */
function createSampler() {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const state = {
    cpu: process.cpuUsage(),
    histogram,
    interval: emptyInterval(),
    startedAt: process.hrtime.bigint(),
    timer: null,
  };
  const intervalMs = Number(process.env.RUNTIME_METRICS_INTERVAL_MS) > 0 ? Number(process.env.RUNTIME_METRICS_INTERVAL_MS) : 10000;
  state.timer = setInterval(() => console.log(JSON.stringify(collectRuntimeMetrics())), intervalMs);
  state.timer.unref();
  return state;
}

/**
 * Inicia el muestreador si aún no existe.
 * Separado del middleware para poder iniciarlo y consultarlo en pruebas.
 *
 * @returns {object} Estado del muestreador.
 */
function ensureSampler() {
  sampler ||= createSampler();
  return sampler;
}

/**
 * Registra una petición terminada o cancelada en el intervalo actual.
 * Las duraciones se guardan por muestreo de reservorio para acotar la memoria.
 *
 * @param {object} interval - Intervalo actual.
 * @param {number} status - Estado HTTP, o 0 si el cliente canceló.
 * @param {number} durationMs - Duración en milisegundos.
 * @returns {void}
 */
function recordRequest(interval, status, durationMs) {
  interval.seen += 1;
  if (interval.durations.length < DURATION_SAMPLE_LIMIT) {
    interval.durations.push(durationMs);
  } else {
    const slot = Math.floor(Math.random() * interval.seen);
    if (slot < DURATION_SAMPLE_LIMIT) interval.durations[slot] = durationMs;
  }
  if (status === 0) {
    interval.aborted += 1;
    return;
  }
  interval.count += 1;
  const statusClass = `${Math.floor(status / 100)}xx`;
  if (statusClass in interval.byStatusClass) interval.byStatusClass[statusClass] += 1;
  if (status === 429) interval.rateLimited += 1;
  if (status === 503) interval.saturated += 1;
}

/**
 * Resume el intervalo actual y lo reinicia: CPU, memoria, event loop, pool y peticiones.
 * El histograma del event loop y los contadores empiezan de nuevo tras cada resumen.
 *
 * @returns {object} Resumen `runtime_metrics` listo para registrar.
 */
export function collectRuntimeMetrics() {
  const state = ensureSampler();
  const now = process.hrtime.bigint();
  const elapsedMicros = Number(now - state.startedAt) / 1000;
  const cpu = process.cpuUsage(state.cpu);
  const memory = process.memoryUsage();
  const pool = getPoolStats();
  const interval = state.interval;
  const sorted = [...interval.durations].sort((left, right) => left - right);
  const summary = {
    cpu: {
      percent: elapsedMicros > 0 ? Number((((cpu.user + cpu.system) / elapsedMicros) * 100).toFixed(1)) : 0,
      systemMs: Number((cpu.system / 1000).toFixed(1)),
      userMs: Number((cpu.user / 1000).toFixed(1)),
    },
    databasePool: { ...pool, active: pool.total - pool.idle },
    eventLoopDelayMs: {
      max: toMs(state.histogram.max),
      mean: toMs(state.histogram.mean),
      p50: toMs(state.histogram.percentile(50)),
      p99: toMs(state.histogram.percentile(99)),
    },
    intervalMs: Number((elapsedMicros / 1000).toFixed(0)),
    memory: {
      externalBytes: memory.external,
      heapTotalBytes: memory.heapTotal,
      heapUsedBytes: memory.heapUsed,
      rssBytes: memory.rss,
    },
    requests: {
      aborted: interval.aborted,
      byStatusClass: interval.byStatusClass,
      count: interval.count,
      durationMs: {
        max: sorted.length ? Number(sorted.at(-1).toFixed(2)) : null,
        p50: percentileOf(sorted, 50),
        p95: percentileOf(sorted, 95),
        p99: percentileOf(sorted, 99),
      },
      rateLimited: interval.rateLimited,
      saturated: interval.saturated,
    },
    timestamp: new Date().toISOString(),
    type: "runtime_metrics",
  };
  state.cpu = process.cpuUsage();
  state.startedAt = now;
  state.interval = emptyInterval();
  state.histogram.reset();
  return summary;
}

/**
 * Procesa el valor de solicitud métricas para completar la responsabilidad asignada al módulo.
 * Participa en la cadena HTTP y continúa o rechaza la solicitud según el resultado.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {void} Finalización de la operación.
 */
export function requestMetrics(req, res, next) {
  if (!enabled()) {
    next();
    return;
  }

  const state = ensureSampler();
  const startedAt = process.hrtime.bigint();
  // El identificador recibido solo se reutiliza si es seguro como cabecera y en los registros.
  const receivedId = String(req.headers["x-request-id"] || "");
  const requestId = REQUEST_ID_PATTERN.test(receivedId) ? receivedId : crypto.randomUUID();
  res.setHeader("X-Request-Id", requestId);

  let recorded = false;
  /**
   * Registra la petición una sola vez, al terminar o al cancelarse.
   * Una cancelación del cliente cuenta como `aborted` con estado 0.
   *
   * @param {boolean} finished - true si la respuesta se completó.
   * @returns {void}
   */
  const record = (finished) => {
    if (recorded) return;
    recorded = true;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const status = finished ? res.statusCode : 0;
    recordRequest(state.interval, status, durationMs);
    if (!logEachRequest()) return;
    const memory = process.memoryUsage();
    console.log(JSON.stringify({
      type: "http_request",
      requestId,
      method: req.method,
      route: req.route ? `${req.baseUrl}${req.route.path}` : "unmatched",
      status,
      aborted: !finished,
      durationMs: Number(durationMs.toFixed(2)),
      contentLength: Number(req.headers["content-length"] || 0),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      databasePool: getPoolStats(),
      timestamp: new Date().toISOString(),
    }));
  };
  res.on("finish", () => record(true));
  res.on("close", () => record(res.writableFinished));

  next();
}
