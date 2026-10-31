import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

// P0-3: plazos explícitos en el almacenamiento, Resend y Geoapify. Los plazos se reducen a 60 ms
// para comprobar que ninguna operación queda pendiente indefinidamente. El transporte simulado nunca
// consulta la base configurada, ni Resend, ni Geoapify, ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.SUPABASE_STORAGE_BUCKET = "test-bucket";
process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID = "test-access-key";
process.env.SUPABASE_STORAGE_S3_ENDPOINT = "https://storage.test.local/s3";
process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY = "test-secret-key";
process.env.STORAGE_REQUEST_TIMEOUT_MS = "60";
process.env.STORAGE_UPLOAD_TIMEOUT_MS = "60";
process.env.EMAIL_REQUEST_TIMEOUT_MS = "60";
process.env.GEOAPIFY_REQUEST_TIMEOUT_MS = "60";
process.env.RESEND_API_KEY = "test-resend-key";
process.env.MAIL_FROM = "ARCA <no-reply@example.test>";
process.env.GEOAPIFY_API_KEY = "test-geoapify-key";

const { pool } = await import("../src/config/db.js");
const { getSupabaseS3Client } = await import("../src/config/storage.js");
const { objectStorage } = await import("../src/services/objectStorage.js");
const { uploadProjectFile } = await import("../src/repositories/fileRepository.js");
const { sendPasswordResetEmail } = await import("../src/services/passwordResetEmailService.js");
const { sendRegistrationEmail } = await import("../src/services/registrationEmailService.js");
const { getAddressSuggestions } = await import("../src/controllers/geoapifyController.js");
const { normalizeError } = await import("../src/errors/appError.js");

/**
 * Sustituye el envío del cliente S3: los comandos indicados quedan colgados hasta que se cancelan.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura el mock.
 * @param {Set<string>} hangingCommands - Nombres de comandos que nunca responden.
 * @returns {Array<{ command: string, signal: AbortSignal }>} Envíos registrados.
 */
function mockS3(context, hangingCommands) {
  const calls = [];
  context.mock.method(getSupabaseS3Client(), "send", (command, { abortSignal } = {}) => {
    const name = command.constructor.name;
    calls.push({ command: name, signal: abortSignal });
    if (!hangingCommands.has(name)) return Promise.resolve({ Body: Readable.from([Buffer.from("ok")]) });
    return new Promise((_resolve, reject) => {
      abortSignal.addEventListener("abort", () => reject(Object.assign(new Error("Request aborted"), { name: "AbortError" })));
    });
  });
  return calls;
}

/**
 * Sustituye `fetch`: espera hasta que la señal se cancele o falla como una red caída.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura el mock.
 * @param {"hang"|"network"} mode - Comportamiento del proveedor.
 * @returns {{ calls: () => number }} Número de llamadas.
 */
function mockFetch(context, mode) {
  // AbortSignal.timeout usa un temporizador sin referencia: en el servidor lo mantiene vivo el
  // servidor HTTP; aquí, sin él, el proceso de pruebas terminaría antes de que venza el plazo.
  const keepAlive = setInterval(() => {}, 1000);
  context.after(() => clearInterval(keepAlive));
  let calls = 0;
  context.mock.method(globalThis, "fetch", (_url, { signal } = {}) => {
    calls += 1;
    if (mode === "network") return Promise.reject(new TypeError("fetch failed"));
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  });
  return { calls: () => calls };
}

/**
 * Ejecuta el controlador de Geoapify con una respuesta simulada y devuelve estado y cuerpo.
 *
 * @param {string} text - Texto buscado.
 * @returns {Promise<{ status: number, body: object, error: unknown }>} Respuesta.
 */
async function callGeoapify(text) {
  const response = { body: null, error: null, status: 0 };
  const res = {
    json(body) { response.body = body; return this; },
    setHeader() {},
    status(code) { response.status = code; return this; },
  };
  await getAddressSuggestions({ query: { q: text } }, res, (error) => { response.error = error; });
  return response;
}

test("almacenamiento: una lectura sin respuesta termina con STORAGE_TIMEOUT 504 en el plazo", async (context) => {
  mockS3(context, new Set(["GetObjectCommand"]));
  const startedAt = Date.now();
  const error = await objectStorage.get("projects/1/key").catch((caught) => caught);
  assert.equal(error.code, "STORAGE_TIMEOUT");
  assert.equal(normalizeError(error).status, 504);
  assert.doesNotMatch(normalizeError(error).message, /projects\/1\/key|storage\.test\.local/);
  assert.ok(Date.now() - startedAt < 1000);
});

test("almacenamiento: una respuesta recibida a tiempo no se cancela después durante la descarga", async (context) => {
  const calls = mockS3(context, new Set());
  const object = await objectStorage.get("projects/1/key");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(calls[0].signal.aborted, false, "el plazo no corta cuerpos que ya se están leyendo");
  object.Body.resume();
});

test("carga: si el almacenamiento no responde se agota el plazo, se compensa y no se abre ninguna transacción", async (context) => {
  const calls = mockS3(context, new Set(["PutObjectCommand"]));
  context.mock.method(pool, "query", async (sql) => (/nextval/.test(sql) ? { rows: [{ id: "500" }] } : { rows: [] }));
  context.mock.method(pool, "connect", async () => { throw new Error("no debería abrir transacciones"); });
  const error = await uploadProjectFile({
    body: Readable.from([Buffer.from("%PDF")]),
    contentType: "application/pdf",
    originalName: "plano.pdf",
    projectId: 15,
    size: 4,
    user: { id: 70 },
  }).catch((caught) => caught);
  assert.equal(error.code, "STORAGE_TIMEOUT");
  assert.deepEqual(calls.map((call) => call.command), ["PutObjectCommand", "DeleteObjectCommand"]);
  assert.equal(pool.connect.mock.callCount(), 0);
});

test("Resend: recuperación y registro agotan el plazo con 504, sin reintentos ni datos internos", async (context) => {
  const fetchMock = mockFetch(context, "hang");
  const resetError = await sendPasswordResetEmail({ email: "a@example.test", expiresInMinutes: 15, resetUrl: "https://app.test/x" }).catch((caught) => caught);
  assert.equal(resetError.code, "EMAIL_SERVICE_TIMEOUT");
  assert.equal(normalizeError(resetError).status, 504);
  assert.equal(normalizeError(resetError).message, "No pudimos enviar el correo de recuperación.");
  const registrationError = await sendRegistrationEmail({ email: "a@example.test", registrationUrl: "https://app.test/y" }).catch((caught) => caught);
  assert.equal(registrationError.code, "EMAIL_SERVICE_TIMEOUT");
  assert.equal(normalizeError(registrationError).message, "No pudimos enviar el correo de verificación.");
  assert.equal(fetchMock.calls(), 2, "un correo no se reintenta: podría enviarse dos veces");
});

test("Resend: un proveedor inalcanzable responde 502 con el mensaje público", async (context) => {
  mockFetch(context, "network");
  const error = await sendPasswordResetEmail({ email: "a@example.test", expiresInMinutes: 15, resetUrl: "https://app.test/x" }).catch((caught) => caught);
  assert.equal(error.code, "EMAIL_SERVICE_UNAVAILABLE");
  assert.equal(normalizeError(error).status, 502);
});

test("Geoapify: búsqueda y coordenadas agotan el plazo con 504; la red caída responde 502", async (context) => {
  const hanging = mockFetch(context, "hang");
  const search = await callGeoapify("Avenida Libertador");
  assert.equal(search.status, 504);
  assert.equal(search.body.code, "GEOAPIFY_TIMEOUT");
  assert.doesNotMatch(JSON.stringify(search.body), /test-geoapify-key/);
  const reverse = await callGeoapify("10.5, -66.9");
  assert.equal(reverse.status, 504);
  assert.equal(hanging.calls(), 2);
  context.mock.restoreAll();

  mockFetch(context, "network");
  const unavailable = await callGeoapify("Avenida Libertador");
  assert.equal(unavailable.status, 502);
  assert.equal(unavailable.body.code, "GEOAPIFY_REQUEST_FAILED");
  assert.equal(unavailable.error, null);
});
