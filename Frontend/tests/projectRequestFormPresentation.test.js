import assert from "node:assert/strict";
import test from "node:test";

import {
  isProjectRequestFileRemovable,
  toProjectRequestFileCards,
} from "../src/pages/project-request/utils/projectRequestFilePresentation.js";
import {
  fromLegalDocumentItems,
  getLegalDocumentsSummary,
  LEGAL_DOCUMENTS_PLACEHOLDER,
  toLegalDocumentItems,
} from "../src/pages/project-request/utils/projectRequestLegalDocuments.js";
import { formatFileSize } from "../src/utils/fileSize.js";

const file = (name, size, type = "image/png") => ({ name, size, type });

test("el tamaño de archivo usa la convención compacta de FileUploadSection", () => {
  assert.equal(formatFileSize(0), "0KB");
  assert.equal(formatFileSize(1), "1KB");
  assert.equal(formatFileSize(200 * 1024), "200KB");
  assert.equal(formatFileSize(1.5 * 1024 * 1024), "1.5MB");
  assert.equal(formatFileSize("no-numérico"), "0KB");
  assert.equal(formatFileSize(-10), "0KB");
});

test("los adjuntos se presentan con su estado real y progreso", () => {
  const cards = toProjectRequestFileCards([
    { error: "", file: file("plano.pdf", 2 * 1024 * 1024, "application/pdf"), id: "a", progress: 0, status: "pending" },
    { error: "", file: file("foto.png", 100 * 1024), id: "b", progress: 50, status: "uploading" },
    { error: "", file: file("video.mp4", 1024, "video/mp4"), id: "c", progress: 10, status: "uploaded" },
    { error: "Sin conexión", file: file("render.jpg", 1024, "image/jpeg"), id: "d", progress: 0, status: "error" },
  ], () => {});

  assert.deepEqual(cards.map((card) => card.status), ["pending", "uploading", "completed", "failed"]);
  assert.equal(cards[1].currentSizeLabel, "50KB");
  assert.equal(cards[1].totalSizeLabel, "100KB");
  assert.equal(cards[2].progress, 100);
  assert.equal(cards[3].errorMessage, "Sin conexión");
  assert.equal(cards[0].name, "plano.pdf");
});

test("solo los adjuntos pendientes o fallidos se pueden quitar", () => {
  const removed = [];
  const cards = toProjectRequestFileCards([
    { file: file("a.png", 1), id: "pending", status: "pending" },
    { file: file("b.png", 1), id: "uploading", status: "uploading" },
    { file: file("c.png", 1), id: "uploaded", status: "uploaded" },
    { file: file("d.png", 1), id: "failed", status: "error" },
  ], (id) => removed.push(id));

  assert.deepEqual(cards.map((card) => typeof card.onRemove), ["function", "undefined", "undefined", "function"]);
  cards[0].onRemove();
  cards[3].onRemove();
  assert.deepEqual(removed, ["pending", "failed"]);
  assert.equal(isProjectRequestFileRemovable(undefined), false);
  // Sin callback (p. ej. durante el envío) ninguna tarjeta ofrece quitar.
  assert.ok(toProjectRequestFileCards([{ file: file("a.png", 1), id: "x", status: "pending" }]).every((card) => !card.onRemove));
});

test("la documentación legal usa ítems Checkbox en orden de catálogo", () => {
  const items = toLegalDocumentItems(["other", "property_deed"]);
  assert.deepEqual(items.map((item) => [item.id, item.checked, item.type]), [
    ["property_deed", "Yes", "Checkbox"],
    ["purchase_contract", "No", "Checkbox"],
    ["lease_contract", "No", "Checkbox"],
    ["other", "Yes", "Checkbox"],
  ]);
  assert.deepEqual(fromLegalDocumentItems(items), ["property_deed", "other"]);
  assert.deepEqual(fromLegalDocumentItems(undefined), []);
});

test("el trigger resume la documentación como en Figma", () => {
  assert.equal(getLegalDocumentsSummary([]), LEGAL_DOCUMENTS_PLACEHOLDER);
  assert.equal(getLegalDocumentsSummary(["purchase_contract"]), "Contrato de compra");
  assert.equal(getLegalDocumentsSummary(["purchase_contract", "property_deed"]), "Documento de propiedad, Contrato de compra");
  assert.equal(
    getLegalDocumentsSummary(["property_deed", "purchase_contract", "other"]),
    "Documento de propiedad, Contrato de compra, otros",
  );
});
