import assert from "node:assert/strict";
import test from "node:test";

import { mockVerifiedSubmitTransaction, VALID_VERIFICATION_CODE } from "./helpers/projectRequestSubmitMock.js";

process.env.DATABASE_URL ||= "postgres://localhost/arca-contract-test";
const { pool } = await import("../src/config/db.js");
const {
  hashVerificationCode,
  issueProjectRequestVerificationCode,
  PROJECT_REQUEST_VERIFICATION,
  verifyAndConsumeProjectRequestCode,
} = await import("../src/services/projectRequestVerificationService.js");
const { submitProjectRequest } = await import("../src/services/projectRequestService.js");
const { submitProjectRequestSchema } = await import("../src/validation/projectRequestSchemas.js");

const USER = { clientId: 2, email: "cliente@example.test", id: 11, role: { code: "client" } };
// Borrador completo: el envío valida el registro entero antes de verificar el código.
const REQUEST_ROW = {
  capital_availability: "available_now",
  client_id: "2",
  description: "Vivienda unifamiliar de dos plantas frente al lago.",
  development_mode: "full",
  expected_start_time: "immediate",
  id: "9",
  investment_range: "10k_50k",
  land_status: "unavailable",
  legal_document_types: [],
  location: "Maracaibo, Estado Zulia",
  project_name: "Casa <Lago>",
  project_type: "residential",
  requested_by: "11",
  status: "draft",
};

/**
 * Configura un proveedor de correo simulado y devuelve los mensajes recibidos.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {{ ok?: boolean }} [options] - Respuesta del proveedor.
 * @returns {Array<object>} Cuerpos enviados a Resend.
 */
function mockEmailProvider(context, { ok = true } = {}) {
  const sent = [];
  const previous = { from: process.env.MAIL_FROM, key: process.env.RESEND_API_KEY };
  process.env.RESEND_API_KEY = "test-key";
  process.env.MAIL_FROM = "ARCA <no-reply@example.test>";
  context.after(() => {
    process.env.RESEND_API_KEY = previous.key;
    process.env.MAIL_FROM = previous.from;
    if (previous.key === undefined) delete process.env.RESEND_API_KEY;
    if (previous.from === undefined) delete process.env.MAIL_FROM;
  });
  context.mock.method(globalThis, "fetch", async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok, json: async () => ({ message: "rejected" }) };
  });
  return sent;
}

/**
 * Crea un ejecutor de transacción simulado con el estado del código bloqueado.
 *
 * @param {object} state - Fila leída con FOR UPDATE.
 * @returns {{ executor: { query: Function }, statements: Array<{ sql: string, values: Array }> }} Ejecutor y registro.
 */
function lockedExecutor(state) {
  const statements = [];
  return {
    executor: {
      async query(sql, values) {
        statements.push({ sql, values });
        if (/for update/.test(sql)) return { rows: state ? [state] : [] };
        if (/verification_attempts \+ 1/.test(sql)) return { rows: [{ verification_attempts: state.verification_attempts + 1 }] };
        return { rows: [] };
      },
    },
    statements,
  };
}

const lockedState = (overrides = {}) => ({
  status: "draft",
  verification_attempts: 0,
  verification_code_hash: hashVerificationCode({ code: "123456", projectRequestId: 9, userId: USER.id }),
  verification_expires_at: new Date(Date.now() + 60_000),
  ...overrides,
});

test("emitir guarda solo el HMAC del código, lo envía al correo del cliente y anuncia el reenvío", async (context) => {
  const sent = mockEmailProvider(context);
  const calls = [];
  context.mock.method(pool, "query", async (sql, values) => {
    calls.push({ sql, values });
    if (/set\s+verification_code_hash = \$4/.test(sql)) return { rows: [{ id: "9", verification_sent_at: new Date() }] };
    return { rows: [REQUEST_ROW] };
  });

  const result = await issueProjectRequestVerificationCode({ projectRequestId: "9", user: USER });

  const store = calls.find((call) => /set\s+verification_code_hash = \$4/.test(call.sql));
  assert.deepEqual(store.values.slice(0, 3), ["9", 2, 11], "solo una solicitud propia");
  assert.match(store.sql, /status in \('draft', 'changes_requested'\)/);
  assert.equal(store.values[5], PROJECT_REQUEST_VERIFICATION.resendCooldownSeconds);
  const [email] = sent;
  assert.deepEqual(email.to, [USER.email]);
  const code = email.text.match(/\b(\d{6})\b/)[1];
  assert.equal(store.values[3], hashVerificationCode({ code, projectRequestId: "9", userId: 11 }));
  assert.equal(store.values.includes(code), false, "el código no se persiste en claro");
  assert.match(email.html, /Casa &#60;Lago&#62;/, "el nombre se escapa en HTML");
  assert.ok(Date.parse(result.expiresAt) > Date.now());
  assert.ok(Date.parse(result.resendAvailableAt) > Date.now());
});

test("emitir dentro del plazo de reenvío responde 429 con retryAfter y no envía correo", async (context) => {
  const sent = mockEmailProvider(context);
  context.mock.method(pool, "query", async (sql) => {
    if (/set\s+verification_code_hash/.test(sql)) return { rows: [] };
    if (/select verification_sent_at/.test(sql)) return { rows: [{ verification_sent_at: new Date(Date.now() - 20_000) }] };
    return { rows: [REQUEST_ROW] };
  });

  await assert.rejects(
    issueProjectRequestVerificationCode({ projectRequestId: "9", user: USER }),
    (error) => error.status === 429 && error.code === "VERIFICATION_CODE_RECENTLY_SENT" && error.retryAfter > 30 && error.retryAfter <= 40,
  );
  assert.equal(sent.length, 0);
});

test("emitir rechaza solicitudes ajenas, ya enviadas o usuarios que no son clientes", async (context) => {
  mockEmailProvider(context);
  let row = null;
  context.mock.method(pool, "query", async (sql) => (/set\s+verification_code_hash/.test(sql) ? { rows: [] } : { rows: row ? [row] : [] }));

  await assert.rejects(issueProjectRequestVerificationCode({ projectRequestId: "9", user: USER }), { code: "PROJECT_REQUEST_NOT_FOUND", status: 404 });
  row = { ...REQUEST_ROW, status: "pending_review" };
  await assert.rejects(issueProjectRequestVerificationCode({ projectRequestId: "9", user: USER }), { code: "PROJECT_REQUEST_NOT_SUBMITTABLE", status: 409 });
  await assert.rejects(issueProjectRequestVerificationCode({ projectRequestId: "9", user: { id: 1, role: { code: "admin" } } }), { code: "CLIENT_REQUIRED", status: 403 });
});

test("si el correo no se entrega, el código se anula para poder pedir otro", async (context) => {
  mockEmailProvider(context, { ok: false });
  const calls = [];
  context.mock.method(pool, "query", async (sql, values) => {
    calls.push({ sql, values });
    if (/set\s+verification_code_hash = \$4/.test(sql)) return { rows: [{ id: "9", verification_sent_at: new Date() }] };
    return { rows: [REQUEST_ROW] };
  });

  await assert.rejects(issueProjectRequestVerificationCode({ projectRequestId: "9", user: USER }), { code: "EMAIL_DELIVERY_FAILED", status: 502 });
  const storedHash = calls.find((call) => /set\s+verification_code_hash = \$4/.test(call.sql)).values[3];
  const discard = calls.find((call) => /verification_code_hash = null/.test(call.sql));
  assert.deepEqual(discard.values, ["9", storedHash], "solo anula el código no entregado");
});

test("un código correcto se consume una sola vez dentro de la transacción", async () => {
  const { executor, statements } = lockedExecutor(lockedState());
  assert.equal(await verifyAndConsumeProjectRequestCode(executor, { code: "123456", projectRequestId: 9, user: USER }), null);
  assert.match(statements.at(-1).sql, /verification_code_hash = null[\s\S]*verified_at = now\(\)/);
});

test("un código incorrecto suma un intento e informa los restantes; al agotarlos se bloquea", async () => {
  const wrong = lockedExecutor(lockedState({ verification_attempts: 1 }));
  const error = await verifyAndConsumeProjectRequestCode(wrong.executor, { code: "000000", projectRequestId: 9, user: USER });
  assert.equal(error.code, "VERIFICATION_CODE_INVALID");
  assert.match(error.message, /Te quedan 3 intentos/);
  assert.ok(wrong.statements.some((statement) => /verification_attempts \+ 1/.test(statement.sql)));
  assert.equal(wrong.statements.some((statement) => /verified_at = now\(\)/.test(statement.sql)), false);

  const last = lockedExecutor(lockedState({ verification_attempts: PROJECT_REQUEST_VERIFICATION.maxAttempts - 1 }));
  assert.equal((await verifyAndConsumeProjectRequestCode(last.executor, { code: "000000", projectRequestId: 9, user: USER })).code, "VERIFICATION_CODE_LOCKED");

  // Bloqueado: ni siquiera el código correcto se acepta.
  const locked = lockedExecutor(lockedState({ verification_attempts: PROJECT_REQUEST_VERIFICATION.maxAttempts }));
  const lockedError = await verifyAndConsumeProjectRequestCode(locked.executor, { code: "123456", projectRequestId: 9, user: USER });
  assert.deepEqual([lockedError.code, lockedError.status], ["VERIFICATION_CODE_LOCKED", 429]);
});

test("se rechazan códigos ausentes, vencidos, de otro usuario y solicitudes que cambiaron de estado", async () => {
  const verify = (state, code = "123456", user = USER) => verifyAndConsumeProjectRequestCode(lockedExecutor(state).executor, { code, projectRequestId: 9, user });
  assert.equal((await verify(lockedState({ verification_code_hash: null }))).code, "VERIFICATION_CODE_REQUIRED");
  assert.equal((await verify(lockedState({ verification_expires_at: new Date(Date.now() - 1) }))).code, "VERIFICATION_CODE_EXPIRED");
  assert.equal((await verify(lockedState(), "123456", { ...USER, id: 12 })).code, "VERIFICATION_CODE_INVALID", "el HMAC liga el código al usuario");
  assert.equal((await verify(lockedState({ status: "pending_verification" }))).code, "PROJECT_REQUEST_NOT_SUBMITTABLE");
  assert.equal((await verify(null)).code, "PROJECT_REQUEST_NOT_SUBMITTABLE");
});

test("el envío confirma el intento fallido y no cambia el estado de la solicitud", async (context) => {
  context.mock.method(pool, "query", async (sql) => {
    if (/existing_names/.test(sql)) return { rows: [] };
    if (/with target as/.test(sql)) throw new Error("no debe enviarse");
    return { rows: [{ ...REQUEST_ROW, project_type: "residential" }] };
  });
  const statements = await mockVerifiedSubmitTransaction(context, pool, { projectRequestId: 9, userId: USER.id });

  await assert.rejects(
    submitProjectRequest({ projectRequestId: 9, user: USER, verificationCode: "999999" }),
    { code: "VERIFICATION_CODE_INVALID", status: 400 },
  );
  assert.equal(statements.at(-1), "commit", "el intento fallido queda registrado");
  assert.equal(statements.some((sql) => /with target as/.test(sql)), false);
  assert.ok(VALID_VERIFICATION_CODE !== "999999");
});

test("el endpoint de envío exige un código de seis dígitos: no se puede omitir la validación", () => {
  const params = { projectRequestId: "9" };
  assert.equal(submitProjectRequestSchema.safeParse({ body: {}, params }).success, false);
  assert.equal(submitProjectRequestSchema.safeParse({ body: { verificationCode: "12345" }, params }).success, false);
  assert.equal(submitProjectRequestSchema.safeParse({ body: { verificationCode: "12345a" }, params }).success, false);
  assert.equal(submitProjectRequestSchema.safeParse({ body: { verificationCode: "123456", extra: true }, params }).success, false);
  assert.equal(submitProjectRequestSchema.safeParse({ body: { verificationCode: "012345" }, params }).success, true);
});
