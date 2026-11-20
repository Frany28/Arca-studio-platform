import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Gestión de archivos (Figma 3727:682730) sobre un backend simulado con la forma del contrato B7:
// árbol, pestañas, búsqueda, tipos, orden, cursor, carpetas y descarga. Datos ficticios en
// memoria; nunca usa Supabase ni datos de Figma.

let browser;
let server;
let origin;

const SCREENSHOT_DIR = process.env.ARCA_U1_SCREENSHOT_DIR || "";

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), cacheDir: getBrowserTestCacheDir(import.meta.url),
    configFile: false,
    envDir: false,
    plugins: [react(), tailwindcss()],
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined),
  });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * Carpetas predeterminadas de un proyecto (ids desde `base`), en preorden y con nombre visible.
 *
 * @param {number} base - Primer id.
 * @returns {Array<Object>} Carpetas.
 */
function defaultFolders(base) {
  return [
    { fileCount: 0, id: base, name: "Portada del proyecto", parentId: null, systemKey: "cover" },
    { fileCount: 0, id: base + 1, name: "Renders e imágenes", parentId: null, systemKey: "renders" },
    { fileCount: 0, id: base + 2, name: "Panorámicas", parentId: base + 1, systemKey: "renders.models" },
    { fileCount: 0, id: base + 3, name: "Documentos", parentId: null, systemKey: "documents" },
    { fileCount: 0, id: base + 4, name: "Garantías", parentId: base + 3, systemKey: "documents.warranties" },
  ];
}

/**
 * Versión de archivo con la forma de FileManagerItem.
 *
 * @param {number} id - Identificador de versión y archivo.
 * @param {Object} values - Campos variables.
 * @returns {Object} Elemento.
 */
function item(id, { day, extension = "pdf", fileCategory, fileId = id, folder, isCurrent = true, name, project, reason = null, size, status = "approved", versionNumber = 1 }) {
  return {
    changeNote: null,
    contentType: extension === "pdf" ? "application/pdf" : "image/png",
    createdAt: `2026-03-${String(day).padStart(2, "0")}T14:00:00.000Z`,
    extension,
    fileCategory: fileCategory || (extension === "pdf" ? "document" : "image"),
    fileId,
    folder,
    isCurrent,
    name,
    project: { id: project.id, name: project.name, status: "in_progress" },
    restoredFromVersionId: null,
    review: { reason, reviewedAt: status === "pending" ? null : "2026-03-25T10:00:00.000Z", reviewerName: status === "pending" ? null : "Ana Admin", status },
    size,
    uploadedBy: { id: 2, name: "Arq. Armando" },
    versionId: id * 10,
    versionNumber,
  };
}

/**
 * Versión del historial (FileVersion) a partir de un elemento del simulador.
 *
 * @param {Object} entry - Elemento.
 * @returns {Object} Versión.
 */
function toFileVersion(entry) {
  return {
    changeNote: entry.changeNote, contentType: entry.contentType, createdAt: entry.createdAt, extension: entry.extension,
    id: entry.versionId, isCurrent: entry.isCurrent, originalName: entry.name, restoredFromVersionId: entry.restoredFromVersionId,
    review: entry.review, size: entry.size, uploadedBy: entry.uploadedBy, versionNumber: entry.versionNumber,
  };
}

// PDF mínimo válido de una página para PDF.js (contenido ficticio).
const SAMPLE_PDF = Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<<>>>>endobj
4 0 obj<</Length 0>>stream

endstream endobj
xref
0 5
0000000000 65535 f 
trailer<</Size 5/Root 1 0 R>>
startxref
0
%%EOF`);
// PNG de 1 × 1 píxel.
const SAMPLE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/**
 * Backend simulado del administrador de archivos con estado en memoria.
 *
 * @param {{ enabled?: boolean, failures?: Object }} [options] - Activación y fallos inyectados.
 * @returns {Object} Estado y manejador.
 */
function createBackend({ enabled = true, failures = {} } = {}) {
  const quinta = { client: { name: "Cliente Uno" }, fileCount: 13, folders: defaultFolders(100), id: 1, name: "Quinta Bella Vista", status: "in_progress" };
  const apto = { client: { name: "Cliente Dos" }, fileCount: 1, folders: defaultFolders(200), id: 2, name: "Apartamento JC", status: "in_progress" };
  quinta.folders.push({ fileCount: 0, id: 150, name: "Planos de obra", parentId: 103, systemKey: null });
  const documents = { id: 103, name: "Documentos", section: "documents" };
  const warranties = { id: 104, name: "Garantías", section: "warranties" };
  const items = [
    ...Array.from({ length: 12 }, (_, index) => item(index + 1, { day: index + 1, folder: documents, name: `Acta de inicio ${String(index + 1).padStart(2, "0")}.pdf`, project: quinta, size: (index + 1) * 1024 * 1024 })),
    // Garantía: doce versiones aprobadas; la V12 es la vigente (historial con «Mostrar más versiones»).
    ...Array.from({ length: 12 }, (_, index) => item(300 + index, { day: 9 + index, fileId: 30, folder: warranties, isCurrent: index === 11, name: "Garantía impermeabilización.pdf", project: quinta, size: 512 * 1024, versionNumber: index + 1 })),
    item(40, { day: 21, extension: "png", folder: { id: 201, name: "Renders e imágenes", section: "renders" }, name: "Fachada.png", project: apto, size: 2048 * 1024 }),
    // Propuesta: V1 aprobada vigente y V2 pendiente de revisión.
    item(49, { day: 1, fileId: 50, folder: documents, name: "Propuesta pendiente.pdf", project: quinta, size: 4000 }),
    item(50, { day: 22, fileId: 50, folder: documents, isCurrent: false, name: "Propuesta pendiente.pdf", project: quinta, size: 4096, status: "pending", versionNumber: 2 }),
    item(60, { day: 23, folder: documents, isCurrent: false, name: "Contrato rechazado.pdf", project: quinta, reason: "Falta la firma del cliente.", size: 8192, status: "rejected" }),
  ];
  const warrantyList = [
    { code: "G-01", documents: [], endDate: "2028-01-01", id: 5, model: "Techo", product: "Impermeabilización", startDate: "2026-01-01" },
    { code: "G-02", documents: [{ fileId: 30 }], endDate: "2027-06-01", id: 6, model: "Aluminio", product: "Ventanas", startDate: "2026-02-01" },
  ];
  const state = { items, projects: [quinta, apto], requests: [], warranties: warrantyList };
  const json = (route, status, body) => route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });

  /**
   * Ids de una carpeta y sus subcarpetas.
   *
   * @param {Object} project - Proyecto.
   * @param {number} folderId - Carpeta.
   * @returns {Set<number>} Ids.
   */
  function subtree(project, folderId) {
    const ids = new Set([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of project.folders) {
        if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          grew = true;
        }
      }
    }
    return ids;
  }

  state.handle = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname: path } = url;
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    const params = Object.fromEntries(url.searchParams);
    state.requests.push({ body, method, path, search: params });
    const operation = `${method} ${path.replace(/\/\d+(?=\/|$)/g, "/:id")}`;
    if (failures[operation]) return json(route, failures[operation].status, failures[operation].body);

    if (path === "/api/auth/me") return json(route, 200, { user: { email: "ana@example.test", firstName: "Ana", id: 1, lastName: "Admin", role: "admin", status: "active" } });
    if (path === "/api/projects") return json(route, 200, { nextCursor: null, projects: [] });
    if (path === "/api/admin/dashboard-metrics") return json(route, 200, { metrics: { files: { latestUploadAt: "2026-06-19T13:34:00", total: 500, totalBytes: 2.33 * 1024 ** 3 } } });
    if (path.startsWith("/api/admin/files") && !enabled) return json(route, 404, { code: "API_ROUTE_NOT_FOUND", message: "Ruta no encontrada" });

    if (path === "/api/admin/files/metrics") {
      return json(route, 200, { metrics: { lastUploadAt: "2026-03-23T14:00:00.000Z", objectCount: 16, scope: { folderId: null, projectId: null }, totalFiles: 16, usedBytes: 2.33 * 1024 ** 3, } });
    }
    if (path === "/api/admin/files/tree") {
      const search = (params.search || "").toLowerCase();
      return json(route, 200, { nextCursor: null, projects: state.projects.filter((project) => `${project.name} ${project.client.name}`.toLowerCase().includes(search)) });
    }
    if (path === "/api/admin/files/folders") {
      const search = (params.search || "").toLowerCase();
      const folders = state.projects.flatMap((project) => project.folders
        .filter((folder) => folder.name.toLowerCase().includes(search))
        .map((folder) => {
          const chain = [];
          for (let current = folder; current; current = project.folders.find((candidate) => candidate.id === current.parentId)) chain.unshift({ id: current.id, name: current.name });
          return { ...folder, client: project.client, path: chain, project: { id: project.id, name: project.name } };
        }));
      return json(route, 200, { folders, nextCursor: null });
    }
    if (path === "/api/admin/files/items") {
      const tab = params.tab || "approved";
      const sort = params.sort || "date";
      const order = params.order || "desc";
      let rows = state.items.filter((candidate) => candidate.review.status === tab && (tab !== "approved" || candidate.isCurrent));
      if (params.projectId) rows = rows.filter((candidate) => candidate.project.id === Number(params.projectId));
      if (params.folderId) {
        const project = state.projects.find((candidate) => candidate.id === Number(params.projectId));
        const ids = subtree(project, Number(params.folderId));
        rows = rows.filter((candidate) => candidate.folder && ids.has(candidate.folder.id));
      }
      if (params.search) rows = rows.filter((candidate) => candidate.name.toLowerCase().includes(params.search.toLowerCase()));
      if (params.extensions) rows = rows.filter((candidate) => params.extensions.split(",").includes(candidate.extension));
      const key = { date: (row) => row.createdAt, name: (row) => row.name, size: (row) => row.size }[sort];
      rows.sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0) * (order === "asc" ? 1 : -1));
      let offset = 0;
      if (params.cursor) {
        const cursor = JSON.parse(Buffer.from(params.cursor, "base64url").toString());
        if (cursor.tab !== tab || cursor.sort !== sort || cursor.order !== order) return json(route, 400, { code: "VALIDATION_ERROR", fields: { "query.cursor": ["Cursor inválido"] }, message: "Cursor inválido" });
        offset = cursor.offset;
      }
      const limit = Number(params.limit || 10);
      const page = rows.slice(offset, offset + limit);
      const nextCursor = offset + limit < rows.length ? Buffer.from(JSON.stringify({ offset: offset + limit, order, sort, tab })).toString("base64url") : null;
      return json(route, 200, { items: page, nextCursor });
    }
    const folderMatch = /^\/api\/admin\/files\/projects\/(\d+)\/folders(?:\/(\d+))?$/.exec(path);
    if (folderMatch) {
      const project = state.projects.find((candidate) => candidate.id === Number(folderMatch[1]));
      const folderId = folderMatch[2] ? Number(folderMatch[2]) : null;
      if (method === "POST") {
        if (body.parentId === null) return json(route, 409, { code: "PROJECT_FOLDER_DECISION_PENDING", message: "Pendiente" });
        const siblings = project.folders.filter((folder) => folder.parentId === body.parentId);
        if (siblings.some((folder) => folder.name.toLowerCase() === body.name.trim().toLowerCase())) {
          return json(route, 400, { code: "VALIDATION_ERROR", fields: { "body.name": ["Ya existe una carpeta con ese nombre en esta ubicación."] }, message: "Datos inválidos" });
        }
        const folder = { fileCount: 0, id: 300 + project.folders.length, name: body.name.trim(), parentId: body.parentId, systemKey: null };
        const parentIndex = project.folders.findIndex((candidate) => candidate.id === body.parentId);
        project.folders.splice(parentIndex + 1, 0, folder);
        return json(route, 201, { folder, folders: project.folders });
      }
      const folder = project.folders.find((candidate) => candidate.id === folderId);
      if (folder.systemKey) return json(route, 409, { code: "PROJECT_FOLDER_PROTECTED", message: "Protegida" });
      if (method === "PATCH") {
        folder.name = body.name;
        return json(route, 200, { folder: null, folders: project.folders });
      }
      if (method === "DELETE") {
        const hasContent = project.folders.some((candidate) => candidate.parentId === folder.id) || state.items.some((candidate) => candidate.folder?.id === folder.id);
        if (hasContent) return json(route, 409, { code: "PROJECT_FOLDER_NOT_EMPTY", message: "No vacía" });
        project.folders = project.folders.filter((candidate) => candidate.id !== folder.id);
        return json(route, 200, { folder: null, folders: project.folders });
      }
    }
    const contentMatch = /^\/api\/projects\/(\d+)\/files\/(\d+)\/content$/.exec(path);
    if (contentMatch) {
      const entry = state.items.find((candidate) => candidate.versionId === Number(params.versionId));
      const png = entry?.extension === "png";
      return route.fulfill({
        body: png ? SAMPLE_PNG : SAMPLE_PDF,
        contentType: png ? "image/png" : "application/pdf",
        headers: { "Content-Disposition": `attachment; filename="acta-v${params.versionId}.${png ? "png" : "pdf"}"` },
        status: 200,
      });
    }
    const versionsMatch = /^\/api\/projects\/(\d+)\/files\/(\d+)\/versions$/.exec(path);
    if (versionsMatch && method === "GET") {
      const fileId = Number(versionsMatch[2]);
      const all = state.items.filter((candidate) => candidate.fileId === fileId).sort((left, right) => right.versionNumber - left.versionNumber);
      const offset = params.cursor ? Number(params.cursor) : 0;
      const limit = Number(params.limit || 20);
      const current = all.find((candidate) => candidate.isCurrent);
      return json(route, 200, {
        currentVersionId: current?.versionId ?? null,
        nextCursor: offset + limit < all.length ? String(offset + limit) : null,
        versions: all.slice(offset, offset + limit).map(toFileVersion),
      });
    }
    const reviewMatch = /^\/api\/projects\/(\d+)\/files\/(\d+)\/versions\/(\d+)\/(approve|reject|restore)$/.exec(path);
    if (reviewMatch && method === "POST") {
      const [, , fileIdText, versionIdText, action] = reviewMatch;
      const fileId = Number(fileIdText);
      const target = state.items.find((candidate) => candidate.versionId === Number(versionIdText));
      const siblings = state.items.filter((candidate) => candidate.fileId === fileId);
      if (action === "restore") {
        if (!body?.changeNote?.trim()) return json(route, 400, { code: "VALIDATION_ERROR", fields: { "body.changeNote": ["Escribe el motivo del cambio."] }, message: "Datos inválidos" });
        if (siblings.some((candidate) => candidate.review.status === "pending")) return json(route, 409, { code: "FILE_VERSION_PENDING_REVIEW", message: "Pendiente" });
        const versionNumber = Math.max(...siblings.map((candidate) => candidate.versionNumber)) + 1;
        const created = {
          ...target, changeNote: body.changeNote.trim(), createdAt: "2026-03-30T10:00:00.000Z", isCurrent: false, restoredFromVersionId: target.versionId,
          review: { reason: null, reviewedAt: null, reviewerName: null, status: "pending" }, uploadedBy: { id: 1, name: "Ana Admin" }, versionId: 9000 + versionNumber, versionNumber,
        };
        state.items.push(created);
        return json(route, 201, { version: toFileVersion(created) });
      }
      if (target.review.status !== "pending") return json(route, 409, { code: "FILE_VERSION_NOT_PENDING", message: "No pendiente" });
      if (action === "approve") {
        for (const sibling of siblings) sibling.isCurrent = false;
        target.isCurrent = true;
        target.review = { reason: null, reviewedAt: "2026-03-31T10:00:00.000Z", reviewerName: "Ana Admin", status: "approved" };
      } else {
        if (!body?.reason?.trim()) return json(route, 400, { code: "VALIDATION_ERROR", fields: { "body.reason": ["Escribe el motivo del rechazo."] }, message: "Datos inválidos" });
        target.review = { reason: body.reason.trim(), reviewedAt: "2026-03-31T10:00:00.000Z", reviewerName: "Ana Admin", status: "rejected" };
      }
      const current = siblings.find((candidate) => candidate.isCurrent);
      return json(route, 200, { currentVersionId: current?.versionId ?? null, sharedWithClient: false, version: toFileVersion(target) });
    }
    if (/^\/api\/projects\/\d+\/warranties$/.test(path)) return json(route, 200, { warranties: state.warranties });
    const warrantyMatch = /^\/api\/admin\/files\/projects\/(\d+)\/warranties\/(\d+)\/documents\/(\d+)$/.exec(path);
    if (warrantyMatch) {
      const warranty = state.warranties.find((candidate) => candidate.id === Number(warrantyMatch[2]));
      const fileId = Number(warrantyMatch[3]);
      const linked = warranty.documents.some((document) => document.fileId === fileId);
      if (method === "PUT" && !linked) warranty.documents.push({ fileId });
      if (method === "DELETE") {
        if (!linked) return json(route, 404, { code: "WARRANTY_DOCUMENT_LINK_NOT_FOUND", message: "Sin vínculo" });
        warranty.documents = warranty.documents.filter((document) => document.fileId !== fileId);
      }
      const linkedWarrantyIds = state.warranties.filter((candidate) => candidate.documents.some((document) => document.fileId === fileId)).map((candidate) => candidate.id);
      return json(route, 200, { changed: method === "DELETE" || !linked, fileId, linkedWarrantyIds, warrantyId: warranty.id });
    }
    state.requests.push({ method, path, unexpected: true });
    return json(route, 404, { code: "TEST_ROUTE_MISSING", message: "Ruta no simulada" });
  };
  return state;
}

/**
 * Abre la página con sesión de administrador; vigila errores y peticiones no previstas.
 *
 * @param {import("node:test").TestContext} context - Prueba.
 * @param {Object} backend - Backend simulado.
 * @param {Object} [options] - Tema y viewport.
 * @returns {Promise<import("playwright").Page>} Página.
 */
async function openFiles(context, backend, { theme = "light", viewport = { height: 1100, width: 1440 } } = {}) {
  const browserContext = await browser.newContext({ acceptDownloads: true, timezoneId: "America/Caracas", viewport });
  const page = applyBrowserTimeouts(await browserContext.newPage());
  await page.addInitScript((value) => localStorage.setItem("arca-theme", value), theme);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), backend.handle);
  context.after(async () => {
    await browserContext.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(backend.requests.filter((request) => request.unexpected), []);
  });
  await page.goto(`${origin}/archivos`);
  await page.getByRole("heading", { level: 1, name: "Gestión de archivos" }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  return page;
}

/**
 * Espera a que se cumpla una condición sobre el backend simulado.
 *
 * @param {() => boolean} condition - Condición.
 * @param {number} [timeout=5000] - Milisegundos máximos.
 * @returns {Promise<void>}
 */
async function waitUntil(condition, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("La condición no se cumplió a tiempo");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const itemRequests = (backend) => backend.requests.filter((request) => request.path === "/api/admin/files/items");
const rowNames = (page) => page.locator("[data-admin-files-table] tbody th[scope='row'] > span:first-child").allInnerTexts();

test("métricas, pestañas, orden, búsqueda, tipos y paginación por cursor con datos de la API", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  const metrics = page.getByLabel("Métricas de archivos");
  await metrics.getByText("16").waitFor();
  assert.match(await metrics.innerText(), /2,33 GB/);

  await page.getByRole("rowheader", { name: /Garantía impermeabilización/ }).waitFor();
  assert.equal((await rowNames(page)).length, 10);
  assert.deepEqual(itemRequests(backend).at(-1).search, { limit: "10", order: "desc", sort: "date", tab: "approved" });
  const firstRow = await page.locator("[data-admin-files-table] tbody tr").first().locator("th, td").allInnerTexts();
  assert.deepEqual(firstRow.slice(0, 5), ["Fachada.png", "v1", ".PNG", "2 MB", "21 mar 2026"]);
  assert.equal(firstRow[5], "Arq. Armando");
  assert.equal(await page.getByRole("columnheader", { name: "Proyecto" }).count(), 0, "Aprobados no muestra Proyecto");

  await page.getByRole("button", { name: "Siguiente pág." }).click();
  await page.getByRole("rowheader", { name: /Acta de inicio 01/ }).waitFor();
  assert.equal((await rowNames(page)).length, 5);
  await page.getByRole("button", { name: "Anterior" }).click();
  await page.getByRole("rowheader", { name: /Garantía impermeabilización/ }).waitFor();

  await page.getByRole("button", { name: "Ordenar por Nombre" }).click();
  await page.waitForFunction(() => document.querySelector("[data-admin-files-table] tbody th")?.textContent.startsWith("Acta de inicio 01"));
  assert.equal(await page.getByRole("columnheader", { name: /Nombre/ }).getAttribute("aria-sort"), "ascending");
  assert.equal(itemRequests(backend).at(-1).search.cursor, undefined, "Cambiar el orden vuelve a la primera página");

  await page.getByLabel("Buscar archivos por nombre").fill("garant");
  await page.waitForFunction(() => document.querySelectorAll("[data-admin-files-table] tbody tr").length === 1);
  assert.equal(itemRequests(backend).at(-1).search.search, "garant");
  await page.getByRole("button", { name: "Quitar filtros" }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-admin-files-table] tbody tr").length === 10);

  await page.getByRole("tab", { name: "Pendientes por aprobación" }).click();
  await page.getByRole("rowheader", { name: /Propuesta pendiente/ }).waitFor();
  await page.getByRole("columnheader", { name: "Proyecto" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Proyectos" }).count(), 0, "El árbol solo está en Aprobados");

  await page.getByRole("tab", { name: "Rechazados" }).click();
  await page.getByRole("rowheader", { name: /Contrato rechazado/ }).waitFor();
  await page.getByText("Motivo: Falta la firma del cliente.").waitFor();
  assert.equal(itemRequests(backend).at(-1).search.tab, "rejected");
  assert.equal(await page.getByRole("button", { name: /Eliminar/ }).count(), 0, "Los archivos guardados no se eliminan");
});

test("el árbol acota la tabla, busca carpetas y gestiona carpetas personalizadas", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  const tree = page.getByRole("complementary", { name: "Proyectos" });
  await tree.getByRole("button", { exact: true, name: "Quinta Bella Vista" }).waitFor();
  const create = tree.getByRole("button", { name: /^Nueva carpeta/ });
  assert.equal(await create.isDisabled(), true, "Sin carpeta seleccionada no se crea");

  await tree.getByRole("button", { exact: true, name: "Quinta Bella Vista" }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-admin-files-table] tbody tr").length === 10);
  assert.equal(itemRequests(backend).at(-1).search.projectId, "1");
  assert.match(await create.getAttribute("aria-label"), /pendiente de decisión/, "La raíz depende de D7");

  await tree.getByRole("button", { exact: true, name: "Portada del proyecto" }).click();
  assert.match(await create.getAttribute("aria-label"), /no admite subcarpetas/);
  assert.equal(await tree.getByRole("button", { name: "Opciones de la carpeta Portada del proyecto" }).count(), 0, "Predeterminadas protegidas");

  await tree.getByRole("button", { name: "Mostrar carpetas de Documentos" }).click();
  await tree.getByRole("button", { exact: true, name: "Garantías" }).click();
  await page.getByRole("rowheader", { name: /Garantía impermeabilización/ }).waitFor();
  assert.deepEqual({ folderId: itemRequests(backend).at(-1).search.folderId, includeSubfolders: itemRequests(backend).at(-1).search.includeSubfolders }, { folderId: "104", includeSubfolders: "true" });

  await create.click();
  const dialog = page.getByRole("dialog", { name: "Nueva carpeta" });
  await dialog.getByText("Dentro de: Quinta Bella Vista › Garantías").waitFor();
  await dialog.getByRole("button", { name: "Crear" }).click();
  await dialog.getByText("Escribe el nombre de la carpeta.").waitFor();
  await dialog.getByLabel("Nombre de la carpeta").fill("Certificados");
  await dialog.getByRole("button", { name: "Crear" }).click();
  await dialog.waitFor({ state: "detached" });
  await tree.getByRole("button", { exact: true, name: "Certificados" }).waitFor();
  await page.getByText("Carpeta creada").waitFor();
  assert.deepEqual(backend.requests.find((request) => request.method === "POST").body, { name: "Certificados", parentId: 104 });

  await tree.getByRole("button", { exact: true, name: "Garantías" }).click();
  await create.click();
  await page.getByLabel("Nombre de la carpeta").fill("certificados");
  await page.getByRole("button", { name: "Crear" }).click();
  await page.getByText("Ya existe una carpeta con ese nombre en esta ubicación.").waitFor();
  await page.getByRole("button", { name: "Cancelar" }).click();

  await tree.getByRole("button", { name: "Opciones de la carpeta Certificados" }).click();
  await page.getByRole("menuitem", { name: "Renombrar" }).click();
  await page.getByLabel("Nombre de la carpeta").fill("Certificados de obra");
  await page.getByRole("button", { name: "Guardar" }).click();
  await tree.getByRole("button", { exact: true, name: "Certificados de obra" }).waitFor();

  await tree.getByRole("button", { name: "Opciones de la carpeta Certificados de obra" }).click();
  await page.getByRole("menuitem", { name: "Retirar carpeta" }).click();
  const confirm = page.locator("[data-admin-file-folder-removal]");
  await confirm.getByText("Los archivos guardados y sus versiones nunca se eliminan.").waitFor();
  await confirm.getByRole("button", { name: "Retirar carpeta" }).click();
  await page.getByText("Carpeta retirada").waitFor();
  await tree.getByRole("button", { exact: true, name: "Certificados de obra" }).waitFor({ state: "detached" });

  await tree.getByRole("button", { name: "Opciones de la carpeta Planos de obra" }).waitFor();
  await page.getByLabel("Buscar carpetas y proyectos").fill("garan");
  const results = page.getByRole("region", { name: "Carpetas encontradas" });
  await results.getByText("Apartamento JC › Documentos › Garantías").waitFor();
  await results.getByText("Apartamento JC › Documentos › Garantías").click();
  await waitUntil(() => itemRequests(backend).at(-1).search.folderId === "204");
  assert.equal(itemRequests(backend).at(-1).search.projectId, "2");
  await page.getByText("No hay coincidencias").waitFor();
});

test("las carpetas con contenido no se retiran y el error se comunica", async (context) => {
  const backend = createBackend();
  backend.projects[0].folders.push({ fileCount: 0, id: 151, name: "Sub", parentId: 150, systemKey: null });
  const page = await openFiles(context, backend);
  const tree = page.getByRole("complementary", { name: "Proyectos" });
  await tree.getByRole("button", { name: "Mostrar carpetas de Quinta Bella Vista" }).click();
  await tree.getByRole("button", { name: "Mostrar carpetas de Documentos" }).click();
  await tree.getByRole("button", { name: "Opciones de la carpeta Planos de obra" }).click();
  await page.getByRole("menuitem", { name: "Retirar carpeta" }).click();
  await page.locator("[data-admin-file-folder-removal]").getByRole("button", { name: "Retirar carpeta" }).click();
  await page.getByText(/Solo se pueden retirar carpetas vacías/).waitFor();
  await tree.getByRole("button", { exact: true, name: "Planos de obra" }).waitFor();
});

test("descarga la versión con el nombre del servidor", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar Garantía impermeabilización.pdf, versión 12" }).click();
  assert.equal((await download).suggestedFilename(), "acta-v3110.pdf");
  const request = backend.requests.find((candidate) => candidate.path === "/api/projects/1/files/30/content");
  assert.equal(request.search.versionId, "3110");
});

test("estado de error con reintento y estado vacío por filtros", async (context) => {
  const backend = createBackend({ failures: { "GET /api/admin/files/items": { body: { code: "INTERNAL", message: "Error temporal del servidor." }, status: 500 } } });
  const page = await openFiles(context, backend);
  await page.getByText("No se pudieron cargar los archivos").waitFor();
  await page.getByText("Error temporal del servidor.").waitFor();
  const attempts = itemRequests(backend).length;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await waitUntil(() => itemRequests(backend).length > attempts);
});

test("estado vacío por filtros con «Quitar filtros»", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await page.getByRole("rowheader", { name: /Garantía impermeabilización/ }).waitFor();
  await page.getByLabel("Buscar archivos por nombre").fill("inexistente");
  await page.getByText("No hay coincidencias").waitFor();
  await page.locator("[data-admin-files-layout]").getByRole("button", { name: "Quitar filtros" }).last().click();
  await page.getByRole("rowheader", { name: /Garantía impermeabilización/ }).waitFor();
});

test("con la activación apagada solo muestra las métricas generales", async (context) => {
  const backend = createBackend({ enabled: false });
  const page = await openFiles(context, backend);
  await page.getByText("La gestión de archivos aún no está disponible").waitFor();
  assert.match(await page.getByLabel("Métricas de archivos").innerText(), /500/);
  assert.equal(await page.getByRole("tab").count(), 0);
  assert.equal(backend.requests.filter((request) => request.path === "/api/admin/files/items").length, 0);
});

const viewerDialog = (page) => page.locator("[data-admin-file-viewer]");
const reviewRequests = (backend, action) => backend.requests.filter((request) => request.method === "POST" && request.path.endsWith(`/${action}`));
const metricsReads = (backend) => backend.requests.filter((request) => request.path === "/api/admin/files/metrics").length;

/**
 * Abre la pestaña de pendientes y el visor de «Propuesta pendiente.pdf» desde «Revisar».
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<import("playwright").Locator>} Visor.
 */
async function openPendingReview(page) {
  await page.getByRole("tab", { name: "Pendientes por aprobación" }).click();
  await page.getByRole("button", { name: "Revisar Propuesta pendiente.pdf, versión 2" }).click();
  const viewer = viewerDialog(page);
  await viewer.locator("canvas").first().waitFor();
  return viewer;
}

test("U2 · «Revisar» abre el PDF con historial; aprobar confirma lo que devuelve la API y no comparte", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await page.getByRole("rowheader", { name: /Fachada/ }).waitFor();
  const viewer = await openPendingReview(page);
  await viewer.getByText("V2 · Pendiente de revisión").waitFor();
  const history = viewer.getByRole("list", { name: "Versiones del archivo" });
  assert.deepEqual(await history.locator("li").evaluateAll((rows) => rows.map((row) => row.dataset.versionNumber)), ["2", "1"]);
  assert.equal(backend.requests.find((request) => request.path === "/api/projects/1/files/50/content").search.versionId, "500");

  const metricsBefore = metricsReads(backend);
  await viewer.getByRole("button", { name: "Aprobar" }).click();
  const result = page.locator("[data-admin-file-review-result]");
  await result.getByText("Archivo aprobado correctamente").waitFor();
  await result.getByText(/La V2 de «Propuesta pendiente\.pdf» es ahora la versión vigente\. Aún no se comparte con el cliente/).waitFor();
  assert.equal(reviewRequests(backend, "approve").length, 1);
  assert.equal(await viewerDialog(page).count(), 0, "el visor se cierra tras aprobar");
  await page.getByText("No hay archivos pendientes").waitFor();
  assert.ok(metricsReads(backend) > metricsBefore, "las métricas se vuelven a leer");
  await result.getByRole("button", { name: "Aceptar" }).click();
  // Compartir con el cliente es independiente: aprobar no llamó a las audiencias.
  assert.equal(backend.requests.filter((request) => request.path.includes("/audiences")).length, 0);
});

test("U2 · rechazar exige motivo, lo envía y conserva la versión rechazada", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  const viewer = await openPendingReview(page);
  await viewer.getByRole("button", { name: "Rechazar" }).click();
  const reason = page.locator("[data-admin-file-reason='reject']");
  await reason.getByRole("button", { name: "Enviar" }).click();
  await reason.getByText("Escribe el motivo del rechazo.").waitFor();
  assert.equal(reviewRequests(backend, "reject").length, 0, "sin motivo no se envía");
  await reason.getByRole("textbox", { name: /Motivo del rechazo/ }).fill("  Falta la firma del cliente.  ");
  await reason.getByRole("button", { name: "Enviar" }).click();
  const result = page.locator("[data-admin-file-review-result]");
  await result.getByText("Archivo rechazado correctamente").waitFor();
  await result.getByText(/se conserva con su motivo\. La versión vigente no cambia\./).waitFor();
  assert.deepEqual(reviewRequests(backend, "reject")[0].body, { reason: "Falta la firma del cliente." });
  await result.getByRole("button", { name: "Aceptar" }).click();
  await page.getByRole("tab", { name: "Rechazados" }).click();
  await page.getByRole("rowheader", { name: /Propuesta pendiente\.pdf/ }).getByText("Motivo: Falta la firma del cliente.").waitFor();
});

test("U2 · un 409 de versión ya revisada se informa sin cerrar el visor y recarga tabla e historial", async (context) => {
  const backend = createBackend({ failures: { "POST /api/projects/:id/files/:id/versions/:id/approve": { body: { code: "FILE_VERSION_NOT_PENDING", message: "No pendiente" }, status: 409 } } });
  const page = await openFiles(context, backend);
  const viewer = await openPendingReview(page);
  const versionReads = () => backend.requests.filter((request) => request.path === "/api/projects/1/files/50/versions").length;
  const itemReads = () => backend.requests.filter((request) => request.path === "/api/admin/files/items").length;
  const [versionsBefore, itemsBefore] = [versionReads(), itemReads()];
  await viewer.getByRole("button", { name: "Aprobar" }).click();
  await viewer.getByRole("alert").getByText("Esta versión ya fue revisada. Se actualizó la información.").waitFor();
  await waitUntil(() => versionReads() > versionsBefore && itemReads() > itemsBefore);
  assert.equal(await viewerDialog(page).count(), 1, "el visor sigue abierto con la versión mostrada");
  await viewer.getByText("V2 · Pendiente de revisión").waitFor();
  assert.equal(await page.locator("[data-admin-file-review-result]").getByText("Archivo aprobado correctamente").count(), 0);
});

test("U2 · historial paginado: ver, descargar y restaurar con motivo (la nueva versión queda pendiente)", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await page.getByRole("button", { name: "Ver Garantía impermeabilización.pdf, versión 12" }).click();
  const viewer = viewerDialog(page);
  await viewer.locator("canvas").first().waitFor();
  const history = viewer.getByRole("list", { name: "Versiones del archivo" });
  await history.locator("li[data-version-number='3']").waitFor();
  assert.equal(await history.locator("li").count(), 10);
  await viewer.getByRole("button", { name: "Mostrar más versiones" }).click();
  await history.locator("li[data-version-number='1']").waitFor();
  assert.equal(await history.locator("li").count(), 12);
  assert.equal(await viewer.getByRole("button", { name: "Mostrar más versiones" }).count(), 0);
  await history.locator("li[data-version-number='12']").getByText("Versión actual · V12").waitFor();

  // Ver otra versión carga su contenido sin cerrar el visor.
  await viewer.getByRole("button", { name: "Opciones de la versión 3" }).click();
  await page.getByRole("menuitem", { exact: true, name: "Ver" }).click();
  await viewer.getByText("V3 · Aprobada").waitFor();
  await waitUntil(() => backend.requests.some((request) => request.path === "/api/projects/1/files/30/content" && request.search.versionId === "3020"));

  // Descargar la versión mostrada reutiliza los bytes recibidos; otra versión la pide a la API.
  const download = page.waitForEvent("download");
  await viewer.getByRole("button", { name: "Opciones de la versión 5" }).click();
  await page.getByRole("menuitem", { name: "Descargar" }).click();
  assert.equal((await download).suggestedFilename(), "acta-v3040.pdf");

  // Restaurar la V3 crea la V13 pendiente, conserva el historial y la muestra para revisarla.
  await viewer.getByRole("button", { name: "Opciones de la versión 3" }).click();
  await page.getByRole("menuitem", { name: "Restaurar versión" }).click();
  const reason = page.locator("[data-admin-file-reason='restore']");
  await reason.getByRole("button", { name: "Restaurar" }).click();
  await reason.getByText("Escribe el motivo de la restauración.").waitFor();
  await reason.getByRole("textbox", { name: /Motivo de la restauración/ }).fill("Se vuelve a la versión firmada.");
  await reason.getByRole("button", { name: "Restaurar" }).click();
  await page.getByText(/Se creó la V13 a partir de la V3, que se conserva en el historial\. La nueva versión queda pendiente de revisión\./).waitFor();
  assert.deepEqual(reviewRequests(backend, "restore")[0].body, { changeNote: "Se vuelve a la versión firmada." });
  await history.locator("li[data-version-number='13']").getByText("Pendiente de revisión").waitFor();
  await history.locator("li[data-version-number='13']").getByText("Motivo: Se vuelve a la versión firmada.").waitFor();
  await viewer.getByText("V13 · Pendiente de revisión").waitFor();
  await viewer.getByRole("button", { name: "Aprobar" }).waitFor();
  assert.equal(await history.locator("li").count(), 13, "el historial conserva todas las versiones");

  // Con una pendiente, restaurar otra queda deshabilitado con su motivo.
  await viewer.getByRole("button", { name: "Opciones de la versión 2" }).click();
  assert.equal(await page.getByRole("menuitem", { name: /Restaurar versión \(El archivo ya tiene una versión pendiente/ }).isDisabled(), true);
  await page.keyboard.press("Escape");
});

test("U2 · garantías: vincular y desvincular un documento de «Documentos › Garantías» con la respuesta del backend", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await page.getByRole("button", { name: "Más opciones para Fachada.png, versión 1" }).click();
  assert.equal(await page.getByRole("menuitem", { name: "Garantías" }).count(), 0, "fuera de Garantías no se ofrece");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Más opciones para Garantía impermeabilización.pdf, versión 12" }).click();
  await page.getByRole("menuitem", { name: "Garantías" }).click();
  const dialog = page.locator("[data-admin-file-warranties]");
  const ventanas = dialog.getByRole("checkbox", { name: /Ventanas/ });
  await ventanas.waitFor();
  assert.equal(await ventanas.getAttribute("aria-checked"), "true", "vínculo leído del backend");
  await dialog.getByRole("checkbox", { name: "Vincular a Impermeabilización · Techo" }).click();
  await dialog.getByText("Documento vinculado a Impermeabilización · Techo.").waitFor();
  assert.ok(backend.requests.some((request) => request.method === "PUT" && request.path === "/api/admin/files/projects/1/warranties/5/documents/30"));
  await dialog.getByRole("checkbox", { name: "Desvincular de Ventanas · Aluminio" }).click();
  await dialog.getByText(/Documento desvinculado de Ventanas · Aluminio\. El vínculo se conserva en el historial\./).waitFor();
  assert.ok(backend.requests.some((request) => request.method === "DELETE" && request.path === "/api/admin/files/projects/1/warranties/6/documents/30"));
  assert.deepEqual(backend.warranties.map((warranty) => warranty.documents.map((document) => document.fileId)), [[30], []]);
  await dialog.getByRole("button", { name: "Listo" }).click();
});

test("U2 · las imágenes se abren en el visor con la versión indicada", async (context) => {
  const backend = createBackend();
  const page = await openFiles(context, backend);
  await page.getByRole("button", { name: "Ver Fachada.png, versión 1" }).click();
  const image = viewerDialog(page).getByRole("img", { name: "Fachada.png" });
  await image.waitFor();
  assert.match(await image.getAttribute("src"), /\/api\/projects\/2\/files\/40\/content\?versionId=400$/);
  await viewerDialog(page).getByRole("button", { name: "Cerrar", exact: true }).click();
  await viewerDialog(page).waitFor({ state: "detached" });
});

for (const theme of ["light", "dark"]) {
  for (const width of [375, 1440]) {
    test(`U2 · visor responsive sin desbordar (${theme}, ${width} px)`, async (context) => {
      const backend = createBackend();
      const page = await openFiles(context, backend, { theme, viewport: { height: 1000, width } });
      const viewer = await openPendingReview(page);
      await viewer.getByRole("list", { name: "Versiones del archivo" }).locator("li").first().waitFor();
      await page.waitForTimeout(400);
      const layout = await page.evaluate(() => {
        const dialog = document.querySelector("[data-admin-file-viewer]").getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - window.innerWidth, right: dialog.right, width: window.innerWidth };
      });
      assert.ok(layout.overflow <= 0, `La página no desborda (${layout.overflow} px)`);
      assert.ok(layout.right <= layout.width, "El visor cabe en el viewport");
      if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/viewer-${theme}-${width}.png` });
      await viewer.getByRole("button", { name: "Rechazar" }).click();
      await page.locator("[data-admin-file-reason='reject']").waitFor();
      if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/reject-${theme}-${width}.png` });
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [375, 768, 1024, 1440]) {
    test(`diseño responsive sin desbordar la página (${theme}, ${width} px)`, async (context) => {
      const backend = createBackend();
      const page = await openFiles(context, backend, { theme, viewport: { height: 1100, width } });
      await page.getByRole("rowheader", { name: /Garantía impermeabilización/ }).waitFor();
      await page.getByRole("complementary", { name: "Proyectos" }).getByRole("button", { name: "Mostrar carpetas de Quinta Bella Vista" }).click();
      await page.getByRole("complementary", { name: "Proyectos" }).getByRole("button", { name: "Mostrar carpetas de Documentos" }).click();
      await page.waitForTimeout(400);
      const layout = await page.evaluate(() => {
        const grid = document.querySelector("[data-admin-files-layout]");
        const [tree, table] = grid.children;
        return {
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          sideBySide: Math.abs(tree.getBoundingClientRect().top - table.getBoundingClientRect().top) < 2,
          theme: document.documentElement.dataset.theme || document.documentElement.className,
        };
      });
      assert.ok(layout.overflow <= 0, `La página no desborda (${layout.overflow} px)`);
      assert.equal(layout.sideBySide, width >= 1024, "Dos columnas solo con espacio suficiente");
      if (SCREENSHOT_DIR) await page.screenshot({ fullPage: true, path: `${SCREENSHOT_DIR}/files-${theme}-${width}.png` });
    });
  }
}
