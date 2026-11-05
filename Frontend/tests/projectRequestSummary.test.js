import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectRequestSummary } from "../src/pages/project-request/utils/projectRequestSummary.js";
import { getProjectRequestOptionLabel } from "../src/utils/projectRequestOptions.js";

const ids = (rows) => rows.flat().map((item) => item.id);
const valueOf = (rows, id) => rows.flat().find((item) => item.id === id)?.value;

test("las respuestas guardadas se muestran con la etiqueta del formulario", () => {
  assert.equal(getProjectRequestOptionLabel("investmentRange", "10k_50k"), "$10,000 - $50,000 USD");
  assert.equal(getProjectRequestOptionLabel("investmentRange", "retirado", "Sin respuesta"), "Sin respuesta");
  assert.equal(getProjectRequestOptionLabel("campo", "x"), "");
  assert.equal(getProjectRequestOptionLabel("quality", null, "-"), "-");
});

test("el resumen de una solicitud con inmueble incluye estado, sección legal y omite respuestas vacías", () => {
  const { details, preferences } = buildProjectRequestSummary({
    capitalAvailability: "available_now", createdAt: "2026-03-22T12:00:00", description: "Oficina creativa.",
    hasMultipleOwners: false, hasPlans: true, investmentRange: "10k_50k", landStatus: "available",
    legalDocumentationStatus: "available", legalDocumentTypes: ["property_deed", "other"], location: "Maracaibo, Zulia",
    projectName: "Apto. Noventa y Uno", projectType: "residential", referenceLink: "https://es.pinterest.com/pin",
    startTime: "immediate", status: "pending_review",
  });

  assert.equal(valueOf(details, "status"), "En revisión");
  assert.equal(valueOf(details, "projectType"), "Residencial");
  assert.equal(valueOf(details, "landStatus"), "Sí, disponible");
  assert.equal(valueOf(details, "legalDocumentTypes"), "Documento de propiedad, Otro documento");
  assert.equal(valueOf(details, "hasMultipleOwners"), "No");
  assert.equal(valueOf(details, "hasPlans"), "Sí, disponible");
  assert.equal(ids(details).includes("projectSize"), false, "las preguntas opcionales sin respuesta no se muestran");
  assert.equal(ids(details).some((id) => id.startsWith("stand")), false);
  assert.deepEqual(details.find((row) => row.length === 2).map((item) => item.id), ["projectType", "location"]);
  assert.equal(preferences.flat().find((item) => item.id === "referenceLink").kind, "link");
  assert.equal(ids(preferences).includes("decisionMaker"), false);
});

test("el resumen de un Stand publicitario muestra sus requisitos y no la sección del inmueble", () => {
  const { details } = buildProjectRequestSummary({
    hasPlans: true, landStatus: "available", legalDocumentationStatus: "available", projectType: "advertising_stand",
    standRequirements: { documentTypes: ["exhibitor_manual"], hasSpacePlans: false, requirementsStatus: "available", spaceStatus: "assigned" },
  });

  assert.equal(valueOf(details, "standDocumentTypes"), "Manual del expositor");
  assert.equal(valueOf(details, "hasStandSpacePlans"), "No disponible");
  for (const id of ["landStatus", "legalDocumentationStatus", "hasPlans"]) {
    assert.equal(ids(details).includes(id), false, id);
  }
});

test("sin solicitud el resumen queda vacío", () => {
  assert.deepEqual(buildProjectRequestSummary(null), { details: [], preferences: [] });
});
