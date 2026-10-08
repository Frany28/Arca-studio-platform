import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedProjectRequestType, PROJECT_REQUEST_VALUES, READABLE_PROJECT_REQUEST_TYPES } from "../src/domain/projectRequest.js";
import { evaluateProjectCompatibility } from "../src/domain/projectRequestCompatibility.js";
import { buildProjectRequestMetrics } from "../src/domain/projectRequestEvaluation.js";
import { createProjectRequestSchema, updateProjectRequestSchema } from "../src/validation/projectRequestSchemas.js";

process.env.DATABASE_URL ||= "postgres://localhost/arca-contract-test";
const { pool } = await import("../src/config/db.js");
const { createProjectRequest, updateProjectRequest, submitProjectRequest, toPublicProjectRequest } = await import("../src/services/projectRequestService.js");
const { findProjectRequestOwnedByUser } = await import("../src/repositories/projectRequestRepository.js");
const { loadProjectRequestReviewQueue } = await import("../src/services/projectRequestWorkflowService.js");
const USER = { id: 1, clientId: 2, role: { code: "admin" } };
const ROW = {
  id: "7", client_id: "2", requested_by: "1", status: "changes_requested",
  project_name: "Exhibición histórica", project_type: "stands_exhibitions", stand_requirements: null,
  location: "Caracas, Venezuela", description: "Diseño del espacio de exposición para el evento.",
  project_size: "small_lt_80", development_mode: "full", land_status: "unavailable",
  legal_documentation_status: null, legal_document_types: [], has_multiple_owners: null, has_plans: null,
  investment_range: "10k_50k", capital_availability: "available_now", expected_start_time: "over_6_months",
  decision_maker: "self", quality_expectation: "standard", prior_design_experience: "first_time",
  reference_link: "https://example.test/referencia", compatibility_score: 73,
  compatibility_level: "high", compatibility_scoring_version: "2.2", compatibility_reason_codes: ["descriptionWeak"],
};
const BODY = {
  projectName: ROW.project_name, projectType: "stands_exhibitions", projectLocation: ROW.location,
  description: ROW.description, projectSize: "small_lt_80", developmentMode: "full", landStatus: "unavailable",
  investmentRange: "10k_50k", capitalAvailability: "available_now", startTime: "over_6_months",
  decisionMaker: "self", quality: "standard", experience: "first_time", referenceLink: ROW.reference_link,
};
const edit = (body) => updateProjectRequestSchema.parse({ body, params: { projectRequestId: "7" } }).body;

test("solo cuatro tipos son vigentes y el tipo retirado únicamente puede conservarse", () => {
  assert.deepEqual(PROJECT_REQUEST_VALUES.projectType, ["residential", "commercial", "corporate", "advertising_stand"]);
  assert.ok(READABLE_PROJECT_REQUEST_TYPES.includes("stands_exhibitions"));
  assert.equal(isAllowedProjectRequestType("stands_exhibitions"), false);
  assert.equal(isAllowedProjectRequestType("stands_exhibitions", "residential"), false);
  assert.equal(isAllowedProjectRequestType("stands_exhibitions", "stands_exhibitions"), true);
  assert.equal(createProjectRequestSchema.safeParse({ body: { ...BODY, submissionId: "550e8400-e29b-41d4-a716-446655440000" } }).success, false);
  assert.equal(edit(BODY).projectType, "stands_exhibitions");
});

test("lecturas de cliente y cola conservan tipo, evaluación histórica y métricas", async (context) => {
  context.mock.method(pool, "query", async () => ({ rows: [{ ...ROW }] }));
  const record = await findProjectRequestOwnedByUser(7, USER);
  const publicRequest = toPublicProjectRequest(record);
  assert.equal(publicRequest.projectType, "stands_exhibitions");
  assert.equal(publicRequest.standRequirements, null);
  assert.deepEqual(publicRequest.compatibility, {
    findings: null, level: "high", score: 73,
    observations: ["Una descripción más completa ayudará a evaluar mejor el alcance del proyecto."],
  });
  const control = { ...record, projectType: "commercial" };
  assert.deepEqual(buildProjectRequestMetrics(record), buildProjectRequestMetrics(control));
  assert.equal(publicRequest.completeness.score, 100);
  assert.deepEqual(evaluateProjectCompatibility(record), evaluateProjectCompatibility(control));
  const queue = await loadProjectRequestReviewQueue({ cursor: null, limit: 25, user: USER });
  assert.equal(queue.items[0].projectType, "stands_exhibitions");
  assert.deepEqual(queue.items[0].compatibility, { score: 73, level: "high" });
  assert.deepEqual(queue.items[0].completeness, publicRequest.completeness);
  assert.deepEqual(queue.items[0].financialViability, publicRequest.financialViability);
});

test("servicio de creación rechaza tipos retirados incluso sin pasar por Zod", async (context) => {
  let queries = 0;
  context.mock.method(pool, "query", async () => { queries += 1; return { rows: [] }; });
  await assert.rejects(createProjectRequest({ user: USER, payload: BODY }), { code: "VALIDATION_ERROR", status: 400 });
  assert.equal(queries, 0);
});

test("edición no puede introducir el tipo retirado en solicitudes de otro tipo", async (context) => {
  let writes = 0;
  context.mock.method(pool, "query", async (sql) => {
    if (/update public.project_requests/.test(sql)) writes += 1;
    return { rows: [{ ...ROW, project_type: "residential" }] };
  });
  await assert.rejects(updateProjectRequest({ user: USER, projectRequestId: 7, payload: edit(BODY) }), (error) => {
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.ok(error.fields["body.projectType"]);
    return true;
  });
  assert.equal(writes, 0);
});

test("edición histórica permite conservar el tipo o elegir cualquier tipo vigente", async (context) => {
  let writes = 0;
  context.mock.method(pool, "query", async (sql, values) => {
    if (/existing_names/.test(sql)) return { rows: [] };
    if (/update public.project_requests/.test(sql)) {
      writes += 1;
      return { rows: [{ ...ROW, project_type: values[3], stand_requirements: values[24] ? JSON.parse(values[24]) : null }] };
    }
    return { rows: [{ ...ROW }] };
  });
  for (const projectType of READABLE_PROJECT_REQUEST_TYPES) {
    const payload = edit({ ...BODY, projectType, ...(projectType === "advertising_stand" ? { standRequirements: { spaceStatus: "unassigned" } } : {}) });
    const result = await updateProjectRequest({ user: USER, projectRequestId: 7, payload });
    assert.equal(result.projectType, projectType);
    assert.equal(result.compatibility.score, 73);
  }
  assert.equal(writes, READABLE_PROJECT_REQUEST_TYPES.length);
});

test("reenvío después de correcciones evalúa 3.0 sin convertir el tipo histórico", async (context) => {
  let evaluationValues;
  context.mock.method(pool, "query", async (sql, values) => {
    if (/existing_names/.test(sql)) return { rows: [] };
    if (/as file_count/.test(sql)) return { rows: [{ file_count: 1, total_bytes: "1024" }] };
    if (/with target as/.test(sql)) {
      evaluationValues = values;
      return { rows: [{ ...ROW, status: "pending_verification", compatibility_score: values[3], compatibility_level: values[4], compatibility_reason_codes: JSON.parse(values[5]), compatibility_scoring_version: values[6] }] };
    }
    return { rows: [{ ...ROW }] };
  });
  const result = await submitProjectRequest({ projectRequestId: 7, user: USER });
  assert.equal(result.projectType, "stands_exhibitions");
  assert.equal(result.compatibility.score, 100);
  assert.equal(result.completeness.score, 100);
  assert.equal(evaluationValues[6], "3.0");
});
