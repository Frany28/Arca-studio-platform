import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Entrada "Servicios y cotizaciones" del riel administrativo (Figma 5790:339391): ruta, estado
// activo por ruta y subruta, protección por rol, riel contraído, drawer móvil y teclado.
const LABEL = "Servicios y cotizaciones";
const SIDEBAR_SELECTOR = 'aside[aria-label="Navegación lateral"]';
const TOGGLE_NAME = /^(Contraer|Expandir) navegación lateral$/;
// /api/projects lo solicita el proveedor compartido de proyectos recientes, no la vista nueva.
const API_FIXTURES = {
  "/api/projects": { projects: [], nextCursor: null },
  "/api/admin/dashboard-metrics": { metrics: { files: { total: 0, totalBytes: 0, latestUploadAt: null } } },
  // La raíz del módulo redirige a Unidades, que lee el catálogo (vacío en estas pruebas).
  "/api/admin/services": { services: [], nextCursor: null },
  "/api/admin/measurement-unit-denominations": { unitDenominations: [], nextCursor: null },
};

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
 * Abre la aplicación real con una sesión simulada del rol indicado. La vista provisional no debe
 * pedir datos: cualquier petición distinta de la sesión y de las fixtures se registra como error.
 *
 * @param {import("node:test").TestContext} context Prueba propietaria del navegador.
 * @param {string} role Rol de la sesión simulada.
 * @param {Object} [options] Opciones del contexto (viewport).
 * @param {boolean} [options.allowUnknownApis=false] Tolera APIs de otras vistas (redirecciones).
 * @returns {Promise<import("playwright").Page>} Página con errores vigilados.
 */
async function openPage(context, role, { allowUnknownApis = false, ...options } = {}) {
  const browserContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  const page = applyBrowserTimeouts(await browserContext.newPage());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payload = path === "/api/auth/me"
      ? { user: { id: 1, firstName: "Nav", lastName: "Test", email: "nav@example.test", role, status: "active" } }
      : API_FIXTURES[path];
    if (!payload) {
      if (!allowUnknownApis) errors.push(`Petición no prevista: ${route.request().method()} ${path}`);
      await route.fulfill({ status: 404, json: { code: "TEST_ROUTE_MISSING", message: "Fixture no definida" } });
      return;
    }
    await route.fulfill({ json: payload });
  });
  context.after(async () => {
    await browserContext.close();
    assert.deepEqual(errors, []);
  });
  return page;
}

/**
 * Indica si un destino del menú visible tiene el fondo de selección (--color-neutral-200).
 * Retira el puntero y el foco para no confundir selección con hover o focus.
 *
 * @param {import("playwright").Page} page Página en prueba.
 * @param {string} label Nombre accesible del destino.
 * @returns {Promise<boolean>} Si el destino aparece seleccionado.
 */
async function isSelected(page, label) {
  await page.mouse.move(1200, 900);
  await page.evaluate(() => document.activeElement?.blur());
  return page.evaluate((label) => {
    const sidebar = [...document.querySelectorAll('aside[aria-label="Navegación lateral"]')].find((element) => element.getClientRects().length);
    const item = [...sidebar.querySelectorAll('nav[aria-label="Secciones"] button')].find((element) => element.getAttribute("aria-label") === label);
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--color-neutral-200)";
    document.body.append(probe);
    const selectedColor = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return getComputedStyle(item).backgroundColor === selectedColor;
  }, label);
}

test("admin: la entrada navega sin recarga y queda activa en la ruta y sus subrutas", async (context) => {
  const page = await openPage(context, "admin");
  await page.goto(`${origin}/archivos`);
  const sidebar = page.locator(`${SIDEBAR_SELECTOR}:visible`).first();
  const entry = sidebar.getByRole("button", { name: LABEL, exact: true });
  await entry.waitFor({ timeout: NAVIGATION_TIMEOUT_MS });

  // Orden de Figma: Historial → Servicios y cotizaciones → Configuraciones.
  const labels = await sidebar.locator('nav[aria-label="Secciones"] button').evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));
  assert.deepEqual(labels, ["Dashboard", "Usuarios", "Proyectos", "Archivos", "Historial", LABEL, "Configuraciones"]);
  assert.equal(await isSelected(page, LABEL), false);

  // Un marcador en window sobrevive solo si la navegación es del lado del cliente.
  await page.evaluate(() => { window.__arcaNoReload = true; });
  await entry.click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/unidades`);
  await page.getByRole("heading", { name: LABEL, level: 1 }).waitFor();
  await page.getByText("Aún no hay unidades de medida", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__arcaNoReload), true, "La navegación no debe recargar la página");
  assert.equal(await isSelected(page, LABEL), true);
  assert.equal(await isSelected(page, "Archivos"), false);

  // Las subrutas del módulo conservan el elemento activo y no producen 404 ni páginas vacías.
  await page.goto(`${origin}/servicios-cotizaciones/tabulador`);
  await page.getByText("Tabulador de servicios en desarrollo", { exact: true }).waitFor();
  assert.equal(await isSelected(page, LABEL), true);
});

for (const role of ["client", "architect"]) {
  test(`${role}: no ve la entrada y la ruta lo redirige a su inicio`, async (context) => {
    const page = await openPage(context, role, { allowUnknownApis: true });
    await page.goto(`${origin}/servicios-cotizaciones`);
    const home = role === "client" ? "/dashboard-clientes" : "/dashboard-arquitecto";
    await page.waitForURL(`${origin}${home}`);
    await page.locator(`${SIDEBAR_SELECTOR}:visible`).first().waitFor();
    assert.equal(await page.getByRole("button", { name: LABEL, exact: true }).count(), 0);
    assert.equal(await page.getByRole("heading", { name: LABEL, level: 1 }).count(), 0);
  });
}

test("riel contraído: icono con nombre accesible, tooltip y activación por teclado", async (context) => {
  const page = await openPage(context, "admin");
  await page.goto(`${origin}/archivos`);
  const sidebar = page.locator(`${SIDEBAR_SELECTOR}:visible`).first();
  const toggle = sidebar.getByRole("button", { name: TOGGLE_NAME });
  await toggle.waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
  await page.waitForFunction((selector) => {
    const rail = [...document.querySelectorAll(selector)].find((element) => element.getClientRects().length);
    return Math.abs(rail.getBoundingClientRect().width - 76) < 0.5;
  }, SIDEBAR_SELECTOR);

  const entry = sidebar.getByRole("button", { name: LABEL, exact: true });
  const box = await entry.boundingBox();
  assert.deepEqual([Math.round(box.width), Math.round(box.height)], [44, 44]);
  // El icono es decorativo y de 20 px; el nombre lo aporta el botón.
  const icon = await entry.locator("svg").evaluate((svg) => ({
    hidden: svg.getAttribute("aria-hidden"), width: Math.round(svg.getBoundingClientRect().width),
  }));
  assert.deepEqual(icon, { hidden: "true", width: 20 });

  // Tab desde el destino anterior activa la modalidad de teclado que Tooltip comprueba (:focus-visible).
  await sidebar.getByRole("button", { name: "Historial", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await entry.evaluate((element) => element === document.activeElement), true);
  await page.getByRole("tooltip").getByText(LABEL, { exact: true }).waitFor();
  await page.keyboard.press("Enter");
  await page.waitForURL(`${origin}/servicios-cotizaciones/unidades`);
  await page.getByText("Aún no hay unidades de medida", { exact: true }).waitFor();
  assert.equal(await isSelected(page, LABEL), true);
});

test("móvil: el drawer incluye la entrada y navega; sin desborde horizontal", async (context) => {
  const page = await openPage(context, "admin", { viewport: { width: 375, height: 700 } });
  await page.goto(`${origin}/archivos`);
  await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Menú de navegación", exact: true });
  await drawer.waitFor({ state: "visible" });
  await drawer.getByRole("button", { name: LABEL, exact: true }).click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/unidades`);
  await page.getByText("Aún no hay unidades de medida", { exact: true }).waitFor();
  await drawer.waitFor({ state: "detached" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.equal(overflow, 0);
});

test("pantallas bajas: el menú desplaza dentro del riel y conserva visibles los controles esenciales", async (context) => {
  const page = await openPage(context, "admin", { viewport: { width: 1280, height: 560 } });
  await page.goto(`${origin}/servicios-cotizaciones`);
  const sidebar = page.locator(`${SIDEBAR_SELECTOR}:visible`).first();
  await sidebar.getByRole("button", { name: LABEL, exact: true }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  const layout = await sidebar.evaluate((rail) => ({
    railBottom: rail.getBoundingClientRect().bottom,
    pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
  }));
  assert.ok(layout.railBottom <= 560.5, "El riel no supera la altura del viewport");
  assert.equal(layout.pageOverflow, 0);
  const settings = sidebar.getByRole("button", { name: "Configuraciones", exact: true });
  await settings.scrollIntoViewIfNeeded();
  assert.equal(await settings.isVisible(), true);
  assert.equal(await sidebar.getByRole("button", { name: /Cerrar sesión/ }).isVisible(), true);
});
