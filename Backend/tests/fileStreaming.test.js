import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import test from "node:test";

import express from "express";

// P0-2: entrega de archivos con `pipeline`. Un fallo del almacenamiento a mitad de la descarga o una
// desconexión del navegador no deben terminar el proceso ni dejar el flujo del almacenamiento abierto.
// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.SUPABASE_URL = "https://supabase.test.local";
process.env.SUPABASE_STORAGE_BUCKET = "test-bucket";
process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID = "test-access-key";
process.env.SUPABASE_STORAGE_S3_ENDPOINT = "https://storage.test.local/s3";
process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY = "test-secret-key";

const { pool } = await import("../src/config/db.js");
const { objectStorage } = await import("../src/services/objectStorage.js");
const { streamProjectFile, streamProjectRequestFile } = await import("../src/controllers/fileController.js");
const { getProfilePhotoImage } = await import("../src/controllers/authController.js");

const FILE_SIZE = 64 * 1024;

/**
 * Simula la fila del archivo descargable con un tipo de vídeo, que se entrega en línea.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura los mocks.
 * @returns {void}
 */
function mockDownloadableFile(context) {
  context.mock.method(pool, "query", async () => ({
    rows: [{ direct_access: true, file_extension: "mp4", file_name: "key", file_size: FILE_SIZE, file_type: "video/mp4", id: "5", original_name: "recorrido.mp4", title: "recorrido", version_id: "9" }],
  }));
}

/**
 * Crea un cuerpo de almacenamiento que entrega fragmentos poco a poco y registra si se destruyó.
 *
 * @param {object} options - Comportamiento del flujo.
 * @param {number} [options.failAfterChunks] - Falla tras emitir este número de fragmentos.
 * @param {boolean} [options.endless] - Nunca termina por sí mismo.
 * @returns {Readable} Flujo simulado.
 */
function storageBody({ endless = false, failAfterChunks = Infinity } = {}) {
  let emitted = 0;
  return new Readable({
    read() {
      if (emitted >= failAfterChunks) {
        setTimeout(() => this.destroy(Object.assign(new Error("storage connection reset"), { code: "ECONNRESET" })), 5);
        return;
      }
      if (!endless && emitted * 1024 >= FILE_SIZE) {
        this.push(null);
        return;
      }
      emitted += 1;
      setTimeout(() => this.push(Buffer.alloc(1024, 1)), 2);
    },
  });
}

/**
 * Inicia una aplicación con los controladores reales de descarga y un usuario autenticado.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor.
 * @returns {Promise<number>} Puerto del servidor.
 */
async function startApp(context) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 1, profilePhotoUrl: "https://supabase.test.local/storage/v1/object/public/test-bucket/users/1/profile-photo/2026/10/foto.png", role: { code: "admin" } };
    next();
  });
  app.get("/projects/:projectId/files/:fileId/content", streamProjectFile);
  app.get("/project-requests/:projectRequestId/files/:fileId/content", streamProjectRequestFile);
  app.get("/profile-photo", getProfilePhotoImage);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

/**
 * Descarga una ruta y devuelve el estado, las cabeceras y los bytes recibidos o el error de red.
 *
 * @param {number} port - Puerto del servidor.
 * @param {string} path - Ruta.
 * @param {object} [headers] - Cabeceras adicionales.
 * @returns {Promise<{ status: number, headers: object, bytes: number, completed: boolean }>} Resultado.
 */
function download(port, path, headers = {}) {
  return new Promise((resolve) => {
    const request = http.get({ headers, host: "127.0.0.1", path, port }, (response) => {
      let bytes = 0;
      response.on("data", (chunk) => { bytes += chunk.length; });
      response.on("end", () => resolve({ bytes, completed: response.complete, headers: response.headers, status: response.statusCode }));
      response.on("error", () => resolve({ bytes, completed: false, headers: response.headers, status: response.statusCode }));
      response.on("aborted", () => resolve({ bytes, completed: false, headers: response.headers, status: response.statusCode }));
    });
    request.on("error", () => resolve({ bytes: 0, completed: false, headers: {}, status: 0 }));
  });
}

/**
 * Espera hasta que se cumpla la condición o se agote el plazo.
 *
 * @param {() => boolean} condition - Condición a esperar.
 * @param {number} [timeoutMs] - Plazo máximo.
 * @returns {Promise<boolean>} true si la condición se cumplió.
 */
async function waitFor(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return condition();
}

test("error del almacenamiento a mitad de la descarga: el proceso sigue, el flujo se libera y se registra", async (context) => {
  const uncaught = [];
  const onUncaught = (error) => uncaught.push(error);
  process.on("uncaughtException", onUncaught);
  context.after(() => process.off("uncaughtException", onUncaught));
  const warnings = [];
  context.mock.method(console, "warn", (message) => warnings.push(String(message)));
  mockDownloadableFile(context);
  const bodies = [];
  context.mock.method(objectStorage, "get", async () => {
    const body = storageBody({ failAfterChunks: bodies.length === 0 ? 4 : Infinity });
    bodies.push(body);
    return { Body: body, ContentLength: FILE_SIZE, ContentType: "video/mp4" };
  });
  const port = await startApp(context);

  const failed = await download(port, "/projects/1/files/5/content");
  assert.equal(failed.status, 200, "las cabeceras ya se habían enviado");
  assert.equal(failed.completed, false, "la respuesta se corta en lugar de quedar colgada");
  assert.ok(failed.bytes < FILE_SIZE);
  assert.ok(await waitFor(() => bodies[0].destroyed));
  assert.ok(await waitFor(() => warnings.some((message) => message.includes("file_stream_failed"))), JSON.stringify(warnings));
  assert.ok(warnings.some((message) => message.includes("ECONNRESET")), JSON.stringify(warnings));
  assert.ok(warnings.every((message) => !message.includes("key")), "el registro no expone la clave del objeto");

  const next = await download(port, "/projects/1/files/5/content");
  assert.equal(next.status, 200, "un fallo aislado no afecta a otras descargas");
  assert.equal(next.bytes, FILE_SIZE);
  assert.deepEqual(uncaught, []);
});

test("desconexión del navegador durante la descarga: se destruye el flujo del almacenamiento sin registrar error", async (context) => {
  const warnings = [];
  context.mock.method(console, "warn", (message) => warnings.push(String(message)));
  mockDownloadableFile(context);
  let body;
  context.mock.method(objectStorage, "get", async () => {
    body = storageBody({ endless: true });
    return { Body: body, ContentLength: FILE_SIZE, ContentType: "video/mp4" };
  });
  const port = await startApp(context);

  await new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", path: "/projects/1/files/5/content", port }, (response) => {
      response.once("data", () => {
        request.destroy();
        resolve();
      });
    });
    request.on("error", () => {});
  });

  assert.ok(await waitFor(() => body.destroyed), "el socket hacia el almacenamiento no queda abierto");
  assert.deepEqual(warnings.filter((message) => message.includes("file_stream_failed")), [], "una cancelación no es un fallo");
});

test("descarga parcial (Range) de un adjunto de solicitud: 206 con exactamente el rango", async (context) => {
  context.mock.method(pool, "query", async () => ({
    rows: [{ file_name: "key", file_size: 10, file_type: "application/pdf", id: "5", original_name: "anexo.pdf", title: "anexo", version_id: "9" }],
  }));
  context.mock.method(objectStorage, "get", async (_key, { range } = {}) => {
    assert.equal(range, "bytes=0-3");
    return { Body: Readable.from([Buffer.from("%PDF")]), ContentLength: 4, ContentRange: "bytes 0-3/10", ContentType: "application/pdf" };
  });
  const port = await startApp(context);
  const partial = await download(port, "/project-requests/1/files/5/content", { Range: "bytes=0-3" });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers["content-range"], "bytes 0-3/10");
  assert.equal(partial.bytes, 4);
  assert.equal(partial.completed, true);
});

test("foto de perfil: un error inmediato del almacenamiento cierra la respuesta sin terminar el proceso", async (context) => {
  context.mock.method(console, "warn", () => {});
  mockDownloadableFile(context);
  let body;
  context.mock.method(objectStorage, "get", async () => {
    if (body) return { Body: storageBody(), ContentLength: FILE_SIZE, ContentType: "video/mp4" };
    body = new Readable({
      read() {
        this.destroy(Object.assign(new Error("NoSuchBucket"), { code: "NoSuchBucket" }));
      },
    });
    return { Body: body, ContentLength: 100, ContentType: "image/png" };
  });
  const port = await startApp(context);
  const result = await download(port, "/profile-photo");
  assert.equal(result.completed, false);
  assert.ok(await waitFor(() => body.destroyed));
  const healthy = await new Promise((resolve) => {
    http.get({ host: "127.0.0.1", path: "/projects/1/files/5/content", port }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", () => resolve(0));
  });
  assert.equal(healthy, 200, "el servidor sigue atendiendo");
});
