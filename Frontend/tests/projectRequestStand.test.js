import assert from "node:assert/strict";
import test from "node:test";
import { PROJECT_REQUEST_OPTIONS } from "../src/utils/projectRequestOptions.js";
import { isAdvertisingStand, normalizeStandFormFields } from "../src/utils/projectRequestStand.js";
import { buildProjectRequestPayload, getProjectRequestFieldErrors } from "../src/utils/projectRequestValidation.js";
import { buildAdminRequestDetails } from "../src/pages/admin-dashboard/utils/adminRequestDetails.js";

const form = {
  projectType: "advertising_stand", projectName: "Evento de prueba", location: "Maracaibo, Estado Zulia",
  description: "Diseño del stand para presentar el proyecto durante el evento.",
  developmentMode: "full", landStatus: "unavailable", investmentRange: "undefined",
  capitalAvailability: "available_now", startTime: "1_3_months",
  standRequirementsStatus: "available", standDocumentTypes: ["exhibitor_manual"],
  standSpaceStatus: "assigned", hasStandSpacePlans: "No",
};

test("el tipo exacto habilita el bloque y todo cambio a otro tipo descarta sus respuestas", () => {
  for (const { value } of PROJECT_REQUEST_OPTIONS.projectType) {
    assert.equal(isAdvertisingStand(value), value === "advertising_stand");
    const next = normalizeStandFormFields({ ...form, projectType: value });
    if (isAdvertisingStand(value)) assert.deepEqual(next, form);
    else {
      assert.equal(next.standRequirementsStatus, "");
      assert.deepEqual(next.standDocumentTypes, []);
      assert.equal(next.standSpaceStatus, "");
      assert.equal(next.hasStandSpacePlans, "Indeterminate");
      assert.equal(next.description, form.description);
      const returned = normalizeStandFormFields({ ...next, projectType: "advertising_stand" });
      assert.deepEqual(returned.standDocumentTypes, []);
      assert.equal(returned.standSpaceStatus, "");
    }
  }
});

test("los documentos se limpian al cambiar su disponibilidad y el payload omite datos no aplicables", () => {
  const changed = normalizeStandFormFields({ ...form, standRequirementsStatus: "in_process" });
  assert.deepEqual(changed.standDocumentTypes, []);
  assert.equal(changed.standSpaceStatus, "assigned");
  assert.equal(buildProjectRequestPayload(form).standRequirements.hasSpacePlans, false);
  for (const { value } of PROJECT_REQUEST_OPTIONS.projectType.filter(({ value }) => !isAdvertisingStand(value))) {
    assert.equal("standRequirements" in buildProjectRequestPayload({ ...form, projectType: value }), false);
  }
});

test("se valida el espacio solo para stand publicitario, sin exigir datos del inmueble", () => {
  assert.deepEqual(getProjectRequestFieldErrors(form), {});
  assert.ok(getProjectRequestFieldErrors({ ...form, standSpaceStatus: "" }).standSpaceStatus);
  assert.ok(getProjectRequestFieldErrors({ ...form, standDocumentTypes: ["other", "other"] }).standDocumentTypes);
  for (const { value } of PROJECT_REQUEST_OPTIONS.projectType.filter(({ value }) => !isAdvertisingStand(value))) {
    assert.deepEqual(getProjectRequestFieldErrors({ ...form, projectType: value, standSpaceStatus: "" }), {});
  }
});

test("detalle administrativo conserva el tipo específico, respuestas y ausencia de históricos", () => {
  const standRequirements = buildProjectRequestPayload(form).standRequirements;
  const details = buildAdminRequestDetails({ summary: { id: 1 }, queueRequest: { id: 1, projectType: "advertising_stand", standRequirements } });
  assert.equal(details.projectTypeLabel, "Stand publicitario");
  assert.deepEqual(details.standRequirements, standRequirements);
  assert.equal(buildAdminRequestDetails({ summary: { id: 1, projectType: "stands_exhibitions" } }).standRequirements, null);
});
