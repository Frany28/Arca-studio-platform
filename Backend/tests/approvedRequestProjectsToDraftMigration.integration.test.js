import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

const migration = "20261114120000_approved_request_projects_to_draft";
const skip = process.env.ARCA_REQUEST_LIFECYCLE_DB_TESTS !== "1" && "Requiere PostgreSQL local desechable y ARCA_REQUEST_LIFECYCLE_DB_TESTS=1.";

/**
 * Ejecuta un script de comprobación como lo haría psql, retirando sus metacomandos.
 *
 * @param {import("pg").Client} client - Cliente de la base temporal.
 * @param {"preflight"|"postcheck"} name - Script.
 * @returns {Promise<object[]>} Filas de todas sus consultas.
 */
async function checkRows(client, name) {
  const source = await readFile(new URL(`../prisma/checks/${migration}/${name}.sql`, import.meta.url), "utf8");
  const results = await client.query(source.replace(/^\\.*$/gm, ""));
  return results.flatMap((result) => result.rows);
}

/**
 * Exige que todos los indicadores ok_* del script sean verdaderos.
 *
 * @param {object[]} rows - Filas del script.
 * @returns {void}
 */
function assertChecks(rows) {
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith("ok_")) assert.equal(value, true, key);
    }
  }
}

test("migración: solo los proyectos pending de solicitudes aprobadas pasan a draft, con historial y auditoría", { skip }, async () => {
  const database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_REQUEST_LIFECYCLE_TEST_DATABASE_URL,
    createApiRoles: true,
    prefix: "arca_approved_to_draft",
    stopBefore: migration,
  });
  const { client } = database;
  try {
    const role = (await client.query("insert into public.roles (code, name) values ('admin', 'Admin') returning id")).rows[0].id;
    const admin = Number((await client.query(`insert into public.users (role_id, email, first_name, last_name, password_hash)
      values ($1, 'aprobador@example.test', 'Admin', 'Aprobador', '!disabled!') returning id`, [role])).rows[0].id);
    const owner = (await client.query("insert into public.clients (name, email) values ('Cliente', 'cliente@example.test') returning id")).rows[0].id;
    const insertProject = async (slug, status = "pending") => Number((await client.query(`
      insert into public.projects (client_id, created_by, name, status, start_date, project_type, location, has_plans, public_slug)
      values ($1, $2, $3, $4::public.project_status, '2026-01-01', 'residential', 'Caracas', true, $3) returning id`, [owner, admin, slug, status])).rows[0].id);
    const approve = (projectId, name) => client.query(`
      insert into public.project_requests (client_id, requested_by, project_name, project_type, location, description, status, converted_project_id, reviewed_by)
      values ($1, $2, $3, 'residential', 'Caracas', 'Descripción de prueba', 'converted', $4, $2)`, [owner, admin, name, projectId]);

    const approvedPending = await insertProject("aprobada-en-espera");
    const approvedInProcess = await insertProject("aprobada-en-progreso", "in_process");
    const manualPending = await insertProject("manual-en-espera");
    await approve(approvedPending, "Aprobada en espera");
    await approve(approvedInProcess, "Aprobada en progreso");
    const file = Number((await client.query(`insert into public.files (project_id, uploaded_by, title, file_type, current_version)
      values ($1, $2, 'plano.pdf', 'application/pdf', 1) returning id`, [approvedPending, admin])).rows[0].id);
    await client.query(`insert into public.project_assignees (project_id, user_id, assigned_by) values ($1, $2, $2)`, [approvedPending, admin]);
    // La configuración de borradores ya está aplicada (requisito del preflight).
    await client.query("insert into public._prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count) values ($1, 'x', '20261113120000_project_draft_configuration', now(), 1)", [randomUUID()]);

    const before = await checkRows(client, "preflight");
    assertChecks(before);
    assert.deepEqual(before.filter((row) => "project_request_id" in row && "files" in row).map((row) => Number(row.project_id)), [approvedPending], "el preflight lista solo lo que cambiará");

    await applyMigration(client, migration);
    const statuses = Object.fromEntries((await client.query("select id, status from public.projects")).rows.map((row) => [Number(row.id), row.status]));
    assert.equal(statuses[approvedPending], "draft");
    assert.equal(statuses[approvedInProcess], "in_process", "un proyecto avanzado no vuelve atrás");
    assert.equal(statuses[manualPending], "pending", "un proyecto sin solicitud no cambia");
    const history = (await client.query("select project_id, changed_by, previous_status, new_status from public.project_status_history")).rows;
    assert.deepEqual(history.map((row) => [Number(row.project_id), Number(row.changed_by), row.previous_status, row.new_status]), [[approvedPending, admin, "pending", "draft"]]);
    assert.equal(Number((await client.query("select count(*) from public.files where id = $1 and project_id = $2", [file, approvedPending])).rows[0].count), 1, "archivos conservados");
    assert.equal(Number((await client.query("select count(*) from public.project_assignees where project_id = $1", [approvedPending])).rows[0].count), 1, "encargados conservados");

    const after = await checkRows(client, "postcheck");
    assertChecks(after);
    // Reaplicar no encuentra nada que cambiar (idempotente).
    await applyMigration(client, migration);
    assert.equal(Number((await client.query("select count(*) from public.project_status_history")).rows[0].count), 1);
  } finally {
    await client.query("rollback").catch(() => {});
    await database.drop();
  }
});
