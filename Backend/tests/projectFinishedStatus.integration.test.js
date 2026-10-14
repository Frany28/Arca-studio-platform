import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const enabled = process.env.ARCA_PROJECT_STATUS_DB_TESTS === "1";
const runPsql = promisify(execFile);

// Nunca usa DATABASE_URL de staging. Crea y elimina exclusivamente su propia base local vacía.
test("PostgreSQL local: migra datos existentes sin pérdida y verifica finished en repositorios reales", {
  skip: !enabled && "Requiere PostgreSQL local y ARCA_PROJECT_STATUS_DB_TESTS=1.",
}, async () => {
  const url = new URL(process.env.ARCA_PROJECT_STATUS_TEST_DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "La prueba rechaza hosts remotos.");
  const { default: pg } = await import("pg");
  const databaseName = `arca_finished_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url.toString(), ssl: false, connectionTimeoutMillis: 5000 });
  let client;
  let created = false;
  let applicationPool;
  try {
    await admin.connect();
    // Nombre interno generado, sin entradas externas y limitado a caracteres seguros.
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    client = new pg.Client({ connectionString: url.toString(), ssl: false });
    await client.connect();
    const migrationDirectory = new URL("../prisma/migrations/", import.meta.url);
    const newMigration = "20261013000000_project_finished_status";
    for (const name of (await readdir(migrationDirectory)).filter((name) => /^\d/.test(name) && name < newMigration).sort()) {
      // psql ejecuta las sentencias históricas respetando sus transacciones explícitas.
      // Un único mensaje pg con todo el archivo creaba una transacción implícita e
      // impedía usar valores de enum recién añadidos en migraciones anteriores.
      await runPsql(process.env.ARCA_PROJECT_STATUS_TEST_PSQL || "psql", [
        "-X", "-v", "ON_ERROR_STOP=1", "-f",
        fileURLToPath(new URL(`${name}/migration.sql`, migrationDirectory)),
      ], {
        env: {
          ...process.env,
          PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
          PGPORT: url.port || "5432",
          PGDATABASE: databaseName,
          PGUSER: decodeURIComponent(url.username),
          PGPASSWORD: decodeURIComponent(url.password),
          PGSSLMODE: "disable",
          PGOPTIONS: "",
        },
        windowsHide: true,
      });
    }
    const migrationSql = await readFile(new URL(`${newMigration}/migration.sql`, migrationDirectory), "utf8");
    const roleId = (await client.query("insert into public.roles (code, name) values ('admin', 'Admin prueba') returning id")).rows[0].id;
    const userId = (await client.query(`insert into public.users (role_id, email, first_name, last_name, password_hash, phone)
      values ($1, 'finished@example.test', 'Prueba', 'Estado', '!login-disabled!', '+584120000001') returning id`, [roleId])).rows[0].id;
    const clientId = (await client.query(`insert into public.clients (name, email, phone, address, city, country)
      values ('Cliente prueba', 'client@example.test', '+584120000002', 'Prueba', 'Caracas', 'VE') returning id`)).rows[0].id;
    const projects = [];
    for (const status of ["pending", "in_process", "completed", "archived", "cancelled"]) {
      const row = (await client.query(`insert into public.projects
        (client_id, created_by, assigned_architect_id, name, status, archived_from_status, start_date,
          end_date, project_type, location, public_slug, progress, created_at, updated_at)
        values ($1, $2, $2, $3, $4::public.project_status,
          case when $4 = 'archived' then 'completed'::public.project_status else null end,
          '2026-01-01', '2026-12-31', 'residential', 'Caracas', $3, 100,
          '2026-01-01T10:00:00Z', '2026-10-01T10:00:00Z') returning *`,
      [clientId, userId, `project-${status}`, status])).rows[0];
      projects.push(row);
    }
    const finishedId = Number(projects[2].id);
    const archivedId = Number(projects[3].id);
    const stageId = (await client.query(`insert into public.project_stages (project_id, name, status, completed_at)
      values ($1, 'Etapa finalizada', 'completed', '2026-10-01T10:00:00Z') returning id`, [finishedId])).rows[0].id;
    await client.query(`insert into public.project_milestones (project_id, stage_id, title, due_date, status, completed_at)
      values ($1, $2, 'Hito finalizado', '2026-10-01', 'completed', '2026-10-01T10:00:00Z')`, [finishedId, stageId]);
    await client.query(`insert into public.project_status_history (project_id, changed_by, previous_status, new_status, note, changed_at)
      values ($1, $2, 'in_process', 'completed', 'Entrega histórica', '2026-10-01T10:00:00Z'),
        ($1, $2, 'completed', 'archived', 'Archivo histórico', '2026-10-02T10:00:00Z'),
        ($1, $2, 'pending', 'in_process', 'Inicio', '2026-09-01T10:00:00Z')`, [finishedId, userId]);
    await client.query(`insert into public.audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
      values ($1, 'project.archive', 'project', $2, '{"status":"completed"}', '{"status":"archived"}')`, [userId, archivedId]);
    // Comprueba dependencias reales de un índice parcial sobre la etiqueta histórica.
    await client.query("create index idx_test_finalized on public.projects(id) where status = 'completed'::public.project_status");
    const tables = ["projects", "project_stages", "project_milestones", "project_status_history", "audit_logs"];
    /**
     * Captura todas las filas del dominio y su auditoría para comparar la migración.
     * Usa consultas secuenciales porque comparten una conexión PostgreSQL de preparación.
     * @returns {Promise<Record<string, object[]>>} Filas completas ordenadas por ID en cada tabla.
     */
    async function readStoredProjectSnapshot() {
      const rowsByTable = {};
      for (const table of tables) {
        rowsByTable[table] = (await client.query(`select to_jsonb(t) as row from public.${table} t order by id`)).rows.map(({ row }) => row);
      }
      return rowsByTable;
    }
    const before = await readStoredProjectSnapshot();
    const enumBefore = (await client.query("select oid from pg_enum where enumtypid = 'public.project_status'::regtype and enumlabel = 'completed'")).rows[0].oid;
    const indexBefore = (await client.query("select 'public.idx_test_finalized'::regclass::oid as oid")).rows[0].oid;

    // Una incompatibilidad en el historial debe revertir también el cambio de enum.
    await client.query("alter table public.project_status_history add constraint test_reject_finished check (new_status <> 'finished')");
    await assert.rejects(client.query(migrationSql), { code: "23514" });
    await client.query("rollback");
    assert.deepEqual(await readStoredProjectSnapshot(), before);
    assert.equal((await client.query("select enumlabel from pg_enum where oid = $1", [enumBefore])).rows[0].enumlabel, "completed");
    await client.query("alter table public.project_status_history drop constraint test_reject_finished");
    await client.query(migrationSql);
    const after = await readStoredProjectSnapshot();
    const expected = structuredClone(before);
    for (const table of tables.filter((table) => table !== "audit_logs")) {
      for (const row of expected[table]) {
        for (const field of ["status", "archived_from_status", "previous_status", "new_status"]) {
          if (row[field] === "completed") row[field] = "finished";
        }
      }
    }
    assert.deepEqual(after, expected, "solo cambian etiquetas: preserva todas las filas, relaciones, fechas y responsables");
    assert.equal((await client.query("select enumlabel from pg_enum where oid = $1", [enumBefore])).rows[0].enumlabel, "finished");
    assert.equal((await client.query("select 'public.idx_test_finalized'::regclass::oid as oid")).rows[0].oid, indexBefore);
    assert.match((await client.query("select pg_get_indexdef($1) as definition", [indexBefore])).rows[0].definition, /finished/);
    await assert.rejects(client.query("select 'completed'::public.project_status"), { code: "22P02" });
    assert.equal((await client.query("select count(*)::int as total from public.projects where status = $1::public.project_status", ["finished"])).rows[0].total, 1);

    process.env.DATABASE_URL = url.toString();
    process.env.DATABASE_SSL = "false";
    const { pool } = await import("../src/config/db.js");
    applicationPool = pool;
    // El pool real se configura exclusivamente con la URL local de esta base efímera.
    // Sus conexiones independientes permiten validar las transacciones reales del repositorio.
    const { manageAdminProjects } = await import("../src/services/adminDashboardService.js");
    const { assertProjectOperationallyMutable, changeProjectPublication } = await import("../src/services/projectService.js");
    const { listProjectsForUser, findProjectDetailForUser } = await import("../src/repositories/projectRepository.js");
    const { getAdminDashboardMetrics, getAdminDashboardOverview } = await import("../src/repositories/adminDashboardRepository.js");
    const user = { id: Number(userId), role: { code: "admin" } };
    const run = (action, projectIds, isPublic) => manageAdminProjects({ action, projectIds, isPublic, userId: Number(userId) });
    assert.equal((await listProjectsForUser(user, { limit: 100 })).items.find(({ id }) => id === finishedId).status, "finished");
    assert.equal((await findProjectDetailForUser(finishedId, user)).status, "finished");
    assert.equal((await getAdminDashboardMetrics()).activeProjects.total, 2);
    assert.ok((await getAdminDashboardOverview()).recentActivity.some(({ title }) => title === "Entrega finalizada"));
    await assert.rejects(assertProjectOperationallyMutable(finishedId), { code: "PROJECT_FINALIZED" });
    assert.equal((await run("change_visibility", [finishedId], true))[0].isPublic, true);
    await assert.rejects(run("change_visibility", [Number(projects[0].id)], true), { code: "VALIDATION_ERROR" });
    await assert.rejects(changeProjectPublication({ projectId: Number(projects[0].id), isPublic: true, user }), { code: "PROJECT_NOT_FINISHED" });
    assert.equal((await run("archive", [finishedId]))[0].status, "archived");
    await assert.rejects(run("change_visibility", [finishedId], true), { code: "VALIDATION_ERROR" });
    const restored = await run("unarchive", [finishedId, archivedId]);
    assert.ok(restored.every(({ status, isPublic }) => status === "finished" && isPublic === false));
    assert.equal((await changeProjectPublication({ projectId: finishedId, isPublic: true, user })).isPublic, true);
    await client.query("update public.projects set status = 'finished' where id = $1", [Number(projects[1].id)]);
    assert.equal((await getAdminDashboardMetrics()).activeProjects.total, 1);
    const createdProject = (await client.query(`insert into public.projects
      (client_id, created_by, name, start_date, project_type, location, public_slug)
      values ($1, $2, 'Proyecto nuevo', current_date, 'residential', 'Caracas', 'project-new') returning status`, [clientId, userId])).rows[0];
    assert.equal(createdProject.status, "pending");
  } finally {
    if (applicationPool) await applicationPool.end();
    if (client) { await client.query("rollback").catch(() => {}); await client.end(); }
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin.end();
  }
});
