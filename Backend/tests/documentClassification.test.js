import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  CLIENT_FILES_FOLDER_KEY,
  DOCUMENT_ORIGINS,
  describeCatalogPath,
  resolveDocumentLocation,
  resolveFileOrigin,
} from "../src/domain/documentClassification.js";
import { evaluateManagedUpload, resolveManagedFileCategory } from "../src/domain/fileManagerUpload.js";
import { getSystemFolder } from "../src/domain/projectFolderCatalog.js";

test("cotizaciones: siempre en «Documentos › Cotizaciones», sea cual sea su formato", () => {
  assert.deepEqual(resolveDocumentLocation({ origin: DOCUMENT_ORIGINS.QUOTE_PDF }), {
    folderKey: "documents.quotes", reason: "QUOTE_PDF", status: "classified", suggestedKey: null,
  });
  assert.ok(getSystemFolder("documents.quotes"), "la clave existe en el catálogo");
});

test("adjuntos de la solicitud de origen: «Archivos del cliente», también si son imágenes o PDF", () => {
  for (const fileCategory of ["image", "document", "video", "panorama"]) {
    const origin = resolveFileOrigin({ folderId: null, originProjectRequestId: 70 });
    assert.equal(origin, DOCUMENT_ORIGINS.REQUEST_ATTACHMENT);
    assert.deepEqual(resolveDocumentLocation({ fileCategory, origin }), { folderKey: CLIENT_FILES_FOLDER_KEY, reason: "REQUEST_ATTACHMENT", status: "classified", suggestedKey: null });
  }
});

test("un archivo subido a una carpeta conserva la elegida: nunca se reubica por su extensión", () => {
  const origin = resolveFileOrigin({ folderId: 15, originProjectRequestId: 70 });
  assert.equal(origin, DOCUMENT_ORIGINS.FOLDER_UPLOAD, "la carpeta registrada prevalece sobre el origen");
  assert.deepEqual(resolveDocumentLocation({ fileCategory: "document", folderKey: "documents.plans", origin }), {
    folderKey: "documents.plans", reason: "CHOSEN_FOLDER", status: "kept", suggestedKey: null,
  });
});

test("imágenes, panorámicas, videos y documentos heredados sin carpeta quedan pendientes, con sugerencia por categoría", () => {
  const origin = resolveFileOrigin({});
  assert.equal(origin, DOCUMENT_ORIGINS.LEGACY_UPLOAD);
  const cases = [
    ["image", "renders.images", "IMAGE_STAGE_UNKNOWN"],
    ["panorama", "renders.models", "PANORAMA_STAGE_UNKNOWN"],
    ["video", "renders.videos", "VIDEO_STAGE_UNKNOWN"],
    ["document", "documents", "DOCUMENT_TYPE_UNKNOWN"],
    [null, null, "CATEGORY_UNKNOWN"],
  ];
  for (const [fileCategory, suggestedKey, reason] of cases) {
    assert.deepEqual(resolveDocumentLocation({ fileCategory, origin }), { folderKey: null, reason, status: "pending", suggestedKey }, fileCategory);
  }
  // Las panorámicas no se mezclan con las imágenes comunes.
  assert.notEqual(resolveDocumentLocation({ fileCategory: "panorama", origin }).suggestedKey, resolveDocumentLocation({ fileCategory: "image", origin }).suggestedKey);
});

test("un origen desconocido es un error explícito, no una clasificación por defecto", () => {
  assert.throws(() => resolveDocumentLocation({ origin: "email" }), { code: "UNKNOWN_DOCUMENT_ORIGIN" });
});

test("la ruta legible de una sugerencia sale del catálogo", () => {
  assert.equal(describeCatalogPath("renders.images"), "Renders e imágenes › Imágenes");
  assert.equal(describeCatalogPath("documents.quotes"), "Documentos › Cotizaciones");
  assert.equal(describeCatalogPath(null), "");
});

test("subida al administrador: Cotizaciones rechaza archivos manuales; las demás categorías documentales los admiten", () => {
  assert.deepEqual(evaluateManagedUpload({ fileCount: 0, systemKey: "documents.quotes" }, "pdf"), { allowed: false, reason: "FOLDER_MANAGED_BY_MODULE" });
  for (const systemKey of ["documents.records", "documents.plans", "documents.additional", "documents.warranties"]) {
    assert.equal(evaluateManagedUpload({ fileCount: 3, systemKey }, "pdf").allowed, true, systemKey);
  }
  // Las panorámicas siguen clasificándose por su carpeta, no por la extensión.
  assert.equal(resolveManagedFileCategory("renders.models.initial_proposal", "image/jpeg"), "panorama");
  assert.equal(resolveManagedFileCategory("renders.images.execution", "image/jpeg"), "image");
  assert.equal(resolveManagedFileCategory("documents.plans", "image/png"), "image");
});

test("al convertir una solicitud en proyecto, sus adjuntos se ubican en «Archivos del cliente» sin pisar una carpeta ya asignada", async () => {
  // Comprobación estructural de la sentencia (el flujo completo se cubre con PostgreSQL desechable).
  const source = await readFile(new URL("../src/repositories/projectRequestWorkflowRepository.js", import.meta.url), "utf8");
  assert.match(source, /origin_project_request_id = project_request_id,[\s\S]*?folder_id = coalesce\(folder_id, \([\s\S]*?folder\.system_key = \$3 and folder\.deleted_at is null/);
  assert.match(source, /\[project\.id, projectRequestId, CLIENT_FILES_FOLDER_KEY\]/);
});
