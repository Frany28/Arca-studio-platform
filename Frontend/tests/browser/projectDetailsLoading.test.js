import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Carga del detalle con la aplicación real: lecturas del proyecto según cambie la ruta o solo la
// query, resolución de enlaces profundos y paneles diferidos con precarga por intención.
const PROJECT = {
  id: 41, name: "Proyecto de carga", publicSlug: "proyecto-de-carga", status: "in_process", progress: 40,
  client: { id: 7, name: "Cliente del proyecto" }, assignees: [], files: [], filesNextCursor: null,
};
const OTHER_PROJECT = { ...PROJECT, id: 42, name: "Otro proyecto", publicSlug: "otro-proyecto" };
// Las recargas en segundo plano usan el id resuelto; la carga por ruta usa el slug.
const PROJECT_BY_ID = `/api/projects/${PROJECT.id}`;
const LATE_FILE = {
  id: 99, title: "Plano tardío", extension: "pdf", fileType: "pdf", mimeType: "application/pdf", size: 2048, available: true,
  createdAt: "2026-11-01T10:00:00.000Z", currentVersionId: 5,
};
const RENDERS_MODULE = "/src/pages/projects/panels/ProjectRendersPanel.jsx";
const DOCUMENTS_MODULE = "/src/pages/projects/panels/ProjectDocumentsPanel.jsx";
const SECTION_LOADER = "Cargando sección del proyecto";
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({ root: fileURLToPath(new URL("../../", import.meta.url)), cacheDir: getBrowserTestCacheDir(import.meta.url), configFile: false, envDir: false,
    plugins: [react(), tailwindcss()], define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
    server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
});
after(async () => { await browser?.close(); await server?.close(); });

/**
 * Abre el detalle con la API simulada y registra lecturas del proyecto y módulos pedidos.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {Object} [options] - Ruta inicial y respuesta de cada lectura.
 * @param {string} [options.path] - Ruta del detalle con su query.
 * @param {(pathname: string, readNumber: number) => Promise<Object>|Object} [options.readProject] - Proyecto por lectura.
 * @param {string} [options.initScript] - Script previo a la aplicación (p. ej. emular la red).
 * @param {boolean} [options.waitForProject=true] - Espera el título del proyecto antes de devolver.
 * @returns {Promise<{documentLoads: () => number, page: import("playwright").Page, projectReads: string[], modules: string[]}>} Página y registros.
 */
async function openDetail(context, {
  initScript,
  path = `/proyectos/${PROJECT.id}`,
  readProject = (pathname) => (pathname.endsWith(OTHER_PROJECT.publicSlug) ? OTHER_PROJECT : PROJECT),
  waitForProject = true,
} = {}) {
  const session = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.after(() => session.close());
  const page = await session.newPage();
  applyBrowserTimeouts(page);
  if (initScript) await page.addInitScript(initScript);
  const projectReads = [];
  const modules = [];
  let loads = 0;
  page.on("load", () => { loads += 1; });
  page.on("request", (request) => modules.push(new URL(request.url()).pathname));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/auth/me") {
      return route.fulfill({ json: { user: { id: 1, firstName: "Admin", lastName: "Prueba", email: "admin@example.test", role: "admin", status: "active" } } });
    }
    if (pathname.endsWith("/events")) return route.fulfill({ status: 204, body: "" });
    if (pathname.endsWith("/comments")) return route.fulfill({ json: { comments: [], nextCursor: null } });
    if (pathname === "/api/projects") return route.fulfill({ json: { projects: [PROJECT, OTHER_PROJECT], nextCursor: null } });
    if (/^\/api\/projects\/[^/]+$/.test(pathname)) {
      projectReads.push(pathname);
      const project = await readProject(pathname, projectReads.length);
      if (project instanceof Error) return route.fulfill({ status: 503, json: { code: "UNAVAILABLE", message: project.message } });
      return route.fulfill({ json: { project } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`${origin}${path}`, { timeout: NAVIGATION_TIMEOUT_MS });
  if (waitForProject) await page.getByRole("heading", { level: 1, name: PROJECT.name }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  return { documentLoads: () => loads, modules, page, projectReads };
}

/** Navega dentro del router sin recargar el documento, como un enlace interno. */
function navigateInApp(page, path) {
  return page.evaluate((nextPath) => {
    window.history.pushState({}, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

function waitForSectionLoaderToFinish(page) {
  return page.waitForFunction((label) => ![...document.querySelectorAll('[role="status"]')].some((node) => node.textContent.includes(label)), SECTION_LOADER);
}

/** Espera a que la pestaña quede seleccionada y su panel sin skeleton (la selección llega tras un render). */
async function waitForOpenTab(page, name) {
  await page.waitForFunction((tabName) => [...document.querySelectorAll('[role="tab"]')]
    .some((tab) => tab.textContent.trim() === tabName && tab.getAttribute("aria-selected") === "true"), name);
  await waitForSectionLoaderToFinish(page);
}

test("la ruta numérica se reemplaza por el slug con una sola lectura del proyecto", async (context) => {
  const { page, projectReads } = await openDetail(context, { path: `/proyectos/${PROJECT.id}?origen=notificacion` });

  await page.waitForURL(`${origin}/proyectos/${PROJECT.publicSlug}?origen=notificacion`);
  await page.waitForTimeout(800);
  // El servidor de desarrollo usa StrictMode, que repite el efecto de montaje con el id numérico;
  // la redirección al slug no debe añadir ninguna lectura.
  assert.ok(projectReads.length > 0);
  assert.deepEqual(projectReads.filter((path) => path !== `/api/projects/${PROJECT.id}`), [], "sin volver a pedir el proyecto por slug");
  assert.equal(await page.getByText("Cargando proyecto").count(), 0, "sin volver a mostrar el Loader del proyecto");
});

test("cambiar solo la query conserva el proyecto sin otra lectura ni Loader", async (context) => {
  const { page, projectReads } = await openDetail(context, { path: `/proyectos/${PROJECT.publicSlug}` });
  await page.waitForTimeout(500);
  const readsAfterLoad = projectReads.length;

  await navigateInApp(page, `/proyectos/${PROJECT.publicSlug}?tab=documents&commentId=12`);
  await waitForOpenTab(page, "Documentos");
  await navigateInApp(page, `/proyectos/${PROJECT.publicSlug}?tab=documents`);
  await page.waitForTimeout(800);

  assert.equal(projectReads.length, readsAfterLoad, "la query no vuelve a pedir el proyecto");
  assert.equal(await page.getByText("Cargando proyecto").count(), 0);
  assert.equal(await page.getByRole("heading", { level: 1, name: PROJECT.name }).count(), 1);
});

test("cambiar de proyecto en la ruta sí carga el nuevo proyecto", async (context) => {
  const { page, projectReads } = await openDetail(context, { path: `/proyectos/${PROJECT.publicSlug}` });

  await navigateInApp(page, `/proyectos/${OTHER_PROJECT.publicSlug}`);
  await page.getByRole("heading", { level: 1, name: OTHER_PROJECT.name }).waitFor();
  assert.equal(projectReads.at(-1), `/api/projects/${OTHER_PROJECT.publicSlug}`);
});

test("un enlace profundo a un archivo aún no cargado recarga los archivos una sola vez", async (context) => {
  const { page, projectReads } = await openDetail(context, {
    path: `/proyectos/${PROJECT.publicSlug}?tab=documents&fileId=${LATE_FILE.id}`,
    // La carga por slug es anterior a la subida del archivo; la recarga (por id) ya lo incluye.
    readProject: (pathname) => (pathname === PROJECT_BY_ID ? { ...PROJECT, files: [LATE_FILE] } : PROJECT),
  });

  await page.getByText("Plano tardío", { exact: false }).first().waitFor();
  await page.waitForTimeout(800);
  // StrictMode (desarrollo) puede repetir la carga por slug; la recarga por id ocurre una sola vez.
  assert.equal(projectReads.filter((path) => path === PROJECT_BY_ID).length, 1, "una sola recarga por id");
});

test("un archivo que sigue ausente no provoca recargas repetidas", async (context) => {
  const { page, projectReads } = await openDetail(context, { path: `/proyectos/${PROJECT.publicSlug}?tab=documents&fileId=${LATE_FILE.id}` });

  const refreshes = () => projectReads.filter((path) => path === PROJECT_BY_ID).length;
  await page.waitForTimeout(1500);
  assert.equal(refreshes(), 1, "una única recarga");
  await navigateInApp(page, `/proyectos/${PROJECT.publicSlug}?tab=documents&fileId=${LATE_FILE.id}&commentId=3`);
  await page.waitForTimeout(800);
  assert.equal(refreshes(), 1);
});

test("una recarga que responde tarde no reemplaza el proyecto abierto después", async (context) => {
  let releaseStaleRefresh;
  const staleRefresh = new Promise((resolve) => { releaseStaleRefresh = resolve; });
  const { page } = await openDetail(context, {
    path: `/proyectos/${PROJECT.publicSlug}?tab=documents&fileId=${LATE_FILE.id}`,
    readProject: async (pathname) => {
      if (pathname.endsWith(OTHER_PROJECT.publicSlug)) return OTHER_PROJECT;
      if (pathname !== PROJECT_BY_ID) return PROJECT;
      await staleRefresh;
      return { ...PROJECT, files: [LATE_FILE] };
    },
  });

  await navigateInApp(page, `/proyectos/${OTHER_PROJECT.publicSlug}`);
  await page.getByRole("heading", { level: 1, name: OTHER_PROJECT.name }).waitFor();
  releaseStaleRefresh();
  await page.waitForTimeout(800);
  assert.equal(await page.getByRole("heading", { level: 1, name: OTHER_PROJECT.name }).count(), 1, "se conserva el proyecto nuevo");
});

test("Renders se descarga al abrir su pestaña y muestra su skeleton mientras llega", async (context) => {
  const { modules, page } = await openDetail(context);
  assert.equal(modules.includes(RENDERS_MODULE), false, "Información no descarga el panel de Renders");

  await page.getByRole("tab", { name: "Renders e Imágenes" }).click();
  await waitForSectionLoaderToFinish(page);
  assert.equal(modules.includes(RENDERS_MODULE), true);
  assert.equal(await page.getByRole("tab", { name: "Renders e Imágenes" }).getAttribute("aria-selected"), "true");
});

test("un enlace directo a Documentos abre la pestaña diferida", async (context) => {
  const { page } = await openDetail(context, { path: `/proyectos/${PROJECT.id}?tab=documents` });

  await waitForOpenTab(page, "Documentos");
});

test("el puntero sostenido sobre una pestaña precarga solo su panel", async (context) => {
  const { modules, page } = await openDetail(context);

  await page.getByRole("tab", { name: "Documentos" }).hover();
  await page.waitForTimeout(400);
  assert.equal(modules.includes(DOCUMENTS_MODULE), true, "Documentos se precarga");
  assert.equal(modules.includes(RENDERS_MODULE), false, "no se precargan otros paneles");
});

test("cruzar Renders sin detenerse no descarga three.js; detenerse sí", async (context) => {
  const { modules, page } = await openDetail(context);
  const rendersTab = page.getByRole("tab", { name: "Renders e Imágenes" });

  await rendersTab.hover();
  await page.waitForTimeout(100);
  await page.getByRole("heading", { level: 1 }).hover();
  await page.waitForTimeout(500);
  assert.equal(modules.includes(RENDERS_MODULE), false, "un cruce breve no precarga");

  await rendersTab.hover();
  await page.waitForTimeout(600);
  assert.equal(modules.includes(RENDERS_MODULE), true, "una intención sostenida precarga");
});

test("con ahorro de datos no se precarga ningún panel, pero la pestaña abre igual", async (context) => {
  const { modules, page } = await openDetail(context, {
    initScript: () => Object.defineProperty(navigator, "connection", { configurable: true, value: { effectiveType: "4g", saveData: true } }),
  });

  await page.getByRole("tab", { name: "Documentos" }).hover();
  await page.waitForTimeout(400);
  assert.equal(modules.includes(DOCUMENTS_MODULE), false);
  await page.getByRole("tab", { name: "Documentos" }).click();
  await waitForOpenTab(page, "Documentos");
});

test("una pestaña precargada abre sin mostrar su skeleton", async (context) => {
  const { modules, page } = await openDetail(context);

  await page.getByRole("tab", { name: "Documentos" }).hover();
  await page.waitForFunction((module) => performance.getEntriesByType("resource").some((entry) => new URL(entry.name).pathname === module), DOCUMENTS_MODULE);
  await page.waitForTimeout(300);
  assert.equal(modules.includes(DOCUMENTS_MODULE), true);
  await page.evaluate((label) => {
    window.__skeletonSeen = false;
    new MutationObserver(() => {
      if ([...document.querySelectorAll('[role="status"]')].some((node) => node.textContent.includes(label))) window.__skeletonSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  }, SECTION_LOADER);
  await page.getByRole("tab", { name: "Documentos" }).click();
  await page.waitForTimeout(600);
  assert.equal(await page.getByRole("tab", { name: "Documentos" }).getAttribute("aria-selected"), "true");
  assert.equal(await page.evaluate(() => window.__skeletonSeen), false, "sin skeleton tras la precarga");
});

test("si falla la carga del proyecto, «Reintentar» vuelve a pedirlo y lo muestra", async (context) => {
  let available = false;
  const { page, projectReads } = await openDetail(context, {
    readProject: () => (available ? PROJECT : new Error("No se pudo cargar el proyecto.")),
    waitForProject: false,
  });

  await page.getByText("No se pudo cargar el proyecto.").waitFor();
  const failedReads = projectReads.length;
  available = true;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await page.getByRole("heading", { level: 1, name: PROJECT.name }).waitFor();
  assert.ok(projectReads.length > failedReads, "el reintento vuelve a pedir el proyecto");
  assert.equal(await page.getByText("No se pudo cargar el proyecto.").count(), 0);
});

test("una precarga fallida no recarga la página y la apertura conserva la recuperación de chunks", async (context) => {
  const { documentLoads, modules, page } = await openDetail(context, { path: `/proyectos/${PROJECT.publicSlug}` });
  // Como tras una nueva publicación: el chunk del panel ya no existe en el servidor.
  const missing = (url) => url.pathname === DOCUMENTS_MODULE;
  await page.route(missing, (route) => route.fulfill({ status: 404, body: "Not Found" }));

  await page.getByRole("tab", { name: "Documentos" }).hover();
  await page.waitForTimeout(600);
  assert.equal(modules.includes(DOCUMENTS_MODULE), true, "se intentó la precarga");
  assert.equal(documentLoads(), 1, "la precarga fallida no recarga la página");

  await page.getByRole("tab", { name: "Documentos" }).click();
  await page.getByRole("heading", { level: 1, name: PROJECT.name }).waitFor();
  assert.equal(documentLoads(), 2, "al abrirla, la carga real recarga una sola vez para obtener la versión vigente");
  assert.equal(await page.getByText("Unexpected Application Error").count(), 0);

  // Con el chunk disponible, la pestaña abre normalmente.
  await page.unroute(missing);
  await page.getByRole("tab", { name: "Documentos" }).click();
  await waitForOpenTab(page, "Documentos");
});

test("subir un archivo actualiza los archivos del proyecto con una recarga en segundo plano", async (context) => {
  const { page, projectReads } = await openDetail(context, {
    path: `/proyectos/${PROJECT.publicSlug}`,
    readProject: (pathname) => (pathname === PROJECT_BY_ID ? { ...PROJECT, files: [LATE_FILE] } : PROJECT),
  });
  let uploads = 0;
  await page.route((url) => url.pathname === `/api/projects/${PROJECT.id}/files`, (route) => {
    uploads += 1;
    return route.fulfill({ status: 201, json: { file: { id: LATE_FILE.id } } });
  });

  await page.getByRole("tab", { name: "Subir archivos" }).click();
  await waitForOpenTab(page, "Subir archivos");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "Plano tardío.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 prueba") });
  await page.waitForTimeout(1500);
  assert.equal(uploads, 1, "una sola subida por archivo seleccionado");
  assert.equal(projectReads.filter((path) => path === PROJECT_BY_ID).length, 1, "una recarga tras la subida");
  assert.equal(await page.getByText("Cargando proyecto").count(), 0, "sin volver al Loader del proyecto");

  await page.getByRole("tab", { name: "Documentos" }).click();
  await waitForOpenTab(page, "Documentos");
  await page.getByText("Plano tardío", { exact: false }).first().waitFor();
});
