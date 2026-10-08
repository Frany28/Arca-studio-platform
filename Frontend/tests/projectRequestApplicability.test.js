import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_PROPERTY_DETAIL_FIELDS,
  hasApplicableProperty,
  normalizeConditionalFormFields,
  requiresPropertyAvailability,
} from "../src/utils/projectRequestApplicability.js";
import { PROJECT_REQUEST_OPTIONS } from "../src/utils/projectRequestOptions.js";
import { buildProjectRequestPayload, getProjectRequestFieldErrors } from "../src/utils/projectRequestValidation.js";

const RESIDENTIAL_WITH_PROPERTY = {
  projectType: "residential", projectName: "Casa Lago", location: "Maracaibo, Estado Zulia",
  description: "Vivienda unifamiliar de dos plantas frente al lago, con terraza.",
  developmentMode: "full", investmentRange: "10k_50k", capitalAvailability: "available_now", startTime: "immediate",
  landStatus: "available", legalDocumentationStatus: "available", legalDocumentTypes: ["property_deed"],
  multipleOwners: "no", hasBlueprints: "Yes",
  standRequirementsStatus: "", standDocumentTypes: [], standSpaceStatus: "", hasStandSpacePlans: "Indeterminate",
};

test("solo Stand publicitario deja N/A la pregunta del inmueble y su sección legal", () => {
  for (const { value } of PROJECT_REQUEST_OPTIONS.projectType) {
    assert.equal(requiresPropertyAvailability(value), value !== "advertising_stand", value);
    assert.equal(hasApplicableProperty({ projectType: value, landStatus: "available" }), value !== "advertising_stand", value);
  }
  // El tipo histórico y un formulario sin tipo conservan la pregunta.
  assert.equal(requiresPropertyAvailability("stands_exhibitions"), true);
  assert.equal(requiresPropertyAvailability(""), true);
});

test("cambiar a Stand publicitario limpia inmueble y sección legal; volver muestra las preguntas vacías", () => {
  const stand = normalizeConditionalFormFields({ ...RESIDENTIAL_WITH_PROPERTY, projectType: "advertising_stand" });
  assert.equal(stand.landStatus, "");
  for (const [field, value] of Object.entries(EMPTY_PROPERTY_DETAIL_FIELDS)) assert.deepEqual(stand[field], value, field);
  assert.equal(stand.projectName, RESIDENTIAL_WITH_PROPERTY.projectName);
  assert.equal(stand.startTime, "immediate");

  const back = normalizeConditionalFormFields({ ...stand, projectType: "commercial" });
  assert.equal(back.landStatus, "");
  assert.equal(getProjectRequestFieldErrors(back).landStatus, "Selecciona una opción válida.");
});

test("limpieza condicional: inmueble no disponible y documentación no disponible", () => {
  for (const landStatus of ["acquiring", "unavailable", ""]) {
    const next = normalizeConditionalFormFields({ ...RESIDENTIAL_WITH_PROPERTY, landStatus });
    assert.equal(next.landStatus, landStatus);
    for (const [field, value] of Object.entries(EMPTY_PROPERTY_DETAIL_FIELDS)) assert.deepEqual(next[field], value, field);
  }
  const inProcess = normalizeConditionalFormFields({ ...RESIDENTIAL_WITH_PROPERTY, legalDocumentationStatus: "in_process" });
  assert.deepEqual(inProcess.legalDocumentTypes, []);
  assert.equal(inProcess.multipleOwners, "no");
  assert.deepEqual(normalizeConditionalFormFields(RESIDENTIAL_WITH_PROPERTY), RESIDENTIAL_WITH_PROPERTY);
  // La limpieza del stand se compone con la del inmueble en el mismo estado.
  const standDocuments = normalizeConditionalFormFields({
    ...RESIDENTIAL_WITH_PROPERTY, projectType: "advertising_stand",
    standRequirementsStatus: "in_process", standDocumentTypes: ["exhibitor_manual"], standSpaceStatus: "assigned",
  });
  assert.deepEqual(standDocuments.standDocumentTypes, []);
  assert.equal(standDocuments.standSpaceStatus, "assigned");
});

test("stand: valida sin la pregunta del inmueble y envía landStatus null aunque quede un valor anterior", () => {
  const stand = { ...RESIDENTIAL_WITH_PROPERTY, projectType: "advertising_stand", standSpaceStatus: "unassigned", standRequirementsStatus: "unavailable" };
  assert.deepEqual(getProjectRequestFieldErrors({ ...stand, landStatus: "" }), {});
  // Aunque el estado no se haya normalizado, el payload no envía datos del inmueble.
  const payload = buildProjectRequestPayload(stand);
  assert.equal(payload.landStatus, null);
  assert.equal(payload.legalDocumentationStatus, null);
  assert.deepEqual(payload.legalDocumentTypes, []);
  assert.equal(payload.hasMultipleOwners, null);
  assert.equal(payload.hasBlueprints, null);
  assert.deepEqual(payload.standRequirements, { requirementsStatus: "unavailable", documentTypes: [], spaceStatus: "unassigned", hasSpacePlans: null });
});

test("otros tipos: la pregunta del inmueble sigue siendo obligatoria y habilita la sección legal", () => {
  assert.ok(getProjectRequestFieldErrors({ ...RESIDENTIAL_WITH_PROPERTY, landStatus: "" }).landStatus);
  assert.ok(getProjectRequestFieldErrors({ ...RESIDENTIAL_WITH_PROPERTY, multipleOwners: "" }).multipleOwners);
  const payload = buildProjectRequestPayload(RESIDENTIAL_WITH_PROPERTY);
  assert.equal(payload.landStatus, "available");
  assert.equal(payload.legalDocumentationStatus, "available");
  assert.equal(payload.hasBlueprints, true);
  assert.equal("standRequirements" in payload, false);
});
