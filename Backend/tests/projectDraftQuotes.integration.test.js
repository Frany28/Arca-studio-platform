import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";
import { listMigrations } from "./helpers/migrationSchema.js";

// Proyectos draft desde cotizaciones contra PostgreSQL real. Opcional y aislada, como las demás
// pruebas de cotizaciones: ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL
// (solo localhost). Aplica el historial hasta antes de las migraciones de drafts, registra un
// proyecto existente y después aplica las tres migraciones, para comprobar que no lo alteran.
const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";
const DRAFT_MIGRATIONS = ["20261102120000_project_draft_status", "20261102121000_project_draft_requirements", "20261102122000_quote_submission_id"];

let database;
let db;
let quotes;
let catalog;
let projects;
let ids;
let legacyProjectBefore;

/**
 * Consulta la base aislada con el cliente de preparación (fuera del pool de la aplicación).
 *
 * @param {string} sql - Sentencia SQL.
 * @param {Array<unknown>} [values] - Parámetros.
 * @returns {Promise<Array<object>>} Filas.
 */
async function rows(sql, values = []) {
  return (await database.client.query(sql, values)).rows;
}

/**
 * Cuerpo validado de un alta con proyecto nuevo, como lo deja quoteCreateSchema.
 *
 * @param {string} newProjectName - Nombre normalizado del proyecto draft.
 * @param {object} [overrides] - Campos que se sustituyen.
 * @returns {object} Cuerpo del alta.
 */
function draftQuoteBody(newProjectName, overrides = {}) {
  return {
    clientId: ids.client,
    items: [{ quantity: "1.000", serviceId: ids.service, unitRate: "10.00" }],
    newProjectName,
    notes: null,
    submissionId: randomUUID(),
    ...overrides,
  };
}

/**
 * Cuenta proyectos, cotizaciones y auditorías de un nombre de proyecto.
 *
 * @param {string} name - Nombre del proyecto.
 * @returns {Promise<{ projects: number, quotes: number, audits: number }>} Recuento.
 */
async function countByProjectName(name) {
  const [counts] = await rows(`select
      (select count(*)::int from public.projects where name = $1) as projects,
      (select count(*)::int from public.quote_versions where project_name = $1) as quotes,
      (select count(*)::int from public.audit_logs where action = 'project.create_from_quote' and new_values->>'name' = $1) as audits`, [name]);
  return counts;
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL,
    prefix: "arca_project_drafts",
    stopBefore: DRAFT_MIGRATIONS[0],
  });
  const [adminRole] = await rows("insert into public.roles (code, name) values ('admin', 'Administrador') returning id");
  const [clientRole] = await rows("insert into public.roles (code, name) values ('client', 'Cliente') returning id");
  const [admin] = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'admin@arca.test', 'Admin', 'Drafts', '!integration-login-disabled!') returning id::int`, [adminRole.id]);
  const [client] = await rows("insert into public.clients (name, email) values ('Leonel Pérez', 'leonel@arca.test') returning id::int");
  const [inactiveClient] = await rows("insert into public.clients (name, email, status) values ('Inactivo', 'off@arca.test', 'inactive') returning id::int");
  const [clientUser] = await rows(`insert into public.users (role_id, client_id, email, first_name, last_name, password_hash)
    values ($1, $2, 'leonel@arca.test', 'Leonel', 'Pérez', '!integration-login-disabled!') returning id::int`, [clientRole.id, client.id]);
  const [legacy] = await rows(`insert into public.projects (client_id, created_by, name, start_date, project_type, location, public_slug, has_plans)
    values ($1, $2, 'Apto. 910', '2026-01-15', 'residential', 'Caracas', 'apto-910-drafts', true) returning id::int`, [client.id, admin.id]);
  legacyProjectBefore = (await rows("select * from public.projects where id = $1", [legacy.id]))[0];

  for (const migration of DRAFT_MIGRATIONS) await applyMigration(database.client, migration);
  // Los servicios actuales requieren también el esquema posterior (p. ej., reservas PDF).
  // Se conserva la preparación de datos previa a Draft para comprobar su compatibilidad.
  for (const migration of (await listMigrations()).filter((name) => name > DRAFT_MIGRATIONS.at(-1))) {
    await applyMigration(database.client, migration);
  }

  const [unit] = await rows("select id::int from public.measurement_units where code = 'square_meter'");
  Object.assign(process.env, { DATABASE_POOL_MAX: "6", DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  db = await import("../src/config/db.js");
  quotes = await import("../src/services/quoteService.js");
  catalog = await import("../src/services/serviceCatalogService.js");
  projects = await import("../src/repositories/projectRepository.js");
  const service = await catalog.createService({
    payload: { changeNote: null, description: null, isActive: true, measurementUnitId: unit.id, name: "Anteproyecto", referenceRate: "10.00", sortOrder: 0 },
    user: { id: admin.id },
  });
  ids = { admin: admin.id, client: client.id, clientUser: clientUser.id, inactiveClient: inactiveClient.id, legacy: legacy.id, service: service.id };
});

after(async () => {
  await db?.pool.end().catch(() => {});
  if (database) await database.drop();
});

test("migración: el proyecto existente no cambia y las restricciones quedan validadas", { skip }, async () => {
  const [legacyAfter] = await rows("select * from public.projects where id = $1", [ids.legacy]);
  assert.deepEqual(legacyAfter, legacyProjectBefore);
  const constraints = await rows(`select conname, convalidated from pg_constraint
    where conname in ('chk_projects_draft_requirements', 'chk_projects_draft_without_end_date', 'chk_project_stages_status_not_draft',
      'chk_project_milestones_status_not_draft', 'chk_quotes_submission') order by conname`);
  assert.equal(constraints.length, 5);
  assert.ok(constraints.every((constraint) => constraint.convalidated));
  const [{ labels }] = await rows("select enum_range(null::public.project_status)::text[] as labels");
  assert.deepEqual(labels, ["draft", "pending", "in_process", "finished", "cancelled", "archived"]);
});

test("alta con proyecto nuevo: draft mínimo, cotización y auditoría en la misma transacción", { skip }, async () => {
  const { quote, replayed } = await quotes.createQuote({ payload: draftQuoteBody("Casa del Lago"), user: { id: ids.admin } });
  assert.equal(replayed, false);
  const [project] = await rows(`select status::text, client_id::int, created_by::int, progress::int, is_public, has_plans, start_date,
      project_type, location, end_date, public_slug from public.projects where id = $1`, [quote.project.id]);
  assert.deepEqual(project, {
    client_id: ids.client, created_by: ids.admin, end_date: null, has_plans: null, is_public: false, location: null,
    progress: 0, project_type: null, public_slug: `casa-del-lago-${quote.project.id}`, start_date: null, status: "draft",
  });
  assert.deepEqual(quote.project, { id: quote.project.id, name: "Casa del Lago" });
  assert.deepEqual(await countByProjectName("Casa del Lago"), { audits: 1, projects: 1, quotes: 1 });
});

test("rollback: si falla la versión después de crear el draft no queda proyecto, cotización ni auditoría", { skip }, async () => {
  // Fallo forzado al insertar la versión, posterior al alta del draft y de la cotización.
  await rows(`create function public.test_fail_quote_version() returns trigger language plpgsql as $$
    begin if new.notes = 'forzar fallo' then raise exception 'fallo forzado'; end if; return new; end $$`);
  await rows("create trigger test_fail_quote_version before insert on public.quote_versions for each row execute function public.test_fail_quote_version()");
  try {
    const [{ quotes: quotesBefore }] = await rows("select count(*)::int as quotes from public.quotes");
    await assert.rejects(quotes.createQuote({ payload: draftQuoteBody("Casa revertida", { notes: "forzar fallo" }), user: { id: ids.admin } }));
    assert.deepEqual(await countByProjectName("Casa revertida"), { audits: 0, projects: 0, quotes: 0 });
    assert.equal((await rows("select count(*)::int as quotes from public.quotes"))[0].quotes, quotesBefore);
  } finally {
    await rows("drop trigger test_fail_quote_version on public.quote_versions");
    await rows("drop function public.test_fail_quote_version()");
  }
});

test("idempotencia concurrente: el mismo envío simultáneo crea una sola cotización y un solo draft", { skip }, async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const name = `Casa simultánea ${attempt}`;
    const payload = draftQuoteBody(name);
    const results = await Promise.all([1, 2, 3].map(() => quotes.createQuote({ payload: { ...payload }, user: { id: ids.admin } })));
    assert.equal(results.filter((result) => !result.replayed).length, 1, "Una sola alta real");
    assert.equal(new Set(results.map((result) => result.quote.id)).size, 1, "Todas devuelven la misma cotización");
    assert.deepEqual(await countByProjectName(name), { audits: 1, projects: 1, quotes: 1 });
  }
});

test("idempotencia: el mismo identificador con otro contenido no devuelve la cotización anterior", { skip }, async () => {
  const payload = draftQuoteBody("Casa reutilizada");
  await quotes.createQuote({ payload, user: { id: ids.admin } });
  await assert.rejects(
    quotes.createQuote({ payload: { ...payload, notes: "Otro contenido" }, user: { id: ids.admin } }),
    { code: "QUOTE_SUBMISSION_REUSED" },
  );
  assert.deepEqual(await countByProjectName("Casa reutilizada"), { audits: 1, projects: 1, quotes: 1 });
});

test("concurrencia: dos altas distintas con el mismo nombre nuevo crean un solo draft y la otra es un error del campo", { skip }, async () => {
  const results = await Promise.allSettled([1, 2].map(() => quotes.createQuote({ payload: draftQuoteBody("Casa disputada"), user: { id: ids.admin } })));
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "VALIDATION_ERROR");
  assert.ok(rejected[0].reason.fields.newProjectName);
  assert.deepEqual(await countByProjectName("Casa disputada"), { audits: 1, projects: 1, quotes: 1 });
});

test("nombres: coincidencia exacta, solicitud activa y cliente inactivo se rechazan sin escribir", { skip }, async () => {
  await rows(`insert into public.project_requests (client_id, requested_by, project_name, project_type, location, status)
    values ($1, $2, 'Casa en revisión', 'residential', 'Caracas', 'pending_review')`, [ids.client, ids.clientUser]);
  for (const [name, overrides, field] of [["apto. 910", {}, "newProjectName"], ["Casa en revisión", {}, "newProjectName"], ["Casa nueva", { clientId: ids.inactiveClient }, "clientId"]]) {
    await assert.rejects(
      quotes.createQuote({ payload: draftQuoteBody(name, overrides), user: { id: ids.admin } }),
      (error) => error.code === "VALIDATION_ERROR" && Boolean(error.fields[field]),
    );
  }
  assert.equal((await rows("select count(*)::int as total from public.projects where lower(name) in ('apto. 910', 'casa en revisión', 'casa nueva')"))[0].total, 1);
});

test("restricciones: solo un draft omite los datos técnicos; draft exclusivo de proyectos", { skip }, async () => {
  const { quote } = await quotes.createQuote({ payload: draftQuoteBody("Casa por activar"), user: { id: ids.admin } });
  const draftId = quote.project.id;
  await assert.rejects(rows("update public.projects set status = 'pending' where id = $1", [draftId]), { code: "23514", constraint: "chk_projects_draft_requirements" });
  await assert.rejects(rows("update public.projects set end_date = current_date where id = $1", [draftId]), { code: "23514", constraint: "chk_projects_draft_without_end_date" });
  await assert.rejects(
    rows("insert into public.project_stages (project_id, name, status) values ($1, 'Etapa', 'draft')", [ids.legacy]),
    { code: "23514", constraint: "chk_project_stages_status_not_draft" },
  );
  // Archivar y desarchivar (mismas sentencias que la gestión administrativa) conserva el draft.
  await rows("update public.projects set archived_from_status = status, status = 'archived', is_public = false where id = $1", [draftId]);
  await rows("update public.projects set status = coalesce(archived_from_status, 'pending'), archived_from_status = null where id = $1", [draftId]);
  assert.equal((await rows("select status::text from public.projects where id = $1", [draftId]))[0].status, "draft");
  // La transición futura draft → pending exige los datos técnicos.
  await rows(`update public.projects set status = 'pending', start_date = current_date, project_type = 'residential',
    location = 'Caracas', has_plans = false where id = $1`, [draftId]);
});

test("visibilidad: el cliente no recibe sus drafts; administración sí", { skip }, async () => {
  const { quote } = await quotes.createQuote({ payload: draftQuoteBody("Casa invisible"), user: { id: ids.admin } });
  const clientViewer = { clientId: ids.client, id: ids.clientUser, role: { code: "client" } };
  const adminViewer = { id: ids.admin, role: { code: "admin" } };
  const clientList = await projects.listProjectsForUser(clientViewer, { limit: 100 });
  assert.ok(clientList.items.some((project) => project.id === ids.legacy));
  assert.ok(!clientList.items.some((project) => project.id === quote.project.id));
  assert.equal(await projects.findProjectDetailForUser(quote.project.id, clientViewer, { fileLimit: 25 }), null);
  const adminList = await projects.listProjectsForUser(adminViewer, { limit: 100 });
  const draft = adminList.items.find((project) => project.id === quote.project.id);
  assert.deepEqual([draft.status, draft.hasPlans, draft.startDate, draft.projectType], ["draft", null, null, null]);
});

test("API directa: clientes y arquitectos (incluso asignados a la fuerza) reciben 404 en todas las rutas de un draft", { skip }, async () => {
  const { quote } = await quotes.createQuote({ payload: draftQuoteBody("Casa por API"), user: { id: ids.admin } });
  const draftId = quote.project.id;
  const [{ public_slug: draftSlug }] = await rows("select public_slug from public.projects where id = $1", [draftId]);

  // Permisos mínimos de las rutas de proyectos y un arquitecto asignado al draft saltándose la API.
  const [architectRole] = await rows("insert into public.roles (code, name) values ('architect', 'Arquitecto') returning id");
  const [architect] = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'arq@arca.test', 'Ana', 'Arq', '!integration-login-disabled!') returning id::int`, [architectRole.id]);
  await rows(`insert into public.permissions (code, name, module) values
    ('projects.read', 'Ver proyectos', 'projects'), ('projects.files.upload', 'Subir archivos', 'projects')`);
  await rows(`insert into public.role_permissions (role_id, permission_id)
    select r.id, p.id from public.roles r cross join public.permissions p where r.code in ('admin', 'client', 'architect')`);
  await rows("insert into public.project_assignees (project_id, user_id, assigned_by) values ($1, $2, $3)", [draftId, architect.id, ids.admin]);

  // Configuración ficticia de almacenamiento: con un draft oculto ninguna ruta llega a contactarlo, pero
  // la foto del arquitecto lee la configuración antes de comprobar si hay foto (sin ella respondería 500).
  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: "integration-only-secret-not-used-elsewhere-0123456789",
    SUPABASE_STORAGE_S3_ACCESS_KEY_ID: process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID || "integration-unused",
    SUPABASE_STORAGE_S3_ENDPOINT: process.env.SUPABASE_STORAGE_S3_ENDPOINT || "http://127.0.0.1:9/unused",
    SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY || "integration-unused",
  });
  const { default: app } = await import("../src/app.js");
  const { issueUserSession } = await import("../src/services/sessionService.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const headersOf = async (userId) => ({ Authorization: `Bearer ${(await issueUserSession(userId)).token}` });
  try {
    for (const userId of [ids.clientUser, architect.id]) {
      const headers = await headersOf(userId);
      const list = await (await fetch(`${base}/projects?limit=100`, { headers })).json();
      assert.ok(!list.projects.some((project) => project.id === draftId), "El listado no incluye el draft");
      for (const path of [`/projects/${draftId}`, `/projects/${draftSlug}`, `/projects/${draftId}/comments`,
        `/projects/${draftId}/events`, `/projects/${draftId}/files/1/content`, `/projects/${draftId}/assigned-architect/profile-photo`]) {
        const response = await fetch(`${base}${path}`, { headers });
        assert.equal(response.status, 404, `${userId} GET ${path}`);
        await response.body?.cancel();
      }
      const comment = await fetch(`${base}/projects/${draftId}/comments`, {
        body: JSON.stringify({ content: "Hola" }), headers: { ...headers, "Content-Type": "application/json" }, method: "POST",
      });
      assert.equal(comment.status, 404, `${userId} POST comentario`);
      const upload = await fetch(`${base}/projects/${draftId}/files`, {
        body: Buffer.from("%PDF-1.4"), headers: { ...headers, "Content-Type": "application/pdf", "X-File-Name": "plano.pdf" }, method: "POST",
      });
      assert.equal(upload.status, 404, `${userId} POST archivo`);
    }

    // El administrador sí lo ve, como draft de solo lectura operativa.
    const adminHeaders = await headersOf(ids.admin);
    const detail = await fetch(`${base}/projects/${draftId}`, { headers: adminHeaders });
    assert.equal(detail.status, 200);
    const { project } = await detail.json();
    assert.deepEqual([project.status, project.hasPlans, project.startDate], ["draft", null, null]);
    const adminComment = await fetch(`${base}/projects/${draftId}/comments`, {
      body: JSON.stringify({ content: "Hola" }), headers: { ...adminHeaders, "Content-Type": "application/json" }, method: "POST",
    });
    assert.equal(adminComment.status, 409);
    assert.equal((await adminComment.json()).code, "PROJECT_DRAFT");
    const assignees = await fetch(`${base}/admin/projects/${draftId}/assignees`, {
      body: JSON.stringify({ assigneeIds: [] }), headers: { ...adminHeaders, "Content-Type": "application/json" }, method: "PUT",
    });
    assert.equal(assignees.status, 409);
    assert.equal((await assignees.json()).code, "PROJECT_DRAFT");
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("compatibilidad: un alta sin submissionId (frontend anterior) se registra con identificador y huella NULL", { skip }, async () => {
  const { submissionId: _omitted, ...legacy } = draftQuoteBody("No se usa");
  const { newProjectName: _name, ...body } = legacy;
  const { quote, replayed } = await quotes.createQuote({ payload: { ...body, projectId: ids.legacy }, user: { id: ids.admin } });
  assert.equal(replayed, false);
  assert.deepEqual(quote.project, { id: ids.legacy, name: "Apto. 910" });
  const [row] = await rows("select submission_id, submission_fingerprint from public.quotes where id = $1", [quote.id]);
  assert.deepEqual(row, { submission_fingerprint: null, submission_id: null });
});
