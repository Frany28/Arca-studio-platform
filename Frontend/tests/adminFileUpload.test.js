import assert from "node:assert/strict";
import test from "node:test";

import { getReplaceAvailability } from "../src/pages/admin-files/utils/adminFileReview.js";
import {
  describeUploadError,
  describeUploadResult,
  getFormatsLabel,
  getUploadAccept,
  validateUploadFile,
} from "../src/pages/admin-files/utils/adminFileUpload.js";
import { getUploadDisabledReason } from "../src/pages/admin-files/utils/adminFilesPresentation.js";

const file = (name, type, size = 1024) => ({ name, size, type });

test("validation mirrors the backend document policy and the confirmed cover rule", () => {
  assert.equal(validateUploadFile(file("Acta.pdf", "application/pdf")), "");
  assert.equal(validateUploadFile(file("Plano.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")), "");
  assert.equal(validateUploadFile(file("Recorrido.mp4", "video/mp4")), "");
  assert.match(validateUploadFile(file("notas.txt", "text/plain")), /Formato no admitido/);
  assert.match(validateUploadFile(file("falso.pdf", "image/png")), /Formato no admitido/, "la extensión y el tipo deben coincidir");
  assert.match(validateUploadFile(file("grande.pdf", "application/pdf", 50 * 1024 * 1024 + 1)), /50 MB/);
  assert.match(validateUploadFile(file("vacio.pdf", "application/pdf", 0)), /vacío/);
  assert.match(validateUploadFile(file(`${"a".repeat(151)}.pdf`, "application/pdf")), /150/);
  assert.match(validateUploadFile(file("Acta.pdf", "application/pdf"), { takenNames: ["acta.PDF"] }), /ya está seleccionado/);
  const cover = { systemKey: "cover" };
  assert.match(validateUploadFile(file("Portada.pdf", "application/pdf"), { folder: cover }), /solo admite imágenes JPEG o PNG/);
  assert.equal(validateUploadFile(file("Portada.jpg", "image/jpeg"), { folder: cover }), "");
  assert.equal(getUploadAccept(cover), ".jpeg,.jpg,.png");
  assert.match(getUploadAccept(null), /\.pdf/);
  assert.match(getFormatsLabel(cover), /Una sola imagen/);
});

test("«+ Nuevo» needs a project; root and any folder are valid; read-only projects and a full cover explain why not", () => {
  assert.match(getUploadDisabledReason(null, null), /Selecciona un proyecto o una carpeta/);
  assert.equal(getUploadDisabledReason({ status: "in_process" }, null), "", "raíz del proyecto (D7/D14 resueltas)");
  assert.equal(getUploadDisabledReason({ status: "in_process" }, { fileCount: 4, systemKey: "documents.quotes" }), "", "Cotizaciones admite archivos manuales");
  assert.match(getUploadDisabledReason({ status: "archived" }, { systemKey: null }), /archivado/);
  assert.match(getUploadDisabledReason({ status: "finished" }, { systemKey: null }), /finalizado/);
  assert.match(getUploadDisabledReason({ status: "in_process" }, { fileCount: 1, systemKey: "cover" }), /usa «Reemplazar archivo»/);
  assert.equal(getUploadDisabledReason({ status: "in_process" }, { fileCount: 0, systemKey: "cover" }), "");
  assert.equal(getUploadDisabledReason({ status: "draft" }, { fileCount: 3, systemKey: "documents" }), "", "el administrador prepara borradores");
});

test("replacement is blocked for legacy files, pending versions and read-only projects", () => {
  assert.deepEqual(getReplaceAvailability({ review: { status: "approved" } }, []), { allowed: true, reason: "" });
  assert.match(getReplaceAvailability({ review: { status: "legacy" } }, []).reason, /heredado/);
  assert.match(getReplaceAvailability({ review: { status: "approved" } }, [{ review: { status: "pending" } }]).reason, /pendiente/);
  assert.equal(getReplaceAvailability({ review: { status: "rejected" } }, []).allowed, true, "rechazada sin pendientes: admite otra versión");
  assert.match(getReplaceAvailability({ review: { status: "approved" }, project: { status: "archived" } }, []).reason, /Desarchiva/);
  assert.match(getReplaceAvailability({ review: { status: "approved" } }, [], { status: "finished" }).reason, /finalizado/);
  assert.equal(getReplaceAvailability({ review: { status: "approved" } }, [], { status: "draft" }).allowed, true);
});

test("nombre repetido en la carpeta destino: definitivo, nombra la ubicación y remite a «Reemplazar archivo»", () => {
  const generic = describeUploadError({ code: "DUPLICATE_PROJECT_FILE", status: 409 });
  assert.match(generic.message, /en esta carpeta\. No se reemplazó nada/);
  const located = describeUploadError({ code: "DUPLICATE_PROJECT_FILE", status: 409 }, { location: "«Quinta › Documentos › Planos»" });
  assert.equal(located.message, "Ya existe un archivo con ese nombre en «Quinta › Documentos › Planos». No se reemplazó nada: cancela o usa «Reemplazar archivo» en ese archivo para subir una versión nueva.");
  assert.deepEqual([located.retryable, located.uncertain], [false, false], "no se reintenta ni se reconcilia como si se hubiera guardado");
  assert.match(describeUploadError({ code: "PROJECT_FOLDER_FULL", status: 409 }, { location: "la raíz" }).message, /reemplaza la existente/, "la ubicación solo cambia el conflicto de nombre");
});

test("upload errors separate final answers, transient failures and uncertain outcomes", () => {
  assert.deepEqual(describeUploadError({ code: "DUPLICATE_PROJECT_FILE", status: 409 }).retryable, false);
  assert.match(describeUploadError({ code: "PROJECT_FOLDER_FULL", status: 409 }).message, /reemplaza la existente/);
  assert.deepEqual(
    [describeUploadError({ code: "NETWORK_ERROR" }).retryable, describeUploadError({ code: "NETWORK_ERROR" }).uncertain],
    [true, true],
    "sin respuesta, la carga pudo registrarse: se reconcilia",
  );
  assert.equal(describeUploadError({ code: "UPLOAD_ABORTED" }).cancelled, true);
  assert.equal(describeUploadError({ code: "STORAGE_UNAVAILABLE", message: "x", status: 503 }).retryable, true);
  assert.equal(describeUploadError({ code: "FORBIDDEN", message: "Sin permisos", status: 403 }).retryable, false);
  assert.equal(describeUploadError({ code: "VALIDATION_ERROR", fields: { "headers.x-change-note": ["Escribe el motivo."] }, status: 400 }).fieldError, "Escribe el motivo.");
});

test("success messages say the file or version is pending review", () => {
  assert.match(describeUploadResult("upload", { location: "Quinta › Garantías", name: "Acta.pdf" }).description, /Queda pendiente de revisión/);
  assert.match(describeUploadResult("replace", { name: "Acta.pdf", versionNumber: 3 }).description, /V3 de «Acta\.pdf»\. Queda pendiente de revisión: la versión vigente no cambia/);
});

test("upload and replacement send the binary with folder, name and encoded change note", async () => {
  const originalXhr = globalThis.XMLHttpRequest;
  const sent = [];
  globalThis.XMLHttpRequest = class {
    constructor() {
      this.headers = {};
      this.upload = {};
    }
    open(method, url) {
      Object.assign(this, { method, url });
    }
    setRequestHeader(name, value) {
      this.headers[name] = value;
    }
    send(body) {
      sent.push({ body, headers: this.headers, method: this.method, url: this.url });
      this.status = 201;
      this.responseText = "{}";
      this.onload();
    }
  };
  try {
    const { fileManagerApi } = await import("../src/api/http.js");
    const chosen = { name: "Acta final.pdf", size: 4, type: "application/pdf" };
    await fileManagerApi.uploadFile({ file: chosen, folderId: 104, projectId: 1 });
    await fileManagerApi.replaceVersion({ changeNote: "Firma añadida", file: chosen, fileId: 30, projectId: 1 });
    assert.deepEqual([sent[0].method, sent[0].url], ["POST", "/api/admin/files/projects/1/files?folderId=104"]);
    assert.equal(sent[0].headers["X-File-Name"], "Acta%20final.pdf");
    assert.equal(sent[0].headers["Content-Type"], "application/pdf");
    assert.equal(sent[1].url, "/api/projects/1/files/30/versions");
    assert.equal(sent[1].headers["X-Change-Note"], "Firma%20a%C3%B1adida");
    assert.equal(sent[1].body, chosen, "el contenido viaja como binario, sin multipart");
  } finally {
    globalThis.XMLHttpRequest = originalXhr;
  }
});
