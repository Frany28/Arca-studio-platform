import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const SIDEBAR_SELECTOR = 'aside[aria-label="Navegación lateral"]';
const TOGGLE_NAME = /^(Contraer|Expandir) navegación lateral$/;
const EMPTY_COLLECTION = { nextCursor: null };
const API_FIXTURES = {
  "/api/projects": { ...EMPTY_COLLECTION, projects: [] },
  "/api/project-requests": { ...EMPTY_COLLECTION, projectRequests: [] },
  "/api/project-requests/review-queue": { ...EMPTY_COLLECTION, projectRequests: [] },
  "/api/environment-comments": { ...EMPTY_COLLECTION, comments: [] },
  "/api/admin/roles": { roles: [] },
  "/api/admin/assignees": { assignees: [] },
  "/api/admin/users": {
    ...EMPTY_COLLECTION,
    users: [],
    metrics: { total: 0, active: 0, suspended: 0, disabled: 0 },
  },
  "/api/admin/dashboard-metrics": { metrics: {} },
  "/api/admin/dashboard-overview": {
    overview: { recentActivity: [], projectRequests: [] },
  },
};
const PAGE_CASES = [
  { path: "/dashboard-clientes", role: "client", destination: "/proyectos", item: "Ver más proyectos", tabletWidth: 234 },
  { path: "/proyectos", role: "client", destination: "/dashboard-clientes", item: "Dashboard", tabletWidth: 234 },
  { path: "/dashboard-arquitecto", role: "architect", destination: "/proyectos", item: "Ver más proyectos" },
  { path: "/dashboard-arquitecto", role: "admin", destination: "/archivos", item: "Archivos" },
  { path: "/usuarios", role: "admin", destination: "/archivos", item: "Archivos" },
  { path: "/archivos", role: "admin", destination: "/usuarios", item: "Usuarios" },
];

let browser;
let server;
let origin;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)),
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
 * Abre un contexto aislado sobre la aplicación real con respuestas HTTP de prueba.
 * Intercepta todas las llamadas de API para no usar sesiones ni datos de infraestructura.
 *
 * @param {import("node:test").TestContext} context Prueba propietaria del navegador y sus comprobaciones.
 * @param {string} role Rol de la sesión simulada.
 * @param {Object} [options] Opciones de viewport, tema o interacción táctil.
 * @returns {Promise<import("playwright").Page>} Página con sesión y errores vigilados.
 */
async function openPage(context, role, options = {}) {
  const browserContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  const page = await browserContext.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const payload = path === "/api/auth/me"
      ? { user: { id: 1, firstName: "Sidebar", lastName: "Test", email: "sidebar@example.test", role, status: "active" } }
      : API_FIXTURES[path];
    if (!payload || request.method() !== "GET") {
      errors.push(`Petición de API no prevista: ${request.method()} ${path}`);
      await route.fulfill({ status: 404, json: { code: "TEST_ROUTE_MISSING", message: "Fixture no definida" } });
      return;
    }
    await route.fulfill({ json: payload });
  });
  context.after(async () => {
    await browserContext.close();
    assert.deepEqual(errors, [], "La navegación no debe producir errores ni peticiones de API imprevistas");
  });
  return page;
}

/**
 * Espera el resultado accesible y el ancho renderizado al finalizar la transición real.
 * Evita esperas fijas y detecta estilos responsive que contradigan el estado de React.
 *
 * @param {import("playwright").Page} page Página en prueba.
 * @param {boolean} expanded Expansión esperada.
 * @param {number} width Ancho final esperado en píxeles.
 * @returns {Promise<void>} Finaliza cuando estado y geometría coinciden.
 */
async function expectSidebar(page, expanded, width) {
  await page.waitForFunction(({ selector, expanded, width }) => {
    const sidebar = [...document.querySelectorAll(selector)].find((element) => element.getClientRects().length);
    const toggle = sidebar?.querySelector("button[aria-expanded]");
    return toggle?.getAttribute("aria-expanded") === String(expanded)
      && Math.abs(sidebar.getBoundingClientRect().width - width) < 0.5;
  }, { selector: SIDEBAR_SELECTOR, expanded, width });
  const name = expanded ? "Contraer navegación lateral" : "Expandir navegación lateral";
  assert.equal(await page.locator(`${SIDEBAR_SELECTOR}:visible`).first().getByRole("button", { name, exact: true }).count(), 1);
}

for (const pageCase of PAGE_CASES) {
  test(`${pageCase.role} ${pageCase.path}: clic, ancho responsive y navegación en ambos estados`, async (context) => {
    const page = await openPage(context, pageCase.role);
    for (const width of [768, 900, 1023, 1024, 1279, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${origin}${pageCase.path}`);
      const sidebar = page.locator(`${SIDEBAR_SELECTOR}:visible`).first();
      const toggle = sidebar.getByRole("button", { name: TOGGLE_NAME });
      await toggle.waitFor();
      if (await toggle.getAttribute("aria-expanded") === "false") {
        await toggle.click();
      }
      const expandedWidth = pageCase.tabletWidth && width < 1023 ? pageCase.tabletWidth : 312;
      await expectSidebar(page, true, expandedWidth);
      await toggle.click();
      await expectSidebar(page, false, 76);
      await toggle.click();
      await expectSidebar(page, true, expandedWidth);
    }

    for (const expanded of [true, false]) {
      if (!expanded) {
        await page.locator(`${SIDEBAR_SELECTOR}:visible`).getByRole("button", { name: TOGGLE_NAME }).click();
        await expectSidebar(page, false, 76);
      }
      await page.locator(`${SIDEBAR_SELECTOR}:visible`).getByRole("button", { name: pageCase.item, exact: true }).click();
      await page.waitForURL(`${origin}${pageCase.destination}`);
      await page.goto(`${origin}${pageCase.path}`);
      await expectSidebar(page, true, 312);
    }
  });
}

for (const path of ["/dashboard-arquitecto", "/usuarios", "/archivos"]) {
  test(`${path}: cruzar 1280 px conserva la política responsive y permite cambios manuales`, async (context) => {
    const page = await openPage(context, "admin");
    await page.goto(`${origin}${path}`);
    await expectSidebar(page, true, 312);
    const toggle = page.locator(`${SIDEBAR_SELECTOR}:visible`).getByRole("button", { name: TOGGLE_NAME });
    await toggle.click();
    await expectSidebar(page, false, 76);
    await page.setViewportSize({ width: 1279, height: 1000 });
    await expectSidebar(page, false, 76);
    await toggle.click();
    await expectSidebar(page, true, 312);
    await page.setViewportSize({ width: 900, height: 1000 });
    await expectSidebar(page, true, 312);
    await toggle.click();
    await expectSidebar(page, false, 76);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await expectSidebar(page, path !== "/archivos", path === "/archivos" ? 76 : 312);
    if (path === "/archivos") await toggle.click();
    await expectSidebar(page, true, 312);
    await page.setViewportSize({ width: 1279, height: 1000 });
    await expectSidebar(page, path === "/archivos", path === "/archivos" ? 312 : 76);
    await toggle.click();
    await expectSidebar(page, path !== "/archivos", path === "/archivos" ? 76 : 312);
  });
}

for (const desktopExpanded of [true, false]) {
  test(`Solicitud móvil: cerrar y reabrir restaura foco y conserva escritorio ${desktopExpanded}`, async (context) => {
    const page = await openPage(context, "client", { hasTouch: true });
    await page.goto(`${origin}/solicitudes/nueva`);
    await expectSidebar(page, true, 312);
    if (!desktopExpanded) {
      await page.getByRole("button", { name: "Contraer navegación lateral", exact: true }).click();
      await expectSidebar(page, false, 76);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
    const drawer = page.getByRole("dialog", { name: "Panel lateral", exact: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await menu.focus();
      await menu.press("Enter");
      await drawer.waitFor({ state: "visible" });
      const toggle = drawer.getByRole("button", { name: "Contraer navegación lateral", exact: true });
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      await toggle.tap();
      await drawer.waitFor({ state: "detached" });
      assert.equal(await menu.evaluate((element) => element === document.activeElement), true);
    }
    await menu.press("Enter");
    await drawer.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "detached" });
    assert.equal(await menu.evaluate((element) => element === document.activeElement), true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expectSidebar(page, desktopExpanded, desktopExpanded ? 312 : 76);
  });
}

test("Sidebar: teclado, tema oscuro y movimiento reducido conservan expansión y navegación", async (context) => {
  const page = await openPage(context, "client", { reducedMotion: "reduce", colorScheme: "dark", viewport: { width: 900, height: 1000 } });
  await page.goto(`${origin}/dashboard-clientes`);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expectSidebar(page, true, 234);
  const sidebar = page.locator(`${SIDEBAR_SELECTOR}:visible`);
  const toggle = sidebar.getByRole("button", { name: TOGGLE_NAME });
  await toggle.focus();
  await toggle.press("Enter");
  await expectSidebar(page, false, 76);
  await toggle.press("Space");
  await expectSidebar(page, true, 234);
  await sidebar.getByRole("button", { name: "Ver más proyectos", exact: true }).press("Enter");
  await page.waitForURL(`${origin}/proyectos`);
});
