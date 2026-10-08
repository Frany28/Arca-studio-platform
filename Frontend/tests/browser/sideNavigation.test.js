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
    const drawer = page.getByRole("dialog", { name: "Menú de navegación", exact: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await menu.focus();
      await menu.press("Enter");
      await drawer.waitFor({ state: "visible" });
      assert.equal(await menu.getAttribute("aria-expanded"), "true");
      // El drawer de Figma no incluye el toggle del riel; se cierra con su botón accesible.
      assert.equal(await drawer.getByRole("button", { name: TOGGLE_NAME }).count(), 0);
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await drawer.waitFor({ state: "detached" });
      assert.equal(await menu.evaluate((element) => element === document.activeElement), true);
      assert.equal(await menu.getAttribute("aria-expanded"), "false");
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

/**
 * Monta la sidebar real sin un layout que imponga estado, para comprobar su contrato público.
 * Usa el mismo aislamiento HTTP de las pruebas de páginas y conserva proveedores reales.
 *
 * @param {import("node:test").TestContext} context Prueba propietaria de la página.
 * @param {Object} [options] Opciones de viewport, tema o interacción táctil.
 * @returns {Promise<import("playwright").Page>} Página con la sidebar inicialmente expandida.
 */
async function openComponent(context, options = {}) {
  const page = await openPage(context, "client", options);
  await page.goto(`${origin}/tests/browser/fixtures/side-navigation.html`);
  await expectSidebar(page, true, 312);
  return page;
}

/**
 * Comprueba la selección por su resultado visual, sin depender de estados internos de React.
 * Retira hover y foco para distinguir selección persistente de énfasis temporal.
 *
 * @param {import("playwright").Page} page Página con la navegación montada.
 * @param {string} label Nombre accesible del destino.
 * @param {boolean} selected Si el destino debe conservar el fondo seleccionado.
 * @returns {Promise<void>} Finaliza cuando el resultado visual coincide.
 */
async function expectSelected(page, label, selected) {
  await page.mouse.move(800, 800);
  const item = page.getByRole("navigation", { name: "Secciones", exact: true }).getByRole("button", { name: label, exact: true });
  await item.evaluate((element) => element.blur());
  await page.waitForFunction(({ label, selected }) => {
    const item = [...document.querySelectorAll('nav[aria-label="Secciones"] button')].find((element) => element.getAttribute("aria-label") === label);
    const expected = getComputedStyle(document.documentElement).getPropertyValue("--color-neutral-200").trim();
    const probe = document.createElement("span");
    probe.style.backgroundColor = expected;
    document.body.append(probe);
    const selectedColor = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return (getComputedStyle(item).backgroundColor === selectedColor) === selected;
  }, { label, selected });
}

test("Componente: estado no controlado, callbacks y selección en ambos menús", async (context) => {
  const page = await openComponent(context);
  await expectSelected(page, "Dashboard", true);
  await page.getByRole("button", { name: "Solicitudes", exact: true }).click();
  await expectSelected(page, "Solicitudes", true);
  await expectSelected(page, "Dashboard", false);
  await page.getByRole("button", { name: "Contraer navegación lateral", exact: true }).click();
  await expectSidebar(page, false, 76);
  await page.getByRole("button", { name: "Configuraciones", exact: true }).click();
  await expectSelected(page, "Configuraciones", true);
  await page.getByRole("button", { name: "Expandir navegación lateral", exact: true }).click();
  await expectSidebar(page, true, 312);
  await expectSelected(page, "Configuraciones", true);
  const events = await page.evaluate(() => window.sideNavigationHarness.events);
  assert.deepEqual(events.filter(({ type }) => type === "expanded" || type === "collapse"), [
    { type: "expanded", value: false }, { type: "collapse", value: false },
    { type: "expanded", value: true }, { type: "collapse", value: true },
  ]);
  assert.deepEqual(events.filter(({ type }) => type === "select").map(({ value }) => value), [
    { id: "requests", label: "Solicitudes", icon: "requests" },
    { id: "settings", label: "Configuraciones", icon: "settings" },
  ]);
});

test("Componente: estado controlado cambia solo al recibir nuevas props del padre", async (context) => {
  const page = await openComponent(context);
  await page.evaluate(() => window.sideNavigationHarness.setProps({ expanded: true, activeItemId: "dashboard" }));
  await page.getByRole("button", { name: "Contraer navegación lateral", exact: true }).click();
  await expectSidebar(page, true, 312);
  await page.getByRole("button", { name: "Solicitudes", exact: true }).click();
  await expectSelected(page, "Dashboard", true);
  await expectSelected(page, "Solicitudes", false);
  await page.evaluate(() => window.sideNavigationHarness.setProps({ expanded: false, activeItemId: "requests" }));
  await expectSidebar(page, false, 76);
  await expectSelected(page, "Solicitudes", true);
  await page.getByRole("button", { name: "Expandir navegación lateral", exact: true }).click();
  await page.getByRole("button", { name: "Configuraciones", exact: true }).click();
  await expectSidebar(page, false, 76);
  await expectSelected(page, "Solicitudes", true);
  await page.evaluate(() => window.sideNavigationHarness.setProps({ expanded: true, activeItemId: "settings" }));
  await expectSidebar(page, true, 312);
  await expectSelected(page, "Configuraciones", true);
  const events = await page.evaluate(() => window.sideNavigationHarness.events);
  assert.deepEqual(events.filter(({ type }) => type === "expanded" || type === "collapse").map(({ value }) => value), [false, false, true, true]);
  assert.deepEqual(events.filter(({ type }) => type === "select").map(({ value }) => value.id), ["requests", "settings"]);
});

test("Componente: búsqueda, estado vacío y filtro persistente al alternar expansión", async (context) => {
  const page = await openComponent(context);
  const search = page.getByRole("searchbox", { name: "Buscar navegación", exact: true });
  const navigation = page.getByRole("navigation", { name: "Secciones", exact: true });
  await search.fill("  SOLIC  ");
  assert.deepEqual(await navigation.getByRole("button").allTextContents(), ["Solicitudes"]);
  await search.fill("sin-coincidencias");
  await navigation.getByText("No hay coincidencias.", { exact: true }).waitFor();
  assert.equal(await navigation.getByRole("button").count(), 0);
  await search.fill("config");
  await page.getByRole("button", { name: "Contraer navegación lateral", exact: true }).click();
  await expectSidebar(page, false, 76);
  assert.equal(await navigation.getByRole("button").count(), 1);
  await navigation.getByRole("button", { name: "Configuraciones", exact: true }).hover();
  await page.getByRole("tooltip").getByText("Configuraciones", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Expandir navegación lateral", exact: true }).click();
  await expectSidebar(page, true, 312);
  assert.equal(await search.inputValue(), "config");
  await search.fill("");
  assert.equal(await navigation.getByRole("button").count(), 4);
  const values = await page.evaluate(() => window.sideNavigationHarness.events.filter(({ type }) => type === "search").map(({ value }) => value));
  assert.deepEqual(values, ["  SOLIC  ", "sin-coincidencias", "config", ""]);
});

test("Componente: footer, oportunidad, foco de puntero y valores iniciales conservados", async (context) => {
  const page = await openComponent(context);
  await page.getByText("Persona de prueba", { exact: true }).waitFor();
  await page.getByText("sidebar@example.test", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await page.getByRole("button", { name: "Nueva oportunidad", exact: true }).click();
  await page.getByRole("button", { name: "Contraer navegación lateral", exact: true }).click();
  await expectSidebar(page, false, 76);
  assert.equal(await page.getByRole("button", { name: "Cerrar sesión", exact: true }).count(), 0);
  assert.equal(await page.getByText("Persona de prueba", { exact: true }).count(), 0);
  const destination = page.getByRole("button", { name: "Otro destino", exact: true });
  await destination.click();
  assert.equal(await destination.evaluate((element) => element === document.activeElement), false);
  await page.getByRole("button", { name: "Nueva oportunidad", exact: true }).click();
  await page.evaluate(() => window.sideNavigationHarness.setProps({ defaultExpanded: true, defaultActiveItemId: "dashboard" }));
  await expectSidebar(page, false, 76);
  await expectSelected(page, "Otro destino", true);
  const events = await page.evaluate(() => window.sideNavigationHarness.events);
  assert.equal(events.filter(({ type }) => type === "logout").length, 1);
  assert.equal(events.filter(({ type }) => type === "new-opportunity").length, 2);
});

test("Componente: abandonar props controladas recupera selección y expansión internas", async (context) => {
  const page = await openComponent(context);
  await page.getByRole("button", { name: "Solicitudes", exact: true }).click();
  await page.getByRole("button", { name: "Contraer navegación lateral", exact: true }).click();
  await expectSidebar(page, false, 76);
  await page.evaluate(() => window.sideNavigationHarness.setProps({ expanded: true, activeItemId: "settings" }));
  await expectSidebar(page, true, 312);
  await expectSelected(page, "Configuraciones", true);
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Contraer navegación lateral", exact: true }).click();
  await expectSidebar(page, true, 312);
  await expectSelected(page, "Configuraciones", true);
  // Una cadena vacía y un valor no booleano dejan de controlar las props según el contrato original.
  await page.evaluate(() => window.sideNavigationHarness.setProps({ expanded: null, activeItemId: "" }));
  await expectSidebar(page, false, 76);
  await expectSelected(page, "Solicitudes", true);
  const events = await page.evaluate(() => window.sideNavigationHarness.events);
  assert.deepEqual(events.filter(({ type }) => type === "select").map(({ value }) => value.id), ["requests", "dashboard"]);
  assert.deepEqual(events.filter(({ type }) => type === "expanded" || type === "collapse"), [
    { type: "expanded", value: false }, { type: "collapse", value: false },
    { type: "expanded", value: false }, { type: "collapse", value: false },
  ]);
});

test("Componente: touch limpia foco en logout y menú colapsado", async (context) => {
  const page = await openComponent(context, { hasTouch: true });
  const logout = page.getByRole("button", { name: "Cerrar sesión", exact: true });
  await logout.tap();
  assert.equal(await logout.evaluate((element) => element === document.activeElement), false);
  await page.getByRole("button", { name: "Contraer navegación lateral", exact: true }).tap();
  await expectSidebar(page, false, 76);
  const destination = page.getByRole("button", { name: "Otro destino", exact: true });
  await destination.tap();
  assert.equal(await destination.evaluate((element) => element === document.activeElement), false);
  await expectSelected(page, "Otro destino", true);
  const events = await page.evaluate(() => window.sideNavigationHarness.events);
  assert.equal(events.filter(({ type }) => type === "logout").length, 1);
  assert.deepEqual(events.filter(({ type }) => type === "select").map(({ value }) => value.id), ["unknown"]);
});

test("Componente: teclado conserva foco y tooltip del menú colapsado", async (context) => {
  const page = await openComponent(context);
  const toggle = page.getByRole("button", { name: TOGGLE_NAME });
  await toggle.focus();
  await toggle.press("Enter");
  await expectSidebar(page, false, 76);
  await page.getByRole("button", { name: "Otro destino", exact: true }).focus();
  // Tab activa la modalidad real de teclado que Tooltip comprueba mediante :focus-visible.
  await page.keyboard.press("Shift+Tab");
  const settings = page.getByRole("button", { name: "Configuraciones", exact: true });
  assert.equal(await settings.evaluate((element) => element === document.activeElement), true);
  await page.getByRole("tooltip").getByText("Configuraciones", { exact: true }).waitFor();
  await settings.press("Enter");
  assert.equal(await settings.evaluate((element) => element === document.activeElement), true);
  await toggle.focus();
  await toggle.press("Space");
  await expectSidebar(page, true, 312);
  assert.equal(await toggle.evaluate((element) => element === document.activeElement), true);
  await expectSelected(page, "Configuraciones", true);
  const events = await page.evaluate(() => window.sideNavigationHarness.events);
  assert.deepEqual(events.filter(({ type }) => type === "select").map(({ value }) => value.id), ["settings"]);
});

const MOBILE_DRAWER_NAME = "Menú de navegación";
const MOBILE_CASES = [
  { path: "/dashboard-arquitecto", role: "admin", item: "Archivos", destination: "/archivos" },
  { path: "/dashboard-arquitecto", role: "architect", item: "Ver más proyectos", destination: "/proyectos" },
  { path: "/usuarios", role: "admin", item: "Archivos", destination: "/archivos" },
  { path: "/archivos", role: "admin", item: "Usuarios", destination: "/usuarios" },
  { path: "/configuraciones", role: "admin", item: "Usuarios", destination: "/usuarios" },
  { path: "/proyectos", role: "admin", item: "Usuarios", destination: "/usuarios" },
  { path: "/dashboard-clientes", role: "client", item: "Ver más proyectos", destination: "/proyectos" },
  { path: "/solicitudes", role: "client", item: "Dashboard", destination: "/dashboard-clientes" },
  { path: "/proyectos", role: "client", item: "Dashboard", destination: "/dashboard-clientes" },
  { path: "/dashboard-arquitecto/nuevo-proyecto", role: "architect", item: "Ver más proyectos", destination: "/proyectos" },
];

/**
 * Comprueba que la página no desborde horizontalmente y que el riel persistente no ocupe
 * espacio en móvil, condición que antes empujaba el contenido al expandirse.
 *
 * @param {import("playwright").Page} page Página en prueba.
 * @returns {Promise<void>} Finaliza cuando ambas condiciones se cumplen.
 */
async function expectMobileLayout(page) {
  // Espera el viewport móvil antes de evaluar, para no medir el layout previo al resize.
  await page.waitForFunction((selector) => window.innerWidth < 768
    && document.documentElement.scrollWidth <= window.innerWidth
    && [...document.querySelectorAll(selector)]
      .filter((element) => !element.closest("[role=dialog]"))
      .every((element) => element.getClientRects().length === 0), SIDEBAR_SELECTOR);
}

/**
 * Abre el drawer con el botón del navbar y espera a que termine la transición de entrada.
 *
 * @param {import("playwright").Page} page Página en prueba.
 * @param {number} width Ancho final esperado del panel.
 * @returns {Promise<import("playwright").Locator>} Diálogo abierto.
 */
async function openMobileDrawer(page, width) {
  const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
  await menu.focus();
  await menu.press("Enter");
  const drawer = page.getByRole("dialog", { name: MOBILE_DRAWER_NAME, exact: true });
  await drawer.waitFor({ state: "visible" });
  await page.waitForFunction(({ name, width }) => {
    const panel = document.querySelector(`[role="dialog"][aria-label="${name}"]`);
    const rect = panel?.getBoundingClientRect();
    return rect && Math.abs(rect.left) < 0.5 && Math.abs(rect.width - width) < 0.5
      && getComputedStyle(panel).opacity === "1";
  }, { name: MOBILE_DRAWER_NAME, width });
  return drawer;
}

/**
 * Espera el cierre completo del drawer y comprueba foco devuelto y scroll desbloqueado.
 *
 * @param {import("playwright").Page} page Página en prueba.
 * @returns {Promise<void>} Finaliza cuando el diálogo ya no existe.
 */
async function expectMobileDrawerClosed(page) {
  // Consulta el DOM: getByRole ignora un panel oculto por CSS que aún no terminó su salida.
  await page.waitForFunction((name) => !document.querySelector(`[role="dialog"][aria-label="${name}"]`), MOBILE_DRAWER_NAME);
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
  if (await menu.isVisible()) {
    assert.equal(await menu.evaluate((element) => element === document.activeElement), true);
  }
}

for (const mobileCase of MOBILE_CASES) {
  test(`${mobileCase.role} ${mobileCase.path} móvil: drawer de Figma abre, cierra y navega`, async (context) => {
    const page = await openPage(context, mobileCase.role, { hasTouch: true, viewport: { width: 375, height: 812 } });
    await page.goto(`${origin}${mobileCase.path}`);
    await page.getByRole("button", { name: "Abrir menú", exact: true }).waitFor();
    await expectMobileLayout(page);

    let drawer = await openMobileDrawer(page, 312);
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    assert.equal(await drawer.getByRole("button", { name: TOGGLE_NAME }).count(), 0, "El drawer de Figma no incluye el toggle del riel");
    assert.equal(await drawer.getByRole("searchbox", { name: "Buscar navegación", exact: true }).count(), 1);
    await page.keyboard.press("Escape");
    await expectMobileDrawerClosed(page);
    await expectMobileLayout(page);

    drawer = await openMobileDrawer(page, 312);
    await page.mouse.click(360, 400);
    await expectMobileDrawerClosed(page);

    drawer = await openMobileDrawer(page, 312);
    const close = drawer.getByRole("button", { name: "Cerrar menú de navegación", exact: true });
    await page.keyboard.press("Tab");
    assert.equal(await close.evaluate((element) => element === document.activeElement), true);
    await page.waitForFunction(() => getComputedStyle(document.activeElement).opacity === "1");
    await page.keyboard.press("Shift+Tab");
    const logout = drawer.getByRole("button", { name: "Cerrar sesión", exact: true });
    assert.equal(await logout.evaluate((element) => element === document.activeElement), true, "Shift+Tab permanece dentro del drawer");
    await page.keyboard.press("Tab");
    assert.equal(await close.evaluate((element) => element === document.activeElement), true, "Tab vuelve al inicio del drawer");
    await close.press("Enter");
    await expectMobileDrawerClosed(page);

    drawer = await openMobileDrawer(page, 312);
    await drawer.getByRole("button", { name: mobileCase.item, exact: true }).tap();
    await page.waitForURL(`${origin}${mobileCase.destination}`);
    await page.getByRole("dialog", { name: MOBILE_DRAWER_NAME, exact: true }).waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  });
}

test("Drawer móvil: anchos de prueba conservan overlay visible y sin desplazamiento horizontal", async (context) => {
  const page = await openPage(context, "admin", { hasTouch: true, viewport: { width: 320, height: 640 } });
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto(`${origin}/dashboard-arquitecto`);
    await page.getByRole("button", { name: "Abrir menú", exact: true }).waitFor();
    await expectMobileLayout(page);
    const drawer = await openMobileDrawer(page, Math.min(312, width - 32));
    await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth);
    const opportunity = drawer.getByRole("button", { name: "Nuevo proyecto", exact: true });
    assert.equal(Math.round((await opportunity.boundingBox()).height), 52);
    await page.mouse.click(width - 8, 400);
    await expectMobileDrawerClosed(page);
  }
});

test("Drawer móvil: crecer a tablet o escritorio lo cierra sin alterar el riel persistente", async (context) => {
  const page = await openPage(context, "admin", { viewport: { width: 900, height: 1000 } });
  await page.goto(`${origin}/usuarios`);
  // Bajo 1280 px el riel inicia contraído; se expande manualmente para detectar cualquier reinicio.
  await expectSidebar(page, false, 76);
  await page.locator(`${SIDEBAR_SELECTOR}:visible`).getByRole("button", { name: TOGGLE_NAME }).click();
  await expectSidebar(page, true, 312);
  await page.setViewportSize({ width: 375, height: 812 });
  await expectMobileLayout(page);
  await openMobileDrawer(page, 312);

  await page.setViewportSize({ width: 900, height: 1000 });
  await expectMobileDrawerClosed(page);
  await expectSidebar(page, true, 312);
  assert.equal(await page.locator(`${SIDEBAR_SELECTOR}:visible`).count(), 1, "En tablet solo existe un menú");
  assert.equal(await page.getByRole("button", { name: "Abrir menú", exact: true }).isVisible(), false);

  await page.setViewportSize({ width: 375, height: 812 });
  await expectMobileLayout(page);
  assert.equal(await page.getByRole("dialog", { name: MOBILE_DRAWER_NAME, exact: true }).count(), 0, "No reaparece un drawer abierto");
  await openMobileDrawer(page, 312);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expectMobileDrawerClosed(page);
  // Cruzar 1280 px aplica la política existente del riel: expandido en escritorio.
  await expectSidebar(page, true, 312);
});
