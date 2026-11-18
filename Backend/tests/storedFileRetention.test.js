import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Fase 1.2, B1: conservación de archivos guardados. Ninguna ruta, servicio o script elimina un
// archivo registrado (ni su objeto, ni sus versiones, ni lo retira con status 'deleted' o deleted_at).
// Solo se compensan objetos que nunca llegaron a registrarse, tras comprobar el resultado de la
// transacción. El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.SUPABASE_STORAGE_BUCKET = "test-bucket";
process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID = "test-access-key";
process.env.SUPABASE_STORAGE_S3_ENDPOINT = "https://storage.test.local/s3";
process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY = "test-secret-key";

const { pool } = await import("../src/config/db.js");
const { objectStorage } = await import("../src/services/objectStorage.js");
const { discardUnrecordedObject, storeThenRecord } = await import("../src/services/storedUpload.js");
const {
  FILE_DELETION_NOT_ALLOWED,
  rejectProjectFileDeletion,
  rejectProjectRequestFileDeletion,
} = await import("../src/services/storedFileRetentionService.js");
const { discardUnrecordedScriptObjects } = await import("../scripts/lib/discardUnrecordedScriptObjects.mjs");

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);

/**
 * Lista recursivamente los archivos de código de una carpeta del backend.
 *
 * @param {string} directory - Carpeta relativa al backend.
 * @returns {Promise<string[]>} Rutas relativas con separador "/".
 */
async function listSourceFiles(directory) {
  const entries = await readdir(path.join(BACKEND_ROOT, directory), { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(m?js)$/.test(entry.name))
    .map((entry) => path.relative(BACKEND_ROOT, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

/**
 * Devuelve los archivos de src/ y scripts/ cuyo código coincide con el patrón.
 *
 * @param {RegExp} pattern - Patrón buscado (sin el indicador g).
 * @returns {Promise<string[]>} Rutas relativas ordenadas.
 */
async function filesMatching(pattern) {
  const files = [...(await listSourceFiles("src")), ...(await listSourceFiles("scripts"))];
  const matches = [];
  for (const file of files) {
    if (pattern.test(await readFile(path.join(BACKEND_ROOT, file), "utf8"))) matches.push(file);
  }
  return matches;
}

/**
 * Sustituye pool.query por un simulador que responde según el SQL y registra cada consulta.
 * Falla si se intenta abrir una transacción o conexión dedicada.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura los mocks.
 * @param {(sql: string, params: unknown[]) => {rows: object[]}} respond - Respuesta por consulta.
 * @returns {Array<{sql: string, params: unknown[]}>} Consultas recibidas.
 */
function mockDatabase(context, respond) {
  const calls = [];
  context.mock.method(pool, "query", async (sql, params = []) => {
    calls.push({ params, sql: String(sql) });
    return respond(String(sql), params);
  });
  context.mock.method(pool, "connect", async () => { throw new Error("no debería abrir transacciones"); });
  return calls;
}

/**
 * Sustituye el borrado del almacenamiento y registra las claves solicitadas.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura el mock.
 * @param {(key: string) => Promise<unknown>} [implementation] - Comportamiento del borrado.
 * @returns {string[]} Claves cuyo borrado se pidió.
 */
function mockStorageDelete(context, implementation = async () => ({})) {
  const keys = [];
  context.mock.method(objectStorage, "delete", async (key) => {
    keys.push(key);
    return implementation(key);
  });
  return keys;
}

const WRITE_SQL = /^\s*(insert|update|delete|merge|truncate|alter|drop)\b/i;
const admin = { id: 1, role: { code: "admin" } };
const architect = { id: 7, role: { code: "architect" } };
const ownerClient = { clientId: 30, id: 31, role: { code: "client" } };
const strangerClient = { clientId: 40, id: 41, role: { code: "client" } };

/**
 * Fila del archivo de proyecto que consulta findProjectFileForRemoval.
 *
 * @param {object} [overrides] - Campos a sustituir.
 * @returns {object} Fila simulada.
 */
function projectFileRow(overrides = {}) {
  return {
    assigned_architect_id: 7,
    client_id: 30,
    id: "15",
    is_assignee: false,
    is_public: false,
    project_archived_from_status: null,
    project_status: "in_process",
    uploaded_by: "7",
    ...overrides,
  };
}

test("solo la compensación de cargas y la foto de perfil (decisión pendiente) pueden borrar objetos", async () => {
  assert.deepEqual(await filesMatching(/objectStorage\.delete\(|Delete(?:Objects?)Command/), [
    "src/controllers/authController.js",
    "src/services/objectStorage.js",
    "src/services/storedUpload.js",
  ]);
});

test("ningún código retira archivos o versiones con deleted_at ni con status 'deleted'", async () => {
  const retirement = /update\s+public\.(?:files|file_versions)\b[^;`]*?\bset\b[^;`]*?(?:deleted_at\s*=|status\s*=\s*'deleted')/i;
  assert.deepEqual(await filesMatching(retirement), []);
  assert.deepEqual(await filesMatching(/delete\s+from\s+public\.(?:files|file_versions)\b/i), []);
});

test("cleanup-legacy-models.mjs termina con error sin cargar .env, PostgreSQL ni almacenamiento", async () => {
  const scriptPath = path.join(BACKEND_ROOT, "scripts", "cleanup-legacy-models.mjs");
  const source = await readFile(scriptPath, "utf8");
  assert.doesNotMatch(source, /^\s*import\b|\bimport\s*\(|require\(/m, "no importa ningún módulo");
  assert.doesNotMatch(source, /DeleteObject|objectStorage|pool/);
  // Se ejecuta desde la carpeta temporal y sin variables de entorno, lejos de cualquier .env.
  const outcome = await run(process.execPath, [scriptPath], { cwd: tmpdir(), env: { PATH: process.env.PATH } })
    .then(() => ({ code: 0, stderr: "" }), (error) => ({ code: error.code, stderr: error.stderr }));
  assert.equal(outcome.code, 1);
  assert.match(outcome.stderr, /bloqueado/);
});

test("eliminar un archivo de proyecto alcanzable responde 409 y solo lee PostgreSQL", async (context) => {
  for (const [user, row] of [[architect, projectFileRow()], [admin, projectFileRow({ uploaded_by: "99" })], [ownerClient, projectFileRow({ uploaded_by: "31" })]]) {
    const calls = mockDatabase(context, () => ({ rows: [row] }));
    const deleted = mockStorageDelete(context);
    const error = await rejectProjectFileDeletion({ fileId: 15, projectId: 3, user }).catch((caught) => caught);
    assert.equal(error.status, 409);
    assert.equal(error.code, FILE_DELETION_NOT_ALLOWED);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].sql, WRITE_SQL);
    assert.deepEqual(deleted, []);
    assert.equal(pool.connect.mock.callCount(), 0);
    context.mock.restoreAll();
  }
});

test("eliminar un archivo de proyecto no alcanzable conserva el 404 previo y el 409 de solo lectura", async (context) => {
  const cases = [
    { expected: 404, row: null, user: admin },
    { expected: 404, row: projectFileRow({ uploaded_by: "99" }), user: architect },
    { expected: 404, row: projectFileRow({ uploaded_by: "41" }), user: strangerClient },
    { expected: 404, row: projectFileRow({ project_status: "draft" }), user: architect },
    { code: "PROJECT_ARCHIVED", expected: 409, row: projectFileRow({ project_archived_from_status: "in_process", project_status: "archived" }), user: admin },
    { code: "PROJECT_FINALIZED", expected: 409, row: projectFileRow({ project_status: "finished" }), user: architect },
  ];
  for (const { code, expected, row, user } of cases) {
    mockDatabase(context, () => ({ rows: row ? [row] : [] }));
    const deleted = mockStorageDelete(context);
    const error = await rejectProjectFileDeletion({ fileId: 15, projectId: 3, user }).catch((caught) => caught);
    assert.equal(error.status, expected, JSON.stringify({ code, user: user.role.code }));
    assert.equal(error.code, code ?? "FILE_NOT_FOUND");
    assert.deepEqual(deleted, []);
    context.mock.restoreAll();
  }
});

test("eliminar un adjunto persistido de una solicitud responde 409 al propietario y al admin y 404 al resto", async (context) => {
  const row = { client_id: 30, id: "21", requested_by: "31", uploaded_by: "31" };
  for (const [user, expected] of [[ownerClient, 409], [admin, 409], [strangerClient, 404], [architect, 404]]) {
    const calls = mockDatabase(context, () => ({ rows: [row] }));
    const deleted = mockStorageDelete(context);
    const error = await rejectProjectRequestFileDeletion({ fileId: 21, projectRequestId: 9, user }).catch((caught) => caught);
    assert.equal(error.status, expected);
    assert.equal(error.code, expected === 409 ? FILE_DELETION_NOT_ALLOWED : "FILE_NOT_FOUND");
    assert.ok(calls.every((call) => !WRITE_SQL.test(call.sql)));
    assert.match(calls[0].sql, /pr\.status in \('draft', 'changes_requested'\)/, "solo una solicitud editable alcanza el adjunto");
    assert.deepEqual(deleted, []);
    context.mock.restoreAll();
  }
  // Solicitud enviada o adjunto inexistente: la consulta no devuelve filas.
  mockDatabase(context, () => ({ rows: [] }));
  const error = await rejectProjectRequestFileDeletion({ fileId: 21, projectRequestId: 9, user: ownerClient }).catch((caught) => caught);
  assert.equal(error.status, 404);
});

test("carga fallida sin registro: el objeto se compensa y se propaga el error original", async (context) => {
  const deleted = mockStorageDelete(context);
  const failure = new Error("record failed");
  const error = await storeThenRecord({
    isRecorded: async () => false,
    key: "projects/1/a.pdf",
    record: async () => { throw failure; },
    scope: "project_file",
    store: async () => ({}),
  }).catch((caught) => caught);
  assert.equal(error, failure);
  assert.deepEqual(deleted, ["projects/1/a.pdf"]);
});

test("COMMIT de resultado incierto con la fila registrada: el objeto se conserva", async (context) => {
  const deleted = mockStorageDelete(context);
  const commitLost = Object.assign(new Error("Connection terminated during COMMIT"), { code: "57P01" });
  const error = await storeThenRecord({
    isRecorded: async () => true,
    key: "projects/1/b.pdf",
    record: async () => { throw commitLost; },
    scope: "project_file",
    store: async () => ({}),
  }).catch((caught) => caught);
  assert.equal(error, commitLost);
  assert.deepEqual(deleted, [], "un archivo registrado nunca pierde su objeto");
});

test("si no se puede comprobar el registro, el objeto se conserva y queda como candidato a huérfano", async (context) => {
  const deleted = mockStorageDelete(context);
  const warnings = [];
  context.mock.method(console, "warn", (message) => warnings.push(JSON.parse(message)));
  await discardUnrecordedObject({
    isRecorded: async () => { throw new Error("database unavailable"); },
    key: "projects/1/c.pdf",
    scope: "project_file",
  });
  assert.deepEqual(deleted, []);
  assert.deepEqual(warnings.map(({ key, reason, type }) => ({ key, reason, type })), [
    { key: "projects/1/c.pdf", reason: "record_check_failed", type: "storage_orphan_candidate" },
  ]);
});

test("un borrado de compensación fallido no oculta el error original de la carga", async (context) => {
  mockStorageDelete(context, async () => { throw Object.assign(new Error("timeout"), { code: "STORAGE_TIMEOUT" }); });
  const warnings = [];
  context.mock.method(console, "warn", (message) => warnings.push(JSON.parse(message)));
  const failure = new Error("store failed");
  const error = await storeThenRecord({
    isRecorded: async () => false,
    key: "projects/1/d.pdf",
    record: async () => ({}),
    scope: "project_file",
    store: async () => { throw failure; },
  }).catch((caught) => caught);
  assert.equal(error, failure);
  assert.equal(warnings[0].reason, "delete_failed");
});

test("una carga correcta nunca borra su objeto", async (context) => {
  const deleted = mockStorageDelete(context);
  const recorded = await storeThenRecord({
    isRecorded: async () => true,
    key: "projects/1/e.pdf",
    record: async () => ({ id: 5 }),
    scope: "project_file",
    store: async () => ({}),
  });
  assert.deepEqual(recorded, { id: 5 });
  assert.deepEqual(deleted, []);
});

test("los scripts de subida solo compensan claves sin versión registrada", async (context) => {
  const recordedKeys = new Set(["projects/2/registrada.png"]);
  const calls = mockDatabase(context, (_sql, [key]) => ({ rows: recordedKeys.has(key) ? [{ "?column?": 1 }] : [] }));
  const deleted = mockStorageDelete(context);
  await discardUnrecordedScriptObjects(
    ["projects/2/registrada.png", "projects/2/huerfana.png", "projects/2/huerfana.png"],
    "maintenance_project_image",
  );
  assert.deepEqual(deleted, ["projects/2/huerfana.png"]);
  assert.ok(calls.every((call) => /from public\.file_versions where file_name = \$1/.test(call.sql)));
});
