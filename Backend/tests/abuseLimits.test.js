import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.AUTH_TOKEN_SECRET = "test-secret-with-sufficient-entropy-for-abuse-limits";
process.env.SUPABASE_STORAGE_BUCKET = "test-bucket";
process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID = "test-access-key";
process.env.SUPABASE_STORAGE_S3_ENDPOINT = "https://storage.test.local/s3";
process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY = "test-secret-key";

const { pool } = await import("../src/config/db.js");
const { objectStorage } = await import("../src/services/objectStorage.js");
const { default: geoapifyRouter } = await import("../src/routes/geoapify.js");
const { default: supportRouter } = await import("../src/routes/support.js");
const { createSupportRequest } = await import("../src/controllers/supportController.js");
const { ACTION_RATE_LIMITS } = await import("../src/middlewares/actionRateLimits.js");
const { uploadSupportAttachment } = await import("../src/services/supportFileService.js");

const handlers = (router, path) => router.stack.find((layer) => layer.route?.path === path).route.stack.map((layer) => layer.handle.name || "anon");

test("Geoapify: cada consulta pasa por un límite por usuario antes de llamar al proveedor", () => {
  // Regresión (auditoría #12): la ruta solo exigía sesión y cualquier cliente podía agotar la cuota.
  assert.deepEqual(handlers(geoapifyRouter, "/address-suggestions"), ["requireAuth", "sharedRateLimit", "getAddressSuggestions"]);
  assert.deepEqual(ACTION_RATE_LIMITS.addressSuggestions, { max: 120, windowMs: 600_000 });
});

test("soporte: crear solicitudes está limitado por usuario", () => {
  // Regresión (auditoría #14).
  assert.deepEqual(handlers(supportRouter, "/requests"), ["requireAuth", "anon", "sharedRateLimit", "createSupportRequest"]);
  assert.deepEqual(ACTION_RATE_LIMITS.supportRequests, { max: 10, windowMs: 3_600_000 });
});

test("soporte: un tipo de incidencia desconocido o enorme se rechaza sin persistir", async (context) => {
  const queries = [];
  context.mock.method(pool, "query", async (sql) => { queries.push(sql); return { rows: [] }; });
  const response = { body: null, statusCode: 0, json(value) { this.body = value; return this; }, status(code) { this.statusCode = code; return this; } };
  await createSupportRequest({ body: { description: "Detalle", issueType: "x".repeat(90_000), subject: "Asunto" }, user: { id: 7 } }, response, (error) => { throw error; });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "INVALID_SUPPORT_ISSUE_TYPE");
  assert.equal(queries.length, 0);
});

/**
 * Simula PostgreSQL y el almacenamiento para una solicitud de soporte con `existing` adjuntos.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura los mocks.
 * @param {{ existing: number, existingBytes?: number }} usage - Uso actual de la solicitud.
 * @returns {{ stored: Array<string> }} Claves transferidas.
 */
function mockSupportBackend(context, { existing, existingBytes = 0 }) {
  const stored = [];
  context.mock.method(pool, "query", async (sql) => (
    /count\(\*\)::integer as file_count/.test(sql)
      ? { rows: [{ file_count: existing, total_bytes: String(existingBytes) }] }
      : { rows: [] }
  ));
  context.mock.method(objectStorage, "put", async ({ key }) => { stored.push(key); return {}; });
  return { stored };
}

const upload = (size = 4) => ({ body: Readable.from([Buffer.from("%PDF")]), contentType: "application/pdf", originalName: "a.pdf", size });

test("soporte: la cuota por solicitud rechaza el archivo 11 antes de transferir", async (context) => {
  // Regresión (auditoría #13): los adjuntos de soporte no tenían límite de número ni de bytes.
  const { stored } = mockSupportBackend(context, { existing: 10 });
  await assert.rejects(uploadSupportAttachment({ supportRequestId: 11, upload: upload(), user: { id: 7 } }), { code: "SUPPORT_REQUEST_FILE_LIMIT" });
  assert.equal(stored.length, 0);
});

test("soporte: la cuota por solicitud rechaza superar 200 MB en total", async (context) => {
  const { stored } = mockSupportBackend(context, { existing: 1, existingBytes: 200 * 1024 * 1024 });
  await assert.rejects(uploadSupportAttachment({ supportRequestId: 11, upload: upload(), user: { id: 7 } }), { code: "SUPPORT_REQUEST_TOTAL_SIZE_LIMIT" });
  assert.equal(stored.length, 0);
});
