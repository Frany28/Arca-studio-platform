import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

// Opt-in: prueba los repositorios sobre staging/pruebas sin confirmar datos creados.
test("PostgreSQL real: creación idempotente, edición, cola y limpieza conservan el contrato del stand", {
  skip: process.env.ARCA_STAND_REPOSITORY_DB_TESTS !== "1",
}, async (context) => {
  const dotenv = await import("dotenv");
  dotenv.config({ quiet: true });
  process.env.DATABASE_URL = process.env.DATABASE_URL?.trim().replace(/^"|"$/g, "");
  const { pool } = await import("../src/config/db.js");
  const { createProjectRequestDraft, updateProjectRequestDraft, findProjectRequestOwnedByUser } = await import("../src/repositories/projectRequestRepository.js");
  const { loadProjectRequestReviewQueue } = await import("../src/services/projectRequestWorkflowService.js");
  const { createProjectRequestSchema, updateProjectRequestSchema } = await import("../src/validation/projectRequestSchemas.js");
  const client = await pool.connect();
  const snapshotSql = "select count(*)::int as requests, md5(coalesce(string_agg(md5(to_jsonb(r)::text), '' order by id), '')) as fingerprint from public.project_requests r";
  try {
    const baseline = (await client.query(snapshotSql)).rows[0];
    const source = (await client.query("select id, client_id, requested_by from public.project_requests order by id limit 1")).rows[0];
    assert.ok(source, "Se necesita una solicitud previa para referenciar cliente y solicitante.");
    await client.query("begin");
    await client.query("set local statement_timeout = '10s'");
    context.mock.method(pool, "query", (sql, values) => client.query(sql, values));
    const user = { id: Number(source.requested_by), clientId: Number(source.client_id), role: { code: "admin" } };
    const requirements = { requirementsStatus: "available", documentTypes: ["exhibitor_manual", "event_regulations"], spaceStatus: "assigned", hasSpacePlans: false };
    const body = {
      projectName: `Prueba stand ${randomUUID().slice(0, 8)}`, projectType: "advertising_stand",
      projectLocation: "Maracaibo, Estado Zulia", description: "Stand de demostración para verificar los requisitos del evento.",
      developmentMode: "full", landStatus: "unavailable", projectSize: "small_lt_80",
      investmentRange: "undefined", capitalAvailability: "available_now", startTime: "1_3_months",
      standRequirements: requirements,
    };
    const payload = createProjectRequestSchema.parse({ body: { ...body, submissionId: randomUUID() } }).body;
    const draft = await createProjectRequestDraft(user, payload);
    assert.deepEqual(draft.standRequirements, requirements);
    assert.equal((await createProjectRequestDraft(user, payload)).id, draft.id);
    assert.deepEqual((await findProjectRequestOwnedByUser(draft.id, user)).standRequirements, requirements);
    await client.query("update public.project_requests set status='pending_review' where id=$1", [draft.id]);
    const queue = await loadProjectRequestReviewQueue({ cursor: null, limit: 100, user });
    assert.deepEqual(queue.items.find((request) => request.id === draft.id).standRequirements, requirements);
    await client.query("update public.project_requests set status='changes_requested' where id=$1", [draft.id]);
    const changed = updateProjectRequestSchema.parse({ body: { ...body, projectType: "corporate", standRequirements: null }, params: { projectRequestId: draft.id } }).body;
    // Detecta huecos en parámetros SQL como $22 sin uso, que los mocks no detectan.
    const updated = await updateProjectRequestDraft(draft.id, user, changed);
    assert.equal(updated.projectType, "corporate");
    assert.equal(updated.standRequirements, null);
    assert.equal(updated.submissionId, payload.submissionId, "La edición no reemplaza el identificador de creación.");
    for (const type of ["residential", "commercial", "corporate", "stands_exhibitions"]) {
      await client.query("savepoint reject_stand");
      await assert.rejects(client.query("update public.project_requests set project_type=$1::public.project_type,stand_requirements=$2::jsonb where id=$3", [type, JSON.stringify(requirements), draft.id]), { code: "23514" });
      await client.query("rollback to savepoint reject_stand");
      await client.query("release savepoint reject_stand");
    }
    await client.query("rollback");
    assert.deepEqual((await client.query(snapshotSql)).rows[0], baseline, "No deja datos de prueba ni cambia solicitudes previas.");
  } finally {
    context.mock.restoreAll();
    try { await client.query("rollback"); }
    finally { client.release(); await pool.end(); }
  }
});

// Opt-in y URL exclusiva de una base local de pruebas; nunca usa DATABASE_URL de staging.
test("PostgreSQL: migración aditiva, históricos NULL y restricción de aplicabilidad", {
  skip: !process.env.ARCA_STAND_TEST_DATABASE_URL,
}, async () => {
  const databaseUrl = new URL(process.env.ARCA_STAND_TEST_DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname), "Usa una base local de pruebas.");
  const schema = `arca_stand_test_${randomUUID().replaceAll("-", "")}`;
  const client = new pg.Client({ connectionString: databaseUrl.href });
  await client.connect();
  try {
    // Esquema exclusivo de esta prueba: no toca tablas ni tipos existentes del proyecto.
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`CREATE TYPE ${schema}.project_type AS ENUM ('residential', 'commercial', 'corporate', 'stands_exhibitions')`);
    await client.query(`CREATE TABLE ${schema}.project_requests (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, project_type ${schema}.project_type NOT NULL)`);
    await client.query(`INSERT INTO ${schema}.project_requests (project_type) VALUES ('residential'), ('stands_exhibitions')`);
    const migration = await readFile(new URL("../prisma/migrations/20261008000000_advertising_stand_requirements/migration.sql", import.meta.url), "utf8");
    // Reubica únicamente el namespace: ejecuta el SQL real y deja commit antes de usar el enum.
    await client.query(migration.replaceAll("public.", `${schema}.`));
    const historical = await client.query(`SELECT * FROM ${schema}.project_requests ORDER BY id`);
    assert.deepEqual(historical.rows.map((row) => row.stand_requirements), [null, null]);
    assert.deepEqual(historical.rows.map((row) => row.project_type), ["residential", "stands_exhibitions"]);
    const requirements = { requirementsStatus: "available", documentTypes: ["exhibitor_manual"], spaceStatus: "assigned", hasSpacePlans: false };
    const created = await client.query(`INSERT INTO ${schema}.project_requests (project_type, stand_requirements) VALUES ('advertising_stand', $1::jsonb) RETURNING *`, [JSON.stringify(requirements)]);
    assert.deepEqual(created.rows[0].stand_requirements, requirements);
    for (const projectType of ["residential", "commercial", "corporate", "stands_exhibitions"]) {
      await assert.rejects(client.query(`INSERT INTO ${schema}.project_requests (project_type, stand_requirements) VALUES ($1, $2::jsonb)`, [projectType, JSON.stringify(requirements)]), { code: "23514" });
    }
    const changed = await client.query(`UPDATE ${schema}.project_requests SET project_type = 'corporate', stand_requirements = NULL WHERE id = $1 RETURNING *`, [created.rows[0].id]);
    assert.equal(changed.rows[0].stand_requirements, null);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.project_requests`)).rows[0].count, 3);
  } finally {
    // El nombre se genera localmente desde UUID hexadecimal y pertenece solo a esta prueba.
    try { await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await client.end(); }
  }
});
