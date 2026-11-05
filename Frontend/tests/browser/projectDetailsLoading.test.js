import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Carga del detalle con la aplicación real: una sola lectura del proyecto al redirigir la ruta
// numérica a su slug y paneles no iniciales descargados al abrir su pestaña.
const PROJECT = {
  id: 41, name: "Proyecto de carga", publicSlug: "proyecto-de-carga", status: "in_process", progress: 40,
  client: { id: 7, name: "Cliente del proyecto" }, assignees: [], files: [], filesNextCursor: null,
};
const RENDERS_MODULE = "/src/pages/projects/panels/ProjectRendersPanel.jsx";
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
 * Abre el detalle por id numérico con la API simulada y registra lecturas y módulos pedidos.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {string} [search] - Query de la ruta numérica.
 * @returns {Promise<{page: import("playwright").Page, projectReads: string[], modules: string[]}>} Página y registros.
 */
async function openNumericDetail(context, search = "") {
  const session = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.after(() => session.close());
  const page = await session.newPage();
  applyBrowserTimeouts(page);
  const projectReads = [];
  const modules = [];
  page.on("request", (request) => modules.push(new URL(request.url()).pathname));
  await page.route((url) => url.pathname.startsWith("/api/"), (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/auth/me") {
      return route.fulfill({ json: { user: { id: 1, firstName: "Admin", lastName: "Prueba", email: "admin@example.test", role: "admin", status: "active" } } });
    }
    if (pathname.endsWith("/events")) return route.fulfill({ status: 204, body: "" });
    if (pathname.endsWith("/comments")) return route.fulfill({ json: { comments: [], nextCursor: null } });
    if (pathname === "/api/projects") return route.fulfill({ json: { projects: [PROJECT], nextCursor: null } });
    if (pathname === `/api/projects/${PROJECT.id}` || pathname === `/api/projects/${PROJECT.publicSlug}`) {
      projectReads.push(pathname);
      return route.fulfill({ json: { project: PROJECT } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`${origin}/proyectos/${PROJECT.id}${search}`, { timeout: NAVIGATION_TIMEOUT_MS });
  await page.getByRole("heading", { level: 1, name: PROJECT.name }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  return { modules, page, projectReads };
}

test("la ruta numérica se reemplaza por el slug con una sola lectura del proyecto", async (context) => {
  const { page, projectReads } = await openNumericDetail(context, "?origen=notificacion");

  await page.waitForURL(`${origin}/proyectos/${PROJECT.publicSlug}?origen=notificacion`);
  await page.waitForTimeout(800);
  // El servidor de desarrollo usa StrictMode, que repite el efecto de montaje con el id numérico;
  // la redirección al slug no debe añadir ninguna lectura.
  assert.ok(projectReads.length > 0);
  assert.deepEqual(projectReads.filter((path) => path !== `/api/projects/${PROJECT.id}`), [], "sin volver a pedir el proyecto por slug");
  assert.equal(await page.getByText("Cargando proyecto").count(), 0, "sin volver a mostrar el Loader del proyecto");
});

test("Renders se descarga al abrir su pestaña y muestra su skeleton mientras llega", async (context) => {
  const { modules, page } = await openNumericDetail(context);
  assert.equal(modules.includes(RENDERS_MODULE), false, "Información no descarga el panel de Renders");

  await page.getByRole("tab", { name: "Renders e Imágenes" }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('[role="status"]')].some((node) => node.textContent.includes("Cargando sección del proyecto")));
  assert.equal(modules.includes(RENDERS_MODULE), true);
  assert.equal(await page.getByRole("tab", { name: "Renders e Imágenes" }).getAttribute("aria-selected"), "true");
});

test("un enlace directo a Documentos abre la pestaña diferida", async (context) => {
  const { page } = await openNumericDetail(context, "?tab=documents");

  await page.waitForFunction(() => ![...document.querySelectorAll('[role="status"]')].some((node) => node.textContent.includes("Cargando sección del proyecto")));
  assert.equal(await page.getByRole("tab", { name: "Documentos" }).getAttribute("aria-selected"), "true");
});
