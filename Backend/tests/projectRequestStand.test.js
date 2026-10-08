import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_REQUEST_VALUES } from "../src/domain/projectRequest.js";
import { isAdvertisingStand, STAND_REQUIREMENTS_VALUES } from "../src/domain/projectRequestStand.js";
import { buildProjectRequestMetrics } from "../src/domain/projectRequestEvaluation.js";
import { evaluateProjectCompatibility } from "../src/domain/projectRequestCompatibility.js";
import { createProjectRequestSchema, updateProjectRequestSchema } from "../src/validation/projectRequestSchemas.js";
import { validate } from "../src/middlewares/validate.js";
import { PROJECT_REQUEST_OPTIONS } from "../../Frontend/src/utils/projectRequestOptions.js";
import { buildProjectRequestPayload } from "../../Frontend/src/utils/projectRequestValidation.js";

const BODY = {
  capitalAvailability: "available_now", decisionMaker: "self",
  description: "Diseño del espacio con alcance definido para el evento.",
  developmentMode: "full", experience: "first_time", investmentRange: "over_150k",
  landStatus: "unavailable", projectLocation: "Maracaibo, Estado Zulia",
  projectName: "Stand de prueba", projectSize: "small_lt_80", projectType: "advertising_stand",
  quality: "standard", startTime: "over_6_months",
};
const REQUIREMENTS = {
  requirementsStatus: "available", documentTypes: ["exhibitor_manual", "event_regulations"],
  spaceStatus: "assigned", hasSpacePlans: true,
};
const submissionId = "550e8400-e29b-41d4-a716-446655440000";
const update = (body) => updateProjectRequestSchema.safeParse({ body, params: { projectRequestId: "1" } });

test("Figma: solo el identificador específico habilita el bloque; los catálogos coinciden", () => {
  assert.deepEqual(PROJECT_REQUEST_OPTIONS.projectType.map(({ value }) => value), PROJECT_REQUEST_VALUES.projectType);
  for (const [backend, frontend] of [["requirementsStatus", "standRequirementsStatus"], ["documentTypes", "standDocumentTypes"], ["spaceStatus", "standSpaceStatus"]]) {
    assert.deepEqual(PROJECT_REQUEST_OPTIONS[frontend].map(({ value }) => value), STAND_REQUIREMENTS_VALUES[backend]);
  }
  for (const type of PROJECT_REQUEST_VALUES.projectType) assert.equal(isAdvertisingStand(type), type === "advertising_stand");
  assert.equal(isAdvertisingStand("Stand publicitario"), false);
});

test("contrato completo: frontend produce respuestas que creación y edición aceptan sin inmueble", () => {
  const payload = buildProjectRequestPayload({
    ...BODY, location: BODY.projectLocation, standRequirementsStatus: "available",
    standDocumentTypes: REQUIREMENTS.documentTypes, standSpaceStatus: "assigned", hasStandSpacePlans: "Yes",
  }, submissionId);
  assert.deepEqual(payload.standRequirements, REQUIREMENTS);
  const created = createProjectRequestSchema.safeParse({ body: payload });
  assert.equal(created.success, true);
  const { submissionId: _id, ...edited } = payload;
  assert.equal(update(edited).success, true);
  assert.equal(created.data.body.hasBlueprints, null);
});

test("Stand publicitario exige solo la respuesta de espacio, independientemente del terreno", () => {
  assert.equal(update(BODY).success, false);
  assert.equal(update({ ...BODY, standRequirements: { spaceStatus: "unassigned" } }).success, true);
  for (const requirementsStatus of [null, ...STAND_REQUIREMENTS_VALUES.requirementsStatus]) {
    for (const spaceStatus of STAND_REQUIREMENTS_VALUES.spaceStatus) {
      assert.equal(update({ ...BODY, standRequirements: { requirementsStatus, spaceStatus, hasSpacePlans: false } }).success, true);
    }
  }
});

test("API rechaza los datos exclusivos en todos los otros tipos y conserva solicitudes anteriores", () => {
  for (const projectType of PROJECT_REQUEST_VALUES.projectType.filter((type) => !isAdvertisingStand(type))) {
    const body = { ...BODY, projectType };
    for (const standRequirements of [REQUIREMENTS, {}, { spaceStatus: "unassigned", hasSpacePlans: false }]) {
      assert.equal(update({ ...body, standRequirements }).success, false, projectType);
      assert.equal(createProjectRequestSchema.safeParse({ body: { ...body, standRequirements, submissionId } }).success, false);
    }
    const historical = update(body);
    assert.equal(historical.success, true, projectType);
    assert.equal(historical.data.body.standRequirements, null);
    assert.equal(update({ ...body, standRequirements: null }).success, true);
  }
});

test("la cadena de validación conserva código, mensaje y campos al rechazar otro tipo", () => {
  let error;
  validate(updateProjectRequestSchema)({ body: { ...BODY, projectType: "stands_exhibitions", standRequirements: REQUIREMENTS }, params: { projectRequestId: "1" } }, {}, (result) => { error = result; });
  assert.equal(error.status, 400);
  assert.equal(error.code, "VALIDATION_ERROR");
  assert.equal(typeof error.publicMessage, "string");
  assert.match(error.fields["body.standRequirements"], /Stand publicitario/);
});

test("rechaza opciones desconocidas, duplicados, documentos no disponibles y propiedades extra", () => {
  for (const changes of [
    { requirementsStatus: "unknown" }, { spaceStatus: "unknown" }, { hasSpacePlans: "yes" },
    { documentTypes: ["property_deed"] }, { documentTypes: ["other", "other"] },
    { requirementsStatus: "in_process" }, { requirementsStatus: "unavailable" }, { verified: true },
  ]) assert.equal(update({ ...BODY, standRequirements: { ...REQUIREMENTS, ...changes } }).success, false);
});

test("3.0: respuestas informativas no alteran compatibilidad, completitud ni viabilidad", () => {
  for (const projectType of PROJECT_REQUEST_VALUES.projectType) {
    for (const landStatus of PROJECT_REQUEST_VALUES.landStatus) {
      for (const investmentRange of PROJECT_REQUEST_VALUES.investmentRange) {
        const answers = { ...BODY, projectType, landStatus, investmentRange, location: BODY.projectLocation, hasFiles: false };
        const compatibility = evaluateProjectCompatibility(answers);
        const metrics = buildProjectRequestMetrics(answers);
        for (const standRequirements of [null, REQUIREMENTS, { requirementsStatus: "unavailable", documentTypes: [], spaceStatus: "unassigned", hasSpacePlans: false }]) {
          assert.deepEqual(evaluateProjectCompatibility({ ...answers, standRequirements }), compatibility);
          assert.deepEqual(buildProjectRequestMetrics({ ...answers, standRequirements }), metrics);
        }
        assert.equal(metrics.completeness.applicable, landStatus === "available" ? 16 : 13);
        assert.ok(!metrics.completeness.missingFields.some((field) => field.startsWith("stand")));
      }
    }
  }
});

test("repositorios: creación, lectura, cola y cambio de tipo conservan el bloque o SQL NULL", async (context) => {
  process.env.DATABASE_URL ||= "postgres://localhost/arca-contract-test";
  const { pool } = await import("../src/config/db.js");
  const { createProjectRequestDraft, updateProjectRequestDraft, findProjectRequestOwnedByUser } = await import("../src/repositories/projectRequestRepository.js");
  const { loadProjectRequestReviewQueue } = await import("../src/services/projectRequestWorkflowService.js");
  const user = { id: 1, clientId: 2, role: { code: "admin" } };
  const payload = createProjectRequestSchema.parse({ body: { ...BODY, standRequirements: REQUIREMENTS, submissionId } }).body;
  let stored = null;
  const calls = [];
  context.mock.method(pool, "query", async (sql, values) => {
    calls.push({ sql, values });
    if (/insert into public.project_requests|update public.project_requests/.test(sql)) {
      stored = values[24] === null ? null : JSON.parse(values[24]);
    }
    return { rows: [{ id: "1", client_id: "2", requested_by: "1", project_type: stored ? "advertising_stand" : "residential", stand_requirements: stored }] };
  });
  assert.deepEqual((await createProjectRequestDraft(user, payload)).standRequirements, REQUIREMENTS);
  assert.deepEqual((await findProjectRequestOwnedByUser(1, user)).standRequirements, REQUIREMENTS);
  const queue = await loadProjectRequestReviewQueue({ cursor: null, limit: 25, user });
  assert.deepEqual(queue.items[0].standRequirements, REQUIREMENTS);
  assert.equal("answers" in queue.items[0], false);
  const changed = update({ ...BODY, projectType: "residential" }).data.body;
  assert.equal((await updateProjectRequestDraft(1, user, changed)).standRequirements, null);
  const updateCall = calls.at(-1);
  assert.match(updateCall.sql, /stand_requirements = \$25::jsonb/);
  assert.match(updateCall.sql, /where id = \$26/);
  assert.equal(updateCall.values[24], null);
  assert.equal(updateCall.values[25], 1);
});
