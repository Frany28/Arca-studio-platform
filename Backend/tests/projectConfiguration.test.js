import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildRequestReference,
  computeProgressFromStages,
  earliestStageStartDate,
  findMissingConfigurationRequirements,
  findTrackingDateErrors,
  isConfigurationDate,
  mapRequestToDraftProject,
} from "../src/domain/projectConfiguration.js";
import {
  projectGeneralConfigurationSchema,
  projectTrackingConfigurationSchema,
  projectWarrantiesConfigurationSchema,
} from "../src/validation/projectConfigurationSchemas.js";
import { ConflictError, ValidationError } from "../src/errors/appError.js";
import { translateProjectConfigurationError } from "../src/services/projectConfigurationErrors.js";

const REQUEST_ROW = {
  capital_availability: "available_now",
  client_id: 4,
  description: "Vivienda unifamiliar de dos plantas.",
  expected_start_time: "immediate",
  formatted_address: "Calle 78, Maracaibo",
  has_plans: true,
  id: 31,
  investment_range: "10k_50k",
  location: "Maracaibo, Estado Zulia",
  location_latitude: "10.6",
  location_longitude: "-71.6",
  project_name: "Casa Lago",
  project_size: "medium_80_200",
  project_type: "residential",
  provider_place_id: "geo-1",
};

test("la aprobación solo copia datos equivalentes; inversión, tamaño y plazo quedan como referencia", () => {
  const draft = mapRequestToDraftProject(REQUEST_ROW);
  assert.deepEqual(draft, {
    clientId: 4,
    description: "Vivienda unifamiliar de dos plantas.",
    formattedAddress: "Calle 78, Maracaibo",
    hasPlans: true,
    latitude: "10.6",
    location: "Maracaibo, Estado Zulia",
    longitude: "-71.6",
    name: "Casa Lago",
    projectType: "residential",
    providerPlaceId: "geo-1",
  });
  for (const key of ["budget", "generalArea", "constructionArea", "startDate", "assigneeIds"]) {
    assert.equal(key in draft, false, `${key} no se infiere de la solicitud`);
  }
  assert.deepEqual(buildRequestReference({ ...REQUEST_ROW, assignee_ids: ["6"], first_contact_at: null }), {
    capitalAvailability: "available_now",
    expectedStartTime: "immediate",
    firstContactAt: null,
    id: 31,
    investmentRange: "10k_50k",
    projectSize: "medium_80_200",
    suggestedAssigneeIds: [6],
  });
  assert.equal(buildRequestReference(null), null, "un draft de cotización no tiene solicitud");
});

test("finalizar exige los campos marcados en Figma y fases completas", () => {
  const complete = {
    assigneeIds: [6], clientId: 4, constructionArea: 80, generalArea: 120, location: "Maracaibo, Zulia",
    name: "Casa Lago", projectType: "residential", stages: [{ endDate: "2026-12-10", name: "Propuesta", startDate: "2026-12-01", status: "pending" }],
    zoning: "Sala y cocina.",
  };
  assert.deepEqual(findMissingConfigurationRequirements(complete), []);
  assert.deepEqual(findMissingConfigurationRequirements({ ...complete, assigneeIds: [], generalArea: 0, zoning: "  ", stages: [] }), [
    "assigneeIds", "generalArea", "zoning", "stages",
  ]);
  assert.deepEqual(findMissingConfigurationRequirements({ ...complete, stages: [{ name: "Fase", startDate: null, endDate: null, status: "pending" }] }), ["stages.incomplete"]);
  // Hitos, garantías, coordenadas y textos opcionales no bloquean la finalización.
  assert.deepEqual(findMissingConfigurationRequirements({ ...complete, conditions: null, equipment: null, latitude: null, warranties: [] }), []);
});

test("el progreso se calcula de las fases reales y la fecha de inicio es la primera fase", () => {
  assert.equal(computeProgressFromStages([]), 0);
  assert.equal(computeProgressFromStages([{ status: "finished" }, { status: "in_process" }, { status: "pending" }]), 33);
  assert.equal(computeProgressFromStages([{ status: "finished" }, { status: "finished" }]), 100);
  assert.equal(earliestStageStartDate([{ startDate: "2026-12-11" }, { startDate: "2026-12-01" }, { startDate: null }]), "2026-12-01");
  assert.equal(earliestStageStartDate([]), null);
});

test("los esquemas admiten guardados parciales y rechazan fechas incoherentes", () => {
  const general = projectGeneralConfigurationSchema.safeParse({ body: { assigneeIds: [], name: "Casa Lago" }, params: { projectId: "7" } });
  assert.equal(general.success, true, "un borrador se guarda incompleto");
  assert.equal(general.data.body.zoning, null);
  assert.equal(projectGeneralConfigurationSchema.safeParse({ body: { assigneeIds: [], latitude: 10, name: "Casa" }, params: { projectId: 7 } }).success, false, "coordenadas juntas");
  assert.equal(projectGeneralConfigurationSchema.safeParse({ body: { assigneeIds: [1, 1], name: "Casa" }, params: { projectId: 7 } }).success, false);
  assert.equal(projectTrackingConfigurationSchema.safeParse({
    body: { estimatedDeliveryDate: null, milestones: [], stages: [{ endDate: "2026-01-01", name: "Fase", startDate: "2026-02-01", status: "pending" }] },
    params: { projectId: 7 },
  }).success, false);
  assert.equal(projectTrackingConfigurationSchema.safeParse({
    body: { estimatedDeliveryDate: null, milestones: [], stages: [{ endDate: null, name: "Fase", startDate: null, status: "draft" }] },
    params: { projectId: 7 },
  }).success, false, "una fase nunca es draft");
  assert.equal(projectWarrantiesConfigurationSchema.safeParse({
    body: { warranties: [{ code: "A", endDate: "2026-01-01", model: "M", product: "P", serviceDate: "2026-02-01", startDate: "2025-01-01" }] },
    params: { projectId: 7 },
  }).success, false, "inicio ≤ servicio ≤ fin");
});

test("la aprobación crea un draft y no copia responsables (contrato del repositorio)", () => {
  const source = readFileSync(new URL("../src/repositories/projectRequestWorkflowRepository.js", import.meta.url), "utf8");
  assert.match(source, /mapRequestToDraftProject\(request\)/);
  assert.match(source, /\$1, \$2, \$3, \$4, 'draft', 0/);
  assert.doesNotMatch(source, /insert into public\.project_assignees/, "quien revisó la solicitud no pasa a responsable operativo");
});

test("fechas civiles reales: bisiestos, límites de mes y años sin normalización de Date", () => {
  for (const value of ["0001-01-01", "0099-12-31", "2000-02-29", "2028-02-29", "9999-12-31"]) {
    assert.equal(isConfigurationDate(value), true, value);
  }
  for (const value of ["0000-01-01", "1900-02-29", "2026-02-29", "2026-02-31", "2026-04-31", "2026-13-01", "2026-00-01", "2026-12-00", "2026-1-01", "2026-01-01T00:00:00Z", null]) {
    assert.equal(isConfigurationDate(value), false, String(value));
  }
});

test("seguimiento: entrega antes, igual y después del inicio más temprano, incluso con fases desordenadas", () => {
  const stages = [
    { startDate: "2026-12-10", endDate: "2026-12-20" },
    { startDate: "2026-12-01", endDate: "2026-12-01" },
  ];
  assert.deepEqual(Object.keys(findTrackingDateErrors({ estimatedDeliveryDate: "2026-11-30", stages })), ["estimatedDeliveryDate.beforeStart"]);
  for (const estimatedDeliveryDate of [null, "2026-12-01", "2026-12-25"]) {
    assert.deepEqual(findTrackingDateErrors({ estimatedDeliveryDate, stages }), {});
  }
  assert.deepEqual(findTrackingDateErrors({ stages: [{ startDate: null, endDate: null }] }), {});
  assert.deepEqual(Object.keys(findTrackingDateErrors({
    estimatedDeliveryDate: "2026-02-31",
    milestones: [{ dueDate: "2026-04-31" }],
    stages: [{ startDate: "2026-12-10", endDate: "2026-12-01" }, { startDate: "2026-02-29", endDate: null }],
  })), ["estimatedDeliveryDate", "stages.0.endDate", "stages.1.startDate", "milestones.0.dueDate"]);
});

test("los esquemas rechazan fechas imposibles en entrega, fases, hitos y garantías", () => {
  const params = { projectId: 7 };
  const valid = { estimatedDeliveryDate: null, milestones: [], stages: [] };
  for (const body of [
    { ...valid, estimatedDeliveryDate: "2026-02-31" },
    { ...valid, stages: [{ name: "Fase", status: "pending", startDate: "2026-02-29", endDate: null }] },
    { ...valid, stages: [{ name: "Fase", status: "pending", startDate: null, endDate: "2026-04-31" }] },
    { ...valid, milestones: [{ title: "Hito", dueDate: "2026-04-31" }] },
  ]) assert.equal(projectTrackingConfigurationSchema.safeParse({ body, params }).success, false);
  const warranty = { product: "P", model: "M", code: "C", startDate: "2026-01-01", serviceDate: "2026-06-01", endDate: "2026-12-01" };
  for (const field of ["startDate", "serviceDate", "endDate"]) {
    assert.equal(projectWarrantiesConfigurationSchema.safeParse({ body: { warranties: [{ ...warranty, [field]: "2026-02-31" }] }, params }).success, false);
  }
  assert.equal(projectGeneralConfigurationSchema.parse({ body: { assigneeIds: [], name: "Casa", latitude: null, longitude: null }, params }).body.latitude, null);
});

test("errores PostgreSQL: traducción de restricciones, fechas, duplicados, referencias y concurrencia", () => {
  for (const constraint of ["chk_projects_dates", "chk_project_warranties_dates", "chk_project_warranties_text", "chk_project_folders_name", "chk_projects_configuration_text_length"]) {
    const translated = translateProjectConfigurationError(Object.assign(new Error("detalle privado"), { code: "23514", constraint }));
    assert.equal(translated.status, 400, constraint);
    assert.equal(translated.code, "VALIDATION_ERROR");
    assert.ok(Object.keys(translated.fields).length);
    assert.doesNotMatch(JSON.stringify(translated.fields), /detalle privado/);
  }
  for (const code of ["22007", "22008"]) {
    assert.equal(translateProjectConfigurationError(Object.assign(new Error("detalle privado"), { code })).status, 400);
  }
  const duplicate = translateProjectConfigurationError({ code: "23505", constraint: "uq_project_folders_sibling_name" });
  assert.ok(duplicate instanceof ValidationError);
  assert.ok(duplicate.fields["body.name"]);
  for (const code of ["23503", "40001", "40P01"]) {
    const translated = translateProjectConfigurationError(Object.assign(new Error("detalle privado"), { code }));
    assert.ok(translated instanceof ConflictError);
    assert.equal(translated.status, 409);
    assert.equal(translated.code, "PROJECT_CONFIGURATION_CONFLICT");
    assert.equal(translated.fields, undefined);
    assert.doesNotMatch(translated.message, /detalle privado/);
  }
  for (const original of [new ValidationError(), new ConflictError("PROJECT_NOT_DRAFT", "Borrador requerido"), new Error("inesperado"), { code: "23514", constraint: "desconocida" }, { code: "23514", constraint: "toString" }, { code: "23505", constraint: "otra" }]) {
    assert.equal(translateProjectConfigurationError(original), original);
  }
});
