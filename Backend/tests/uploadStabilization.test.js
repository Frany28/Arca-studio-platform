import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

// P0-1: cargas sin conexiones retenidas durante la transferencia. El transporte simulado nunca
// consulta la base configurada ni requiere dotenv; modela transacciones (los cambios solo son
// visibles tras COMMIT), el estado bloqueado del proyecto o la solicitud y el almacenamiento.
// La concurrencia con bloqueos reales de PostgreSQL se prueba en uploadConcurrency.integration.test.js.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.SUPABASE_STORAGE_BUCKET = "test-bucket";
process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID = "test-access-key";
process.env.SUPABASE_STORAGE_S3_ENDPOINT = "https://storage.test.local/s3";
process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY = "test-secret-key";

const { pool } = await import("../src/config/db.js");
const { objectStorage } = await import("../src/services/objectStorage.js");
const { uploadProjectFile } = await import("../src/repositories/fileRepository.js");
const { uploadProjectRequestAttachment } = await import("../src/services/projectRequestFileService.js");
const { uploadSupportRequestFile } = await import("../src/repositories/supportRepository.js");

const user = { clientId: 7, id: 70, role: { code: "client" } };

/**
 * Crea una promesa controlable desde fuera para pausar la transferencia simulada.
 * Permite comprobar el estado del pool mientras una carga está en curso.
 *
 * @returns {{ promise: Promise<void>, resolve: Function }} Promesa y su resolución.
 */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * Sustituye PostgreSQL y el almacenamiento por un modelo en memoria con transacciones.
 * Registra las conexiones prestadas para demostrar que ninguna queda retenida durante `put`.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura los mocks.
 * @param {object} [options] - Comportamiento simulado.
 * @returns {object} Estado observable de la base y del almacenamiento.
 */
function mockUploadBackend(context, {
  commitThenDisconnect = false,
  deleteFails = false,
  failVersionInsert = false,
  projectStatus = "in_process",
  putGate = null,
  putFails = null,
  requestStatus = "draft",
  existingRequestFiles = 0,
} = {}) {
  const state = {
    activeConnections: 0,
    connectionsDuringPut: [],
    deleted: [],
    files: new Map(),
    nextId: 100,
    projectStatus,
    releases: 0,
    requestStatus,
    stored: new Map(),
    connects: 0,
  };
  for (let index = 0; index < existingRequestFiles; index += 1) {
    state.files.set(900 + index, { project_request_id: 31, size: 1, title: `previo-${index}.pdf`, uploaded_by: 70 });
  }

  /**
   * Resuelve las sentencias que el código ejecuta fuera de transacciones, sobre datos confirmados.
   *
   * @param {string} sql - Sentencia.
   * @param {Array<unknown>} params - Parámetros.
   * @returns {{ rows: Array<object> }} Resultado.
   */
  function autocommit(sql, params = []) {
    if (/nextval/.test(sql)) return { rows: [{ id: String(state.nextId++) }] };
    if (/select 1 from public\.files where id = \$1/.test(sql)) return { rows: state.files.has(Number(params[0])) ? [{}] : [] };
    if (/select 1 from public\.support_request_files/.test(sql)) return { rows: state.files.has(Number(params[0])) ? [{}] : [] };
    if (/insert into public\.support_request_files/.test(sql)) {
      state.files.set(Number(params[0]), { title: params[3] });
      return { rows: [{ created_at: new Date(), file_extension: "pdf", file_size: "4", file_type: "application/pdf", id: String(params[0]), original_name: params[3], support_request_id: String(params[1]) }] };
    }
    if (/lower\(title\)/.test(sql)) return { rows: findDuplicate(sql, params, state.files) };
    if (/from public\.project_requests/.test(sql)) {
      return { rows: ["draft", "changes_requested"].includes(state.requestStatus) ? [{ client_id: 7, id: 31, requested_by: 70, status: state.requestStatus }] : [] };
    }
    if (/count\(\*\)::integer as file_count/.test(sql)) return { rows: [usage(state.files)] };
    return { rows: [] };
  }

  // FOR UPDATE como en PostgreSQL: la fila queda bloqueada hasta COMMIT o ROLLBACK.
  const rowLocks = new Map();
  /**
   * Espera a que la fila quede libre y la bloquea para la transacción que la pide.
   *
   * @param {string} key - Fila bloqueada.
   * @returns {Promise<Function>} Función que libera el bloqueo.
   */
  async function lockRow(key) {
    while (rowLocks.has(key)) await rowLocks.get(key).promise;
    const lock = deferred();
    rowLocks.set(key, lock);
    return () => {
      rowLocks.delete(key);
      lock.resolve();
    };
  }

  context.mock.method(pool, "query", async (sql, params) => autocommit(String(sql), params));
  context.mock.method(pool, "connect", async () => {
    state.connects += 1;
    state.activeConnections += 1;
    const staged = new Map();
    const heldLocks = [];
    const releaseLocks = () => heldLocks.splice(0).forEach((release) => release());
    return {
      async query(sql, params = []) {
        const text = String(sql);
        if (text === "begin") return { rows: [] };
        if (text === "rollback") { staged.clear(); releaseLocks(); return { rows: [] }; }
        if (text === "commit") {
          for (const [id, row] of staged) state.files.set(id, row);
          releaseLocks();
          if (commitThenDisconnect) throw Object.assign(new Error("connection lost after commit"), { code: "08006" });
          return { rows: [] };
        }
        if (/from public\.projects/.test(text) && /for update/.test(text)) {
          heldLocks.push(await lockRow(`project:${params[0]}`));
          return { rows: state.projectStatus === "deleted" ? [] : [{ status: state.projectStatus }] };
        }
        if (/from public\.project_requests/.test(text) && /for update/.test(text)) {
          heldLocks.push(await lockRow(`request:${params[0]}`));
          return { rows: ["draft", "changes_requested"].includes(state.requestStatus) ? [{ id: 31 }] : [] };
        }
        if (/lower\(title\)/.test(text)) return { rows: findDuplicate(text, params, new Map([...state.files, ...staged])) };
        if (/count\(\*\)::integer as file_count/.test(text)) return { rows: [usage(new Map([...state.files, ...staged]))] };
        if (/insert into public\.files/.test(text)) {
          const isRequest = /\(\s*id,\s*project_request_id,/.test(text);
          staged.set(Number(params[0]), {
            project_id: isRequest ? null : Number(params[1]),
            project_request_id: isRequest ? Number(params[1]) : null,
            size: 0,
            title: params[3],
            uploaded_by: Number(params[2]),
          });
          return { rows: [{ current_version: 1, file_category: params[5], file_type: params[4], id: String(params[0]), project_id: isRequest ? null : String(params[1]), project_request_id: isRequest ? String(params[1]) : null, uploaded_by: String(params[2]) }] };
        }
        if (/insert into public\.file_versions/.test(text)) {
          if (failVersionInsert) {
            throw Object.assign(new Error("simulated version insert failure"), { code: "23514" });
          }
          staged.get(Number(params[0])).size = Number(params[7]);
          return { rows: [{ created_at: new Date(), file_name: params[3], file_size: String(params[7]), file_url: params[5], id: "1", original_name: params[4], version_number: 1 }] };
        }
        throw new Error(`Sentencia no simulada: ${text}`);
      },
      release() {
        state.releases += 1;
        state.activeConnections -= 1;
      },
    };
  });

  context.mock.method(objectStorage, "put", async ({ body, key }) => {
    state.connectionsDuringPut.push(state.activeConnections);
    for await (const _chunk of body) { /* consume el flujo como el almacenamiento real */ }
    if (putGate) await putGate;
    state.connectionsDuringPut.push(state.activeConnections);
    if (putFails) throw putFails;
    state.stored.set(key, true);
    return {};
  });
  context.mock.method(objectStorage, "delete", async (key) => {
    if (deleteFails) throw Object.assign(new Error("storage down"), { code: "ECONNREFUSED" });
    state.deleted.push(key);
    state.stored.delete(key);
    return {};
  });

  return state;
}

/**
 * Busca un título igual (sin distinguir mayúsculas) entre los archivos visibles.
 *
 * @param {string} sql - Sentencia de búsqueda de duplicados.
 * @param {Array<unknown>} params - Parámetros de la sentencia.
 * @param {Map<number, object>} files - Archivos visibles.
 * @returns {Array<object>} Duplicado encontrado o lista vacía.
 */
function findDuplicate(sql, params, files) {
  const isRequest = /project_request_id = \$1/.test(sql);
  const title = String(isRequest ? params[2] : params[1]).toLowerCase();
  for (const [id, file] of files) {
    const sameParent = isRequest
      ? file.project_request_id === Number(params[0]) && file.uploaded_by === Number(params[1])
      : file.project_id === Number(params[0]);
    if (sameParent && String(file.title).toLowerCase() === title) return [{ id: String(id), title: file.title }];
  }
  return [];
}

/**
 * Calcula el uso de adjuntos de la solicitud simulada.
 *
 * @param {Map<number, object>} files - Archivos visibles.
 * @returns {{ file_count: number, total_bytes: string }} Uso con la forma de pg.
 */
function usage(files) {
  const requestFiles = [...files.values()].filter((file) => file.project_request_id === 31);
  return { file_count: requestFiles.length, total_bytes: String(requestFiles.reduce((total, file) => total + file.size, 0)) };
}

/**
 * Prepara una carga de proyecto con un PDF mínimo.
 *
 * @param {string} [name] - Nombre original del archivo.
 * @returns {object} Opciones para uploadProjectFile.
 */
function projectUpload(name = "plano.pdf") {
  return { body: Readable.from([Buffer.from("%PDF")]), contentType: "application/pdf", originalName: name, projectId: 15, size: 4, user };
}

test("cinco cargas simultáneas no retienen conexiones durante la transferencia y una consulta paralela no espera", async (context) => {
  const gate = deferred();
  const state = mockUploadBackend(context, { putGate: gate.promise });
  const uploads = Array.from({ length: 5 }, (_, index) => uploadProjectFile(projectUpload(`plano-${index}.pdf`)));

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(state.connects, 0, "ninguna carga toma una conexión mientras transfiere");
  // Equivale a crear un comentario durante la carga: obtiene conexión sin esperar a las transferencias.
  const startedAt = Date.now();
  const client = await pool.connect();
  client.release();
  assert.ok(Date.now() - startedAt < 50);

  gate.resolve();
  const results = await Promise.all(uploads);
  assert.equal(new Set(results.map((file) => file.id)).size, 5);
  assert.ok(state.connectionsDuringPut.every((active) => active === 0));
  assert.equal(state.files.size, 5);
  assert.equal(state.stored.size, 5);
  assert.equal(state.activeConnections, 0, "todas las conexiones se liberan");
  assert.equal(state.releases, state.connects);
});

test("error del almacenamiento durante la transferencia: sin filas, sin conexiones y objeto compensado", async (context) => {
  const state = mockUploadBackend(context, { putFails: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
  await assert.rejects(uploadProjectFile(projectUpload()), { code: "ECONNRESET" });
  assert.equal(state.connects, 0, "un fallo de transferencia no abre transacciones");
  assert.equal(state.files.size, 0);
  assert.equal(state.deleted.length, 1, "un plazo agotado pudo dejar el objeto guardado: se elimina");
  assert.equal(state.stored.size, 0);
});

test("fallo de base de datos tras transferir: rollback, objeto eliminado y conexión liberada", async (context) => {
  const state = mockUploadBackend(context, { failVersionInsert: true });
  await assert.rejects(uploadProjectFile(projectUpload()), { code: "23514" });
  assert.equal(state.files.size, 0, "no queda ninguna fila parcial");
  assert.equal(state.stored.size, 0, "no queda ningún objeto huérfano");
  assert.equal(state.deleted.length, 1);
  assert.equal(state.activeConnections, 0);
});

test("COMMIT de resultado incierto: si la fila existe, el objeto se conserva", async (context) => {
  const state = mockUploadBackend(context, { commitThenDisconnect: true });
  await assert.rejects(uploadProjectFile(projectUpload()), { code: "08006" });
  assert.equal(state.files.size, 1, "la fila confirmada se mantiene");
  assert.equal(state.stored.size, 1, "su objeto no se elimina, para no dejar una fila sin archivo");
  assert.equal(state.deleted.length, 0);
  assert.equal(state.activeConnections, 0);
});

test("el proyecto se archiva, finaliza o elimina durante la carga: se rechaza y se compensa", async (context) => {
  for (const [status, expected] of [["archived", { code: "PROJECT_ARCHIVED", status: 409 }], ["finished", { code: "PROJECT_FINALIZED", status: 409 }], ["deleted", { code: "PROJECT_NOT_FOUND", status: 404 }]]) {
    const gate = deferred();
    const state = mockUploadBackend(context, { putGate: gate.promise });
    const upload = uploadProjectFile(projectUpload());
    await new Promise((resolve) => setTimeout(resolve, 10));
    state.projectStatus = status;
    gate.resolve();
    await assert.rejects(upload, expected, status);
    assert.equal(state.files.size, 0, status);
    assert.equal(state.stored.size, 0, status);
    assert.equal(state.activeConnections, 0, status);
    context.mock.restoreAll();
  }
});

test("dos cargas simultáneas con el mismo nombre: una se registra y la otra se rechaza sin huérfanos", async (context) => {
  const gate = deferred();
  const state = mockUploadBackend(context, { putGate: gate.promise });
  const uploads = [uploadProjectFile(projectUpload("Plano.pdf")), uploadProjectFile(projectUpload("plano.PDF"))];
  await new Promise((resolve) => setTimeout(resolve, 10));
  gate.resolve();
  const results = await Promise.allSettled(uploads);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "DUPLICATE_PROJECT_FILE");
  assert.equal(state.files.size, 1);
  assert.equal(state.stored.size, 1);
});

test("si la compensación falla se registra el objeto huérfano y se conserva el error original", async (context) => {
  const warnings = [];
  context.mock.method(console, "warn", (message) => warnings.push(message));
  mockUploadBackend(context, { deleteFails: true, failVersionInsert: true });
  await assert.rejects(uploadProjectFile(projectUpload()), { code: "23514" });
  const event = JSON.parse(warnings.find((message) => message.includes("storage_orphan_candidate")));
  assert.equal(event.reason, "delete_failed");
  assert.match(event.key, /^projects\/15\/users\/70\//);
});

test("solicitud: enviada durante la carga se rechaza y los límites se aplican bajo bloqueo", async (context) => {
  const gate = deferred();
  const state = mockUploadBackend(context, { putGate: gate.promise });
  const upload = uploadProjectRequestAttachment({
    projectRequestId: 31,
    upload: { body: Readable.from([Buffer.from("%PDF")]), contentType: "application/pdf", originalName: "anexo.pdf", size: 4 },
    user,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  state.requestStatus = "pending_review";
  gate.resolve();
  await assert.rejects(upload, { code: "PROJECT_REQUEST_NOT_FOUND", status: 404 });
  assert.equal(state.files.size, 0);
  assert.equal(state.stored.size, 0);
  context.mock.restoreAll();

  const limitGate = deferred();
  const limited = mockUploadBackend(context, { existingRequestFiles: 8, putGate: limitGate.promise });
  const uploads = ["a.pdf", "b.pdf", "c.pdf"].map((name) => uploadProjectRequestAttachment({
    projectRequestId: 31,
    upload: { body: Readable.from([Buffer.from("%PDF")]), contentType: "application/pdf", originalName: name, size: 4 },
    user,
  }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  limitGate.resolve();
  const results = await Promise.allSettled(uploads);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 2, "8 previos + 2 = máximo de 10");
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "PROJECT_REQUEST_FILE_LIMIT");
  assert.equal([...limited.files.values()].filter((file) => file.project_request_id === 31).length, 10);
  assert.equal(limited.stored.size, 2);
});

test("soporte: el adjunto se registra después de transferir y se compensa si falla el registro", async (context) => {
  const state = mockUploadBackend(context);
  const file = await uploadSupportRequestFile({ body: Readable.from([Buffer.from("%PDF")]), contentType: "application/pdf", originalName: "a.pdf", size: 4, supportRequestId: 11, user });
  assert.equal(file.id, 100);
  assert.equal(state.connects, 0);
  assert.equal(state.stored.size, 1);
  context.mock.restoreAll();

  const failing = mockUploadBackend(context);
  context.mock.method(pool, "query", async (sql, params) => {
    if (/insert into public\.support_request_files/.test(sql)) throw Object.assign(new Error("fk"), { code: "23503" });
    if (/nextval/.test(sql)) return { rows: [{ id: "300" }] };
    return { rows: [] };
  });
  await assert.rejects(uploadSupportRequestFile({ body: Readable.from([Buffer.from("%PDF")]), contentType: "application/pdf", originalName: "a.pdf", size: 4, supportRequestId: 11, user }), { code: "23503" });
  assert.equal(failing.stored.size, 0);
  assert.equal(failing.deleted.length, 1);
});
