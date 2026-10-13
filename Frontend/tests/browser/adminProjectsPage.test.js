import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

const WIDTHS = [320, 375, 430, 768, 1024, 1279, 1280, 1440, 1920];
const PROJECTS = Array.from({ length: 12 }, (_, index) => ({
  id: index + 30, name: `Proyecto ${index + 1}`, publicSlug: `proyecto-${index + 1}`,
  status: ["in_process", "finished", "pending", "archived"][index % 4],
  progress: index % 4 === 1 ? 100 : 50, isPublic: index % 4 === 1,
  client: { id: 90 + index, name: "Cliente del proyecto" },
  assignees: [{ id: 9, name: "Laura Rivas" }],
}));
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({ root: fileURLToPath(new URL("../../", import.meta.url)), configFile: false, envDir: false,
    plugins: [react(), tailwindcss()], define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
    server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
});
after(async () => { await browser?.close(); await server?.close(); });

/** Abre la ruta real, aislando lecturas HTTP; cualquier mutación o endpoint nuevo falla. */
async function openPage(context, { theme = "light", projects = PROJECTS, fail = false, hold = false } = {}) {
  const session = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = applyBrowserTimeouts(await session.newPage());
  const errors = [];
  await page.addInitScript((theme) => localStorage.setItem("arca-theme", theme), theme);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      errors.push(`Mutación no autorizada: ${pathname}`);
      return route.abort();
    }
    if (pathname === "/api/projects") {
      if (hold) return;
      return route.fulfill(fail ? { status: 503, json: { message: "No disponible" } } : { json: { projects, nextCursor: null } });
    }
    const payload = {
      "/api/auth/me": { user: { id: 1, firstName: "Admin", lastName: "Prueba", email: "admin@example.test", role: "admin", status: "active" } },
      "/api/admin/dashboard-metrics": { metrics: { requests: { total: 18 } } },
      "/api/admin/dashboard-overview": { overview: { recentActivity: [], newRequests: [] } },
      "/api/project-requests/review-queue": { projectRequests: [], nextCursor: null },
      "/api/admin/assignees": { assignees: [] },
    }[pathname];
    if (!payload) errors.push(`Lectura no prevista: ${pathname}`);
    return route.fulfill({ status: payload ? 200 : 404, json: payload || {} });
  });
  context.after(async () => { await session.close(); assert.deepEqual(errors, []); });
  await page.goto(`${origin}/gestion-proyectos`);
  await page.getByRole("heading", { name: "Gestión de proyectos", exact: true }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  if (!hold) await page.getByText(fail ? "No se pudieron cargar los proyectos" : projects.length ? projects[0].name : "No hay proyectos", { exact: true }).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/** Espera la geometría final del sidebar sin eliminar sus animaciones. */
async function setSidebar(page, width, expanded) {
  if (width < 768) return;
  const toggle = page.locator('aside[aria-label="Navegación lateral"]:visible').getByRole("button", { name: /^(Contraer|Expandir) navegación lateral$/ });
  if (await toggle.getAttribute("aria-expanded") !== String(expanded)) await toggle.click();
  await page.waitForFunction((expected) => {
    const rail = [...document.querySelectorAll('aside[aria-label="Navegación lateral"]')].find((element) => element.getClientRects().length);
    return Math.abs(rail.getBoundingClientRect().width - expected) < 0.5;
  }, expanded ? (width >= 1024 ? 312 : 234) : 76);
}

for (const theme of ["light", "dark"]) {
  test(`Gestión ${theme}: responsive, sidebar, indicadores y scroll interno con contenido extenso`, async (context) => {
    const longProjects = PROJECTS.map((project) => ({ ...project, name: `${project.name} con una descripción extensa`, client: { ...project.client, name: "Cliente con un nombre completo muy extenso" } }));
    const page = await openPage(context, { theme, projects: longProjects });
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), theme === "dark");
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 1200 });
      for (const expanded of width < 768 ? [false] : [false, true]) {
        await setSidebar(page, width, expanded);
        const result = await page.evaluate(() => {
          const content = document.querySelector("main > div > .overflow-y-auto");
          const table = document.querySelector("table");
          const viewport = table.parentElement;
          const controls = [...document.querySelectorAll('[data-selection-footer] button')].map((element) => element.getBoundingClientRect());
          return {
            document: document.documentElement.scrollWidth - innerWidth,
            content: content.scrollWidth - content.clientWidth,
            columns: [...table.querySelectorAll("thead th")].map((cell) => cell.getBoundingClientRect().width),
            rows: table.querySelectorAll("tbody tr").length,
            rowHeights: [...table.querySelectorAll("tbody tr")].map((row) => row.getBoundingClientRect().height),
            headerHeight: table.querySelector("thead").getBoundingClientRect().height,
            internalScroll: viewport.scrollWidth > viewport.clientWidth,
            controlsInside: controls.every((rect) => rect.left >= 0 && rect.right <= innerWidth),
            metricRows: [...document.querySelectorAll('[aria-label="Indicadores de proyectos"] article')].map((article) => article.getBoundingClientRect().top),
          };
        });
        assert.equal(result.document, 0, `${width}px, sidebar ${expanded}: documento`);
        assert.equal(result.content, 0, `${width}px, sidebar ${expanded}: shell`);
        assert.equal(result.rows, 10);
        assert.equal(result.headerHeight, 49);
        assert.ok(result.rowHeights.every((height) => height === 68), `${width}px: altura de filas`);
        assert.ok(result.columns.every((value, index) => value >= [48, 155, 184, 300, 117, 117, 172][index] - 0.1));
        assert.equal(result.controlsInside, true);
        if (width < 768) assert.equal(new Set(result.metricRows).size, 4);
        if (width === 1024 && !expanded || width >= 1280) assert.equal(new Set(result.metricRows).size, 1, `${width}px: cuatro indicadores en una fila`);
        if (width <= 1024 || (width === 1280 && expanded)) assert.equal(result.internalScroll, true);
        if (process.env.ARCA_PROJECT_CAPTURE_DIR && [375, 1024, 1440].includes(width)) {
          await mkdir(process.env.ARCA_PROJECT_CAPTURE_DIR, { recursive: true });
          await page.evaluate(() => document.querySelector("main > div > .overflow-y-auto").scrollTop = 0);
          await page.setViewportSize({ width, height: width < 768 ? 1600 : 1280 });
          await page.mouse.move(width - 1, 0);
          // La captura espera las transiciones existentes; no desactiva animaciones.
          await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect.getTiming().iterations === Infinity));
          await page.screenshot({ path: join(process.env.ARCA_PROJECT_CAPTURE_DIR, `management-${width}-${theme}-${expanded ? "expanded" : "collapsed"}.png`) });
          await page.setViewportSize({ width, height: 1200 });
        }
        const select = page.getByRole("checkbox", { name: `Seleccionar ${longProjects[0].name}`, exact: true });
        await select.check();
        assert.equal(await page.getByRole("button", { name: "Archivar", exact: true }).isDisabled(), true);
        assert.equal(await page.locator('[data-selection-footer]').evaluate((footer) => {
          const elements = [footer, ...footer.querySelectorAll("button")];
          return elements.every((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth;
          }) && document.documentElement.scrollWidth === innerWidth;
        }), true, `${width}px: footer con selección`);
        await select.uncheck();
      }
    }
    const metrics = page.locator('[aria-label="Indicadores de proyectos"] article strong');
    assert.deepEqual(await metrics.allTextContents(), ["12", "3", "3", "18"]);
    await page.setViewportSize({ width: 375, height: 1200 });
    const viewport = page.locator("table").locator("..");
    await viewport.evaluate((element) => element.scrollLeft = element.scrollWidth);
    assert.ok(await viewport.evaluate((element) => element.scrollLeft > 0));
    assert.equal(await page.getByRole("button", { name: `Editar ${longProjects[0].name}`, exact: true }).isDisabled(), true);
  });
}

test("Gestión: filtros, selección, paginación, foco y navegación existentes sin mutaciones", async (context) => {
  const page = await openPage(context);
  assert.equal(await page.getByText("Laura Rivas", { exact: true }).count(), 10);
  assert.equal(await page.getByRole("textbox", { name: "Responsables de Proyecto 1. Asignación deshabilitada", exact: true }).isDisabled(), true);
  await page.getByRole("checkbox", { name: "Seleccionar Proyecto 1", exact: true }).check();
  await page.getByText("1 de 10 seleccionados", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Archivar", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Ir a la página siguiente de proyectos", exact: true }).click();
  await page.getByText("0 de 2 seleccionados", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Ir a la página anterior de proyectos", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Buscar proyectos", exact: true });
  await search.fill("Proyecto 12");
  await page.getByText("0 de 1 seleccionados", { exact: true }).waitFor();
  await search.fill("sin coincidencias");
  await page.getByText("No hay coincidencias", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Quitar filtros", exact: true }).click();
  await page.getByRole("button", { name: "Filtrar proyectos por status", exact: true }).click();
  await page.locator(".admin-active-projects__filter-menu button").filter({ hasText: "Finalizado" }).click();
  await page.keyboard.press("Escape");
  await page.getByText("0 de 3 seleccionados", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Quitar filtros", exact: true }).click();
  const create = page.getByRole("button", { name: "Nuevo", exact: true });
  await create.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(`${origin}/dashboard-arquitecto/nuevo-proyecto`);
});

test("Gestión: carga, vacío y error conservan su contexto y acción de reintento", async (context) => {
  const loading = await openPage(context, { hold: true });
  assert.equal(await loading.getByText("Cargando proyectos", { exact: true }).count(), 1);
  const empty = await openPage(context, { projects: [] });
  assert.equal(await empty.getByText("No hay proyectos", { exact: true }).count(), 1);
  const error = await openPage(context, { fail: true });
  const request = error.waitForRequest((request) => new URL(request.url()).pathname === "/api/projects");
  await error.getByRole("button", { name: "Reintentar", exact: true }).click();
  await request;
});
