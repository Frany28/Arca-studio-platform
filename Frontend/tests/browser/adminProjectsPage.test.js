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

/**
 * Abre la ruta real aislando HTTP. Las mutaciones solo se aceptan si el test declara
 * `onMutation`; cualquier otra mutación o lectura no prevista falla el test.
 * @param {Object} context - Contexto de node:test.
 * @param {Object} [options] - Tema, datos y manejador de mutaciones.
 * @returns {Promise<import("playwright").Page>} Página lista con la tabla cargada.
 */
async function openPage(context, { theme = "light", projects = PROJECTS, fail = false, hold = false, assignees = [], onMutation, viewport = { width: 1440, height: 1200 } } = {}) {
  const session = await browser.newContext({ viewport });
  const page = applyBrowserTimeouts(await session.newPage());
  const errors = [];
  await page.addInitScript((theme) => localStorage.setItem("arca-theme", theme), theme);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      if (!onMutation) {
        errors.push(`Mutación no autorizada: ${pathname}`);
        return route.abort();
      }
      const response = await onMutation({ method: route.request().method(), pathname, body: route.request().postDataJSON() });
      return route.fulfill(response);
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
      "/api/admin/assignees": { assignees },
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
  assert.equal(await page.getByRole("textbox", { name: "Responsables de Proyecto 1", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("textbox", { name: "Responsables de Proyecto 2. Asignación deshabilitada", exact: true }).isDisabled(), true);
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

/** Crea una respuesta controlable para observar pending, duplicados y orden de actualización. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** Abre el menú de fila y devuelve el locator del menú en portal. */
async function openRowMenu(page, projectName) {
  await page.getByRole("button", { name: `Más opciones de ${projectName}`, exact: true }).click();
  const menu = page.getByRole("menu", { name: `Acciones de ${projectName}`, exact: true });
  await menu.waitFor();
  return menu;
}

/** Abre "Configuración del proyecto" desde el menú de la fila indicada. */
async function openSettings(page, projectName) {
  const menu = await openRowMenu(page, projectName);
  await menu.getByRole("menuitem", { name: "Cambiar visibilidad", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración del proyecto", exact: true });
  await dialog.waitFor();
  return dialog;
}

/** Lee nombre, aria-checked y aria-disabled de los cuatro switches en orden visual. */
async function readSwitches(dialog) {
  return dialog.getByRole("switch").evaluateAll((elements) => elements.map((element) => ({
    name: document.getElementById(element.getAttribute("aria-labelledby")).textContent.trim(),
    checked: element.getAttribute("aria-checked"),
    disabled: element.getAttribute("aria-disabled") === "true",
  })));
}

for (const theme of ["light", "dark"]) {
  test(`Gestión ${theme}: menú de fila con opciones de Figma, teclado, Escape y clic exterior`, async (context) => {
    const page = await openPage(context, { theme });
    const trigger = page.getByRole("button", { name: "Más opciones de Proyecto 1", exact: true });
    const menu = await openRowMenu(page, "Proyecto 1");
    assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), ["Cambiar visibilidad", "Archivar"]);
    const geometry = await menu.evaluate((element, label) => {
      const rect = element.getBoundingClientRect();
      const anchor = document.querySelector(`[aria-label="${label}"]`).getBoundingClientRect();
      return { width: rect.width, rightGap: Math.abs(rect.right - anchor.right), below: rect.top >= anchor.bottom, background: getComputedStyle(element).backgroundColor };
    }, "Más opciones de Proyecto 1");
    assert.equal(geometry.width, 183);
    assert.ok(geometry.rightGap < 1, "el menú se ancla al borde derecho del disparador");
    assert.equal(geometry.below, true);
    assert.notEqual(geometry.background, "rgba(0, 0, 0, 0)");
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Más opciones de Proyecto 1");

    await trigger.click();
    await menu.waitFor();
    await page.getByRole("heading", { name: "Gestión de proyectos", exact: true }).click();
    await menu.waitFor({ state: "detached" });

    await trigger.focus();
    await page.keyboard.press("Enter");
    await menu.waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent === "Cambiar visibilidad");
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Archivar");
    await page.keyboard.press("Enter");
    await menu.waitFor({ state: "detached" });
    const archiveDialog = page.getByRole("dialog", { name: "¿Deseas archivar el proyecto?", exact: true });
    await archiveDialog.waitFor();
    await page.keyboard.press("Escape");
    await archiveDialog.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Más opciones de Proyecto 1");

    const archivedMenu = await openRowMenu(page, "Proyecto 4");
    assert.deepEqual(await archivedMenu.getByRole("menuitem").allTextContents(), ["Cambiar visibilidad", "Desarchivar"]);
  });

  test(`Gestión ${theme}: configuración inicializa, distingue pendientes, cancela sin persistir y aísla proyectos`, async (context) => {
    const calls = [];
    const page = await openPage(context, { theme, onMutation: (request) => { calls.push(request); return { status: 500, json: {} }; } });
    let dialog = await openSettings(page, "Proyecto 2");
    assert.equal(await dialog.getByRole("heading", { name: "Configuración del proyecto" }).count(), 1);
    assert.equal(await dialog.getByText("Controla cómo y dónde será visible este proyecto dentro de la plataforma y en el sitio web público.", { exact: true }).count(), 1);
    assert.deepEqual(await readSwitches(dialog), [
      { name: "Mostrar en el portafolio público", checked: "true", disabled: false },
      { name: "Destacar en la página principal", checked: "false", disabled: true },
      { name: "Permitir acceso al cliente", checked: "true", disabled: true },
      { name: "Archivar proyecto", checked: "false", disabled: false },
    ]);
    const confirm = dialog.getByRole("button", { name: "Confirmar", exact: true });
    assert.equal(await confirm.isDisabled(), true, "sin cambios no se confirma");
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "switch");

    const portfolio = dialog.getByRole("switch", { name: "Mostrar en el portafolio público" });
    await portfolio.click();
    assert.equal(await portfolio.getAttribute("aria-checked"), "false");
    assert.equal(await dialog.locator('[data-setting="portfolio"][data-pending="true"]').count(), 1);
    await dialog.getByText("Cambio pendiente de confirmación.", { exact: true }).waitFor();
    assert.equal(await confirm.isEnabled(), true);

    const archivedSwitch = dialog.getByRole("switch", { name: "Archivar proyecto" });
    await archivedSwitch.click();
    assert.equal(await portfolio.getAttribute("aria-disabled"), "true", "archivar desactiva la visibilidad pública");
    await archivedSwitch.click();

    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    // Modal conserva su animación de salida: el contenido sigue montado durante la transición.
    assert.equal(await page.locator("[data-project-settings-modal]").count(), 1);
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Más opciones de Proyecto 2");

    dialog = await openSettings(page, "Proyecto 2");
    assert.equal(await dialog.getByRole("switch", { name: "Mostrar en el portafolio público" }).getAttribute("aria-checked"), "true", "cancelar descarta el borrador");
    await dialog.getByRole("switch", { name: "Mostrar en el portafolio público" }).click();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });

    dialog = await openSettings(page, "Proyecto 1");
    assert.deepEqual((await readSwitches(dialog))[0], { name: "Mostrar en el portafolio público", checked: "false", disabled: true });
    await dialog.getByText("Solo los proyectos finalizados pueden mostrarse en el portafolio público.", { exact: true }).waitFor();
    assert.equal(await dialog.locator('[data-pending="true"]').count(), 0, "el borrador de otro proyecto no se comparte");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(calls, []);
  });
}

test("Gestión: confirmar visibilidad espera al servidor, bloquea duplicados y actualiza la fila", async (context) => {
  const calls = [];
  const response = deferred();
  const page = await openPage(context, { onMutation: (request) => {
    calls.push(request);
    return response.promise;
  } });
  const dialog = await openSettings(page, "Proyecto 2");
  await dialog.getByRole("switch", { name: "Mostrar en el portafolio público" }).click();
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  const pending = dialog.getByRole("button", { name: "Confirmando...", exact: true });
  await pending.waitFor();
  assert.equal(await pending.isDisabled(), true);
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true, "no se cierra mientras guarda");
  assert.deepEqual(calls, [{ method: "PATCH", pathname: "/api/admin/projects/bulk-action", body: { action: "change_visibility", isPublic: false, projectIds: [31] } }]);

  response.resolve({ json: { projects: [{ id: 31, status: "finished", isPublic: false, archivedAt: null }] } });
  await dialog.waitFor({ state: "detached" });
  await page.getByText("Visibilidad actualizada", { exact: true }).waitFor();
  assert.equal(calls.length, 1);
  const reopened = await openSettings(page, "Proyecto 2");
  assert.equal(await reopened.getByRole("switch", { name: "Mostrar en el portafolio público" }).getAttribute("aria-checked"), "false", "la fila refleja la respuesta del servidor");
});

test("Gestión: error al guardar conserva el borrador, informa y permite reintentar", async (context) => {
  const calls = [];
  const page = await openPage(context, { onMutation: (request) => {
    calls.push(request);
    return calls.length === 1
      ? { status: 409, json: { code: "VISIBILITY_REQUIRES_COMPLETED", message: "Solo los proyectos completados pueden cambiar su visibilidad." } }
      : { json: { projects: [{ id: 31, status: "finished", isPublic: false }] } };
  } });
  const dialog = await openSettings(page, "Proyecto 2");
  const portfolio = dialog.getByRole("switch", { name: "Mostrar en el portafolio público" });
  await portfolio.click();
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await dialog.getByRole("alert").getByText("Solo los proyectos completados pueden cambiar su visibilidad.", { exact: true }).waitFor();
  await page.getByText("No se pudo cambiar la visibilidad", { exact: true }).waitFor();
  assert.equal(await portfolio.getAttribute("aria-checked"), "false", "el borrador pendiente se conserva");
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(calls.length, 2);
});

test("Gestión: archivar desde el menú y desde el modal comparten la operación recuperable", async (context) => {
  const calls = [];
  const page = await openPage(context, { onMutation: (request) => {
    calls.push(request.body);
    const [id] = request.body.projectIds;
    const status = request.body.action === "archive" ? "archived" : "in_process";
    return { json: { projects: [{ id, status, isPublic: false, archivedAt: null }] } };
  } });
  const firstRow = page.locator("tbody tr").first();
  const menu = await openRowMenu(page, "Proyecto 1");
  await menu.getByRole("menuitem", { name: "Archivar", exact: true }).click();
  const archiveDialog = page.getByRole("dialog", { name: "¿Deseas archivar el proyecto?", exact: true });
  await archiveDialog.getByRole("button", { name: "Archivar", exact: true }).click();
  await archiveDialog.waitFor({ state: "detached" });
  await page.getByText("Proyecto archivado", { exact: true }).waitFor();
  await firstRow.getByText("Archivado", { exact: true }).waitFor();

  const restoreMenu = await openRowMenu(page, "Proyecto 1");
  await restoreMenu.getByRole("menuitem", { name: "Desarchivar", exact: true }).click();
  const unarchiveDialog = page.getByRole("dialog", { name: "¿Deseas desarchivar el proyecto?", exact: true });
  await unarchiveDialog.getByRole("button", { name: "Desarchivar", exact: true }).click();
  await unarchiveDialog.waitFor({ state: "detached" });
  await firstRow.getByText("En progreso", { exact: true }).waitFor();

  const settings = await openSettings(page, "Proyecto 3");
  await settings.getByRole("switch", { name: "Archivar proyecto" }).click();
  await settings.getByRole("button", { name: "Confirmar", exact: true }).click();
  await settings.waitFor({ state: "detached" });
  assert.deepEqual(calls, [
    { action: "archive", projectIds: [30] },
    { action: "unarchive", projectIds: [30] },
    { action: "archive", projectIds: [32] },
  ]);
});

test("Gestión: responsables reutilizan selector, confirmación y avisos del Dashboard", async (context) => {
  const calls = [];
  const response = deferred();
  const carmen = { id: 12, name: "Carmen Díaz", roleCode: "architect", roleName: "Arquitecta" };
  const laura = { id: 9, name: "Laura Rivas", roleCode: "architect", roleName: "Arquitecta" };
  const page = await openPage(context, { assignees: [laura, carmen], onMutation: (request) => {
    calls.push(request);
    return response.promise;
  } });
  const input = page.getByRole("textbox", { name: "Responsables de Proyecto 1", exact: true });
  const firstRow = page.locator("tbody tr").first();
  await input.fill("Carmen");
  await input.press("Enter");
  assert.deepEqual(calls, [{ method: "PUT", pathname: "/api/admin/projects/30/assignees", body: { assigneeIds: [9, 12] } }]);
  assert.equal(await input.isDisabled(), true, "bloquea operaciones duplicadas mientras guarda");
  assert.equal(await page.getByText("Responsable asignado exitosamente", { exact: true }).count(), 0);
  response.resolve({ json: { assignees: [laura, carmen] } });
  await page.getByText("Responsable asignado exitosamente", { exact: true }).waitFor();
  await firstRow.getByText("Carmen Díaz", { exact: true }).waitFor();
  assert.equal(await page.locator("tbody tr").nth(2).getByText("Carmen Díaz", { exact: true }).count(), 0, "solo cambia el proyecto afectado");

  await input.focus();
  await input.press("Backspace");
  const removal = page.getByRole("dialog", { name: "Confirmar retiro del encargado" });
  await removal.waitFor();
  await removal.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.equal(calls.length, 1, "cancelar la baja no persiste");
});

test("Gestión: menú y modal dentro del viewport en todos los anchos, con sidebar y scroll interno", async (context) => {
  const page = await openPage(context);
  for (const width of WIDTHS) {
    for (const expanded of width < 768 ? [false] : [false, true]) {
      await page.setViewportSize({ width, height: 900 });
      await setSidebar(page, width, expanded);
      const menu = await openRowMenu(page, "Proyecto 10");
      const menuBox = await menu.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const items = [...element.querySelectorAll('[role="menuitem"]')].map((item) => item.getBoundingClientRect());
        return { inside: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, itemsInside: items.every((item) => item.top >= rect.top && item.bottom <= rect.bottom + 0.5) };
      });
      assert.deepEqual(menuBox, { inside: true, itemsInside: true }, `${width}px, sidebar ${expanded}: menú`);
      await menu.getByRole("menuitem", { name: "Cambiar visibilidad", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Configuración del proyecto", exact: true });
      await dialog.waitFor();
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect.getTiming().iterations === Infinity));
      const dialogBox = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const buttons = [...element.querySelectorAll("footer button")].map((button) => button.getBoundingClientRect());
        return {
          inside: rect.left >= 0 && rect.right <= innerWidth + 0.5 && rect.top >= 0 && rect.bottom <= innerHeight + 0.5,
          buttons: buttons.length === 2 && buttons.every((button) => button.left >= rect.left && button.right <= rect.right && button.bottom <= rect.bottom + 0.5),
          document: document.documentElement.scrollWidth - innerWidth,
        };
      });
      assert.deepEqual(dialogBox, { inside: true, buttons: true, document: 0 }, `${width}px, sidebar ${expanded}: modal`);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    }
  }
  await page.setViewportSize({ width: 320, height: 480 });
  const dialog = await openSettings(page, "Proyecto 1");
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect.getTiming().iterations === Infinity));
  const scroll = await dialog.evaluate((element) => {
    const body = element.firstElementChild;
    const footer = element.querySelector("footer").getBoundingClientRect();
    return { scrollable: body.scrollHeight > body.clientHeight, footerVisible: footer.bottom <= innerHeight };
  });
  assert.deepEqual(scroll, { scrollable: true, footerVisible: true });
});
