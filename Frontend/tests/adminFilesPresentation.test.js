import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fileManagerApi } from "../src/api/http.js";
import { getAdminFilesColumns, getAdminFilesGridTemplate, getAdminFilesTableMinWidth } from "../src/config/adminFilesTable.js";
import { describeFolderError } from "../src/pages/admin-files/hooks/useAdminFileFolderActions.js";
import {
  ADMIN_FILES_TABS,
  FOLDER_RULE_MESSAGES,
  buildFolderTree,
  formatExtension,
  formatFileDate,
  formatFolderPath,
  getFolderCapabilities,
  getFolderDepth,
  getFolderDestinationPath,
  MAX_FOLDER_DEPTH,
  getUploadDisabledReason,
  QUOTES_FOLDER_KEY,
  getItemsEmptyCopy,
  isFileManagerUnavailable,
} from "../src/pages/admin-files/utils/adminFilesPresentation.js";

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

test("tabs follow Figma order and labels", () => {
  assert.deepEqual(ADMIN_FILES_TABS.map((tab) => tab.label), ["Aprobados", "Pendientes por aprobación", "Rechazados"]);
  assert.deepEqual(ADMIN_FILES_TABS.map((tab) => tab.id), ["approved", "pending", "rejected"]);
});

test("the disabled feature is detected only by 404 API_ROUTE_NOT_FOUND", () => {
  assert.equal(isFileManagerUnavailable({ code: "API_ROUTE_NOT_FOUND", status: 404 }), true);
  assert.equal(isFileManagerUnavailable({ code: "PROJECT_NOT_FOUND", status: 404 }), false);
  assert.equal(isFileManagerUnavailable({ status: 500 }), false);
  assert.equal(isFileManagerUnavailable(null), false);
});

test("folders in API preorder become a nested tree that keeps orphans", () => {
  const roots = buildFolderTree([
    { id: 1, name: "Renders e imágenes", parentId: null, systemKey: "renders" },
    { id: 2, name: "Panorámicas", parentId: 1, systemKey: "renders.models" },
    { id: 3, name: "Propuesta inicial", parentId: 2, systemKey: "renders.models.initial_proposal" },
    { id: 4, name: "Documentos", parentId: null, systemKey: "documents" },
    { id: 5, name: "Garantías", parentId: 4, systemKey: "documents.warranties" },
    { id: 9, name: "Huérfana", parentId: 99, systemKey: null },
  ]);
  assert.deepEqual(roots.map((node) => node.name), ["Renders e imágenes", "Documentos", "Huérfana"]);
  assert.equal(roots[0].children[0].name, "Panorámicas");
  assert.equal(roots[0].children[0].children[0].name, "Propuesta inicial");
  assert.equal(roots[1].children[0].name, "Garantías");
  assert.deepEqual(buildFolderTree(null), []);
});

test("folder capabilities: root of a selected project, any folder (Cotizaciones included) except the cover, and a maximum depth", () => {
  assert.deepEqual(getFolderCapabilities(null), { canCreateChild: false, canManage: false, createReason: FOLDER_RULE_MESSAGES.selectFolder });
  const project = { folders: [{ id: 1, parentId: null }, { id: 2, parentId: 1 }] };
  assert.deepEqual(getFolderCapabilities(null, { project }), { canCreateChild: true, canManage: false, createReason: "" }, "raíz del proyecto (D7 resuelta)");
  assert.equal(getFolderCapabilities({ systemKey: "cover" }).canCreateChild, false);
  assert.equal(getFolderCapabilities({ systemKey: "cover" }).createReason, FOLDER_RULE_MESSAGES.coverNoSubfolders);
  assert.deepEqual(getFolderCapabilities({ systemKey: "documents.warranties" }), { canCreateChild: true, canManage: false, createReason: "" });
  assert.deepEqual(getFolderCapabilities({ systemKey: null }), { canCreateChild: true, canManage: true, createReason: "" });
  assert.deepEqual(getFolderCapabilities({ systemKey: QUOTES_FOLDER_KEY }), { canCreateChild: true, canManage: false, createReason: "" }, "Cotizaciones admite subcarpetas");
  for (const systemKey of ["documents.records", "documents.plans", "documents.additional", "renders.images", "renders.videos", "renders.models", "client_files"]) {
    assert.deepEqual(getFolderCapabilities({ systemKey }), { canCreateChild: true, canManage: false, createReason: "" }, systemKey);
  }
  const deep = { folders: Array.from({ length: MAX_FOLDER_DEPTH }, (_, index) => ({ id: index + 1, parentId: index === 0 ? null : index })) };
  assert.equal(getFolderDepth(deep.folders, MAX_FOLDER_DEPTH), MAX_FOLDER_DEPTH);
  assert.deepEqual(getFolderCapabilities({ id: MAX_FOLDER_DEPTH, systemKey: null }, { project: deep }), { canCreateChild: false, canManage: true, createReason: FOLDER_RULE_MESSAGES.tooDeep });
  assert.equal(getFolderCapabilities({ id: MAX_FOLDER_DEPTH - 1, systemKey: null }, { project: deep }).canCreateChild, true);
  assert.equal(getUploadDisabledReason({ status: "in_progress" }, { fileCount: 3, systemKey: QUOTES_FOLDER_KEY }), "");
  assert.equal(getUploadDisabledReason({ status: "in_progress" }, { fileCount: 0, systemKey: "documents.plans" }), "");
});

test("ruta de destino «Proyecto/Carpeta/Subcarpeta» con la ubicación abierta; en la raíz, «Proyecto/»", () => {
  const folders = [{ id: 10, name: "Imágenes", parentId: null }, { id: 11, name: "Renders", parentId: 10 }, { id: 12, name: "Fachada norte", parentId: 11 }];
  const project = { folders, name: "Casa en las Nubes" };
  assert.equal(getFolderDestinationPath(project, null), "Casa en las Nubes/");
  assert.equal(getFolderDestinationPath(project, folders[0]), "Casa en las Nubes/Imágenes");
  assert.equal(getFolderDestinationPath(project, folders[1]), "Casa en las Nubes/Imágenes/Renders");
  assert.equal(getFolderDestinationPath(project, folders[2]), "Casa en las Nubes/Imágenes/Renders/Fachada norte", "la subcarpeta abierta, nunca su madre");
  assert.equal(getFolderDestinationPath({ name: "Casa" }, { id: 9, name: "Suelta", parentId: 99 }), "Casa/Suelta", "sin el resto del árbol, al menos la carpeta");
  const cycle = [{ id: 1, name: "A", parentId: 2 }, { id: 2, name: "B", parentId: 1 }];
  assert.ok(getFolderDestinationPath({ folders: cycle, name: "P" }, cycle[0]).split("/").length <= 65, "un ciclo heredado no la vuelve infinita");
});
test("formats keep visible names readable", () => {
  assert.equal(formatExtension("pdf"), ".PDF");
  assert.equal(formatExtension(".docx"), ".DOCX");
  assert.equal(formatExtension(""), "—");
  assert.match(formatFileDate("2026-03-22T12:00:00Z"), /22[\s\S]*mar[\s\S]*2026/);
  assert.doesNotMatch(formatFileDate("2026-03-22T12:00:00Z"), /\./);
  assert.equal(formatFileDate(null), "Sin fecha");
  assert.equal(formatFileDate("no-es-fecha"), "Sin fecha");
  assert.equal(formatFolderPath({ path: [{ name: "Documentos" }, { name: "Garantías" }], project: { name: "Quinta" } }), "Quinta › Documentos › Garantías");
});

test("empty states distinguish filters and tabs", () => {
  assert.equal(getItemsEmptyCopy("approved", true).title, "No hay coincidencias");
  assert.equal(getItemsEmptyCopy("pending", false).title, "No hay archivos pendientes");
  assert.match(getItemsEmptyCopy("rejected", false).description, /se conservan/);
  assert.equal(getItemsEmptyCopy("approved", false).title, "Aún no hay archivos aprobados");
});

test("folder API errors map to readable messages and field errors", () => {
  assert.deepEqual(
    describeFolderError({ code: "VALIDATION_ERROR", fields: { "body.name": ["Ya existe una carpeta con ese nombre."] }, message: "Datos inválidos" }, "x"),
    { fieldError: "Ya existe una carpeta con ese nombre.", message: "Datos inválidos" },
  );
  assert.match(describeFolderError({ code: "PROJECT_FOLDER_NOT_EMPTY" }, "x").message, /vacías/);
  assert.match(describeFolderError({ code: "PROJECT_FOLDER_PROTECTED" }, "x").message, /predeterminadas/);
  assert.match(describeFolderError({ code: "PROJECT_FOLDER_DECISION_PENDING" }, "x").message, /pendiente de decisión/);
  assert.equal(describeFolderError({}, "Fallo").message, "Fallo");
});

test("table geometry adds Proyecto only outside the approved tree view", () => {
  assert.deepEqual(getAdminFilesColumns({ showProject: false }).map((column) => column.id), ["name", "version", "type", "size", "date", "uploadedBy", "actions"]);
  assert.equal(getAdminFilesColumns({ showProject: true })[2].id, "project");
  assert.equal(getAdminFilesTableMinWidth({ showProject: true }) - getAdminFilesTableMinWidth({ showProject: false }), 176);
  assert.match(getAdminFilesGridTemplate({ showProject: false }), /^minmax\(0,1fr\) 88px/);
  // Pendientes (Figma 3727:683264): «Revisar» como única acción y la tabla cabe en 1032 px (1440 con menú).
  assert.deepEqual(getAdminFilesColumns({ review: true, showProject: true }).map((column) => column.id), ["name", "version", "project", "type", "size", "date", "uploadedBy", "actions"]);
  assert.ok(getAdminFilesTableMinWidth({ review: true, showProject: true }) <= 1032);
  assert.equal(getAdminFilesColumns({ review: true, showProject: true }).at(-1).width, 128);
  const rejected = { rejected: true, showProject: true };
  assert.deepEqual(getAdminFilesColumns(rejected).map((column) => column.id), ["name", "version", "project", "type", "size", "date", "uploadedBy", "actions"]);
  assert.deepEqual(getAdminFilesColumns(rejected).map((column) => column.width), [160, null, null, null, null, null, null, null]);
  assert.equal(getAdminFilesTableMinWidth(rejected), 1028);
});

test("the file manager API builds the documented admin routes", async () => {
  let request = await captureRequest(() => fileManagerApi.listItems({ extensions: ["pdf", "png"], folderId: 7, includeSubfolders: true, limit: 10, order: "asc", projectId: 3, search: "acta", sort: "name", tab: "pending" }));
  const url = new URL(request.url, "http://local");
  assert.equal(url.pathname, "/api/admin/files/items");
  assert.equal(url.searchParams.get("extensions"), "pdf,png");
  assert.equal(url.searchParams.get("includeSubfolders"), "true");
  assert.equal(url.searchParams.get("tab"), "pending");
  assert.equal(url.searchParams.get("sort"), "name");

  request = await captureRequest(() => fileManagerApi.listItems({ includeSubfolders: true, tab: "approved" }));
  assert.equal(new URL(request.url, "http://local").searchParams.has("includeSubfolders"), false, "Sin carpeta no se envía includeSubfolders");

  request = await captureRequest(() => fileManagerApi.createFolder({ name: "Planos", parentId: 5, projectId: 3 }));
  assert.equal(request.url, "/api/admin/files/projects/3/folders");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), { name: "Planos", parentId: 5 });

  request = await captureRequest(() => fileManagerApi.renameFolder({ folderId: 8, name: "Nuevo", projectId: 3 }));
  assert.equal(request.url, "/api/admin/files/projects/3/folders/8");
  assert.equal(request.options.method, "PATCH");

  request = await captureRequest(() => fileManagerApi.deleteFolder({ folderId: 8, projectId: 3 }));
  assert.equal(request.options.method, "DELETE");

  request = await captureRequest(() => fileManagerApi.searchFolders({ search: "garan" }));
  assert.equal(request.url, "/api/admin/files/folders?search=garan");
});

test("the page offers no file deletion and keeps the default activation off", async () => {
  const [table, workspace, api] = await Promise.all([
    readFile(new URL("../src/pages/admin-files/components/AdminFilesTable.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/admin-files/components/AdminFilesWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/fileManagerApi.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(table, /label: "Eliminar"|>Eliminar</);
  assert.doesNotMatch(api, /\/files\/\$\{[^}]+\}`,\s*\{\s*method: "DELETE"/);
  assert.match(workspace, /Los archivos guardados y sus versiones nunca se eliminan/);
});
