import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const ARCHITECT = { id: 2, name: "Diego Jiménez" };
const PROJECT = { id: 30, name: "Stand Aurea", status: "in_process", progress: 90, endDate: "2026-03-24T00:00:00.000Z", client: { id: 50, name: "Diego Jiménez" }, assignees: [], assignedArchitect: null };
const PAYLOADS = {
  "/api/projects": { projects: [PROJECT], nextCursor: null },
  "/api/project-requests/review-queue": { projectRequests: [], nextCursor: null },
  "/api/environment-comments": { comments: [], nextCursor: null },
  "/api/admin/assignees": { assignees: [ARCHITECT] },
  "/api/admin/dashboard-metrics": { metrics: { activeUsers: { total: 32, thisMonth: 12 }, activeProjects: { total: 12, thisMonth: 2 }, files: { total: 3, totalBytes: 1024 }, requests: { total: 4, today: 2 }, criticalEvents: { total: 2, latestAt: null } } },
  "/api/admin/dashboard-overview": { overview: {
    recentActivity: [{ id: 1, title: "Entrega finalizada", userName: "Arq. Sofía Tapia", projectName: "Stand Aurea", projectId: 30, createdAt: "2026-03-23T13:00:00" }],
    newRequests: [{ id: 7, projectName: "Apto. Noventa y Uno", projectType: "residential", status: "pending_review", assignees: [] }],
  } },
};

let server;
let browser;
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
 * Abre el dashboard administrativo real con respuestas HTTP de prueba y espera su contenido.
 *
 * @param {import("node:test").TestContext} context Prueba propietaria del navegador.
 * @param {number} width Ancho del viewport.
 * @returns {Promise<import("playwright").Page>} Página lista para medir.
 */
async function openDashboard(context, width) {
  const browserContext = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await browserContext.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payload = path === "/api/auth/me"
      ? { user: { id: 1, firstName: "Leonel", lastName: "Pérez", email: "leonel@example.test", role: "admin", status: "active" } }
      : PAYLOADS[path];
    if (!payload) {
      errors.push(`Petición no prevista: ${route.request().method()} ${path}`);
      await route.fulfill({ status: 404, json: { code: "TEST_ROUTE_MISSING", message: "Fixture no definida" } });
      return;
    }
    await route.fulfill({ json: payload });
  });
  context.after(async () => {
    await browserContext.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(`${origin}/dashboard-arquitecto`);
  await page.getByText("Apto. Noventa y Uno", { exact: true }).waitFor();
  await page.getByText("24 Mar 2026", { exact: true }).waitFor();
  return page;
}

/**
 * Obtiene la caja de un elemento visible y su estilo computado relevante.
 *
 * @param {import("playwright").Locator} locator Elemento a medir.
 * @returns {Promise<{x: number, y: number, width: number, height: number, fontSize: string, fontWeight: string}>}
 */
async function measure(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, fontSize: style.fontSize, fontWeight: style.fontWeight };
  });
}

test("Dashboard admin 375 px reproduce las medidas de Figma 3727:678728", async (context) => {
  const page = await openDashboard(context, 375);

  const navbar = await measure(page.locator("[data-scroll-direction-navbar]"));
  assert.equal(navbar.height, 68);
  const menu = await measure(page.getByRole("button", { name: "Abrir menú", exact: true }));
  assert.deepEqual([menu.width, menu.height, menu.x], [44, 44, 16]);
  assert.equal((await measure(page.getByText("Jueves", { exact: false }).first())).fontWeight, "500");

  assert.equal((await measure(page.getByRole("heading", { name: "Dashboard", level: 1 }))).fontSize, "24px");
  const exportButton = await measure(page.getByRole("button", { name: "Exportar reporte" }));
  const historyButton = await measure(page.getByRole("button", { name: "Ver historial" }).first());
  assert.equal(exportButton.y, historyButton.y, "Las acciones comparten fila");
  assert.ok(Math.abs(exportButton.width - historyButton.width) < 1, "Las acciones tienen igual ancho");
  assert.ok(Math.abs(exportButton.width + historyButton.width + 12 - 343) < 1, "Las acciones ocupan el ancho del contenido");

  const metrics = page.getByRole("region", { name: "Resumen de métricas administrativas" }).locator("article");
  assert.equal(await metrics.filter({ hasText: "Archivos registrados" }).isVisible(), false, "Figma móvil oculta Archivos");
  const visibleMetrics = [];
  for (const label of ["Usuarios activos", "Proyectos activos", "Solicitudes", "Eventos críticos"]) {
    visibleMetrics.push(await measure(metrics.filter({ hasText: label })));
  }
  assert.deepEqual(visibleMetrics.map(({ x }) => Math.round(x)), [16, 196, 16, 196], "Métricas en dos columnas con 16 px de separación");
  assert.equal((await measure(metrics.filter({ hasText: "Usuarios activos" }).locator("strong"))).fontSize, "24px");

  const eventTag = await measure(page.getByText("Sistema", { exact: true }));
  assert.equal(eventTag.fontSize, "14px");
  const eye = await measure(page.getByRole("button", { name: "Ver Error de respaldo automático (próximamente)" }));
  assert.deepEqual([eye.width, eye.height], [44, 44]);
  const eventsCardContentRight = await page.getByText("Error de respaldo automático", { exact: true })
    .evaluate((element) => {
      const card = element.closest(".rounded-\\[var\\(--radius-3\\)\\]");
      const style = getComputedStyle(card);
      return card.getBoundingClientRect().right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    });
  assert.ok(Math.abs(eye.x + eye.width - eventsCardContentRight) < 1, "La acción del evento se alinea a la derecha de la tarjeta");

  const requestTitle = await measure(page.getByText("Apto. Noventa y Uno", { exact: true }));
  const assignee = await measure(page.getByLabel("Responsables de Apto. Noventa y Uno"));
  assert.ok(assignee.y > requestTitle.y + requestTitle.height, "El selector pasa a la línea siguiente del título");

  assert.equal(await page.locator("#admin-active-projects-title").textContent(), "Proyectos activos");
  const header = await measure(page.locator("thead th").nth(1));
  assert.deepEqual([header.fontSize, header.fontWeight], ["14px", "500"]);
  const previous = await measure(page.getByRole("button", { name: "Ir a la página anterior de proyectos" }));
  const selection = await measure(page.getByText("0 de 1 seleccionados", { exact: true }));
  assert.ok(Math.abs(previous.y + previous.height / 2 - (selection.y + selection.height / 2)) < 2, "El pie usa una sola fila");

  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
});

test("Dashboard admin 1440 px conserva la presentación de escritorio", async (context) => {
  const page = await openDashboard(context, 1440);
  assert.equal((await measure(page.getByRole("heading", { name: "Dashboard", level: 1 }))).fontSize, "48px");
  const metrics = page.getByRole("region", { name: "Resumen de métricas administrativas" }).locator("article");
  assert.equal(await metrics.count(), 5);
  assert.equal(await metrics.filter({ hasText: "Archivos registrados" }).isVisible(), true);
  const tops = await metrics.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().y)));
  assert.equal(new Set(tops).size, 1, "Las cinco métricas comparten fila");
  assert.equal(await page.getByRole("heading", { name: "Proyectos", exact: true }).isVisible(), true);
  const eye = await measure(page.getByRole("button", { name: "Ver Error de respaldo automático (próximamente)" }));
  assert.deepEqual([eye.width, eye.height], [36, 36]);
  assert.equal((await measure(page.getByText("Sistema", { exact: true }))).fontSize, "12px");
});
