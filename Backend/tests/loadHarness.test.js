import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { classifyStatus, sessionCookieFrom, sessionHeaders } from "../load-tests/session.js";

// P0-4: el arnés de carga usa la cookie de sesión real. Los scripts de k6 importan módulos de k6 y no
// se pueden ejecutar con Node; se comprueban su configuración y el módulo común de sesión.
const loadTestsDirectory = new URL("../load-tests/", import.meta.url);

test("extrae la cookie de sesión de desarrollo y de producción, sola o junto a otras", () => {
  assert.equal(sessionCookieFrom(["arca_session=abc.def.ghi; Max-Age=43200; Path=/; HttpOnly; SameSite=Lax"]), "arca_session=abc.def.ghi");
  assert.equal(sessionCookieFrom("__Host-arca_session=tok; Path=/; HttpOnly; Secure; SameSite=Lax"), "__Host-arca_session=tok");
  // k6 une varias Set-Cookie en una cadena; las fechas Expires contienen comas.
  assert.equal(sessionCookieFrom("other=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/, arca_session=xyz; Path=/; HttpOnly"), "arca_session=xyz");
  assert.equal(sessionCookieFrom(["arca_session=; Max-Age=0; Path=/"]), null, "una cookie vacía (logout) no es una sesión");
  assert.equal(sessionCookieFrom(undefined), null);
  assert.deepEqual(sessionHeaders("arca_session=x", "https://app.test", { Range: "bytes=0-1" }), { Cookie: "arca_session=x", Origin: "https://app.test", Range: "bytes=0-1" });
});

test("separa límites legítimos, saturación y fallos de autenticación de los errores del sistema", () => {
  assert.equal(classifyStatus(200), "ok");
  assert.equal(classifyStatus(206), "ok");
  assert.equal(classifyStatus(429), "rate_limited");
  assert.equal(classifyStatus(503), "saturated");
  assert.equal(classifyStatus(401), "auth_failure");
  assert.equal(classifyStatus(403), "auth_failure");
  assert.equal(classifyStatus(500), "server_error");
  assert.equal(classifyStatus(409), "client_error");
  assert.equal(classifyStatus(0), "network_error");
});

test("ningún script lee un token del cuerpo ni usa Authorization Bearer", async () => {
  const files = (await readdir(loadTestsDirectory)).filter((name) => /\.(m?js)$/.test(name));
  assert.ok(files.length >= 5);
  for (const file of files) {
    const source = await readFile(new URL(file, loadTestsDirectory), "utf8");
    assert.doesNotMatch(source, /json\(["']token["']\)|\)\.token\b|Bearer \$\{/, file);
  }
});

test("escenarios A–H: 10, 25, 50 y 100 usuarios, 60 minutos sostenidos y saturación con recuperación", async () => {
  const config = await readFile(new URL("config.js", loadTestsDirectory), "utf8");
  for (const profile of ["A: constant(10)", "B: constant(25)", "C: constant(50)", "D: constant(100)", 'E: constant(Number(__ENV.SOAK_VUS || 50), __ENV.DURATION || "60m")']) {
    assert.ok(config.includes(profile), profile);
  }
  assert.match(config, /recovery: \{ duration: "3m", executor: "constant-vus", startTime: "4m"/);
  assert.match(config, /"system_errors\{scenario:spike\}"/);
  assert.match(config, /auth_failures: \["count==0"\]/);
  assert.match(config, /expectedStatuses\(\{ min: 200, max: 399 \}, 429\)/);
  assert.match(config, /"p\(95\)", "p\(99\)"/);
  assert.match(config, /assertLocalTarget\(baseUrl\)/);
  assert.match(config, /@loadtest\.invalid/);
  for (const workload of ["mixed-workload.js", "file-workload.js", "comments-workload.js"]) {
    const source = await readFile(new URL(workload, loadTestsDirectory), "utf8");
    assert.match(source, /login\(baseUrl, accounts\)/, workload);
    assert.match(source, /profileOptions\(/, workload);
  }
});

test("aislamiento: rechaza bases, almacenamiento, servicios y destinos reales; acepta el entorno de carga", async () => {
  const { collectAccountViolations, collectIsolationViolations, collectTargetViolations } = await import("../load-tests/env/isolation.mjs");
  const valid = {
    ARCA_LOADTEST: "1",
    AUTH_TOKEN_SECRET: "loadtest-secret-ficticio-0123456789abcdef",
    DATABASE_URL: "postgres://loadtest:x@postgres:5432/arca_loadtest",
    SUPABASE_STORAGE_BUCKET: "arca-loadtest-files",
    SUPABASE_STORAGE_S3_ENDPOINT: "http://minio:9000",
  };
  assert.deepEqual(collectIsolationViolations(valid), []);
  const rejected = {
    "base de Supabase": { DATABASE_URL: "postgres://u:p@aws-0-x.pooler.supabase.com:5432/postgres" },
    "base local de desarrollo": { DATABASE_URL: "postgres://u@localhost:5432/arca_dev" },
    "bucket real": { SUPABASE_STORAGE_BUCKET: "project-files" },
    "almacenamiento de Supabase": { SUPABASE_STORAGE_S3_ENDPOINT: "https://x.supabase.co/storage/v1/s3" },
    "clave de Resend": { RESEND_API_KEY: "re_ficticia" },
    "clave de Geoapify": { GEOAPIFY_API_KEY: "ficticia" },
    "sin confirmación": { ARCA_LOADTEST: "" },
    "secreto de otro entorno": { AUTH_TOKEN_SECRET: "x".repeat(48) },
    "URL pública": { FRONTEND_URL: "https://arcastudio.netlify.app" },
  };
  for (const [name, change] of Object.entries(rejected)) {
    assert.ok(collectIsolationViolations({ ...valid, ...change }).length > 0, name);
  }
  assert.deepEqual(collectTargetViolations("http://backend:3000"), []);
  assert.ok(collectTargetViolations("https://sistema-web-arca-studio.vercel.app").length > 0);
  assert.deepEqual(collectAccountViolations([{ email: "client-001@loadtest.invalid" }]), []);
  assert.ok(collectAccountViolations([{ email: "persona@ejemplo.com" }]).length > 0, "las cuentas reales o de demostración se rechazan");
});

test("collect-results: RPS, percentiles por endpoint, 429/503/5xx por separado, backend y entrega SSE", async (context) => {
  // Datos sintéticos para comprobar los cálculos del script; no son resultados de ninguna prueba.
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const directory = await mkdtemp(join(tmpdir(), "arca-collect-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const start = Date.parse("2026-01-01T00:00:00Z");
  const point = (offsetSeconds, value, tags) => JSON.stringify({ data: { tags, time: new Date(start + offsetSeconds * 1000).toISOString(), value }, metric: "http_req_duration", type: "Point" });
  const raw = [];
  for (let index = 0; index < 100; index += 1) raw.push(point(index / 10, index + 1, { endpoint: "projects-list", kind: "json", scenario: "main", status: "200" }));
  raw.push(point(5, 40, { endpoint: "comment-create", kind: "write", project: "7", scenario: "main", status: "201" }));
  raw.push(point(6, 10, { endpoint: "comment-create", kind: "write", project: "7", scenario: "main", status: "429" }));
  raw.push(point(7, 900, { endpoint: "projects-list", kind: "json", scenario: "main", status: "503" }));
  raw.push(point(10, 50, { endpoint: "projects-list", kind: "json", scenario: "main", status: "500" }));
  const metrics = [0, 5, 10].map((offset, index) => JSON.stringify({
    cpu: { percent: 20 + index }, databasePool: { active: index, idle: 1, waiting: 0 }, eventLoopDelayMs: { p99: 10 + index },
    memory: { heapUsedBytes: 50 * 1048576, rssBytes: 100 * 1048576 }, requests: { count: 30, saturated: index === 1 ? 1 : 0 },
    timestamp: new Date(start + offset * 1000).toISOString(), type: "runtime_metrics",
  }));
  await writeFile(join(directory, "raw.json"), `${raw.join("\n")}\n`);
  await writeFile(join(directory, "metrics.jsonl"), `${metrics.join("\n")}\n`);
  await writeFile(join(directory, "sse.json"), JSON.stringify({ commentEventsByProject: { 7: 2 }, connectionsPerProject: { 7: 2 } }));
  const output = await new Promise((resolve, reject) => execFile(process.execPath, [
    new URL("../load-tests/env/collect-results.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    "--scenario=prueba", `--k6-raw=${join(directory, "raw.json")}`, `--metrics=${join(directory, "metrics.jsonl")}`, `--sse=${join(directory, "sse.json")}`,
  ], (error, stdout) => (error ? reject(error) : resolve(stdout))));
  const report = JSON.parse(output);
  assert.equal(report.window.seconds, 10);
  const list = report.byEndpoint["projects-list"];
  assert.equal(list.requests, 102);
  assert.equal(list.p50Ms, 50, "1..100 más 50 y 900: la mediana de 102 valores es 50");
  assert.deepEqual(list.status, { "2xx": 100, "4xx (sin 429)": 0, 429: 0, 503: 1, "5xx (sin 503)": 1, "sin respuesta": 0 });
  assert.equal(report.byEndpoint["comment-create"].status[429], 1);
  assert.equal(report.byKind.write.requests, 2);
  assert.deepEqual(report.realtime, [{ connections: 2, created: 1, expectedEvents: 2, projectId: "7", received: 2 }]);
  assert.equal(report.backend.samples, 3);
  assert.equal(report.backend.saturated503, 1);
  assert.equal(report.backend.eventLoopP99Ms.max, 12);
  assert.equal(report.acceptance.unexpectedServerErrors, false, "un 500 entre 104 peticiones supera el umbral");
  assert.equal(report.acceptance.eventLoopP99, true);
});
