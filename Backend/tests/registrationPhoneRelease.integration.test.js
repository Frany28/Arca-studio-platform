import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Regresión (auditoría #16) contra PostgreSQL real: el índice único de teléfono de
// user_registrations no distingue registros vencidos, y un pendiente abandonado bloqueaba el número
// para siempre. Opcional y aislada: ARCA_REGISTRATION_DB_TESTS=1 y
// ARCA_REGISTRATION_TEST_DATABASE_URL (solo localhost); nunca usa DATABASE_URL del proyecto.
const enabled = process.env.ARCA_REGISTRATION_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_REGISTRATION_DB_TESTS=1 y ARCA_REGISTRATION_TEST_DATABASE_URL.";

let database;
let repository;
let db;

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_REGISTRATION_TEST_DATABASE_URL,
    prefix: "arca_registration_phone",
  });
  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: "registration-test-secret-0123456789abcdef0123456789",
    DATABASE_URL: database.databaseUrl,
    NODE_ENV: "test",
  });
  db = await import("../src/config/db.js");
  repository = await import("../src/repositories/registrationRepository.js");
});

after(async () => {
  if (!enabled) return;
  await db?.pool?.end().catch(() => {});
  await database?.drop();
});

/**
 * Datos de un registro pendiente con el teléfono indicado.
 *
 * @param {string} email - Correo del registro.
 * @param {string} phone - Teléfono normalizado.
 * @returns {object} Payload para upsertPendingRegistration.
 */
const pending = (email, phone) => ({
  email,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  firstName: "Prueba",
  lastName: "Registro",
  phone,
  referralSource: "other",
  tokenHash: `hash-${email}`,
});

test("un pendiente vencido de otro correo ya no retiene el teléfono; uno vigente sí", { skip }, async () => {
  await repository.upsertPendingRegistration(pending("atacante@example.test", "4121234567"));

  await assert.rejects(
    repository.upsertPendingRegistration(pending("victima@example.test", "4121234567")),
    { code: "23505" },
    "mientras el pendiente ajeno esté vigente, el teléfono sigue ocupado",
  );

  await database.client.query("update public.user_registrations set expires_at = now() - interval '1 minute' where lower(email) = 'atacante@example.test'");
  const released = await repository.upsertPendingRegistration(pending("victima@example.test", "4121234567"));
  assert.equal(released.email, "victima@example.test");
  const holders = (await database.client.query("select lower(email) as email from public.user_registrations where phone = '4121234567'")).rows;
  assert.deepEqual(holders.map((row) => row.email), ["victima@example.test"]);
});
