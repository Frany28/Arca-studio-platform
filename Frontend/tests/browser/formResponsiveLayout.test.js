import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

const VIEWPORT_WIDTHS = [320, 375, 430, 768, 1024, 1279, 1280, 1440];
const SIDEBAR_SELECTOR = 'aside[aria-label="Navegación lateral"]';
const TOGGLE_NAME = /^(Contraer|Expandir) navegación lateral$/;
const SETTINGS_TABS = ["Perfil", "Seguridad", "Preferencias", "Soporte"];
const READ_FIXTURES = {
  "/api/projects": { projects: [], nextCursor: null },
  "/api/project-requests": { projectRequests: [], nextCursor: null },
  "/api/environment-comments": { comments: [], nextCursor: null },
};
let server;
let browser;
let origin;

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
 * Abre el formulario real con sesión y lecturas HTTP aisladas.
 * Cualquier mutación o petición no prevista falla: las pruebas de layout no usan infraestructura.
 *
 * @param {import("node:test").TestContext} context Prueba propietaria de la sesión.
 * @param {string} path Ruta del formulario.
 * @param {Object} [options] Tema, rol, mutaciones permitidas y opciones de accesibilidad.
 * @param {Object<string, {status?: number, json: Object}>} [options.mutations] Respuestas de las
 * únicas mutaciones permitidas, por «MÉTODO /api/ruta»; se registran en `page.mutations`.
 * @returns {Promise<import("playwright").Page>} Página lista para interactuar y medir.
 */
async function openForm(context, path, { theme = "light", role: requestedRole, mutations = {}, ...options } = {}) {
  const role = requestedRole || (path === "/configuraciones" ? "admin" : "architect");
  const sentMutations = [];
  const session = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  const page = applyBrowserTimeouts(await session.newPage());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((theme) => {
    localStorage.setItem("arca-theme", theme);
  }, theme);
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const requestPath = new URL(request.url()).pathname;
    const payload = requestPath === "/api/auth/me"
      ? { user: { id: 1, firstName: "Sidebar", lastName: "Test", email: "sidebar@example.test", role, status: "active" } }
      : READ_FIXTURES[requestPath];
    const mutation = mutations[`${request.method()} ${requestPath}`];
    if (mutation) {
      sentMutations.push({ body: request.postDataJSON?.() ?? null, path: requestPath });
      await route.fulfill({ status: mutation.status || 200, json: mutation.json });
      return;
    }
    if (request.method() !== "GET" || !payload) {
      errors.push(`HTTP inesperado: ${request.method()} ${requestPath}`);
      await route.fulfill({ status: 404, json: { code: "TEST_ROUTE_MISSING", message: "Fixture no definida" } });
      return;
    }
    await route.fulfill({ json: payload });
  });
  context.after(async () => {
    await session.close();
    assert.deepEqual(errors, [], "Sin errores ni cambios del contrato HTTP");
  });
  await page.goto(`${origin}${path}`);
  // La ruta lazy puede seguir compilándose tras el evento load: esta espera pertenece
  // a la navegación inicial. Las interacciones posteriores conservan su límite de 5000 ms.
  await page.locator(`${SIDEBAR_SELECTOR}:visible`).getByRole("button", { name: TOGGLE_NAME })
    .waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), theme === "dark");
  await page.evaluate(() => document.fonts.ready);
  page.mutations = sentMutations;
  return page;
}

/**
 * Espera el ancho final del riel sin desactivar su transición.
 * En móvil comprueba que desaparece; en tablet/escritorio conserva la elección manual.
 *
 * @param {import("playwright").Page} page Página que se redimensiona.
 * @param {number} width Viewport actual.
 * @param {boolean} expanded Estado deseado desde 768 px.
 * @returns {Promise<void>} Geometría estable antes de medir el contenido.
 */
async function setRailState(page, width, expanded) {
  if (width < 768) {
    await page.waitForFunction((selector) => [...document.querySelectorAll(selector)]
      .every((element) => element.getClientRects().length === 0), SIDEBAR_SELECTOR);
    return;
  }
  const toggle = page.locator(`${SIDEBAR_SELECTOR}:visible`).getByRole("button", { name: TOGGLE_NAME });
  if (await toggle.getAttribute("aria-expanded") !== String(expanded)) await toggle.click();
  const expectedWidth = expanded ? (width >= 1024 ? 312 : 234) : 76;
  await page.waitForFunction(({ selector, expanded, expectedWidth }) => {
    const rail = [...document.querySelectorAll(selector)].find((element) => element.getClientRects().length);
    return rail?.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded") === String(expanded)
      && Math.abs(rail.getBoundingClientRect().width - expectedWidth) < 0.5;
  }, { selector: SIDEBAR_SELECTOR, expanded, expectedWidth });
}

/**
 * Detecta desborde real del shell y del panel, incluso si un ancestro lo recortara.
 * Los controles deben caber en el panel; no se considera desborde el scroll nativo del texto de un input.
 *
 * @param {import("playwright").Page} page Formulario renderizado.
 * @returns {Promise<Object>} Desbordes y controles que exceden sus límites.
 */
function measureFormOverflow(page) {
  return page.evaluate(() => {
    const content = document.querySelector("main > div > .overflow-y-auto");
    const panel = content.querySelector(".settings-panel, form");
    const bounds = panel.getBoundingClientRect();
    return {
      document: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      content: Math.max(0, content.scrollWidth - content.clientWidth),
      panel: Math.max(0, panel.scrollWidth - panel.clientWidth),
      outsideControls: [...panel.querySelectorAll("input, textarea, button")]
        .filter((element) => element.getClientRects().length && getComputedStyle(element).position !== "absolute")
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5;
        })
        .map((element) => element.getAttribute("aria-label") || element.labels?.[0]?.textContent?.trim() || element.textContent?.trim()),
    };
  });
}

/**
 * Recorre los anchos aprobados con los dos estados del riel donde existe.
 * Se conserva la misma página para detectar pérdida de estado durante resize o cambio del sidebar.
 *
 * @param {import("playwright").Page} page Formulario con contenido listo.
 * @param {string} description Identifica el panel en los fallos.
 * @returns {Promise<void>} Finaliza con todos los controles dentro del layout.
 */
async function checkResponsiveMatrix(page, description) {
  for (const width of VIEWPORT_WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    for (const expanded of width < 768 ? [false] : [false, true]) {
      await setRailState(page, width, expanded);
      assert.deepEqual(await measureFormOverflow(page), {
        document: 0, content: 0, panel: 0, outsideControls: [],
      }, `${description}, ${width} px, ${width < 768 ? "móvil" : expanded ? "expandido" : "contraído"}`);
    }
  }
}

for (const theme of ["light", "dark"]) {
  for (const tab of SETTINGS_TABS) {
    test(`Configuración ${tab} (${theme}): sin desborde con todos los anchos y estados del riel`, async (context) => {
      const page = await openForm(context, "/configuraciones", { theme });
      const selectedTab = page.getByRole("tab", { name: tab, exact: true });
      await selectedTab.click();
      assert.equal(await selectedTab.getAttribute("aria-selected"), "true");
      if (tab === "Perfil") await page.getByRole("textbox", { name: "Nombre", exact: true }).fill("Nombre conservado al redimensionar");
      if (tab === "Seguridad") await page.getByLabel("Nueva contraseña", { exact: true }).fill("Borrador2026*");
      await checkResponsiveMatrix(page, `${tab} ${theme}`);
      if (tab === "Perfil") {
        assert.equal(await page.getByRole("textbox", { name: "Nombre", exact: true }).inputValue(), "Nombre conservado al redimensionar");
        // Perfil conserva sus dos teléfonos bloqueados: cambiar la geometría no los habilita.
        const prefixes = page.getByRole("combobox");
        assert.equal(await prefixes.count(), 2);
        for (const prefix of await prefixes.all()) assert.equal(await prefix.isDisabled(), true);
        assert.equal(await page.getByRole("listbox", { name: "Países y códigos telefónicos" }).count(), 0);
      }
      if (tab === "Seguridad") assert.equal(await page.getByLabel("Nueva contraseña", { exact: true }).inputValue(), "Borrador2026*");
      if (tab === "Preferencias" || tab === "Soporte") {
        await page.setViewportSize({ width: 320, height: 1000 });
        const trigger = page.getByRole("button", { name: tab === "Preferencias" ? "Seleccionar tema" : "Seleccionar tipo de problema", exact: true });
        await trigger.click();
        await page.getByRole(tab === "Preferencias" ? "menuitem" : "menuitemcheckbox", { name: tab === "Preferencias" ? "Sistema" : "Otro", exact: true }).waitFor();
        assert.deepEqual(await measureFormOverflow(page), { document: 0, content: 0, panel: 0, outsideControls: [] });
        await page.keyboard.press("Escape");
      }
    });
  }
  test(`Nuevo proyecto (${theme}): sin desborde y con borrador intacto al cambiar anchos y riel`, async (context) => {
    const page = await openForm(context, "/dashboard-arquitecto/nuevo-proyecto", { theme });
    const name = page.getByRole("textbox", { name: "Nombre del proyecto" });
    await name.fill("Proyecto responsive conservado");
    await page.getByRole("button", { name: "Seleccionar tipo de proyecto", exact: true }).click();
    await page.getByRole("menuitem", { name: "Residencial", exact: true }).click();
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.getByRole("button", { name: "Seleccionar tipo de proyecto", exact: true }).click();
    await page.getByRole("menuitem", { name: "Comercial", exact: true }).waitFor();
    assert.deepEqual(await measureFormOverflow(page), { document: 0, content: 0, panel: 0, outsideControls: [] });
    await page.keyboard.press("Escape");
    await checkResponsiveMatrix(page, `Nuevo proyecto ${theme}`);
    assert.equal(await name.inputValue(), "Proyecto responsive conservado");
    assert.equal(await page.getByRole("button", { name: "Seleccionar tipo de proyecto", exact: true }).textContent(), "Residencial");
    await page.locator(`${SIDEBAR_SELECTOR}:visible`).getByRole("button", { name: "Ver más proyectos", exact: true }).click();
    await page.waitForURL(`${origin}/proyectos`);
  });
}

test("Escritorio 1440 px: ambos formularios conservan la geometría anterior de sus controles", async (context) => {
  for (const [path, controls] of [
    ["/configuraciones", [["Nombre", 690, 268], ["Empresa", 1034, 268], ["Correo electrónico", 690, 268]]],
    ["/dashboard-arquitecto/nuevo-proyecto", [["Nombre del proyecto", 750, 292], ["Área general", 750, 292], ["Área de construcción", 1086, 292], ["Ubicación del proyecto", 750, 628]]],
  ]) {
    const page = await openForm(context, path);
    await setRailState(page, 1440, true);
    for (const [name, x, width] of controls) {
      const box = await page.getByRole("textbox", { name }).boundingBox();
      assert.ok(Math.abs(box.x - x) < 0.5 && Math.abs(box.width - width) < 0.5, `${path}: geometría de ${name}: ${JSON.stringify(box)}`);
    }
  }
});

test("Configuración sigue las variantes de Figma: pestañas horizontales en móvil y menú lateral desde tablet", async (context) => {
  const page = await openForm(context, "/configuraciones");
  const measure = () => page.evaluate(() => {
    const tablist = document.querySelector("[role='tablist']").getBoundingClientRect();
    const panel = document.querySelector(".settings-panel").getBoundingClientRect();
    const row = document.querySelector(".settings-form-row").getBoundingClientRect();
    return {
      orientation: document.querySelector("[role='tablist']").getAttribute("aria-orientation"),
      panel: { left: Math.round(panel.left), top: Math.round(panel.top), width: Math.round(panel.width) },
      row: { left: Math.round(row.left), width: Math.round(row.width) },
      tablist: { bottom: Math.round(tablist.bottom), top: Math.round(tablist.top), width: Math.round(tablist.width) },
    };
  });

  // Móvil 375 (Figma 3727:688309…3727:688270): pestañas a todo el ancho, 48 px sobre el contenido.
  await page.setViewportSize({ width: 375, height: 812 });
  await setRailState(page, 375, false);
  const mobile = await measure();
  assert.equal(mobile.orientation, "horizontal");
  assert.equal(mobile.tablist.width, 343);
  assert.equal(mobile.panel.top - mobile.tablist.bottom, 48);
  assert.equal(mobile.row.width, 343, "los campos aprovechan todo el ancho");

  // Tablet 1024 con riel contraído (Figma 3727:688302): menú de 160 px, panel de 644 px junto a él
  // y formulario de 596 px (dos campos de 286 px) con 24 px de margen.
  await page.setViewportSize({ width: 1024, height: 1366 });
  await setRailState(page, 1024, false);
  const tablet = await measure();
  assert.equal(tablet.orientation, "vertical");
  assert.equal(tablet.panel.width, 644);
  assert.equal(tablet.panel.top, Math.round((await page.getByRole("tablist").boundingBox()).y), "menú y panel en la misma fila");
  assert.deepEqual(tablet.row, { left: tablet.panel.left + 24, width: 596 });
  const nameBox = await page.getByRole("textbox", { name: "Nombre", exact: true }).locator("xpath=ancestor::*[contains(@class,'settings-form-field')][1]").boundingBox();
  assert.equal(Math.round(nameBox.width), 286);
});

for (const role of ["admin", "architect", "client"]) {
  test(`Configuración móvil (${role}): pestañas, contraseña, avatar y soporte funcionan y conservan su estado`, async (context) => {
    const page = await openForm(context, "/configuraciones", {
      mutations: { "POST /api/auth/change-password": { json: { ok: true } } },
      role,
      theme: role === "architect" ? "dark" : "light",
    });
    // El borrador de Seguridad sobrevive al cambio de orientación del menú (escritorio → móvil).
    await page.getByRole("tab", { name: "Seguridad", exact: true }).click();
    await page.getByLabel("Contraseña actual", { exact: true }).fill("Actual2025*");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector("[role='tablist']")?.getAttribute("aria-orientation") === "horizontal");
    assert.equal(await page.getByRole("tab", { name: "Seguridad", exact: true }).getAttribute("aria-selected"), "true");
    assert.equal(await page.getByLabel("Contraseña actual", { exact: true }).inputValue(), "Actual2025*");
    assert.deepEqual(await page.getByRole("tab").allInnerTexts(), SETTINGS_TABS, "los tres roles conservan sus cuatro pestañas");

    // Cambiar contraseña envía la petición real y limpia el formulario.
    await page.getByLabel("Nueva contraseña", { exact: true }).fill("Nueva2026*");
    await page.getByLabel("Confirmar contraseña", { exact: true }).fill("Nueva2026*");
    await page.getByRole("button", { name: "Cambiar contraseña", exact: true }).click();
    await page.getByText("Contraseña restablecida").waitFor();
    assert.deepEqual(page.mutations, [{ body: { currentPassword: "Actual2025*", newPassword: "Nueva2026*" }, path: "/api/auth/change-password" }]);
    assert.equal(await page.getByLabel("Contraseña actual", { exact: true }).inputValue(), "");

    // El modal de avatar cabe en el viewport y se cierra con Escape.
    await page.getByRole("tab", { name: "Perfil", exact: true }).click();
    await page.getByRole("button", { name: "Subir imagen", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page.waitForTimeout(400);
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, `el modal cabe a lo ancho: ${JSON.stringify(box)}`);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });

    // Soporte: la pestaña se alcanza desplazando el menú y conserva el envío existente.
    const support = page.getByRole("tab", { name: "Soporte", exact: true });
    await support.click();
    assert.equal(await support.getAttribute("aria-selected"), "true");
    await page.getByRole("heading", { name: "Contactar Soporte" }).waitFor();
    assert.deepEqual(await measureFormOverflow(page), { document: 0, content: 0, panel: 0, outsideControls: [] });
  });
}

test("Configuración: teclado, validación y movimiento reducido conservan el layout móvil", async (context) => {
  const page = await openForm(context, "/configuraciones", { reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 1000 });
  const profile = page.getByRole("tab", { name: "Perfil", exact: true });
  // En móvil las pestañas son horizontales (Figma 3727:688316): las flechas laterales las recorren.
  // ResizeObserver notifica el nuevo ancho en el siguiente frame.
  await page.waitForFunction(() => document.querySelector("[role='tablist']")?.getAttribute("aria-orientation") === "horizontal");
  await profile.focus();
  await profile.press("ArrowRight");
  const security = page.getByRole("tab", { name: "Seguridad", exact: true });
  assert.equal(await security.getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "Cambiar contraseña", exact: true }).click();
  await page.getByLabel("Contraseña actual", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Contraseña actual", { exact: true }).getAttribute("aria-invalid"), "true");
  assert.deepEqual(await measureFormOverflow(page), { document: 0, content: 0, panel: 0, outsideControls: [] });
});
