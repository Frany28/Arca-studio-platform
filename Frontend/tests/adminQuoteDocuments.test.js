import assert from "node:assert/strict";
import test from "node:test";

import {
  describeQuotePdfStatus,
  describeQuoteRestoreError,
  describeQuoteRestorePlan,
  describeQuoteRestoreResult,
  getAdminFileItemKey,
  getQuoteVersionActions,
  isQuoteItem,
  toQuoteHistoryVersion,
} from "../src/pages/admin-files/utils/adminQuoteDocuments.js";

test("estado del PDF de una cotización: solo «available» es descargable; los fallos se nombran", () => {
  assert.deepEqual(describeQuotePdfStatus({ status: "available" }), { available: true, label: "" });
  assert.deepEqual(describeQuotePdfStatus({ status: "pending" }), { available: false, label: "PDF en preparación" });
  assert.deepEqual(describeQuotePdfStatus(null), { available: false, label: "PDF en preparación" }, "sin reserva: versión anterior a la persistencia");
  assert.equal(describeQuotePdfStatus({ errorCode: "QUOTE_PDF_GENERATION_ERROR", status: "error" }).label, "Error de generación del PDF");
  assert.equal(describeQuotePdfStatus({ errorCode: "QUOTE_PDF_STORAGE_ERROR", status: "error" }).label, "Error de almacenamiento del PDF");
  assert.equal(describeQuotePdfStatus({ errorCode: "QUOTE_PDF_MISSING", status: "error" }).label, "PDF no encontrado en el almacenamiento");
  assert.match(describeQuotePdfStatus({ errorCode: "QUOTE_PDF_INTEGRITY_ERROR", status: "error" }).label, /requiere revisión/);
  assert.equal(describeQuotePdfStatus({ errorCode: "OTRO", status: "error" }).label, "PDF no disponible");
});

test("filas: una cotización se reconoce por su origen y su clave no choca con la de un archivo del mismo id", () => {
  assert.equal(isQuoteItem({ source: "quote" }), true);
  assert.equal(isQuoteItem({ source: "file" }), false);
  assert.equal(isQuoteItem({}), false, "respuestas anteriores sin origen son archivos");
  assert.notEqual(getAdminFileItemKey({ source: "quote", versionId: 40 }), getAdminFileItemKey({ versionId: 40 }));
});

test("historial: la versión comercial se adapta al drawer; las históricas se restauran y solo un PDF disponible se descarga", () => {
  const version = toQuoteHistoryVersion({
    createdAt: "2026-04-02T10:00:00.000Z", createdBy: { id: 2, name: "Admin Arca" }, isCurrent: false,
    pdf: { errorCode: "QUOTE_PDF_STORAGE_ERROR", fileName: "COT-012-v2.pdf", size: null, status: "error" }, versionNumber: 2,
  });
  assert.deepEqual([version.id, version.versionNumber, version.isCurrent, version.fileName, version.uploadedBy.name, version.note], [2, 2, false, "COT-012-v2.pdf", "Admin Arca", "Error de almacenamiento del PDF"]);
  assert.deepEqual(getQuoteVersionActions(version).map((action) => [action.id, Boolean(action.disabled)]), [["view", false], ["restore", false], ["download", true]]);
  const current = getQuoteVersionActions({ isCurrent: true, pdf: { status: "available" } });
  assert.deepEqual(current.map((action) => [action.id, Boolean(action.disabled)]), [["view", false], ["restore", true], ["download", false]]);
  assert.equal(current[1].hint, "Esta es la versión vigente.");
  assert.equal(current[1].label, "Restaurar versión");
});

test("restauración comercial: el historial muestra el origen y el motivo junto al estado del PDF", () => {
  const restored = toQuoteHistoryVersion({
    createdAt: "2026-11-24T10:00:00.000Z", createdBy: { id: 2, name: "Admin" }, isCurrent: true,
    pdf: { status: "pending" }, restoredFrom: { reason: "Aprobada por el cliente", versionNumber: 1 }, versionNumber: 4,
  });
  assert.equal(restored.note, "Restaurada desde V1: Aprobada por el cliente · PDF en preparación");
  assert.deepEqual(restored.restoredFrom, { reason: "Aprobada por el cliente", versionNumber: 1 });
  assert.equal(toQuoteHistoryVersion({ pdf: { status: "available" }, versionNumber: 2 }).note, "");
});

test("restauración comercial: el plan explica la versión creada y los datos recuperados; el aviso no declara un PDF inexistente", () => {
  const plan = describeQuoteRestorePlan({ versionNumber: 1 }, 3);
  assert.match(plan, /^Se creará la V4 con los datos comerciales de la V1/);
  assert.match(plan, /servicios, cantidades, unidades, tarifas, totales/);
  assert.match(plan, /versiones anteriores y sus PDF se conservan/);
  assert.doesNotMatch(plan, /pendiente de revisión/, "La restauración comercial no requiere aprobación");

  const ok = describeQuoteRestoreResult({ currentVersion: 4, pdf: { status: "available" } }, { versionNumber: 1 });
  assert.equal(ok.title, "Versión restaurada");
  assert.match(ok.description, /Se creó la V4 a partir de la V1 y es la versión vigente/);
  const failed = describeQuoteRestoreResult({ currentVersion: 4, pdf: { errorCode: "QUOTE_PDF_STORAGE_ERROR", status: "error" } }, { versionNumber: 1 });
  assert.equal(failed.title, "Versión restaurada; PDF no disponible");
  assert.match(failed.description, /Error de almacenamiento del PDF: se intentará recuperar/);
  assert.doesNotMatch(failed.description, /está disponible/);
});

test("restauración comercial: errores de motivo, conflictos y referencias no disponibles", () => {
  assert.deepEqual(describeQuoteRestoreError({ code: "VALIDATION_ERROR", fields: { "body.reason": "Escribe el motivo." }, message: "Datos inválidos" }),
    { fieldError: "Escribe el motivo.", message: "Datos inválidos", stale: false });
  assert.equal(describeQuoteRestoreError({ code: "QUOTE_VERSION_CONFLICT" }).stale, true);
  const reference = describeQuoteRestoreError({ code: "QUOTE_RESTORE_REFERENCE_UNAVAILABLE", message: "No se puede restaurar la versión 1: El servicio «SERV-001» está inactivo." });
  assert.deepEqual([reference.stale, reference.message], [false, "No se puede restaurar la versión 1: El servicio «SERV-001» está inactivo."]);
  assert.equal(describeQuoteRestoreError({ code: "NETWORK_ERROR" }).message, "No se pudo restaurar la versión.");
});
