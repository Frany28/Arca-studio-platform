import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
const { pool } = await import("../src/config/db.js");
const { isProjectFileReviewEnabled, withProjectFileReviewState } = await import("../src/config/projectFileReview.js");
const { createProjectFileReviewActivation } = await import("../src/services/projectFileReviewActivationService.js");
const { readProjectFileReviewSchemaState } = await import("../src/repositories/projectFileReviewSchemaRepository.js");
const { PROJECT_FILE_REVIEW_MIGRATIONS } = await import("../src/config/projectFileReviewSchema.js");
const { normalizeError } = await import("../src/errors/appError.js");
const previous = process.env.PROJECT_FILE_REVIEW_ENABLED;
afterEach(() => {
  if (previous === undefined) delete process.env.PROJECT_FILE_REVIEW_ENABLED;
  else process.env.PROJECT_FILE_REVIEW_ENABLED = previous;
});

test("el manifiesto de activación conserva los checksums exactos de las migraciones originales", async () => {
  for (const [name, checksum] of PROJECT_FILE_REVIEW_MIGRATIONS) {
    const bytes = await readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), checksum, name);
  }
});

test("la intención apagada evita PostgreSQL; la encendida requiere dependencias completas", async () => {
  let reads = 0;
  const resolve = createProjectFileReviewActivation({ readState: async () => { reads++; return { missing: ["files.access_policy"], ready: false }; }, log() {} });
  process.env.PROJECT_FILE_REVIEW_ENABLED = "false";
  assert.equal(await resolve(), false);
  assert.equal(reads, 0);
  process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
  assert.equal(await resolve(), false);
  assert.equal(reads, 1);
});

test("deduplica lecturas; expira negativos y positivos e invalida al apagar", async () => {
  process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
  let time = 0;
  let reads = 0;
  let ready = false;
  const resolve = createProjectFileReviewActivation({ readState: async () => { reads++; return { missing: [], ready }; }, now: () => time, log() {} });
  assert.deepEqual(await Promise.all([resolve(), resolve(), resolve()]), [false, false, false]);
  assert.equal(reads, 1);
  ready = true;
  time = 4999;
  assert.equal(await resolve(), false);
  time = 5000;
  assert.equal(await resolve(), true);
  assert.equal(reads, 2);
  time = 34999;
  assert.equal(await resolve(), true);
  time = 35000;
  assert.equal(await resolve(), true);
  assert.equal(reads, 3);
  process.env.PROJECT_FILE_REVIEW_ENABLED = "false";
  assert.equal(await resolve(), false);
  process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
  assert.equal(await resolve(), true);
  assert.equal(reads, 4);
});

test("los errores no se cachean y conservan su causa técnica", async () => {
  process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
  const failure = Object.assign(new Error("detalle privado"), { code: "42501" });
  let reads = 0;
  const resolve = createProjectFileReviewActivation({ readState: async () => { if (++reads === 1) throw failure; return { ready: true }; } });
  await assert.rejects(resolve(), (error) => error === failure);
  assert.equal(await resolve(), true);
  assert.equal(reads, 2);
});

test("apagar invalida también lecturas en vuelo y una respuesta antigua no sobrescribe la nueva", async () => {
  process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
  let finishOld;
  let reads = 0;
  const old = new Promise((resolve) => { finishOld = resolve; });
  const resolve = createProjectFileReviewActivation({ readState: () => ++reads === 1 ? old : Promise.resolve({ ready: true }), log() {} });
  const pending = resolve();
  process.env.PROJECT_FILE_REVIEW_ENABLED = "false";
  assert.equal(await resolve(), false);
  process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
  assert.equal(await resolve(), true);
  finishOld({ ready: false, legacySafe: true, missing: [] });
  assert.equal(await pending, false);
  assert.equal(await resolve(), true);
  assert.equal(reads, 2);
});

test("un esquema incoherente con archivos 1.2 nunca vuelve a las reglas heredadas", async () => {
  process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
  const resolve = createProjectFileReviewActivation({ readState: async () => ({ ready: false, legacySafe: false, missing: ["unfinished_migration"] }), log() {} });
  await assert.rejects(resolve(), (error) => error.status === 503 && error.code === "DATABASE_SCHEMA_NOT_READY");
});

test("el estado se mantiene por petición durante concurrencia y fuera del contexto está apagado", async () => {
  process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
  const result = await Promise.all([true, false].map((enabled) => withProjectFileReviewState(enabled, async () => {
    await Promise.resolve();
    process.env.PROJECT_FILE_REVIEW_ENABLED = "false";
    return isProjectFileReviewEnabled();
  })));
  assert.deepEqual(result, [true, false]);
  assert.equal(isProjectFileReviewEnabled(), false);
});

test("exige historial exacto y estructura, incluso si una de las dos parece completa", async (context) => {
  const structure = { history_available: true, missing_columns: [], missing_constraints: [], missing_indexes: [], missing_types: [] };
  const history = PROJECT_FILE_REVIEW_MIGRATIONS.map(([migration_name, checksum]) => ({ migration_name, checksum, finished_at: new Date(), rolled_back_at: null }));
  let hasReviewFiles = false;
  context.mock.method(pool, "query", async (sql) => ({ rows: /history_available/.test(sql) ? [structure] : /has_review_files/.test(sql) ? [{ has_review_files: hasReviewFiles }] : history }));
  assert.equal((await readProjectFileReviewSchemaState()).ready, true);
  history[1].checksum = "alterado";
  assert.equal((await readProjectFileReviewSchemaState()).ready, false);
  history[1].checksum = PROJECT_FILE_REVIEW_MIGRATIONS[1][1];
  structure.missing_columns = ["files.access_policy"];
  assert.equal((await readProjectFileReviewSchemaState()).ready, false);
  structure.missing_columns = [];
  history[2].finished_at = null;
  assert.ok((await readProjectFileReviewSchemaState()).missing.includes("unfinished_migration"));
  structure.history_available = false;
  assert.ok((await readProjectFileReviewSchemaState()).missing.includes("_prisma_migrations"));
  hasReviewFiles = true;
  assert.equal((await readProjectFileReviewSchemaState()).legacySafe, false, "el historial ausente no permite ampliar las audiencias existentes");
});

test("una activación incompleta preserva proyectos y bloquea las tres rutas nuevas", async (context) => {
  process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
  const { startAdminRouterServer } = await import("./helpers/adminRouterServer.js");
  const { loadProjectFileReviewActivation } = await import("../src/middlewares/projectFileReview.js");
  const { default: fileRoutes } = await import("../src/routes/fileManager.js");
  const { listProjectsForUser } = await import("../src/repositories/projectRepository.js");
  const { default: express } = await import("express");
  const router = express.Router();
  router.get("/projects", async (req, res, next) => {
    try { res.json(await listProjectsForUser(req.user)); } catch (error) { next(error); }
  });
  const server = await startAdminRouterServer(context, { pool, routes: [["/api", loadProjectFileReviewActivation], ["/api/admin/files", fileRoutes], ["/api", router]], respond(sql) {
    if (/history_available/.test(sql)) return { rows: [{ history_available: false, missing_columns: ["files.access_policy"], missing_constraints: [], missing_indexes: [], missing_types: [] }] };
    assert.doesNotMatch(sql, /access_policy|review_status|project_file_audience_grants/);
    return { rows: [] };
  } });
  server.setUser({ id: 1, role: { code: "admin" } });
  assert.equal((await server.send("GET", "/api/projects")).status, 200);
  for (const route of ["metrics", "items", "tree"]) {
    const response = await server.send("GET", `/api/admin/files/${route}`);
    assert.equal(response.status, 404);
    assert.equal(response.body.code, "API_ROUTE_NOT_FOUND");
  }
});

test("traduce errores PostgreSQL sin filtrar códigos ni detalles internos", () => {
  for (const code of ["42703", "42P01", "42704", "42883"]) {
    const cause = Object.assign(new Error("public.secreto.columna"), { code });
    const error = normalizeError(cause);
    assert.equal(error.status, 503);
    assert.equal(error.code, "DATABASE_SCHEMA_NOT_READY");
    assert.equal(error.cause, cause);
    assert.doesNotMatch(error.message, /secreto|public|42703/);
  }
  assert.equal(normalizeError({ code: "23505" }).code, "RESOURCE_CONFLICT");
  assert.equal(normalizeError({ code: "42601" }).code, "INTERNAL_SERVER_ERROR");
});
