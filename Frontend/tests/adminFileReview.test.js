import assert from "node:assert/strict";
import test from "node:test";

import { fileManagerApi } from "../src/api/http.js";
import {
  canLinkWarranties,
  describeOperationError,
  describeRestoreResult,
  describeReviewResult,
  formatReviewStatus,
  formatVersionLabel,
  getRestoreAvailability,
  getViewerKind,
} from "../src/pages/admin-files/utils/adminFileReview.js";

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return { headers: { get: () => "application/json" }, json: async () => data, ok, status };
}

async function captureRequest(run, data = {}) {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { options, url };
    return jsonResponse(data);
  };
  try {
    await run();
    return request;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("each version opens its existing viewer by format and category", () => {
  assert.equal(getViewerKind({ extension: "pdf" }), "pdf");
  assert.equal(getViewerKind({ contentType: "application/pdf", extension: "" }), "pdf");
  assert.equal(getViewerKind({ extension: "docx" }), "docx");
  assert.equal(getViewerKind({ extension: "xlsx" }), "xlsx");
  assert.equal(getViewerKind({ extension: "png" }), "image");
  assert.equal(getViewerKind({ extension: "jpg", fileCategory: "panorama" }), "panorama");
  assert.equal(getViewerKind({ contentType: "video/mp4", extension: "mp4" }), "video");
  assert.equal(getViewerKind({ extension: "zip" }), "unsupported");
});

test("warranties are offered only inside «Documentos › Garantías» and its subfolders", () => {
  assert.equal(canLinkWarranties({ folder: { section: "warranties" } }), true);
  assert.equal(canLinkWarranties({ folder: { section: "documents" } }), false);
  assert.equal(canLinkWarranties({ folder: null }), false);
});

test("history labels and restore availability follow the backend rules", () => {
  assert.equal(formatVersionLabel({ isCurrent: true, versionNumber: 4 }), "Versión actual · V4");
  assert.equal(formatVersionLabel({ isCurrent: false, versionNumber: 2 }), "V2");
  assert.equal(formatReviewStatus("pending"), "Pendiente de revisión");
  assert.equal(formatReviewStatus(null), "Heredada");
  const approvedOld = { id: 1, isCurrent: false, review: { status: "approved" } };
  const current = { id: 2, isCurrent: true, review: { status: "approved" } };
  const rejected = { id: 3, isCurrent: false, review: { status: "rejected" } };
  const pending = { id: 4, isCurrent: false, review: { status: "pending" } };
  assert.deepEqual(getRestoreAvailability(approvedOld, [current, approvedOld]), { allowed: true, reason: "" });
  assert.equal(getRestoreAvailability(current, [current]).allowed, false);
  assert.equal(getRestoreAvailability(rejected, [rejected]).allowed, false);
  assert.match(getRestoreAvailability(approvedOld, [pending, current, approvedOld]).reason, /pendiente/);
});

test("success messages state only what the API confirmed: approval does not share", () => {
  const approved = describeReviewResult("approve", { currentVersionId: 9, sharedWithClient: false, version: { id: 9, versionNumber: 3 } }, "Acta.pdf");
  assert.equal(approved.title, "Archivo aprobado correctamente");
  assert.match(approved.description, /V3 de «Acta\.pdf» es ahora la versión vigente/);
  assert.match(approved.description, /Aún no se comparte con el cliente/);
  assert.doesNotMatch(approved.description, /visible en el proyecto|notificado/);
  const rejected = describeReviewResult("reject", { currentVersionId: 8, sharedWithClient: false, version: { id: 9, versionNumber: 3 } }, "Acta.pdf");
  assert.equal(rejected.title, "Archivo rechazado correctamente");
  assert.match(rejected.description, /se conserva con su motivo\. La versión vigente no cambia/);
  assert.match(describeReviewResult("reject", { currentVersionId: null, version: { versionNumber: 1 } }, "A").description, /sin versión vigente/);
  assert.match(describeRestoreResult({ review: { status: "pending" }, versionNumber: 5 }, { versionNumber: 2 }), /V5 a partir de la V2, que se conserva en el historial\. La nueva versión queda pendiente de revisión/);
});

test("409 conflicts and stale responses map to readable messages and a refresh", () => {
  assert.deepEqual(describeOperationError({ code: "FILE_VERSION_NOT_PENDING", status: 409 }, "x"), { fieldError: "", message: "Esta versión ya fue revisada. Se actualizó la información.", stale: true });
  assert.equal(describeOperationError({ code: "FILE_VERSION_PENDING_REVIEW" }, "x").stale, true);
  assert.equal(describeOperationError({ code: "PROJECT_FINALIZED" }, "x").stale, false);
  assert.equal(describeOperationError({ code: "WARRANTY_RETIRED" }, "x").stale, true);
  assert.equal(describeOperationError({ code: "VALIDATION_ERROR", fields: { "body.reason": ["Escribe el motivo."] } }, "x").fieldError, "Escribe el motivo.");
  assert.equal(describeOperationError({ code: "VALIDATION_ERROR", fields: { "body.changeNote": "Muy largo" } }, "x").fieldError, "Muy largo");
  assert.equal(describeOperationError({ message: "Error del servidor" }, "x").message, "Error del servidor");
});

test("U2 API calls use the documented version, review and warranty routes", async () => {
  let request = await captureRequest(() => fileManagerApi.listVersions({ cursor: "abc", fileId: 7, limit: 10, projectId: 3 }));
  assert.equal(request.url, "/api/projects/3/files/7/versions?cursor=abc&limit=10");

  request = await captureRequest(() => fileManagerApi.approveVersion({ fileId: 7, projectId: 3, versionId: 70 }));
  assert.deepEqual([request.url, request.options.method], ["/api/projects/3/files/7/versions/70/approve", "POST"]);

  request = await captureRequest(() => fileManagerApi.rejectVersion({ fileId: 7, projectId: 3, reason: "Falta firma", versionId: 70 }));
  assert.equal(request.url, "/api/projects/3/files/7/versions/70/reject");
  assert.deepEqual(JSON.parse(request.options.body), { reason: "Falta firma" });

  request = await captureRequest(() => fileManagerApi.restoreVersion({ changeNote: "Volver a v1", fileId: 7, projectId: 3, versionId: 10 }));
  assert.equal(request.url, "/api/projects/3/files/7/versions/10/restore");
  assert.deepEqual(JSON.parse(request.options.body), { changeNote: "Volver a v1" });

  request = await captureRequest(() => fileManagerApi.listWarranties({ projectId: 3 }));
  assert.equal(request.url, "/api/projects/3/warranties");
  request = await captureRequest(() => fileManagerApi.linkWarrantyDocument({ fileId: 7, projectId: 3, warrantyId: 5 }));
  assert.deepEqual([request.url, request.options.method], ["/api/admin/files/projects/3/warranties/5/documents/7", "PUT"]);
  request = await captureRequest(() => fileManagerApi.unlinkWarrantyDocument({ fileId: 7, projectId: 3, warrantyId: 5 }));
  assert.equal(request.options.method, "DELETE");

  assert.equal(fileManagerApi.getVersionContentUrl({ fileId: 7, projectId: 3, versionId: 70 }), "/api/projects/3/files/7/content?versionId=70");
});
