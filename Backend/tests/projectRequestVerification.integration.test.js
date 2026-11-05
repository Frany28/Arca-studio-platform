import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Código de validación del envío contra PostgreSQL real con todas las migraciones. Opcional y
// aislada: ARCA_PROJECT_REQUEST_VERIFICATION_DB_TESTS=1 y
// ARCA_PROJECT_REQUEST_VERIFICATION_TEST_DATABASE_URL (solo localhost). El correo se simula.
const enabled = process.env.ARCA_PROJECT_REQUEST_VERIFICATION_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_PROJECT_REQUEST_VERIFICATION_DB_TESTS=1 y ARCA_PROJECT_REQUEST_VERIFICATION_TEST_DATABASE_URL.";

let database;
let modules;
let seed;
const sentCodes = [];

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_PROJECT_REQUEST_VERIFICATION_TEST_DATABASE_URL,
    prefix: "arca_request_code",
  });
  Object.assign(process.env, {
    DATABASE_URL: database.databaseUrl,
    MAIL_FROM: "ARCA <no-reply@example.test>",
    NODE_ENV: "test",
    RESEND_API_KEY: "test-key",
  });
  // Proveedor de correo simulado: registra el código enviado.
  globalThis.fetch = async (_url, options) => {
    sentCodes.push(JSON.parse(options.body).text.match(/\b(\d{6})\b/)[1]);
    return { ok: true, json: async () => ({}) };
  };
  modules = {
    ...(await import("../src/config/db.js")),
    ...(await import("../src/services/projectRequestVerificationService.js")),
    ...(await import("../src/services/projectRequestService.js")),
    ...(await import("../src/validation/projectRequestSchemas.js")),
  };
  const { client } = database;
  const roleId = (await client.query("insert into public.roles (code, name) values ('client', 'Cliente prueba') returning id")).rows[0].id;
  const clientId = Number((await client.query(`insert into public.clients (name, email, phone, address, city, country)
    values ('Cliente prueba', 'cliente@example.test', '+584120000002', 'Prueba', 'Caracas', 'VE') returning id`)).rows[0].id);
  const insertUser = async (email, phone) => Number((await client.query(`insert into public.users (role_id, client_id, email, first_name, last_name, password_hash, phone)
    values ($1, $2, $3, 'Prueba', 'Código', '!login-disabled!', $4) returning id`, [roleId, clientId, email, phone])).rows[0].id);
  const userId = await insertUser("codigo@example.test", "+584120000001");
  const otherUserId = await insertUser("otro@example.test", "+584120000003");
  seed = {
    other: { clientId, email: "otro@example.test", id: otherUserId, role: { code: "client" } },
    user: { clientId, email: "codigo@example.test", id: userId, role: { code: "client" } },
  };
});

after(async () => {
  if (!enabled) return;
  await modules?.pool?.end().catch(() => {});
  await database?.drop();
});

/**
 * Crea un borrador completo propio del usuario de prueba.
 *
 * @returns {Promise<number>} Id de la solicitud.
 */
async function createDraft() {
  const { body: payload } = modules.createProjectRequestSchema.parse({
    body: {
      capitalAvailability: "available_now", description: "Vivienda unifamiliar de dos plantas frente al lago.",
      developmentMode: "full", investmentRange: "10k_50k", landStatus: "unavailable",
      projectLocation: "Maracaibo, Estado Zulia", projectName: `Código ${randomUUID().slice(0, 8)}`,
      projectType: "residential", startTime: "immediate", submissionId: randomUUID(),
    },
  });
  const draft = await modules.createProjectRequest({ payload, user: seed.user });
  return draft.id;
}

const resetCooldown = (id) => database.client.query("update public.project_requests set verification_sent_at = now() - interval '2 minutes' where id = $1", [id]);
const codeState = async (id) => (await database.client.query(
  "select status, verification_code_hash, verification_attempts, verified_at from public.project_requests where id = $1",
  [id],
)).rows[0];

test("PostgreSQL real: emisión con plazo de reenvío, intentos, bloqueo y uso único", { skip }, async () => {
  const id = await createDraft();
  const submit = (verificationCode, user = seed.user) => modules.submitProjectRequest({ projectRequestId: id, user, verificationCode });

  // Sin código emitido no hay envío.
  await assert.rejects(submit("123456"), { code: "VERIFICATION_CODE_REQUIRED" });

  await modules.issueProjectRequestVerificationCode({ projectRequestId: id, user: seed.user });
  await assert.rejects(modules.issueProjectRequestVerificationCode({ projectRequestId: id, user: seed.user }), { code: "VERIFICATION_CODE_RECENTLY_SENT", status: 429 });
  const code = sentCodes.at(-1);
  assert.notEqual((await codeState(id)).verification_code_hash, code, "solo se guarda el HMAC");

  // Otro usuario del mismo cliente no puede usar el código ni la solicitud.
  await assert.rejects(submit(code, seed.other), { code: "PROJECT_REQUEST_NOT_FOUND" });

  const wrong = code === "000000" ? "111111" : "000000";
  await assert.rejects(submit(wrong), { code: "VERIFICATION_CODE_INVALID" });
  assert.equal((await codeState(id)).verification_attempts, 1, "el intento fallido se confirma");
  assert.equal((await codeState(id)).status, "draft");

  const submitted = await submit(code);
  assert.equal(submitted.status, "pending_verification");
  const consumed = await codeState(id);
  assert.equal(consumed.verification_code_hash, null, "uso único");
  assert.ok(consumed.verified_at);
});

test("PostgreSQL real: el código se bloquea tras los intentos permitidos y uno nuevo lo reemplaza", { skip }, async () => {
  const id = await createDraft();
  await modules.issueProjectRequestVerificationCode({ projectRequestId: id, user: seed.user });
  const first = sentCodes.at(-1);
  const wrong = first === "000000" ? "111111" : "000000";
  for (let attempt = 1; attempt < modules.PROJECT_REQUEST_VERIFICATION.maxAttempts; attempt += 1) {
    await assert.rejects(modules.submitProjectRequest({ projectRequestId: id, user: seed.user, verificationCode: wrong }), { code: "VERIFICATION_CODE_INVALID" });
  }
  await assert.rejects(modules.submitProjectRequest({ projectRequestId: id, user: seed.user, verificationCode: wrong }), { code: "VERIFICATION_CODE_LOCKED" });
  await assert.rejects(modules.submitProjectRequest({ projectRequestId: id, user: seed.user, verificationCode: first }), { code: "VERIFICATION_CODE_LOCKED" });

  await resetCooldown(id);
  await modules.issueProjectRequestVerificationCode({ projectRequestId: id, user: seed.user });
  const second = sentCodes.at(-1);
  assert.equal((await codeState(id)).verification_attempts, 0, "un código nuevo reinicia los intentos");
  if (first !== second) {
    await assert.rejects(modules.submitProjectRequest({ projectRequestId: id, user: seed.user, verificationCode: first }), { code: "VERIFICATION_CODE_INVALID" });
  }
  assert.equal((await modules.submitProjectRequest({ projectRequestId: id, user: seed.user, verificationCode: second })).status, "pending_verification");
});

test("PostgreSQL real: dos envíos simultáneos con el mismo código solo cambian el estado una vez", { skip }, async () => {
  const id = await createDraft();
  await modules.issueProjectRequestVerificationCode({ projectRequestId: id, user: seed.user });
  const code = sentCodes.at(-1);
  const results = await Promise.allSettled([
    modules.submitProjectRequest({ projectRequestId: id, user: seed.user, verificationCode: code }),
    modules.submitProjectRequest({ projectRequestId: id, user: seed.user, verificationCode: code }),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  // El segundo devuelve la solicitud ya enviada (reintento idempotente) o la rechaza por estado.
  assert.ok(fulfilled.length >= 1);
  for (const result of results.filter((item) => item.status === "rejected")) {
    assert.equal(result.reason.code, "PROJECT_REQUEST_NOT_SUBMITTABLE");
  }
  const audits = await database.client.query(
    "select count(*)::int as total from public.audit_logs where action = 'project_request.submit' and entity_id = $1",
    [id],
  );
  assert.equal(audits.rows[0].total, 1);
});
