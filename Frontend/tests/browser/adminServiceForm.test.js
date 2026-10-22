import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";

import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";
import { createServiceCatalogBackend, sampleCatalog } from "../helpers/serviceCatalogBackend.js";

// Formulario de servicios (Figma 5764:226084): un único modal de alta y edición y, desde él, el
// alta de unidades con el formulario existente de Unidades, contra un backend simulado.

let browser;
let server;
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
 * Abre el tabulador con sesión de administrador; vigila errores de página y peticiones no previstas.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {Object} backend - Backend simulado.
 * @param {Object} [options] - Viewport y tema.
 * @returns {Promise<import("playwright").Page>} Página con la tabla cargada.
 */
async function openTabulator(context, backend, { theme = "light", viewport = { width: 1440, height: 1000 } } = {}) {
  const browserContext = await browser.newContext({ viewport });
  const page = applyBrowserTimeouts(await browserContext.newPage());
  await page.addInitScript((value) => localStorage.setItem("arca-theme", value), theme);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), backend.handle);
  context.after(async () => {
    await browserContext.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(backend.requests.filter((request) => request.unexpected), []);
  });
  await page.goto(`${origin}/servicios-cotizaciones/tabulador`);
  await page.locator("tbody tr").first().waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  return page;
}

const requestsOf = (backend, method, pathPattern) => backend.requests.filter((request) => request.method === method && pathPattern.test(request.path));
const rowFor = (page, code) => page.locator("tbody tr", { has: page.locator("th[scope=row]", { hasText: code }) });

/**
 * Abre «Nuevo servicio» y espera a que el catálogo de unidades base esté listo.
 *
 * @param {import("playwright").Page} page - Página del tabulador.
 * @returns {Promise<import("playwright").Locator>} Diálogo.
 */
async function openCreate(page) {
  await page.getByRole("button", { name: "Añadir servicio" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo servicio" });
  await dialog.waitFor();
  await page.waitForFunction(() => !document.querySelector("[data-service-form]")?.textContent.includes("Cargando unidades base"));
  return dialog;
}

/**
 * Elige la unidad base en el selector de prefijo del campo de unidad.
 *
 * @param {import("playwright").Page} page - Página.
 * @param {string} optionName - Nombre accesible de la opción (abreviatura, nombre).
 * @returns {Promise<void>}
 */
async function chooseBase(page, optionName) {
  await page.getByRole("combobox", { name: /^Unidad base del servicio/ }).click();
  await page.getByRole("option", { name: optionName }).click();
}

/**
 * Enfoca el campo de unidad y elige una denominación entre las sugerencias de la base.
 *
 * @param {import("playwright").Page} page - Página.
 * @param {string} text - Texto de la denominación.
 * @returns {Promise<void>}
 */
async function chooseDenomination(page, text) {
  await page.locator("#service-form-unit").focus();
  await page.getByRole("button", { name: `Seleccionar ${text}`, exact: true }).click();
}

test("alta: modal de Figma, foco, campos obligatorios y sin código ni tipo en el formulario", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  assert.equal(await page.locator("#service-form-name").evaluate((element) => element === document.activeElement), true, "El nombre recibe el foco");
  for (const label of ["Nombre del servicio", "Descripción (opcional)", "Unidad de medida", "Tarifa USD"]) {
    assert.equal(await dialog.getByText(label, { exact: true }).count() > 0, true, label);
  }
  assert.equal(await dialog.getByText(/Código|Tipo/).count(), 0, "El código y el tipo los genera el sistema");
  assert.equal(await dialog.getByRole("button", { name: "Crear unidad" }).isVisible(), true);
  assert.equal(await dialog.getByRole("button", { name: "Crear", exact: true }).isVisible(), true);
  // Unidades base reales del catálogo.
  assert.equal(requestsOf(backend, "GET", /^\/api\/admin\/measurement-units$/).length, 1);

  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  for (const message of ["Escribe el nombre del servicio.", "Elige la unidad de medida.", "Indica la tarifa."]) {
    await dialog.getByText(message, { exact: true }).waitFor();
  }
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0, "No se envía un formulario inválido");
  // Escape cierra el modal (un único diálogo) sin crear nada.
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
});

test("unidad: base y denominación coherentes, cambio de base sin combinaciones incompatibles y alta del servicio", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  await dialog.locator("#service-form-name").fill("Servicio de prueba del formulario");
  await dialog.getByPlaceholder("Descripción del servicio.").fill("Descripción de prueba del formulario.");
  await dialog.getByPlaceholder("0.00").fill("12.50");

  await chooseBase(page, "m², Metro cuadrado");
  await page.locator("#service-form-unit").focus();
  // Solo denominaciones de m², pedidas a la API con su base.
  await dialog.getByRole("button", { name: "Seleccionar de construcción", exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Seleccionar de excavación", exact: true }).count(), 0);
  assert.equal(requestsOf(backend, "GET", /measurement-unit-denominations$/).at(-1).params.measurementUnitId, "1");
  await chooseDenomination(page, "a intervenir");
  await dialog.getByRole("button", { name: "Quitar a intervenir" }).waitFor();

  // Cambiar a m³ retira la denominación de m² y ofrece solo las de m³.
  await chooseBase(page, "m³, Metro cúbico");
  assert.equal(await dialog.getByRole("button", { name: "Quitar a intervenir" }).count(), 0);
  await chooseDenomination(page, "de excavación");
  await dialog.getByRole("button", { name: "Quitar de excavación" }).waitFor();
  // Escribir y pulsar Enter con un texto que no existe no crea denominaciones.
  await page.locator("#service-form-unit").fill("inventada");
  await page.keyboard.press("Enter");
  assert.equal(await dialog.getByRole("button", { name: "Quitar inventada" }).count(), 0);
  await page.locator("#service-form-unit").fill("");

  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const [post] = requestsOf(backend, "POST", /^\/api\/admin\/services$/);
  assert.deepEqual(post.body, {
    name: "Servicio de prueba del formulario",
    description: "Descripción de prueba del formulario.",
    measurementUnitId: 13,
    unitDenominationId: 13,
    referenceRate: "12.50",
  }, "Sin código ni tipo; tarifa como texto");
  await page.getByRole("alert").getByText("SERV-006 · Servicio de prueba del formulario").waitFor();
  const row = rowFor(page, "SERV-006");
  await row.waitFor();
  assert.deepEqual((await row.locator("td").allInnerTexts()).slice(1, 4).map((text) => text.trim()), ["Servicio de prueba del formulario", "m³ de excavación", "$12.50"]);
  // La descripción alimenta el tooltip del tabulador.
  await row.getByRole("button", { name: "Ver descripción de Servicio de prueba del formulario" }).hover();
  await page.getByRole("tooltip").getByText("Descripción de prueba del formulario.", { exact: true }).waitFor();
});

test("crear unidad: reutiliza el formulario de Unidades, conserva el borrador y selecciona la nueva denominación", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  await dialog.locator("#service-form-name").fill("Borrador conservado");
  await dialog.getByPlaceholder("Descripción del servicio.").fill("Texto del borrador.");
  await dialog.getByPlaceholder("0.00").fill("30");
  await chooseBase(page, "m², Metro cuadrado");

  // Cancelar vuelve al servicio sin cambios y con el foco en «Crear unidad».
  await dialog.getByRole("button", { name: "Crear unidad" }).click();
  const unitDialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await unitDialog.waitFor();
  assert.equal(await page.locator('[role="dialog"]').count(), 1, "Un solo diálogo: sin overlays ni focus traps apilados");
  assert.match(await unitDialog.getByRole("combobox").textContent(), /m²/, "Abre con la base del servicio");
  await unitDialog.getByRole("button", { name: "Cancelar" }).click();
  await dialog.waitFor();
  // El foco inicial llega cuando Modal termina de montar su contenido (unos frames).
  await page.waitForFunction(() => document.activeElement?.matches("[data-service-create-unit]"));
  assert.equal(await dialog.locator("#service-form-name").inputValue(), "Borrador conservado");
  assert.equal(await dialog.getByPlaceholder("Descripción del servicio.").inputValue(), "Texto del borrador.");
  assert.equal(await dialog.getByPlaceholder("0.00").inputValue(), "30");
  assert.equal(requestsOf(backend, "POST", /measurement-unit-denominations$/).length, 0, "Cancelar no crea unidades");

  // Escape en el formulario de unidades solo cierra ese paso.
  await dialog.getByRole("button", { name: "Crear unidad" }).click();
  await unitDialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor();
  assert.equal(await page.locator('[role="dialog"]').count(), 1);

  // Crear la denominación vuelve al servicio con ella elegida y el foco en la unidad.
  await dialog.getByRole("button", { name: "Crear unidad" }).click();
  await unitDialog.waitFor();
  await unitDialog.getByRole("textbox", { name: "Nombre de la unidad" }).fill("de prueba nueva");
  await unitDialog.getByRole("button", { name: "Crear", exact: true }).click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Quitar de prueba nueva" }).waitFor();
  await page.waitForFunction(() => document.activeElement?.id === "service-form-unit");
  assert.deepEqual(requestsOf(backend, "POST", /measurement-unit-denominations$/).map((request) => request.body), [{ denomination: "de prueba nueva", measurementUnitId: 1 }]);
  assert.equal(await dialog.locator("#service-form-name").inputValue(), "Borrador conservado");
  assert.equal(await dialog.getByPlaceholder("0.00").inputValue(), "30");

  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const [post] = requestsOf(backend, "POST", /^\/api\/admin\/services$/);
  assert.equal(post.body.unitDenominationId, 14);
  await rowFor(page, "SERV-006").getByText("m² de prueba nueva", { exact: true }).waitFor();
});

test("edición: mismo modal con datos reales, solo campos cambiados, expectedVersion y sin cambios no envía", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  const dialog = page.getByRole("dialog", { name: "Servicio" });
  await dialog.locator("#service-form-name").waitFor();
  // Al menos una lectura del detalle (en desarrollo, StrictMode repite el montaje y aborta la primera).
  assert.ok(requestsOf(backend, "GET", /^\/api\/admin\/services\/1$/).length >= 1, "Lee la versión vigente");
  assert.equal(await dialog.locator("#service-form-name").inputValue(), "Anteproyecto de prueba");
  assert.equal(await dialog.getByPlaceholder("Descripción del servicio.").inputValue(), "Primera propuesta del espacio.");
  assert.equal(await dialog.getByPlaceholder("0.00").inputValue(), "12.00", "La tarifa guardada, sin conversión");
  await dialog.getByRole("button", { name: "Quitar de construcción" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Guardar" }).isVisible(), true);

  // Sin cambios: no hay PATCH.
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("alert").getByText("Sin cambios").first().waitFor();
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).length, 0);

  // Cambiar solo la tarifa (12 equivale a 12.00, así que se cambia de verdad a 15).
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  await dialog.locator("#service-form-name").waitFor();
  await dialog.getByPlaceholder("0.00").fill("15");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).at(-1).body, { expectedVersion: 1, referenceRate: "15" });
  await rowFor(page, "TST-001").getByText("$15", { exact: true }).waitFor();

  // Vaciar la descripción la retira y el tabulador deja de mostrar el icono.
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  await dialog.locator("#service-form-name").waitFor();
  await dialog.getByPlaceholder("Descripción del servicio.").fill("");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).at(-1).body, { expectedVersion: 2, description: null });
  await page.waitForFunction(() => {
    const row = [...document.querySelectorAll("tbody tr")].find((item) => item.textContent.includes("TST-001"));
    return row && !row.querySelector("[data-service-description-hint]");
  });

  // Cambiar la base envía también la denominación (null) para no dejar combinaciones inválidas.
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  await dialog.locator("#service-form-name").waitFor();
  await chooseBase(page, "m.l., Metro lineal");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).at(-1).body, { expectedVersion: 3, measurementUnitId: 6, unitDenominationId: null });
});

test("precisión y errores: tarifa decimal exacta, 400 por campo y 409 de versión sin perder lo escrito", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  await page.getByRole("button", { name: "Editar TST-002 Diseño interior de prueba" }).click();
  const dialog = page.getByRole("dialog", { name: "Servicio" });
  await dialog.locator("#service-form-name").waitFor();
  assert.equal(await dialog.getByPlaceholder("0.00").inputValue(), "1250.50");

  // Más de 2 decimales o signo: validación local, sin petición.
  for (const invalid of ["12.345", "-5", "1e3"]) {
    await dialog.getByPlaceholder("0.00").fill(invalid);
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await dialog.getByText("Usa hasta 12 enteros y 2 decimales, sin signo (por ejemplo, 12.50).", { exact: true }).waitFor();
  }
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/2$/).length, 0);

  // 400 del backend junto al campo; el formulario sigue abierto con lo escrito.
  backend.failures["PATCH /api/admin/services/:id"] = { status: 400, body: { code: "VALIDATION_ERROR", message: "Datos inválidos.", fields: { "body.name": "Ese nombre no es válido." } } };
  await dialog.locator("#service-form-name").fill("Nombre rechazado");
  await dialog.getByPlaceholder("0.00").fill("999999999999.99");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.getByText("Ese nombre no es válido.", { exact: true }).waitFor();
  assert.equal(await dialog.locator("#service-form-name").inputValue(), "Nombre rechazado");
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/2$/).at(-1).body.referenceRate, "999999999999.99", "Sin redondeo ni Number");

  // 409: otro administrador guardó antes. No se sobrescribe, se explica y se recarga la tabla.
  delete backend.failures["PATCH /api/admin/services/:id"];
  backend.items.find((item) => item.id === 2).currentVersion = 7;
  const tableReads = requestsOf(backend, "GET", /^\/api\/admin\/services$/).length;
  await dialog.locator("#service-form-name").fill("Diseño interior de prueba");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.getByText(/Otro administrador guardó cambios en este servicio/).waitFor();
  assert.equal(await dialog.getByPlaceholder("0.00").inputValue(), "999999999999.99");
  assert.equal(backend.items.find((item) => item.id === 2).referenceRate, "1250.50", "La tarifa ajena no se sobrescribió");
  await page.waitForFunction((count) => count >= 0, tableReads);
  assert.ok(requestsOf(backend, "GET", /^\/api\/admin\/services$/).length > tableReads, "El listado se recarga");

  // Cerrar y volver a abrir lee la versión vigente; la tarifa grande se guarda exacta.
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Editar TST-002 Diseño interior de prueba" }).click();
  await dialog.locator("#service-form-name").waitFor();
  await dialog.getByPlaceholder("0.00").fill("999999999999.99");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/2$/).at(-1).body, { expectedVersion: 7, referenceRate: "999999999999.99" });
  await rowFor(page, "TST-002").getByText("$999,999,999,999.99", { exact: true }).waitFor();
});

test("responsive y accesibilidad: modal dentro del viewport en 375–1440 px, claro y oscuro, foco atrapado", async (context) => {
  for (const theme of ["light", "dark"]) {
    const backend = createServiceCatalogBackend(sampleCatalog());
    const page = await openTabulator(context, backend, { theme, viewport: { width: 375, height: 812 } });
    for (const [width, height] of [[375, 812], [768, 1024], [1024, 768], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      const dialog = await openCreate(page);
      await chooseBase(page, "m², Metro cuadrado");
      await chooseDenomination(page, "de construcción");
      const layout = await page.evaluate(() => {
        const box = document.querySelector("[data-service-form]").getBoundingClientRect();
        const form = document.querySelector("#service-form");
        const rate = document.querySelector('input[placeholder="0.00"]').getBoundingClientRect();
        const unit = document.querySelector("#service-form-unit").closest("[data-input-shell]").getBoundingClientRect();
        return {
          inside: box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight,
          noHorizontalOverflow: form.scrollWidth <= form.clientWidth,
          rateBesideUnit: rate.left >= unit.right,
          rateInside: rate.right <= box.right,
          width: Math.round(box.width),
        };
      });
      assert.deepEqual({ inside: layout.inside, noHorizontalOverflow: layout.noHorizontalOverflow, rateBesideUnit: layout.rateBesideUnit, rateInside: layout.rateInside },
        { inside: true, noHorizontalOverflow: true, rateBesideUnit: true, rateInside: true }, `${theme} ${width}px: ${JSON.stringify(layout)}`);
      assert.ok(layout.width <= 400, "Ancho máximo de Figma");
      // El foco no sale del diálogo con Tab.
      for (let step = 0; step < 12; step += 1) await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-service-form]"))), true, `${theme} ${width}px: foco atrapado`);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    }
  }
});
