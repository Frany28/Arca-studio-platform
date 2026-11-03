// Arranque del backend para pruebas de carga (Fase 3). Igual que local.js, pero:
// - nunca carga Backend/.env (no importa dotenv): toda la configuración llega del entorno aislado;
// - comprueba el aislamiento antes de cargar la aplicación y se detiene si algo apunta a servicios reales;
// - copia los resúmenes `runtime_metrics` a LOADTEST_METRICS_FILE (JSON por línea) y registra el
//   arranque y la salida del proceso, para detectar caídas durante la prueba.
// No cambia la lógica de negocio: carga src/app.js tal cual.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { collectEgressViolations, collectIsolationViolations, failOnViolations } from "./isolation.mjs";

const violations = collectIsolationViolations();
if (process.env.LOADTEST_EXPECT_NO_EGRESS === "1") violations.push(...await collectEgressViolations());
failOnViolations(violations, "el arranque del backend");

const metricsFile = process.env.LOADTEST_METRICS_FILE;

/**
 * Añade una línea JSON al archivo de métricas del entorno, si está configurado.
 *
 * @param {object} event - Evento a registrar.
 * @returns {void}
 */
function recordEvent(event) {
  if (!metricsFile) return;
  appendFileSync(metricsFile, `${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`);
}

if (metricsFile) {
  mkdirSync(dirname(metricsFile), { recursive: true });
  const log = console.log.bind(console);
  console.log = (...args) => {
    log(...args);
    if (typeof args[0] === "string" && args[0].includes('"type":"runtime_metrics"')) appendFileSync(metricsFile, `${args[0]}\n`);
  };
}

await import("../../src/config/environmentGuard.js");
const { default: app } = await import("../../src/app.js");
const { pool } = await import("../../src/config/db.js");
const { closeAllProjectEventConnections } = await import("../../src/services/projectEvents.js");
const { beginShutdown } = await import("../../src/services/lifecycle.js");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const server = app.listen(port, host, () => {
  recordEvent({ pid: process.pid, port, type: "loadtest_server_started" });
  console.log(JSON.stringify({ port, type: "loadtest_server_ready" }));
});

process.on("exit", (code) => recordEvent({ code, pid: process.pid, type: "loadtest_server_exit" }));

let stopping = false;
/**
 * Cierra el servidor de forma ordenada, como local.js.
 *
 * @param {string} signal - Señal recibida.
 * @returns {void}
 */
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  beginShutdown();
  closeAllProjectEventConnections();
  const forceTimer = setTimeout(() => process.exit(1), 10000);
  forceTimer.unref();
  server.close(async () => {
    await pool.end();
    clearTimeout(forceTimer);
    recordEvent({ signal, type: "loadtest_server_stopped" });
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
