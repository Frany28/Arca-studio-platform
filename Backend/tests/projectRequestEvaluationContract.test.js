import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_REQUEST_VALUES } from "../src/domain/projectRequest.js";
import { evaluateProjectCompatibility } from "../src/domain/projectRequestCompatibility.js";
import { evaluateProjectRequestCompleteness } from "../src/domain/projectRequestCompleteness.js";
import { createProjectRequestSchema, updateProjectRequestSchema } from "../src/validation/projectRequestSchemas.js";
import { PROJECT_REQUEST_OPTIONS } from "../../Frontend/src/utils/projectRequestOptions.js";
import { buildProjectRequestPayload, getProjectRequestFieldErrors } from "../../Frontend/src/utils/projectRequestValidation.js";

process.env.DATABASE_URL ||= "postgres://localhost/arca-contract-test";
const { pool } = await import("../src/config/db.js");
const { findProjectRequestOwnedByUser } = await import("../src/repositories/projectRequestRepository.js");
const { toPublicProjectRequest } = await import("../src/services/projectRequestService.js");

const FORM = {
  capitalAvailability: "available_now", decisionMaker: "self",
  description: "Remodelación integral de cocina y sala principal.",
  developmentMode: "full", experience: "first_time", hasBlueprints: "Yes",
  investmentRange: "10k_50k", landStatus: "available", legalDocumentationStatus: "available",
  legalDocumentTypes: ["property_deed"], location: "Caracas, Venezuela", multipleOwners: "no",
  projectName: "Proyecto preparado", projectSize: "small_lt_80", projectType: "residential",
  quality: "standard", referenceLink: "https://example.test/referencia", startTime: "over_6_months",
};
const SUBMISSION_ID = "550e8400-e29b-41d4-a716-446655440000";

test("V3: todos los catálogos generales mantienen paridad entre formulario y API", () => {
  for (const [field, values] of Object.entries(PROJECT_REQUEST_VALUES)) {
    assert.deepEqual(PROJECT_REQUEST_OPTIONS[field].map(({ value }) => value), values, field);
  }
});

test("V3: descripción recortada de 30–100 cuenta como respuesta sin modificar compatibilidad", () => {
  for (const length of [0, 29, ...Array.from({ length: 71 }, (_, index) => index + 30), 101]) {
    const form = { ...FORM, description: `  ${"x".repeat(length)}  ` };
    const payload = buildProjectRequestPayload(form, SUBMISSION_ID);
    const created = createProjectRequestSchema.safeParse({ body: payload });
    const { submissionId: _id, ...body } = payload;
    const edited = updateProjectRequestSchema.safeParse({ body, params: { projectRequestId: "1" } });
    const valid = length >= 30 && length <= 100;
    assert.equal(!getProjectRequestFieldErrors(form).description, valid, `frontend ${length}`);
    assert.equal(created.success, valid, `crear ${length}`);
    assert.equal(edited.success, valid, `editar ${length}`);
    const answers = { ...FORM, description: payload.description, hasFiles: true, hasPlans: true };
    assert.equal(evaluateProjectRequestCompleteness(answers).missingFields.includes("description"), !valid);
    assert.equal(evaluateProjectCompatibility(answers).score, 100, `sin peso por longitud ${length}`);
    if (valid) assert.equal(created.data.body.description.length, length);
  }
});

test("V3: el contrato guardado separa normativas y planos del evento de la evaluación legal", async (context) => {
  let savedRow;
  context.mock.method(pool, "query", async () => ({ rows: [savedRow] }));
  const user = { id: 1, clientId: 2 };

  for (const projectType of PROJECT_REQUEST_VALUES.projectType) {
    for (const landStatus of PROJECT_REQUEST_VALUES.landStatus) {
      const legalStatuses = landStatus === "available" ? PROJECT_REQUEST_VALUES.legalDocumentationStatus : [null];
      for (const legalDocumentationStatus of legalStatuses) {
        for (const hasBlueprints of ["Yes", "No", "Indeterminate"]) {
          const requirementsStatuses = projectType === "advertising_stand" ? [null, "available", "in_process", "unavailable"] : [null];
          for (const requirementsStatus of requirementsStatuses) {
            const form = {
              ...FORM, projectType, landStatus, legalDocumentationStatus, hasBlueprints,
              legalDocumentTypes: legalDocumentationStatus === "available" ? ["lease_contract"] : [],
              standRequirementsStatus: requirementsStatus, standSpaceStatus: "unassigned",
              standDocumentTypes: requirementsStatus === "available" ? ["exhibitor_manual"] : [],
              // Los planos del evento deliberadamente difieren de los del inmueble.
              hasStandSpacePlans: hasBlueprints === "Yes" ? "No" : "Yes",
            };
            assert.deepEqual(getProjectRequestFieldErrors(form), {});
            const body = createProjectRequestSchema.parse({ body: buildProjectRequestPayload(form, SUBMISSION_ID) }).body;
            savedRow = {
              id: "1", client_id: "2", requested_by: "1", project_name: body.projectName,
              project_type: body.projectType, location: body.projectLocation, description: body.description,
              has_plans: body.hasBlueprints, project_size: body.projectSize, development_mode: body.developmentMode,
              land_status: body.landStatus, legal_documentation_status: body.legalDocumentationStatus,
              legal_document_types: body.legalDocumentTypes, has_multiple_owners: body.hasMultipleOwners,
              investment_range: body.investmentRange, capital_availability: body.capitalAvailability,
              expected_start_time: body.startTime, decision_maker: body.decisionMaker, quality_expectation: body.quality,
              prior_design_experience: body.experience, reference_link: body.referenceLink, stand_requirements: body.standRequirements,
            };
            const record = await findProjectRequestOwnedByUser(1, user);
            const evaluation = evaluateProjectCompatibility({ ...record, hasFiles: true });
            const publicRequest = toPublicProjectRequest({ ...record, compatibility: evaluation });
            const hasProperty = landStatus === "available";
            const legalDeduction = hasProperty ? { available: 0, in_process: 3, unavailable: 6 }[legalDocumentationStatus] : 0;
            const plansDeduction = hasProperty && hasBlueprints !== "Yes" ? 2 : 0;
            assert.equal(publicRequest.compatibility.score, 100 - legalDeduction - plansDeduction);
            assert.equal(publicRequest.completeness.applicable, hasProperty ? legalDocumentationStatus === "available" ? 17 : 16 : 13);
            const missingPlans = hasProperty && hasBlueprints === "Indeterminate";
            assert.deepEqual(publicRequest.completeness.missingFields, missingPlans ? ["hasPlans"] : []);
            assert.equal(publicRequest.completeness.answered, publicRequest.completeness.applicable - Number(missingPlans));
            assert.equal(publicRequest.completeness.score, Math.round(publicRequest.completeness.answered / publicRequest.completeness.applicable * 100));
            assert.deepEqual(publicRequest.financialViability, { findings: [], score: null, status: "NO_OBVIOUS_CONFLICT" });
            assert.deepEqual(publicRequest.standRequirements, body.standRequirements);
            assert.equal(new Set(evaluation.findings.map(({ code }) => code)).size, evaluation.findings.length);
          }
        }
      }
    }
  }
});
