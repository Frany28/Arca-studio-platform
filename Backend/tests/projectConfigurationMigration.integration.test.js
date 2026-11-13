import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

const migration = "20261113120000_project_draft_configuration";
const checksum = "7e5aa94035425b39ea49d325c0c9eba050b44c3c3b8c53ecaeb06eeea2475635";
const skip = process.env.ARCA_REQUEST_LIFECYCLE_DB_TESTS !== "1" && "Requiere PostgreSQL local desechable y ARCA_REQUEST_LIFECYCLE_DB_TESTS=1.";

/**
 * Ejecuta los mismos scripts que psql, retirando únicamente su metacomando ON_ERROR_STOP.
 * Recoge todas las filas para verificar los indicadores y comparar las huellas completas.
 *
 * @param {import("pg").Client} client - Cliente de la base temporal.
 * @param {string} name - preflight o postcheck.
 * @returns {Promise<object[]>} Resultados de todas las consultas del script.
 */
async function checkRows(client, name) {
  const source = await readFile(new URL(`../prisma/checks/${migration}/${name}.sql`, import.meta.url), "utf8");
  const results = await client.query(source.replace(/^\\.*$/gm, ""));
  return results.flatMap((result) => result.rows);
}

/**
 * Exige que cada indicador ok_* sea verdadero, incluyendo las filas esperadas ausentes.
 * Da el nombre de la comprobación fallida sin volcar datos de la base.
 *
 * @param {object[]} rows - Filas del script de comprobación.
 * @returns {void}
 */
function assertChecks(rows) {
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith("ok_")) assert.equal(value, true, `${row.name || row.table_name || "check"}.${key}`);
    }
  }
}

test("Fase 1.1: preflight, timeout con rollback, migración original y postcheck preservan datos existentes", { skip }, async () => {
  const database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_REQUEST_LIFECYCLE_TEST_DATABASE_URL,
    createApiRoles: true,
    prefix: "arca_configuration_migration",
    stopBefore: migration,
  });
  const { client } = database;
  const blocker = new pg.Client({ connectionString: database.databaseUrl, ssl: false });
  try {
    const role = (await client.query("insert into public.roles (code, name) values ('admin', 'Admin') returning id")).rows[0].id;
    const user = (await client.query("insert into public.users (role_id, email, first_name, last_name, password_hash) values ($1, 'migration@example.test', 'Prueba', 'Migración', '!disabled!') returning id", [role])).rows[0].id;
    const owner = (await client.query("insert into public.clients (name, email) values ('Prueba', 'owner@example.test') returning id")).rows[0].id;
    const project = (await client.query(`insert into public.projects (client_id, created_by, name, start_date, project_type, location, has_plans, public_slug)
      values ($1,$2,'Proyecto existente','2026-01-01','residential','Caracas',true,'existing-phase11') returning id`, [owner, user])).rows[0].id;
    await client.query(`insert into public.projects (client_id, created_by, name, status, public_slug) values ($1,$2,'Draft de cotización','draft','quote-draft-phase11')`, [owner, user]);
    const request = (await client.query(`insert into public.project_requests (client_id, requested_by, project_name, project_type, location, description, status, converted_project_id)
      values ($1,$2,'Solicitud convertida','residential','Caracas','Descripción de prueba','converted',$3) returning id`, [owner, user, project])).rows[0].id;
    const file = (await client.query(`insert into public.files (project_id, origin_project_request_id, uploaded_by, title, file_type, current_version)
      values ($1,$2,$3,'plano.pdf','document',1) returning id`, [project, request, user])).rows[0].id;
    await client.query(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size)
      values ($1,$2,1,'plano.pdf','plano.pdf','test/plan.pdf','pdf',100)`, [file, user]);

    const before = await checkRows(client, "preflight");
    assertChecks(before);
    // Un intento previo incompleto debe detectarse sin repararlo automáticamente.
    const failedId = randomUUID();
    await client.query("insert into public._prisma_migrations (id,checksum,migration_name) values ($1,$2,'test_incomplete')", [failedId, checksum]);
    assert.equal((await checkRows(client, "preflight")).find((row) => "ok_no_unfinished" in row).ok_no_unfinished, false);
    await client.query("delete from public._prisma_migrations where id = $1", [failedId]);

    await blocker.connect();
    await blocker.query("begin read only; select id from public.project_requests limit 1");
    await client.query("set lock_timeout = '100ms'");
    // El primer ALTER de projects ya ocurrió cuando el segundo ALTER espera por project_requests.
    await assert.rejects(applyMigration(client, migration), { code: "55P03" });
    await client.query("rollback; reset lock_timeout");
    await blocker.query("rollback");
    const afterTimeout = await checkRows(client, "preflight");
    assertChecks(afterTimeout);
    assert.deepEqual(afterTimeout.filter((row) => "fingerprint" in row), before.filter((row) => "fingerprint" in row));

    await applyMigration(client, migration);
    // El helper aplica SQL directamente. Simula el registro que Prisma escribe al terminar.
    await client.query("insert into public._prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count) values ($1,$2,$3,now(),1)", [randomUUID(), checksum, migration]);
    const after = await checkRows(client, "postcheck");
    assertChecks(after);
    assert.deepEqual(after.filter((row) => "fingerprint" in row), before.filter((row) => "fingerprint" in row));
    assert.equal((await checkRows(client, "preflight")).find((row) => "ok_target_not_applied" in row).ok_target_not_applied, false);
  } finally {
    await blocker.end().catch(() => {});
    await client.query("rollback").catch(() => {});
    await database.drop();
  }
});
