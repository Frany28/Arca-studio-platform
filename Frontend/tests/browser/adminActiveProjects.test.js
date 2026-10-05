import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const ANA = { id: 1, name: "Ana" };
const LUIS = { id: 2, name: "Luis" };
const CARMEN = { id: 3, name: "Carmen" };
const PROJECTS = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1, title: `Proyecto ${index + 1}`, client: { id: 9, name: "Cliente Norte" },
  status: "in_process", progress: 35, editable: true, assignees: [ANA, LUIS], isPublic: false,
}));
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), configFile: false, envDir: false,
    plugins: [react(), tailwindcss()], server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.ARCA_TEST_BROWSER_CHANNEL
    || (process.platform === "win32" ? "msedge" : undefined) });
});

after(async () => { await browser?.close(); await server?.close(); });

/** Monta el consumidor real con props públicas y detecta errores o acceso inesperado a APIs. */
async function openPage(context, props = {}, { theme = "light", resizeFallback = false, ...options } = {}) {
  const session = await browser.newContext({ viewport: { width: 1024, height: 900 }, ...options });
  const page = await session.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    errors.push(`API inesperada: ${route.request().url()}`);
    await route.abort();
  });
  context.after(async () => { await session.close(); assert.deepEqual(errors, []); });
  await page.goto(`${origin}/tests/browser/fixtures/admin-active-projects.html?theme=${theme}&resizeFallback=${resizeFallback}&props=${encodeURIComponent(JSON.stringify({ projects: PROJECTS, assignees: [ANA, LUIS, CARMEN], ...props }))}`);
  await page.getByRole("heading", { name: "Proyectos", exact: true }).waitFor();
  return page;
}

/** Lee únicamente argumentos recibidos por el consumidor y la identidad de los objetos. */
async function events(page, type) {
  return page.evaluate((type) => window.adminProjectsHarness.events.filter((event) => event.type === type), type);
}

/** Selecciona filas por su control accesible, sin inspeccionar el estado interno. */
async function select(page, id = 1) {
  await page.getByRole("checkbox", { name: `Seleccionar Proyecto ${id}`, exact: true }).click();
}

/** Obtiene controles de paginación por su texto conservando los labels existentes. */
function paginationButton(page, previous = false) {
  return page.locator("footer button").filter({ hasText: previous ? /^Anterior$/ : /^Siguiente pág\.$/ });
}

/** Abre el filtro y activa una opción del menú múltiple real. */
async function filter(page, kind, label) {
  await page.getByRole("button", { name: kind === "status" ? "Filtrar proyectos por status" : "Filtrar proyectos por personal", exact: true }).click();
  await page.locator(".admin-active-projects__filter-menu button").filter({ hasText: label }).click();
  await page.getByRole("heading", { name: "Proyectos", exact: true }).click();
}

/** Retira al último responsable mediante el flujo de confirmación ya existente. */
async function remove(page, confirm = true) {
  const input = page.getByRole("textbox", { name: "Responsables de Proyecto 1", exact: true });
  await input.focus();
  await input.press("Backspace");
  const dialog = page.getByRole("dialog", { name: "Confirmar retiro del encargado" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: confirm ? "Confirmar" : "Cancelar", exact: true }).click();
}

test("Estados: loading, error, retry, vacío y ausencia de coincidencias", async (context) => {
  const page = await openPage(context, { loading: true, error: "No disponible" });
  await page.getByText("Cargando proyectos", { exact: true }).waitFor();
  assert.equal(await page.locator("table").count(), 0);
  await page.evaluate(() => window.adminProjectsHarness.setProps({ loading: false }));
  await page.getByText("No se pudieron cargar los proyectos", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  assert.equal((await events(page, "retry")).length, 1);
  await page.evaluate(() => window.adminProjectsHarness.setProps({ error: "", projects: [] }));
  await page.getByText("No hay proyectos", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Buscar proyectos" }).fill("No existe");
  await page.getByText("No hay coincidencias", { exact: true }).waitFor();
  assert.equal(await paginationButton(page).isDisabled(), true);
});

test("Búsqueda: trim, mayúsculas, título, nombre, cliente y fallback", async (context) => {
  const page = await openPage(context, { projects: [
    { ...PROJECTS[0], title: "Ático" },
    { ...PROJECTS[1], title: "", name: "Casa Sur", client: {}, clientName: "Diana" },
    { ...PROJECTS[2], client: null, clientName: "" },
  ] });
  const input = page.getByRole("textbox", { name: "Buscar proyectos" });
  await input.fill("  ÁTICO  ");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await input.fill("diana");
  await page.getByRole("checkbox", { name: "Seleccionar Casa Sur", exact: true }).waitFor();
  await input.fill("casa sur");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await input.fill("sin cliente");
  await page.getByRole("checkbox", { name: "Seleccionar Proyecto 3", exact: true }).waitFor();
  await input.fill("   ");
  assert.equal(await page.locator("tbody tr").count(), 3);
  assert.equal(await page.getByRole("button", { name: "Quitar filtros", exact: true }).isDisabled(), false);
});

test("Filtros: aliases, personal, combinación y resets de página y selección", async (context) => {
  const projects = PROJECTS.map((project, index) => ({ ...project,
    status: index < 3 ? ["completed", "finished", "request"][index] : "pending_approval",
    assignees: index % 2 ? [LUIS] : [ANA],
  }));
  const page = await openPage(context, { projects });
  await paginationButton(page).click();
  await select(page, 6);
  await filter(page, "status", "Finalizado");
  assert.equal(await page.locator("tbody tr").count(), 2);
  assert.equal(await page.locator("footer").textContent().then((text) => text.includes("0 de 2 seleccionados")), true);
  assert.equal(await paginationButton(page, true).isDisabled(), true);
  await filter(page, "person", "Ana");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByRole("button", { name: "Quitar filtros", exact: true }).click();
  await filter(page, "status", "Solicitud");
  await page.getByRole("checkbox", { name: "Seleccionar Proyecto 3", exact: true }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 5);
});

test("Personal: prioridades y catálogo deduplicado por ID o nombre", async (context) => {
  const page = await openPage(context, { projects: [
    { ...PROJECTS[0], assignees: [ANA], assignedArchitects: [CARMEN] },
    { ...PROJECTS[1], assignees: [], assignedArchitects: [LUIS] },
    { ...PROJECTS[2], assignees: [], assignedArchitects: [], assignedArchitect: { name: "Sin ID" } },
    { ...PROJECTS[3], assignees: [{ ...ANA, name: "Ana actualizada" }] },
  ] });
  await page.getByRole("button", { name: "Filtrar proyectos por personal", exact: true }).click();
  assert.deepEqual(await page.locator(".admin-active-projects__filter-menu button").allTextContents(), ["Ana actualizada", "Luis", "Sin ID"]);
  await page.locator(".admin-active-projects__filter-menu button").filter({ hasText: "Sin ID" }).click();
  await page.getByRole("checkbox", { name: "Seleccionar Proyecto 3", exact: true }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1);
});

test("Selección: header mixto, todos, IDs como texto y selección limitada a página", async (context) => {
  const page = await openPage(context);
  const header = page.getByRole("checkbox", { name: "Seleccionar todos los proyectos visibles" });
  assert.equal(await header.getAttribute("aria-checked"), "false");
  await select(page);
  assert.equal(await header.getAttribute("aria-checked"), "mixed");
  await header.click();
  assert.equal(await header.getAttribute("aria-checked"), "true");
  assert.equal(await page.locator('tbody tr[data-selected="true"]').count(), 5);
  await header.click();
  assert.equal(await header.getAttribute("aria-checked"), "false");
  await select(page);
  await page.evaluate((projects) => window.adminProjectsHarness.setProps({ projects: projects.map((project) => ({ ...project, id: String(project.id) })) }), PROJECTS);
  assert.equal(await page.getByRole("checkbox", { name: "Seleccionar Proyecto 1", exact: true }).getAttribute("aria-checked"), "true");
  await paginationButton(page).click();
  assert.equal(await page.locator('tbody tr[data-selected="true"]').count(), 0);
  await paginationButton(page, true).click();
  assert.equal(await page.locator('tbody tr[data-selected="true"]').count(), 0);
});

test("Selección: desaparición, reaparición y cambio de estado derivan disponibilidad", async (context) => {
  const page = await openPage(context);
  await select(page);
  await page.evaluate((projects) => window.adminProjectsHarness.setProps({ projects: projects.slice(1) }), PROJECTS);
  assert.equal(await page.getByRole("button", { name: "Archivar", exact: true }).count(), 0);
  await page.evaluate((projects) => window.adminProjectsHarness.setProps({ projects: projects.map((project) => project.id === 1 ? { ...project, status: "archived" } : project) }), PROJECTS);
  assert.equal(await page.getByRole("button", { name: "Archivar", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Desarchivar", exact: true }).isDisabled(), false);
  assert.equal(await page.locator('tbody tr[data-selected="true"]').count(), 1);
});

test("Paginación: límite derivado conserva página solicitada al restaurar proyectos", async (context) => {
  const page = await openPage(context);
  await paginationButton(page).click();
  await paginationButton(page).click();
  await page.getByRole("checkbox", { name: "Seleccionar Proyecto 11", exact: true }).waitFor();
  assert.equal(await paginationButton(page).isDisabled(), true);
  await page.evaluate((projects) => window.adminProjectsHarness.setProps({ projects: projects.slice(0, 1) }), PROJECTS);
  await page.getByRole("checkbox", { name: "Seleccionar Proyecto 1", exact: true }).waitFor();
  await page.evaluate((projects) => window.adminProjectsHarness.setProps({ projects }), PROJECTS);
  await page.getByRole("checkbox", { name: "Seleccionar Proyecto 11", exact: true }).waitFor();
});

for (const [action, label, title, status] of [
  ["archive", "Archivar", "Proyectos archivados", "in_process"],
  ["unarchive", "Desarchivar", "Proyectos desarchivados", "archived"],
  ["change_visibility", "Cambiar visibilidad", "Visibilidad actualizada", "finished"],
]) {
  test(`Bulk ${action}: éxito, objetos originales y limpieza de selección`, async (context) => {
    const page = await openPage(context, { projects: [{ ...PROJECTS[0], status }] });
    await select(page);
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByText(title, { exact: true }).waitFor();
    const calls = await events(page, "bulk");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sameReference, true);
    assert.equal(calls[0].value.action, action);
    assert.deepEqual(calls[0].value.projects.map((project) => project.id), [1]);
    assert.equal(await page.locator('tbody tr[data-selected="true"]').count(), 0);
  });
}

test("Bulk: guarda inmediata, pending, error, reintento y snapshot tras filtrar", async (context) => {
  const page = await openPage(context);
  await page.evaluate(() => window.adminProjectsHarness.setMode("pending"));
  await select(page);
  const archive = page.getByRole("button", { name: "Archivar", exact: true });
  await archive.evaluate((button) => { button.click(); button.click(); });
  assert.equal((await events(page, "bulk")).length, 1);
  assert.equal(await archive.isDisabled(), true);
  assert.equal(await archive.getAttribute("aria-busy"), "true");
  assert.equal(await paginationButton(page).isDisabled(), true);
  assert.equal(await page.getByRole("checkbox", { name: "Seleccionar Proyecto 2", exact: true }).isEnabled(), true);
  await page.evaluate(() => window.adminProjectsHarness.settle(0, true));
  await page.getByText("No se pudieron archivar los proyectos", { exact: true }).waitFor();
  assert.equal(await archive.isEnabled(), true);
  assert.equal(await page.locator('tbody tr[data-selected="true"]').count(), 1);
  await archive.click();
  await page.getByRole("textbox", { name: "Buscar proyectos" }).fill("Proyecto 2");
  await select(page, 2);
  assert.deepEqual((await events(page, "bulk"))[1].value.projects.map((project) => project.id), [1]);
  await page.evaluate(() => window.adminProjectsHarness.settle(1));
  await page.getByText("Proyectos archivados", { exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr[data-selected="true"]').count(), 0);
});

test("Bulk: error síncrono y cambio de filtro limpian feedback sin perder reintento", async (context) => {
  const page = await openPage(context);
  await page.evaluate(() => window.adminProjectsHarness.setProps({ onBulkAction: () => { throw new Error("Error síncrono"); } }));
  await select(page);
  await page.getByRole("button", { name: "Archivar", exact: true }).click();
  await page.getByText("Error síncrono", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Buscar proyectos" }).fill("Proyecto 1");
  assert.equal(await page.getByText("Error síncrono", { exact: true }).count(), 0);
  assert.equal(await page.locator('tbody tr[data-selected="true"]').count(), 0);
});

test("Navegación y callbacks ausentes conservan objetos y deshabilitados", async (context) => {
  const page = await openPage(context, { projects: [{ ...PROJECTS[0], editable: false }] });
  await page.getByRole("button", { name: "Ver Proyecto 1", exact: true }).click();
  assert.equal((await events(page, "open"))[0].sameReference, true);
  assert.equal(await page.getByRole("button", { name: "Editar Proyecto 1", exact: true }).isDisabled(), true);
  await page.evaluate(() => window.adminProjectsHarness.setProps({ onBulkAction: undefined }));
  await select(page);
  assert.equal(await page.getByRole("button", { name: "Archivar", exact: true }).isDisabled(), true);
});

test("Responsables: confirmar, cancelar, pending, error y reintento", async (context) => {
  const page = await openPage(context, { projects: [PROJECTS[0]] });
  await remove(page, false);
  assert.equal((await events(page, "assignees")).length, 0);
  await page.evaluate(() => window.adminProjectsHarness.setMode("pending"));
  await remove(page);
  assert.equal((await events(page, "assignees"))[0].sameReference, true);
  assert.deepEqual((await events(page, "assignees"))[0].value.assignees, [ANA]);
  await page.evaluate(() => window.adminProjectsHarness.settle(0, true));
  await page.getByText("Error de actualización", { exact: true }).waitFor();
  assert.equal(await page.getByText("Encargado retirado", { exact: true }).count(), 0);
  await remove(page);
  await page.evaluate(() => window.adminProjectsHarness.settle(1));
  await page.getByText("Encargado retirado", { exact: true }).waitFor();
});

test("Responsables: undo restaura snapshot y evita ejecución duplicada", async (context) => {
  const page = await openPage(context, { projects: [PROJECTS[0]] });
  await remove(page);
  const undo = page.getByRole("button", { name: "Deshacer", exact: true });
  await undo.waitFor();
  await page.evaluate(() => window.adminProjectsHarness.setMode("pending"));
  await undo.evaluate((button) => { button.click(); button.click(); });
  const calls = await events(page, "assignees");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].value.project, PROJECTS[0]);
  assert.deepEqual(calls[1].value.assignees, [ANA, LUIS]);
  await page.evaluate(() => window.adminProjectsHarness.settle(0));
  await page.waitForFunction(() => document.querySelector('input[aria-label="Responsables de Proyecto 1"]')?.parentElement.textContent.includes("Luis"));
});

test("Responsables: agregar conserva lista durante pending y confirma solo tras éxito", async (context) => {
  const page = await openPage(context, { projects: [PROJECTS[0]] });
  await page.evaluate(() => window.adminProjectsHarness.setMode("pending"));
  const input = page.getByRole("textbox", { name: "Responsables de Proyecto 1", exact: true });
  await input.fill("Carmen");
  await input.press("Enter");
  const calls = await events(page, "assignees");
  assert.deepEqual(calls[0].value.assignees, [ANA, LUIS, CARMEN]);
  assert.equal(await input.isDisabled(), true);
  assert.equal(await page.getByText("Responsable asignado exitosamente", { exact: true }).count(), 0);
  await page.evaluate(() => window.adminProjectsHarness.settle(0));
  await page.getByText("Responsable asignado exitosamente", { exact: true }).waitFor();
  assert.equal(await input.isEnabled(), true);
});

test("Responsables: proyecto desaparecido conserva snapshot disponible para undo", async (context) => {
  const page = await openPage(context, { projects: [PROJECTS[0]] });
  await remove(page);
  const undo = page.getByRole("button", { name: "Deshacer", exact: true });
  await undo.waitFor();
  await page.evaluate(() => window.adminProjectsHarness.setProps({ projects: [] }));
  assert.equal(await undo.isEnabled(), true);
  await undo.click();
  assert.deepEqual((await events(page, "assignees"))[1].value, { project: PROJECTS[0], assignees: [ANA, LUIS] });
});

test("Responsables: undo bloqueado si proyecto se cierra y error usa feedback existente", async (context) => {
  const page = await openPage(context, { projects: [PROJECTS[0]] });
  await remove(page);
  const undo = page.getByRole("button", { name: "Deshacer", exact: true });
  await undo.waitFor();
  await page.evaluate((project) => window.adminProjectsHarness.setProps({ projects: [{ ...project, status: "archived" }] }), PROJECTS[0]);
  assert.equal(await undo.isDisabled(), true);
  await page.evaluate((project) => window.adminProjectsHarness.setProps({ projects: [{ ...project, assignees: [project.assignees[0]] }] }), PROJECTS[0]);
  await page.evaluate(() => window.adminProjectsHarness.setMode("throw"));
  await undo.click();
  await page.getByText("No se pudo restaurar al encargado", { exact: true }).waitFor();
});

for (const resizeFallback of [false, true]) {
  test(`Scroll: resize, ausencia de nodo y cleanup (${resizeFallback ? "fallback" : "observer"})`, async (context) => {
    const page = await openPage(context, {}, { resizeFallback, viewport: { width: 375, height: 900 } });
    const scrollbar = page.getByRole("scrollbar");
    await scrollbar.waitFor();
    await page.locator("table").evaluate((table) => { table.parentElement.scrollLeft = 150; table.parentElement.dispatchEvent(new Event("scroll")); });
    await page.waitForFunction(() => Number(document.querySelector('[role="scrollbar"]').getAttribute("aria-valuenow")) > 0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await scrollbar.waitFor({ state: "detached" });
    await page.setViewportSize({ width: 375, height: 900 });
    await scrollbar.waitFor();
    await page.evaluate(() => window.adminProjectsHarness.setProps({ loading: true }));
    await page.evaluate(() => window.adminProjectsHarness.setProps({ loading: false }));
    await scrollbar.waitFor();
    await page.evaluate(() => window.adminProjectsHarness.unmount());
    const trace = await page.evaluate(() => window.adminProjectsHarness.traceSummary());
    if (resizeFallback) assert.equal(await page.evaluate(() => window.adminProjectsHarness.resizeCleanupMatches()), true);
    else assert.equal(trace.filter((event) => event.type === "observe").length, trace.filter((event) => event.type === "disconnect").length);
  });
}

for (const reducedMotion of ["reduce", "no-preference"]) {
  test(`Scroll: anterior usa RAF y ${reducedMotion}; siguiente no desplaza footer`, async (context) => {
    const page = await openPage(context, {}, { reducedMotion });
    await paginationButton(page).click();
    assert.equal((await page.evaluate(() => window.adminProjectsHarness.traceSummary())).filter((event) => event.type === "scroll-end").length, 0);
    await paginationButton(page, true).click();
    await page.waitForFunction(() => window.adminProjectsHarness.trace.some((event) => event.type === "scroll-end"));
    const trace = await page.evaluate(() => window.adminProjectsHarness.traceSummary());
    assert.deepEqual(trace.find((event) => event.type === "scroll-end").options, { behavior: reducedMotion === "reduce" ? "auto" : "smooth", block: "end" });
  });
}

test("Scroll: control horizontal actualiza scrollLeft y posición accesible", async (context) => {
  const page = await openPage(context, {}, { viewport: { width: 375, height: 900 } });
  const scrollbar = page.getByRole("scrollbar");
  await scrollbar.waitFor();
  const box = await scrollbar.boundingBox();
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height / 2);
  await page.waitForFunction(() => Number(document.querySelector('[role="scrollbar"]').getAttribute("aria-valuenow")) > 50);
  assert.equal(await page.locator("table").evaluate((table) => table.parentElement.scrollLeft > 0), true);
});

test("Scroll: desmontar antes del RAF cancela desplazamiento pendiente", async (context) => {
  const page = await openPage(context);
  await paginationButton(page).click();
  await paginationButton(page, true).evaluate((button) => { button.click(); queueMicrotask(() => window.adminProjectsHarness.unmount()); });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const trace = await page.evaluate(() => window.adminProjectsHarness.traceSummary());
  assert.equal(trace.some((event) => event.type === "cancel-frame"), true);
  assert.equal(trace.some((event) => event.type === "scroll-end"), false);
});

for (const width of [375, 768, 1024, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`Presentación: ${width}px ${theme}, markup, estilos y geometría`, async (context) => {
      const page = await openPage(context, {}, { theme, viewport: { width, height: 900 } });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter((animation) => animation.effect.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))); });
      const snapshot = await page.locator(".admin-active-projects").evaluate((section) => ({
        html: section.outerHTML.replace(/_r_[\da-z]+_/g, "_react_id_"),
        elements: [...section.querySelectorAll("h2, table, th, td, input, button, footer")].map((element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return { text: element.textContent, font: style.font, color: style.color, background: style.backgroundColor,
            display: style.display, padding: style.padding, border: style.border, radius: style.borderRadius,
            box: [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 100) / 100) };
        }),
      }));
      assert.equal(await page.locator("tbody tr").count(), 5);
      const sectionBox = await page.locator(".admin-active-projects").boundingBox();
      const tableBox = await page.locator("table").boundingBox();
      assert.ok(sectionBox.width <= width, "La sección debe caber en el viewport");
      assert.ok(tableBox.width >= 1093, "La tabla conserva su ancho mínimo");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "El overflow permanece dentro de la tabla");
      assert.equal(await page.getByRole("scrollbar").count(), width === 1440 ? 0 : 1);
      const directory = process.env.ARCA_ADMIN_PROJECTS_BASELINE_DIR;
      if (!directory) return;
      const filename = join(directory, `${width}-${theme}.json`);
      if (process.env.ARCA_ADMIN_PROJECTS_RECORD_BASELINE === "1") {
        await mkdir(directory, { recursive: true });
        await writeFile(filename, JSON.stringify(snapshot, null, 2));
      } else assert.deepEqual(snapshot, JSON.parse(await readFile(filename, "utf8")), "Debe conservar markup, estilos y geometría de la línea base");
    });
  }
}
