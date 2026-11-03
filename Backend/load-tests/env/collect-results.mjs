// Consolida los resultados de un escenario de carga (Fase 3) y evalúa los criterios de aceptación.
//
//   node load-tests/env/collect-results.mjs --scenario=A --k6-summary=results/A-summary.json \
//     --k6-raw=results/A-raw.json.gz --metrics=results/backend-metrics.jsonl \
//     [--sse=results/G-sse.json] [--integrity=results/A-integrity.json] [--out=results/A-report.json]
//
// Fuentes: el resumen de k6 (--summary-export), la salida detallada de k6 (--out json=…, .gz admitido)
// para métricas por endpoint, tipo de operación y escenario, y los resúmenes `runtime_metrics` del
// backend (CPU, memoria, event loop, pool) dentro de la ventana de la prueba. Solo lee archivos: los
// resultados son mediciones de la ejecución, nunca valores simulados.
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

const options = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split(/=(.*)/s).slice(0, 2)));
const ACCEPTANCE = Object.freeze({ eventLoopP99Ms: 100, heapGrowthMbPerHour: 50, jsonP95Ms: 800, unexpectedServerErrorRate: 0.001, writeP95Ms: 1500 });

/**
 * Percentil de una lista de números (se ordena una copia).
 *
 * @param {Array<number>} values - Valores.
 * @param {number} percentile - Percentil 0–100.
 * @returns {number|null} Valor o null sin datos.
 */
function percentile(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1))].toFixed(2));
}

/**
 * Resume una lista de duraciones y de estados HTTP.
 *
 * @param {{ durations: Array<number>, statuses: Record<string, number> }} bucket - Datos acumulados.
 * @param {number} seconds - Duración de la ventana.
 * @returns {object} Resumen.
 */
function summarize(bucket, seconds) {
  const total = bucket.durations.length;
  const byStatus = bucket.statuses;
  const of = (predicate) => Object.entries(byStatus).filter(([status]) => predicate(Number(status))).reduce((sum, [, value]) => sum + value, 0);
  return {
    avgMs: total ? Number((bucket.durations.reduce((sum, value) => sum + value, 0) / total).toFixed(2)) : null,
    p50Ms: percentile(bucket.durations, 50),
    p95Ms: percentile(bucket.durations, 95),
    p99Ms: percentile(bucket.durations, 99),
    requests: total,
    requestsPerSecond: seconds > 0 ? Number((total / seconds).toFixed(2)) : null,
    status: {
      "2xx": of((status) => status >= 200 && status < 300),
      "4xx (sin 429)": of((status) => status >= 400 && status < 500 && status !== 429),
      429: of((status) => status === 429),
      503: of((status) => status === 503),
      "5xx (sin 503)": of((status) => status >= 500 && status !== 503),
      "sin respuesta": of((status) => status === 0),
    },
  };
}

/**
 * Lee la salida detallada de k6 y agrupa duraciones y estados por endpoint, tipo y escenario.
 *
 * @param {string} file - Archivo JSON por línea (opcionalmente .gz).
 * @returns {Promise<object>} Agrupaciones y ventana temporal.
 */
async function readRawPoints(file) {
  const stream = file.endsWith(".gz") ? createReadStream(file).pipe(createGunzip()) : createReadStream(file);
  const groups = { endpoint: {}, kind: {}, scenario: {} };
  const commentsByProject = {};
  let first = Infinity;
  let last = -Infinity;
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!line.includes('"metric":"http_req_duration"') || !line.includes('"type":"Point"')) continue;
    const { data } = JSON.parse(line);
    const time = Date.parse(data.time);
    first = Math.min(first, time);
    last = Math.max(last, time);
    const tags = data.tags || {};
    const status = String(tags.status ?? 0);
    for (const [group, key] of [["endpoint", tags.endpoint || "sin etiqueta"], ["kind", tags.kind || "sin etiqueta"], ["scenario", tags.scenario || "default"]]) {
      groups[group][key] ||= { durations: [], statuses: {} };
      groups[group][key].durations.push(data.value);
      groups[group][key].statuses[status] = (groups[group][key].statuses[status] || 0) + 1;
    }
    if (tags.endpoint === "comment-create" && status === "201" && tags.project) commentsByProject[tags.project] = (commentsByProject[tags.project] || 0) + 1;
  }
  return { commentsByProject, first, groups, last };
}

/**
 * Lee los resúmenes del backend dentro de la ventana y calcula máximos, medias y tendencia del heap.
 *
 * @param {string} file - JSON por línea escrito por env/server.mjs.
 * @param {number} from - Inicio de la ventana (ms).
 * @param {number} to - Fin de la ventana (ms).
 * @returns {object} Resumen del backend.
 */
function readBackendMetrics(file, from, to) {
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const samples = lines.filter((sample) => sample.type === "runtime_metrics" && Date.parse(sample.timestamp) >= from && Date.parse(sample.timestamp) <= to + 15000);
  const exits = lines.filter((event) => event.type === "loadtest_server_exit" && event.code !== 0 && Date.parse(event.timestamp) >= from);
  const series = (pick) => samples.map(pick).filter((value) => Number.isFinite(value));
  const stats = (values, unit = 1) => values.length
    ? { avg: Number((values.reduce((sum, value) => sum + value, 0) / values.length / unit).toFixed(2)), max: Number((Math.max(...values) / unit).toFixed(2)), min: Number((Math.min(...values) / unit).toFixed(2)) }
    : null;
  // Pendiente del heap (MB/hora) por mínimos cuadrados: detecta crecimiento sostenido en pruebas largas.
  const points = samples.map((sample) => [Date.parse(sample.timestamp) / 3600000, sample.memory.heapUsedBytes / 1048576]);
  let heapGrowthMbPerHour = null;
  if (points.length >= 6) {
    const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
    const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
    const numerator = points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
    const denominator = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
    heapGrowthMbPerHour = denominator ? Number((numerator / denominator).toFixed(2)) : null;
  }
  return {
    cpuPercent: stats(series((sample) => sample.cpu.percent)),
    crashes: exits.length,
    eventLoopP99Ms: stats(series((sample) => sample.eventLoopDelayMs.p99)),
    heapGrowthMbPerHour,
    heapUsedMb: stats(series((sample) => sample.memory.heapUsedBytes), 1048576),
    poolActive: stats(series((sample) => sample.databasePool.active)),
    poolIdle: stats(series((sample) => sample.databasePool.idle)),
    poolWaiting: stats(series((sample) => sample.databasePool.waiting)),
    rssMb: stats(series((sample) => sample.memory.rssBytes), 1048576),
    samples: samples.length,
    saturated503: samples.reduce((sum, sample) => sum + sample.requests.saturated, 0),
    serverRequests: samples.reduce((sum, sample) => sum + sample.requests.count, 0),
  };
}

const summary = options["k6-summary"] ? JSON.parse(readFileSync(options["k6-summary"], "utf8")) : null;
const raw = options["k6-raw"] ? await readRawPoints(options["k6-raw"]) : null;
const seconds = raw ? (raw.last - raw.first) / 1000 : 0;
const report = { scenario: options.scenario || "sin nombre", type: "loadtest_report", window: raw ? { from: new Date(raw.first).toISOString(), seconds: Number(seconds.toFixed(0)), to: new Date(raw.last).toISOString() } : null };

if (summary) {
  const metric = (name) => summary.metrics?.[name] || {};
  report.k6 = {
    authFailures: metric("auth_failures").count || 0,
    commentsCreated: metric("comments_created").count || 0,
    httpReqDurationMs: { avg: metric("http_req_duration").avg, max: metric("http_req_duration").max, p50: metric("http_req_duration").med, p95: metric("http_req_duration")["p(95)"], p99: metric("http_req_duration")["p(99)"] },
    httpReqFailedRate: metric("http_req_failed").value ?? metric("http_req_failed").rate,
    rateLimited429: metric("rate_limited").count || 0,
    requests: metric("http_reqs").count,
    requestsPerSecond: metric("http_reqs").rate,
    saturated503: metric("saturated").count || 0,
    systemErrorRate: metric("system_errors").value ?? metric("system_errors").rate,
    virtualUsersMax: metric("vus_max").max ?? metric("vus_max").value,
  };
}
if (raw) {
  report.byEndpoint = Object.fromEntries(Object.entries(raw.groups.endpoint).map(([key, bucket]) => [key, summarize(bucket, seconds)]));
  report.byKind = Object.fromEntries(Object.entries(raw.groups.kind).map(([key, bucket]) => [key, summarize(bucket, seconds)]));
  report.byScenario = Object.fromEntries(Object.entries(raw.groups.scenario).map(([key, bucket]) => [key, summarize(bucket, seconds)]));
}
if (options.metrics && raw) report.backend = readBackendMetrics(options.metrics, raw.first, raw.last);
if (options.integrity) report.integrity = JSON.parse(readFileSync(options.integrity, "utf8"));
if (options.sse && raw) {
  const sse = JSON.parse(readFileSync(options.sse, "utf8"));
  // Cada conexión debería recibir todos los comentarios creados en su proyecto (una sola instancia).
  report.realtime = Object.entries(sse.connectionsPerProject).map(([projectId, connections]) => {
    const created = raw.commentsByProject[projectId] || 0;
    const received = sse.commentEventsByProject[projectId] || 0;
    return { connections, created, expectedEvents: created * connections, projectId, received };
  });
}

// Criterios de aceptación (orientativos). 429 y 503 se informan aparte: no se dan por buenos sin análisis.
const kinds = report.byKind || {};
const unexpected5xx = raw ? Object.values(raw.groups.kind).reduce((sum, bucket) => sum + Object.entries(bucket.statuses).filter(([status]) => Number(status) >= 500 && Number(status) !== 503).reduce((total, [, value]) => total + value, 0), 0) : 0;
const totalRequests = raw ? Object.values(raw.groups.kind).reduce((sum, bucket) => sum + bucket.durations.length, 0) : 0;
report.acceptance = {
  dataIntegrity: report.integrity ? report.integrity.ok === true : null,
  eventLoopP99: report.backend?.eventLoopP99Ms ? report.backend.eventLoopP99Ms.max < ACCEPTANCE.eventLoopP99Ms : null,
  heapStable: report.backend?.heapGrowthMbPerHour == null ? null : report.backend.heapGrowthMbPerHour < ACCEPTANCE.heapGrowthMbPerHour,
  jsonP95: kinds.json ? kinds.json.p95Ms < ACCEPTANCE.jsonP95Ms : null,
  noAuthFailures: report.k6 ? report.k6.authFailures === 0 : null,
  noCrashes: report.backend ? report.backend.crashes === 0 : null,
  unexpectedServerErrors: totalRequests ? unexpected5xx / totalRequests < ACCEPTANCE.unexpectedServerErrorRate : null,
  writeP95: kinds.write ? kinds.write.p95Ms < ACCEPTANCE.writeP95Ms : null,
};
if (report.byScenario?.recovery) {
  report.acceptance.recoveredAfterSaturation = report.byScenario.recovery.p95Ms < ACCEPTANCE.jsonP95Ms
    && report.byScenario.recovery.status["5xx (sin 503)"] === 0 && report.byScenario.recovery.status[503] === 0;
}
report.thresholds = ACCEPTANCE;

if (options.out) writeFileSync(options.out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
