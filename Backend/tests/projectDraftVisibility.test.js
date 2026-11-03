import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_STATUS, isProjectDraft, isProjectOperationallyReadOnly } from "../src/domain/projectStatus.js";
import { assertMutableProjectState, assertOperationallyMutableProjectState } from "../src/services/projectMutationPolicy.js";
import { getEnvironmentCommentAccess } from "../src/utils/environmentCommentAccess.js";
import { nonDraftProjectCondition } from "../src/utils/projectDraftVisibility.js";

// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";

const { pool } = await import("../src/config/db.js");
const {
  findAssignedArchitectProfilePhotoForUser,
  findDirectProjectStateForUser,
  findProjectDetailForUser,
  listProjectsForUser,
} = await import("../src/repositories/projectRepository.js");
const { canAccessProjectComments } = await import("../src/repositories/projectCommentRepository.js");
const { findProjectFileForDownload, findProjectForFileUpload } = await import("../src/repositories/fileRepository.js");
const { applyProjectRequestDecision } = await import("../src/services/projectRequestWorkflowService.js");

// Proyectos draft: preliminares creados desde una cotización y visibles solo para administración.
const owner = { clientId: 7, id: 70, role: { code: "client" } };
const architect = { id: 90, role: { code: "architect" } };
const admin = { id: 1, role: { code: "admin" } };
const DRAFT_CONDITION = /status <> 'draft'::public\.project_status\s+and \w+\.archived_from_status is distinct from 'draft'::public\.project_status/;

/**
 * Sustituye `pool.query`, registra cada consulta y responde sin filas.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura el mock.
 * @returns {Array<{ sql: string, params: Array<unknown> }>} Consultas ejecutadas.
 */
function recordQueries(context) {
  const calls = [];
  context.mock.method(pool, "query", async (sql, params) => {
    calls.push({ params, sql });
    return { rows: [] };
  });
  return calls;
}

test("dominio: draft (también archivado desde draft) es un estado preliminar de solo lectura operativa", () => {
  assert.equal(isProjectDraft(PROJECT_STATUS.DRAFT), true);
  assert.equal(isProjectDraft("archived", "draft"), true);
  assert.equal(isProjectDraft("archived", "pending"), false);
  assert.equal(isProjectDraft("pending"), false);
  assert.equal(isProjectOperationallyReadOnly("draft"), true);
  assert.equal(isProjectOperationallyReadOnly("pending"), false);
});

test("política: un draft admite archivarse pero rechaza archivos, comentarios y responsables con PROJECT_DRAFT", () => {
  const draft = { id: 5, status: "draft" };
  assert.equal(assertMutableProjectState(draft), draft);
  assert.throws(() => assertOperationallyMutableProjectState(draft), (error) => error.code === "PROJECT_DRAFT" && error.status === 409);
});

test("acceso: clientes y arquitectos nunca reciben drafts; administración sí", async (context) => {
  for (const viewer of [owner, architect]) {
    const calls = recordQueries(context);
    await listProjectsForUser(viewer);
    await listProjectsForUser(viewer, { directOnly: true });
    await findProjectDetailForUser(15, viewer, { fileLimit: 25 });
    await findDirectProjectStateForUser(15, viewer);
    await findAssignedArchitectProfilePhotoForUser(15, viewer);
    await canAccessProjectComments(15, viewer);
    await findProjectFileForDownload({ fileId: 3, projectId: 15, user: viewer });
    assert.equal(calls.length, 7);
    for (const { sql } of calls) assert.match(sql, DRAFT_CONDITION, viewer.role.code);
    context.mock.restoreAll();
  }

  const calls = recordQueries(context);
  await listProjectsForUser(admin);
  await findDirectProjectStateForUser(15, admin);
  await canAccessProjectComments(15, admin);
  for (const { sql } of calls) assert.doesNotMatch(sql, DRAFT_CONDITION);
});

test("archivos: subir a un draft es un proyecto inexistente para clientes y arquitectos", async (context) => {
  for (const [status, archivedFrom] of [["draft", null], ["archived", "draft"]]) {
    context.mock.method(pool, "query", async () => ({
      rows: [{ archived_from_status: archivedFrom, assigned_architect_id: "90", client_id: "7", id: "15", is_assignee: true, is_public: false, status }],
    }));
    assert.equal(await findProjectForFileUpload(15, owner), null, status);
    assert.equal(await findProjectForFileUpload(15, architect), null, status);
    assert.ok(await findProjectForFileUpload(15, admin), "El administrador llega a la política (409 PROJECT_DRAFT)");
    context.mock.restoreAll();
  }
});

test("observaciones de entorno: un draft no crea audiencia compartida", () => {
  for (const viewer of [owner, architect]) assert.match(getEnvironmentCommentAccess(viewer).sql, DRAFT_CONDITION);
  assert.equal(getEnvironmentCommentAccess(admin).sql, "true");
  assert.match(nonDraftProjectCondition("p"), /^\(p\.status <> 'draft'/);
});

test("contrato: un draft conserva NULL en sus datos desconocidos (hasPlans no se convierte en false)", async (context) => {
  context.mock.method(pool, "query", async (sql) => (sql.includes("c.name as client_name")
    ? { rows: [{ client_id: "7", client_name: "Cliente", created_by: "1", has_plans: null, id: "15", location: null, name: "Casa", progress: "0", project_type: null, start_date: null, status: "draft" }] }
    : { rows: [] }));
  const { items: [project] } = await listProjectsForUser(admin);
  assert.deepEqual([project.status, project.hasPlans, project.startDate, project.projectType, project.location], ["draft", null, null, null, null]);
});

/**
 * Simula la transacción de la decisión administrativa hasta el alta del proyecto, que falla con
 * el error indicado.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura el mock.
 * @param {Error} insertError - Error de PostgreSQL al insertar el proyecto.
 * @returns {void}
 */
function mockApprovalWithInsertError(context, insertError) {
  context.mock.method(pool, "connect", async () => ({
    query: async (sql) => {
      if (/from public\.project_requests\s+where id = \$1/.test(sql)) {
        return { rows: [{ client_id: "7", id: "40", project_name: "Casa", status: "pending_review" }] };
      }
      if (sql.includes("review_count")) return { rows: [{ review_count: 1 }] };
      if (sql.includes("insert into public.projects")) throw insertError;
      return { rows: [] };
    },
    release() {},
  }));
}

test("aprobación de solicitudes: solo la unicidad del nombre del proyecto se traduce a PROJECT_NAME_ALREADY_EXISTS", async (context) => {
  const decision = { payload: { action: "approve" }, projectRequestId: 40, user: admin };
  mockApprovalWithInsertError(context, Object.assign(new Error("dup"), { code: "23505", constraint: "uq_projects_client_active_name" }));
  await assert.rejects(applyProjectRequestDecision(decision), (error) => error.code === "PROJECT_NAME_ALREADY_EXISTS" && error.status === 409);
  context.mock.restoreAll();

  const other = Object.assign(new Error("dup"), { code: "23505", constraint: "idx_projects_public_slug_active" });
  mockApprovalWithInsertError(context, other);
  await assert.rejects(applyProjectRequestDecision(decision), (error) => error === other);
});
