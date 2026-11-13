import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAdminProjectRequestEditPayload,
  getAdminProjectRequestSaveFailure,
  getProjectRequestFormFingerprint,
} from "../src/pages/admin-project-request-edit/utils/adminProjectRequestEdit.js";
import {
  toPersistedProjectRequestFileItem,
  toProjectRequestFileCards,
  UPLOADED_PENDING_SUBMIT_LABEL,
} from "../src/pages/project-request/utils/projectRequestFilePresentation.js";
import { normalizeWithRetainedAnswers } from "../src/utils/projectRequestRetainedAnswers.js";
import {
  ADMIN_PROJECT_REQUEST_EDIT_ROUTE,
  getAdminProjectRequestEditPath,
} from "../src/utils/projectRequestRoutes.js";

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

/**
 * Formulario residencial con inmueble disponible, como lo deja useProjectRequestForm.
 *
 * @param {Object} [overrides] - Campos a sustituir.
 * @returns {Object} Estado del formulario.
 */
function residentialForm(overrides = {}) {
  return {
    capitalAvailability: "available_now",
    decisionMaker: "",
    description: "Vivienda unifamiliar de dos plantas frente al lago, con terraza.",
    developmentMode: "full",
    experience: "",
    hasBlueprints: "No",
    hasStandSpacePlans: "Indeterminate",
    investmentRange: "10k_50k",
    landStatus: "available",
    legalDocumentTypes: ["property_deed"],
    legalDocumentationStatus: "available",
    location: "Maracaibo, Estado Zulia",
    locationFormattedAddress: "",
    locationLatitude: null,
    locationLongitude: null,
    locationProviderPlaceId: null,
    multipleOwners: "no",
    projectName: "Casa Lago",
    projectSize: "",
    projectType: "residential",
    quality: "",
    referenceLink: "",
    standDocumentTypes: [],
    standRequirementsStatus: "",
    standSpaceStatus: "",
    startTime: "immediate",
    ...overrides,
  };
}

test("el lápiz de una solicitud abre «Editar solicitud» y la creación conserva su ruta", async () => {
  assert.equal(ADMIN_PROJECT_REQUEST_EDIT_ROUTE, "/solicitudes-proyecto/:projectRequestId/editar");
  assert.equal(getAdminProjectRequestEditPath(42), "/solicitudes-proyecto/42/editar");
  const [projectsPage, routes] = await Promise.all([source("pages/admin-projects/AdminProjectsPage.jsx"), source("main.jsx")]);
  assert.match(projectsPage, /onEditProject=\{\(row\) => navigate\(getAdminProjectRequestEditPath\(row\.requestId\)/);
  assert.match(projectsPage, /canEditProject=\{isProjectRequestRow\}/, "el lápiz de los proyectos sigue deshabilitado");
  assert.match(routes, /<Route path=\{ADMIN_PROJECT_REQUEST_EDIT_ROUTE\} element=\{<AdminProjectRequestEditPage \/>\} \/>/);
  assert.match(routes, /<Route path="\/solicitudes\/nueva" element=\{<ProjectRequestPage \/>\} \/>/);
  // La edición está dentro del bloque exclusivo de administradores.
  const adminBlock = routes.slice(routes.indexOf('allowedRoles={["admin"]}'));
  assert.ok(adminBlock.indexOf("ADMIN_PROJECT_REQUEST_EDIT_ROUTE") > 0);
  assert.ok(adminBlock.indexOf("ADMIN_PROJECT_REQUEST_EDIT_ROUTE") < adminBlock.indexOf("</Route>"));
});

test("creación y edición comparten un único formulario; la edición usa la navegación administrativa", async () => {
  const [clientPage, editForm, editPage] = await Promise.all([
    source("pages/ProjectRequestPage.jsx"),
    source("pages/admin-project-request-edit/components/AdminProjectRequestEditForm.jsx"),
    source("pages/admin-project-request-edit/AdminProjectRequestEditPage.jsx"),
  ]);
  for (const page of [clientPage, editForm]) {
    assert.match(page, /<ProjectRequestFormSections/);
    assert.match(page, /useProjectRequestForm\(/);
    assert.doesNotMatch(page, /<FormSection title=/, "las secciones viven solo en ProjectRequestFormSections");
    assert.match(page, /<ProjectRequestFormHeader/);
    assert.doesNotMatch(page, /<h1|<header/, "el encabezado vive solo en ProjectRequestFormHeader");
  }
  assert.match(editForm, /title="Editar solicitud"/);
  assert.match(clientPage, /title="Solicitud de proyecto"/);
  assert.match(editForm, /"Guardar cambios"/);
  assert.match(editForm, />Cancelar</);
  assert.match(editForm, /retainHiddenAnswers: true/);
  assert.match(editForm, /useUnsavedChangesGuard\(\{ when: hasChanges \}\)/);
  assert.match(editPage, /<InternalDashboardLayout/);
  assert.doesNotMatch(editPage, /ProjectRequestPageShell/, "no usa la navegación del cliente");
  assert.match(editPage, /<Loader preset="projectRequestForm"/);
  // El formulario solo se monta con la solicitud ya recibida.
  assert.ok(editPage.indexOf("detail.loading") < editPage.indexOf("<AdminProjectRequestEditForm"));
});

test("el cuerpo de la edición son las respuestas del formulario más la versión, sin workflow", () => {
  const payload = buildAdminProjectRequestEditPayload(residentialForm(), "2026-11-13T10:00:00.123Z");
  assert.equal(payload.expectedUpdatedAt, "2026-11-13T10:00:00.123Z");
  assert.equal(payload.hasMultipleOwners, false, "«no» se envía como false, no como vacío");
  assert.equal(payload.hasBlueprints, false);
  assert.equal(payload.decisionMaker, null);
  for (const field of ["submissionId", "status", "clientId", "assigneeIds", "reviewedBy"]) {
    assert.equal(field in payload, false, field);
  }
});

test("la huella detecta cambios reales y no los que no se enviarían", () => {
  const original = residentialForm();
  assert.equal(getProjectRequestFormFingerprint({ ...original }), getProjectRequestFormFingerprint(original));
  assert.notEqual(getProjectRequestFormFingerprint({ ...original, description: `${original.description} Ampliada.` }), getProjectRequestFormFingerprint(original));
  // Sin inmueble disponible los datos legales no se envían: no cuentan como cambio.
  const withoutProperty = residentialForm({ landStatus: "unavailable" });
  assert.equal(
    getProjectRequestFormFingerprint({ ...withoutProperty, multipleOwners: "yes" }),
    getProjectRequestFormFingerprint(withoutProperty),
  );
});

test("cambiar de tipo y volver no borra la información del inmueble ni la del stand", () => {
  const original = residentialForm({ hasBlueprints: "Yes", multipleOwners: "no" });
  const toStand = normalizeWithRetainedAnswers({ ...original, projectType: "advertising_stand" }, {}, "projectType");
  assert.equal(toStand.form.landStatus, "", "en un stand la pregunta del inmueble no aplica");
  assert.deepEqual(toStand.form.legalDocumentTypes, []);
  const withStand = normalizeWithRetainedAnswers({ ...toStand.form, standSpaceStatus: "assigned" }, toStand.retained, "standSpaceStatus");
  const back = normalizeWithRetainedAnswers({ ...withStand.form, projectType: "residential" }, withStand.retained, "projectType");
  assert.equal(back.form.landStatus, "available");
  assert.equal(back.form.legalDocumentationStatus, "available");
  assert.deepEqual(back.form.legalDocumentTypes, ["property_deed"]);
  assert.equal(back.form.multipleOwners, "no", "un «no» existente se conserva");
  assert.equal(back.form.hasBlueprints, "Yes");
  assert.equal(back.form.standSpaceStatus, "", "lo del stand se oculta al salir de stand");
  const standAgain = normalizeWithRetainedAnswers({ ...back.form, projectType: "advertising_stand" }, back.retained, "projectType");
  assert.equal(standAgain.form.standSpaceStatus, "assigned", "y vuelve al regresar a stand");
});

test("las respuestas retenidas no se envían y una edición explícita prevalece", () => {
  const original = residentialForm();
  const hidden = normalizeWithRetainedAnswers({ ...original, landStatus: "unavailable" }, {}, "landStatus");
  assert.equal(hidden.form.legalDocumentationStatus, "");
  const payload = buildAdminProjectRequestEditPayload(hidden.form, "2026-11-13T10:00:00.123Z");
  assert.equal(payload.legalDocumentationStatus, null);
  assert.deepEqual(payload.legalDocumentTypes, []);
  assert.equal(payload.hasMultipleOwners, null);
  const shown = normalizeWithRetainedAnswers({ ...hidden.form, landStatus: "available" }, hidden.retained, "landStatus");
  assert.equal(shown.form.legalDocumentationStatus, "available");
  assert.deepEqual(shown.retained, {});
  // Documentos: se vacían mientras la documentación no está disponible y vuelven al estarlo.
  const unavailableDocs = normalizeWithRetainedAnswers({ ...original, legalDocumentationStatus: "in_process" }, {}, "legalDocumentationStatus");
  assert.deepEqual(unavailableDocs.form.legalDocumentTypes, []);
  const stillHidden = normalizeWithRetainedAnswers({ ...unavailableDocs.form, legalDocumentationStatus: "unavailable" }, unavailableDocs.retained, "legalDocumentationStatus");
  assert.deepEqual(stillHidden.form.legalDocumentTypes, []);
  const availableDocs = normalizeWithRetainedAnswers({ ...stillHidden.form, legalDocumentationStatus: "available" }, stillHidden.retained, "legalDocumentationStatus");
  assert.deepEqual(availableDocs.form.legalDocumentTypes, ["property_deed"]);
  // Con la sección visible, la selección explícita del usuario prevalece y ya no hay nada retenido.
  const explicit = normalizeWithRetainedAnswers({ ...availableDocs.form, legalDocumentTypes: ["purchase_contract"] }, availableDocs.retained, "legalDocumentTypes");
  assert.deepEqual(explicit.form.legalDocumentTypes, ["purchase_contract"]);
  assert.deepEqual(explicit.retained, {});
});

test("los adjuntos guardados se muestran como parte de la solicitud y sin acciones en la edición", () => {
  const item = toPersistedProjectRequestFileItem({ fileType: "image/png", id: 9, name: "planta.png", size: 2048 });
  assert.equal(item.status, "uploaded");
  assert.equal(item.remoteId, 9);
  const [card] = toProjectRequestFileCards([item], undefined, { completedLabel: "Adjunto de la solicitud" });
  assert.equal(card.completedLabel, "Adjunto de la solicitud");
  assert.equal(card.onRemove, undefined);
  assert.equal(toProjectRequestFileCards([item])[0].completedLabel, UPLOADED_PENDING_SUBMIT_LABEL, "la creación no cambia");
});

test("los errores al guardar se explican y solo los conflictos ofrecen recargar", () => {
  assert.equal(getAdminProjectRequestSaveFailure({ code: "PROJECT_REQUEST_EDIT_CONFLICT", status: 409 }).canReload, true);
  assert.equal(getAdminProjectRequestSaveFailure({ code: "PROJECT_REQUEST_NOT_EDITABLE", status: 409 }).canReload, true);
  assert.equal(getAdminProjectRequestSaveFailure({ code: "FORBIDDEN", status: 403 }).title, "Sin permiso");
  const validation = getAdminProjectRequestSaveFailure({ code: "VALIDATION_ERROR", fields: { "body.description": "Muy corta." }, status: 400 });
  assert.deepEqual([validation.title, validation.description, validation.canReload], ["Revisa la información", "Muy corta.", false]);
  const duplicated = getAdminProjectRequestSaveFailure({ code: "PROJECT_NAME_ALREADY_EXISTS", message: "Ya existe un proyecto o solicitud activa con ese nombre.", status: 409 });
  assert.equal(duplicated.description, "Ya existe un proyecto o solicitud activa con ese nombre.");
  assert.equal(getAdminProjectRequestSaveFailure({ code: "NETWORK_ERROR" }).title, "No se pudieron guardar los cambios");
});
