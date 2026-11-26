import assert from "node:assert/strict";
import test from "node:test";

import { fileManagerApi } from "../src/api/http.js";
import {
  canLinkWarranties,
  describeOperationError,
  describeRestoreResult,
  describeRestorePlan,
  describeReviewResult,
  describeVersionNote,
  formatDisplayedVersionSuffix,
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

test("history notes and the viewer header name the version only when it adds information", () => {
  const versions = [
    { id: 30, review: { status: "approved" }, versionNumber: 3 },
    { changeNote: "Vuelve la firmada.", id: 50, restoredFromVersionId: 30, review: { status: "pending" }, versionNumber: 5 },
  ];
  assert.equal(describeVersionNote(versions[1], versions), "Restaurada desde V3 · Motivo: Vuelve la firmada.");
  assert.equal(describeVersionNote({ restoredFromVersionId: 1 }, versions), "Restaurada desde una versión anterior");
  assert.equal(describeVersionNote({ changeNote: "Plano corregido.", review: { status: "approved" } }, []), "Motivo: Plano corregido.");
  assert.equal(describeVersionNote({ changeNote: "x", review: { reason: "Falta la firma.", status: "rejected" } }, []), "Motivo del rechazo: Falta la firma.");
  assert.equal(describeVersionNote({ review: { status: "approved" } }, []), "");

  assert.equal(formatDisplayedVersionSuffix({ isCurrent: true, review: { status: "approved" }, versionNumber: 4 }), "");
  assert.equal(formatDisplayedVersionSuffix({ isCurrent: true, review: { status: "legacy" }, versionNumber: 1 }), "");
  assert.equal(formatDisplayedVersionSuffix({ isCurrent: false, review: { status: "approved" }, versionNumber: 2 }), "V2 · Aprobada");
  assert.equal(formatDisplayedVersionSuffix({ isCurrent: false, review: { status: "pending" }, versionNumber: 5 }), "V5 · Pendiente de revisión");
});

test("history labels and restore availability follow the backend rules", () => {
  // Drawer 3934:182047: «Versión actual» y «V2»; pendientes y rechazadas nombran su estado.
  assert.equal(formatVersionLabel({ isCurrent: true, review: { status: "approved" }, versionNumber: 4 }), "Versión actual");
  assert.equal(formatVersionLabel({ isCurrent: false, review: { status: "approved" }, versionNumber: 2 }), "V2");
  assert.equal(formatVersionLabel({ isCurrent: false, review: { status: "pending" }, versionNumber: 5 }), "V5 · Pendiente de revisión");
  assert.equal(formatVersionLabel({ isCurrent: false, review: { status: "rejected" }, versionNumber: 3 }), "V3 · Rechazada");
  assert.equal(formatReviewStatus("pending"), "Pendiente de revisión");
  assert.equal(formatReviewStatus(null), "Heredada");
  const approvedOld = { id: 1, isCurrent: false, review: { status: "approved" } };
  const current = { id: 2, isCurrent: true, review: { status: "approved" } };
  const rejected = { id: 3, isCurrent: false, review: { status: "rejected" } };
  const pending = { id: 4, isCurrent: false, review: { status: "pending" } };
  assert.deepEqual(getRestoreAvailability(approvedOld, [current, approvedOld]), { allowed: true, reason: "" });
  assert.deepEqual(getRestoreAvailability(current, [current, approvedOld]), { allowed: true, reason: "" }, "la vigente aprobada también se restaura (PR2)");
  assert.match(getRestoreAvailability(current, [pending, current]).reason, /pendiente/);
  assert.equal(getRestoreAvailability(rejected, [rejected]).allowed, false);
  assert.match(getRestoreAvailability(approvedOld, [pending, current, approvedOld]).reason, /pendiente/);
});

test("review alerts describe completed actions without promising sharing", () => {
  const approved = describeReviewResult("approve");
  assert.equal(approved.title, "Archivo aprobado correctamente");
  assert.equal(approved.description, "El archivo fue aprobado y está disponible según los permisos del proyecto.");
  assert.doesNotMatch(approved.description, /compart|cliente|públic/i);
  const rejected = describeReviewResult("reject");
  assert.equal(rejected.title, "Archivo rechazado correctamente");
  assert.equal(rejected.description, "El motivo del rechazo quedó guardado en el historial de versiones.");
  assert.match(describeRestoreResult({ review: { status: "pending" }, versionNumber: 5 }, { versionNumber: 2 }), /V5 a partir de la V2, que se conserva en el historial\. La nueva versión queda pendiente de revisión/);
});

test("409 conflicts and stale responses map to readable messages and a refresh", () => {
  assert.deepEqual(describeOperationError({ code: "FILE_VERSION_NOT_PENDING", status: 409 }, "x"), { fieldError: "", message: "Esta versión ya fue revisada. Se actualizó la información.", stale: true });
  assert.equal(describeOperationError({ code: "FILE_VERSION_PENDING_REVIEW" }, "x").stale, true);
  assert.equal(describeOperationError({ code: "PROJECT_FINALIZED" }, "x").stale, false);
  assert.equal(describeOperationError({ code: "WARRANTY_RETIRED" }, "x").stale, true);
  assert.equal(describeOperationError({ code: "VALIDATION_ERROR", fields: { "body.reason": ["Escribe el motivo."] } }, "x").fieldError, "Escribe el motivo.");
  assert.equal(describeOperationError({ code: "VALIDATION_ERROR", fields: { "body.changeNote": "Muy largo" } }, "x").fieldError, "Muy largo");
  assert.deepEqual(describeOperationError({
    code: "INTERNAL_ERROR",
    fields: { "body.reason": "Detalle interno" },
    message: "Detalle interno del servidor",
    status: 500,
  }, "Inténtalo de nuevo."), { fieldError: "", message: "Inténtalo de nuevo.", stale: false });
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

test("restore plan explains the new version, that history is kept and that it stays pending", () => {
  const text = describeRestorePlan({ versionNumber: 2 }, [{ versionNumber: 5 }, { versionNumber: 4 }, { versionNumber: 2 }]);
  assert.equal(text, "Se creará la V6 con el contenido de la V2. Las versiones anteriores se conservan y la nueva quedará pendiente de revisión; la versión vigente no cambia hasta aprobarla.");
  assert.match(describeRestorePlan({ versionNumber: 3 }, []), /^Se creará la V4 con el contenido de la V3\./);
  assert.equal(describeOperationError({ code: "FILE_VERSION_OBJECT_MISSING" }, "x").stale, false);
});
