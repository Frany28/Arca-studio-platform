import assert from "node:assert/strict";
import test from "node:test";

import * as backend from "../src/domain/projectRequest.js";
import { allowsStandDocumentSelection as backendAllowsStandDocuments, STAND_REQUIREMENTS_VALUES } from "../src/domain/projectRequestStand.js";
import { createProjectRequestSchema } from "../src/validation/projectRequestSchemas.js";
import * as frontend from "../../Frontend/src/utils/projectRequestApplicability.js";
import { allowsStandDocumentSelection as frontendAllowsStandDocuments } from "../../Frontend/src/utils/projectRequestStand.js";
import { buildProjectRequestPayload, getProjectRequestFieldErrors } from "../../Frontend/src/utils/projectRequestValidation.js";

// El frontend replica las reglas del dominio; estas pruebas impiden que diverjan.
const PROJECT_TYPES = [...backend.READABLE_PROJECT_REQUEST_TYPES, null, undefined, "", "castle"];
const LAND_STATUSES = [...backend.PROJECT_REQUEST_VALUES.landStatus, null, undefined, "", "invalid"];
const LEGAL_STATUSES = [...backend.PROJECT_REQUEST_VALUES.legalDocumentationStatus, null, ""];
const SUBMISSION_ID = "550e8400-e29b-41d4-a716-446655440000";

test("paridad: inmueble y documentación legal aplican igual en frontend y backend", () => {
  for (const projectType of PROJECT_TYPES) {
    assert.equal(frontend.requiresPropertyAvailability(projectType), backend.requiresPropertyAvailability(projectType), String(projectType));
    assert.equal(backend.requiresPropertyAvailability(projectType), projectType !== "advertising_stand");
    for (const landStatus of LAND_STATUSES) {
      assert.equal(frontend.hasAvailableProperty(landStatus), backend.hasAvailableProperty(landStatus));
      const answers = { landStatus, projectType };
      assert.equal(frontend.hasApplicableProperty(answers), backend.hasApplicableProperty(answers), `${projectType}/${landStatus}`);
      for (const legalDocumentationStatus of LEGAL_STATUSES) {
        assert.equal(
          backend.hasAvailableLegalDocumentation({ ...answers, legalDocumentationStatus }),
          frontend.hasApplicableProperty(answers) && legalDocumentationStatus === "available",
        );
      }
    }
  }
  assert.equal(backend.hasApplicableProperty(null), false);
  assert.equal(frontend.hasApplicableProperty(undefined), false);
});

test("paridad: la documentación del evento se habilita con la misma respuesta", () => {
  for (const requirementsStatus of [...STAND_REQUIREMENTS_VALUES.requirementsStatus, null, undefined, ""]) {
    assert.equal(frontendAllowsStandDocuments(requirementsStatus), backendAllowsStandDocuments(requirementsStatus));
    assert.equal(backendAllowsStandDocuments(requirementsStatus), requirementsStatus === "available");
  }
});

test("paridad: lo que el formulario valida como completo lo acepta la API, incluida la pregunta del inmueble", () => {
  const base = {
    capitalAvailability: "available_now", description: "Proyecto con alcance definido para la reunión inicial.",
    developmentMode: "full", investmentRange: "10k_50k", location: "Maracaibo, Estado Zulia",
    projectName: "Paridad de aplicabilidad", startTime: "over_6_months", standSpaceStatus: "assigned",
    multipleOwners: "no", legalDocumentTypes: ["property_deed"],
  };
  for (const projectType of backend.PROJECT_REQUEST_VALUES.projectType) {
    for (const landStatus of ["", ...backend.PROJECT_REQUEST_VALUES.landStatus]) {
      for (const legalDocumentationStatus of ["available", "in_process"]) {
        const form = frontend.normalizeConditionalFormFields({ ...base, projectType, landStatus, legalDocumentationStatus });
        const frontendErrors = getProjectRequestFieldErrors(form);
        const parsed = createProjectRequestSchema.safeParse({ body: buildProjectRequestPayload(form, SUBMISSION_ID) });
        const label = `${projectType}/${landStatus}/${legalDocumentationStatus}`;
        assert.equal(parsed.success, Object.keys(frontendErrors).length === 0, label);
        const backendLandIssue = !parsed.success && parsed.error.issues.some(({ path }) => path.join(".") === "body.landStatus");
        assert.equal(Boolean(frontendErrors.landStatus), backendLandIssue, label);
        if (parsed.success) {
          assert.equal(parsed.data.body.landStatus === null, projectType === "advertising_stand", label);
        }
      }
    }
  }
});
