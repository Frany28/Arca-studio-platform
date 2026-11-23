import assert from "node:assert/strict";
import test from "node:test";

import {
  describeQuotePdfStatus,
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

test("historial: la versión comercial se adapta al drawer y solo se ve o descarga (sin restaurar)", () => {
  const version = toQuoteHistoryVersion({
    createdAt: "2026-04-02T10:00:00.000Z", createdBy: { id: 2, name: "Admin Arca" }, isCurrent: false,
    pdf: { errorCode: "QUOTE_PDF_STORAGE_ERROR", fileName: "COT-012-v2.pdf", size: null, status: "error" }, versionNumber: 2,
  });
  assert.deepEqual([version.id, version.versionNumber, version.isCurrent, version.fileName, version.uploadedBy.name, version.note], [2, 2, false, "COT-012-v2.pdf", "Admin Arca", "Error de almacenamiento del PDF"]);
  assert.deepEqual(getQuoteVersionActions(version).map((action) => [action.id, Boolean(action.disabled)]), [["view", false], ["download", true]]);
  assert.deepEqual(getQuoteVersionActions({ pdf: { status: "available" } }).map((action) => [action.id, Boolean(action.disabled)]), [["view", false], ["download", false]]);
});
