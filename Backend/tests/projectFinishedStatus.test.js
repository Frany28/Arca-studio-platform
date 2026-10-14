import assert from "node:assert/strict";
import { createRateLimitQueryMock } from "./helpers/rateLimitQueryMock.js";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isProjectFinalized, normalizeProjectStatus, PROJECT_STATUS } from "../src/domain/projectStatus.js";
import { assertOperationallyMutableProjectState, assertProjectPublicationState } from "../src/services/projectMutationPolicy.js";

// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";
const { pool } = await import("../src/config/db.js");
const { applyAdminProjectBulkAction, getAdminDashboardMetrics, getAdminDashboardOverview } = await import("../src/repositories/adminDashboardRepository.js");
const { manageAdminProjects } = await import("../src/services/adminDashboardService.js");
const { changeProjectPublication } = await import("../src/services/projectService.js");
const { listProjectsForUser } = await import("../src/repositories/projectRepository.js");

function mockBulkTransport(context, rows, { updated = rows, writeError } = {}) {
  const calls = [];
  let released = false;
  context.mock.method(pool, "connect", async () => ({
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("for update")) return { rows };
      if (sql.includes("update public.projects")) {
        if (writeError) throw writeError;
        return { rows: updated };
      }
      return { rows: [] };
    },
    release() { released = true; },
  }));
  return { calls, wasReleased: () => released };
}

test("Prisma, backend y frontend comparten finished como único código canónico", async () => {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const states = schema.match(/enum project_status \{([^}]+)\}/)[1].trim().split(/\s+/);
  assert.deepEqual(states, Object.values(PROJECT_STATUS));
  const frontend = await import("../../Frontend/src/utils/projectStatus.js");
  assert.equal(frontend.FINISHED_PROJECT_STATUS, PROJECT_STATUS.FINISHED);
  for (const value of [...states, "completed", "FINISHED", undefined, null]) {
    assert.equal(frontend.normalizeProjectStatus(value), normalizeProjectStatus(value));
  }
});

test("la compatibilidad temporal normaliza únicamente el estado histórico de proyectos", () => {
  for (const status of ["finished", "completed"]) {
    assert.equal(normalizeProjectStatus(status), "finished");
    assert.equal(isProjectFinalized(status), true);
    assert.throws(() => assertOperationallyMutableProjectState({ status }), { code: "PROJECT_FINALIZED", status: 409 });
    assert.equal(assertProjectPublicationState({ status }).status, status);
  }
  for (const status of ["pending", "in_process", "cancelled", "FINISHED", " completed", null]) {
    assert.equal(normalizeProjectStatus(status), status);
    assert.equal(isProjectFinalized(status), false);
    assert.throws(() => assertProjectPublicationState({ status }), { code: "PROJECT_NOT_FINISHED", status: 409 });
  }
  assert.throws(() => assertProjectPublicationState({ status: "archived" }), { code: "PROJECT_ARCHIVED" });
  assert.throws(() => assertProjectPublicationState(null), { code: "PROJECT_NOT_FOUND" });
});

for (const status of ["finished", "completed"]) {
  for (const isPublic of [true, false]) {
    test(`bulk-action cambia visibilidad ${isPublic} de ${status} y emite finished`, async (context) => {
      const transport = mockBulkTransport(context, [{ id: "18", status, is_public: !isPublic }], {
        updated: [{ id: "18", status, is_public: isPublic }],
      });
      const projects = await manageAdminProjects({ action: "change_visibility", isPublic, projectIds: [18], userId: 2 });
      assert.deepEqual(projects, [{ id: 18, status: "finished", isPublic, archived: false, archivedAt: null }]);
      const write = transport.calls.find(({ sql }) => sql.includes("update public.projects"));
      assert.deepEqual(write.params, [[18], isPublic]);
      assert.equal(transport.calls.filter(({ sql }) => sql.includes("insert into public.audit_logs")).length, 1);
      assert.equal(transport.calls.at(-1).sql, "commit");
      assert.equal(transport.wasReleased(), true);
    });
  }
}

for (const row of [
  { status: "pending" }, { status: "in_process" }, { status: "cancelled" },
  { status: "archived", archived_from_status: "finished" }, { status: "finished", deleted_at: new Date() },
]) {
  test(`bulk-action rechaza selección mixta con ${row.status}${row.deleted_at ? " eliminado" : ""} sin escrituras`, async (context) => {
    const transport = mockBulkTransport(context, [{ id: 18, status: "finished" }, { id: 19, ...row }]);
    await assert.rejects(manageAdminProjects({ action: "change_visibility", isPublic: true, projectIds: [18, 19], userId: 2 }), { code: "VALIDATION_ERROR", status: 400 });
    assert.equal(transport.calls.length, 3);
    assert.equal(transport.calls.at(-1).sql, "rollback");
    assert.equal(transport.wasReleased(), true);
  });
}

test("bulk-action revierte recursos inexistentes y recuperaciones inválidas", async (context) => {
  const transport = mockBulkTransport(context, [{ id: 18, status: "finished" }]);
  await assert.rejects(manageAdminProjects({ action: "archive", projectIds: [18, 19], userId: 2 }), { code: "PROJECT_NOT_FOUND", status: 404 });
  await assert.rejects(manageAdminProjects({ action: "unarchive", projectIds: [18], userId: 2 }), { code: "VALIDATION_ERROR", status: 400 });
  assert.equal(transport.calls.filter(({ sql }) => sql === "rollback").length, 2);
  assert.equal(transport.wasReleased(), true);
});

test("bulk-action propaga fallo PostgreSQL, revierte y libera conexión", async (context) => {
  const writeError = Object.assign(new Error("test failure"), { code: "XX000" });
  const transport = mockBulkTransport(context, [{ id: 18, status: "finished" }], { writeError });
  await assert.rejects(applyAdminProjectBulkAction({ action: "archive", projectIds: [18], userId: 2 }), (error) => error === writeError);
  assert.equal(transport.calls.at(-1).sql, "rollback");
  assert.equal(transport.wasReleased(), true);
});

test("listado paginado emite finished para proyectos actuales e históricos sin modificar filas", async (context) => {
  const rows = [
    { id: "18", status: "finished", progress: "100", created_at: "2026-10-12T10:00:00Z" },
    { id: "19", status: "completed", progress: "100", created_at: "2026-10-11T10:00:00Z" },
    { id: "20", status: "pending", progress: "0", created_at: "2026-10-10T10:00:00Z" },
  ];
  context.mock.method(pool, "query", async () => ({ rows }));
  const result = await listProjectsForUser({ id: 2, role: { code: "admin" } }, { limit: 2 });
  assert.deepEqual(result.items.map(({ status }) => status), ["finished", "finished"]);
  assert.ok(result.nextCursor);
  assert.equal(rows[1].status, "completed");
});

test("publicación individual exige finalización, respeta acceso y verifica finished al escribir", async (context) => {
  let state = { id: 18, status: "finished" };
  const calls = [];
  context.mock.method(pool, "query", async (sql, params) => {
    calls.push({ sql, params });
    return { rows: state ? [state] : [] };
  });
  const options = { projectId: 18, isPublic: true, user: { id: 2, role: { code: "client" }, clientId: 3 } };
  assert.equal((await changeProjectPublication(options)).status, "finished");
  assert.match(calls[1].sql, /status = 'finished'::public\.project_status/);
  assert.ok(calls[1].params.includes(3), "conserva el cliente autorizado en SQL");
  for (state of [{ id: 18, status: "pending" }, { id: 18, status: "archived" }, null]) {
    const before = calls.length;
    await assert.rejects(changeProjectPublication(options), { code: !state ? "PROJECT_NOT_FOUND" : state.status === "archived" ? "PROJECT_ARCHIVED" : "PROJECT_NOT_FINISHED" });
    assert.equal(calls.length, before + 1, "no escribe tras rechazar el estado o el acceso");
  }
});

test("dashboard mantiene métricas activas excluyendo finalizados y títulos de historial finished", async (context) => {
  const calls = [];
  context.mock.method(pool, "query", async (sql) => {
    calls.push(sql);
    return { rows: sql.includes("active_projects_total") ? [{ active_projects_total: "2", active_projects_this_month: "1" }] : [] };
  });
  assert.deepEqual((await getAdminDashboardMetrics()).activeProjects, { total: 2, thisMonth: 1 });
  await getAdminDashboardOverview();
  assert.match(calls[0], /status in \('pending', 'in_process'\)/);
  assert.match(calls[1], /history.new_status = 'finished'/);
  assert.doesNotMatch(calls.join("\n"), /'completed'/);
});

test("permisos HTTP administrativos y validación bulk se mantienen antes de consultar proyectos", async (context) => {
  const { default: express } = await import("express");
  const { default: adminRouter } = await import("../src/routes/admin.js");
  const { normalizeError } = await import("../src/errors/appError.js");
  let user = null;
  context.mock.method(pool, "connect", async () => { throw new Error("No debe acceder a PostgreSQL"); });
  // El contador compartido de B-2 es la única consulta permitida antes de validar.
  const rateLimitQueries = createRateLimitQueryMock();
  context.mock.method(pool, "query", async (sql, params) => rateLimitQueries.handle(sql, params) ?? Promise.reject(new Error("No debe acceder a PostgreSQL")));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { isAuthenticated: Boolean(user) };
    req.user = user;
    next();
  });
  app.use("/admin", adminRouter);
  app.use((error, _req, res, _next) => {
    const normalized = normalizeError(error);
    res.status(normalized.status).json({ code: normalized.code, message: normalized.publicMessage, fields: normalized.fields });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const send = (body) => fetch(`http://127.0.0.1:${server.address().port}/admin/projects/bulk-action`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const valid = { action: "change_visibility", isPublic: true, projectIds: [18] };
  let response = await send(valid);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "UNAUTHENTICATED");
  for (const role of ["client", "architect"]) {
    user = { id: 2, role: { code: role } };
    response = await send(valid);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "FORBIDDEN");
  }
  user = { id: 2, role: { code: "admin" } };
  response = await send({ ...valid, projectIds: [18, 18] });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "VALIDATION_ERROR");
  const transport = mockBulkTransport(context, [{ id: 18, status: "finished", is_public: false }], {
    updated: [{ id: 18, status: "finished", is_public: true }],
  });
  response = await send(valid);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { projects: [{ id: 18, status: "finished", isPublic: true, archived: false, archivedAt: null }] });
  assert.equal(transport.calls.at(-1).sql, "commit");
});
