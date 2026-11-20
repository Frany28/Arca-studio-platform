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
function item(id, { day, folder, name, project, reason = null, size, status = "approved", extension = "pdf" }) {
  return {
    contentType: extension === "pdf" ? "application/pdf" : "image/png",
    createdAt: `2026-03-${String(day).padStart(2, "0")}T14:00:00.000Z`,
    extension,
    fileId: id,
    folder,
    isCurrent: true,
    name,
    project: { id: project.id, name: project.name, status: "in_progress" },
    restoredFromVersionId: null,
    review: { reason, reviewedAt: status === "pending" ? null : "2026-03-25T10:00:00.000Z", reviewerName: status === "pending" ? null : "Ana Admin", status },
    size,
    uploadedBy: { id: 2, name: "Arq. Armando" },
    versionId: id * 10,
    versionNumber: 1,
  };
}

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
  const documents = { id: 103, name: "Documentos" };
  const warranties = { id: 104, name: "Garantías" };
  const items = [
    ...Array.from({ length: 12 }, (_, index) => item(index + 1, { day: index + 1, folder: documents, name: `Acta de inicio ${String(index + 1).padStart(2, "0")}.pdf`, project: quinta, size: (index + 1) * 1024 * 1024 })),
    item(30, { day: 20, folder: warranties, name: "Garantía impermeabilización.pdf", project: quinta, size: 512 * 1024 }),
    item(40, { day: 21, extension: "png", folder: { id: 201, name: "Renders e imágenes" }, name: "Fachada.png", project: apto, size: 2048 * 1024 }),
    item(50, { day: 22, folder: documents, name: "Propuesta pendiente.pdf", project: quinta, size: 4096, status: "pending" }),
    item(60, { day: 23, folder: documents, name: "Contrato rechazado.pdf", project: quinta, reason: "Falta la firma del cliente.", size: 8192, status: "rejected" }),
  ];
  const state = { items, projects: [quinta, apto], requests: [] };
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
      let rows = state.items.filter((candidate) => candidate.review.status === tab);
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
      return route.fulfill({ body: "%PDF-1.4 prueba", contentType: "application/pdf", headers: { "Content-Disposition": `attachment; filename="acta-v${params.versionId}.pdf"` }, status: 200 });
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
  assert.equal((await rowNames(page)).length, 4);
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
  await page.getByRole("button", { name: "Descargar Garantía impermeabilización.pdf, versión 1" }).click();
  assert.equal((await download).suggestedFilename(), "acta-v300.pdf");
  const request = backend.requests.find((candidate) => candidate.path === "/api/projects/1/files/30/content");
  assert.equal(request.search.versionId, "300");
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
