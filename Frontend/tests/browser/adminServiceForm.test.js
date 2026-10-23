import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";

import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";
import { createServiceCatalogBackend, denominationRecord, sampleCatalog, service } from "../helpers/serviceCatalogBackend.js";

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
  await page.waitForFunction(() => {
    const text = document.querySelector("[data-service-form]")?.textContent || "";
    return !text.includes("Cargando unidades base") && !text.includes("Cargando unidades de medida");
  });
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
 * Elige la modalidad de contratación en su Dropdown menu.
 *
 * @param {import("playwright").Page} page - Página.
 * @param {"Detalle por detalle"|"Llave en mano"} label - Opción visible.
 * @returns {Promise<void>}
 */
async function chooseModality(page, label) {
  await page.getByRole("button", { name: "Modalidad de contratación", exact: true }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

/**
 * Abre el selector de la unidad base y devuelve los nombres de sus opciones; lo deja cerrado.
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<Array<string>>} Opciones visibles (abreviatura, nombre).
 */
async function baseOptionNames(page) {
  const combobox = page.getByRole("combobox", { name: /^Unidad base del servicio/ });
  await combobox.click();
  const names = await page.getByRole("option").evaluateAll((options) => options.map((option) => option.getAttribute("aria-label") || option.textContent.trim()));
  await page.keyboard.press("Escape");
  return names;
}

/**
 * Despliega «+ Crear unidad» dentro del modal y devuelve la fila del alta contextual.
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<import("playwright").Locator>} Fila «Nombre de la unidad».
 */
async function openUnitCreation(page) {
  await page.locator("[data-service-form]").getByRole("button", { name: "Crear unidad" }).click();
  const row = page.locator("[data-service-unit-create]");
  await row.waitFor();
  return row;
}

/**
 * Opciones del selector de base de la fila de alta contextual (la abre y la cierra).
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<Array<string>>} Opciones visibles (abreviatura, nombre).
 */
async function newUnitBaseOptions(page) {
  await page.getByRole("combobox", { name: /^Unidad base de la nueva unidad/ }).click();
  const names = await page.getByRole("option").evaluateAll((options) => options.map((option) => option.getAttribute("aria-label") || option.textContent.trim()));
  await page.keyboard.press("Escape");
  return names;
}

/**
 * Comprueba que el borrador del servicio no cambió.
 *
 * @param {import("playwright").Page} page - Página.
 * @param {{name: string, description: string, rate: string, modality: string}} expected - Valores esperados.
 * @returns {Promise<void>}
 */
async function assertDraftKept(page, expected) {
  const dialog = page.locator("[data-service-form]");
  assert.equal(await dialog.locator("#service-form-name").inputValue(), expected.name);
  assert.equal(await dialog.getByPlaceholder("Descripción del servicio.").inputValue(), expected.description);
  assert.equal(await dialog.getByPlaceholder("0.00").inputValue(), expected.rate);
  assert.match(await page.getByRole("button", { name: "Modalidad de contratación", exact: true }).innerText(), new RegExp(expected.modality));
}

/**
 * Enfoca el campo de unidad y elige una unidad registrada entre las sugerencias.
 *
 * @param {import("playwright").Page} page - Página.
 * @param {string} label - Etiqueta de la unidad con su símbolo («m² de construcción»).
 * @returns {Promise<void>}
 */
async function chooseDenomination(page, label) {
  await page.locator("#service-form-unit").focus();
  await page.getByRole("button", { name: `Seleccionar ${label}`, exact: true }).click();
}

/**
 * Enfoca el campo de unidad y devuelve las sugerencias visibles (sin seleccionar ninguna).
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<Array<string>>} Etiquetas sugeridas, ordenadas.
 */
async function unitSuggestions(page) {
  await page.locator("#service-form-unit").waitFor();
  await page.waitForFunction(() => !document.querySelector("[data-service-form]")?.textContent.includes("Cargando unidades de medida"));
  await page.locator("#service-form-unit").focus();
  return (await page.locator("[data-service-form]").getByRole("button", { name: /^Seleccionar / }).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label").replace(/^Seleccionar /, "")))).sort();
}

test("alta: modal de Figma, foco, campos obligatorios, modalidad exigida y sin código", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  assert.equal(await page.locator("#service-form-name").evaluate((element) => element === document.activeElement), true, "El nombre recibe el foco");
  for (const label of ["Nombre del servicio", "Modalidad de Contratación", "Descripción (opcional)", "Unidad de medida", "Tarifa USD"]) {
    assert.equal(await dialog.getByText(label, { exact: true }).count() > 0, true, label);
  }
  assert.equal(await dialog.getByText(/Código/).count(), 0, "El código lo genera el sistema");
  // Figma 5764:226084: la modalidad va entre el nombre y la descripción, sin elegir en el alta.
  const order = await dialog.evaluate((element) => ["#service-form-name", "[data-service-modality-field]", "textarea"]
    .map((selector) => Math.round(element.querySelector(selector).getBoundingClientRect().top)));
  assert.ok(order[0] < order[1] && order[1] < order[2], JSON.stringify(order));
  assert.match(await page.getByRole("button", { name: "Modalidad de contratación", exact: true }).innerText(), /Elige la modalidad/);
  await page.getByRole("button", { name: "Modalidad de contratación", exact: true }).click();
  assert.deepEqual(await page.getByRole("menuitem").allInnerTexts(), ["Detalle por detalle", "Llave en mano"]);
  // Escape con el desplegable abierto cierra solo el desplegable, no el modal.
  await page.keyboard.press("Escape");
  await page.getByRole("menuitem").first().waitFor({ state: "detached" });
  assert.equal(await dialog.isVisible(), true, "El modal sigue abierto");
  assert.equal(await dialog.getByRole("button", { name: "Crear unidad" }).isVisible(), true);
  assert.equal(await dialog.getByRole("button", { name: "Crear", exact: true }).isVisible(), true);
  // Unidades base reales del catálogo.
  assert.equal(requestsOf(backend, "GET", /^\/api\/admin\/measurement-units$/).length, 1);

  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  for (const message of ["Escribe el nombre del servicio.", "Elige la modalidad de contratación.", "Elige la unidad de medida.", "Indica la tarifa."]) {
    await dialog.getByText(message, { exact: true }).waitFor();
  }
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0, "No se envía un formulario inválido");
  // Elegir la modalidad retira su error.
  await chooseModality(page, "Detalle por detalle");
  assert.equal(await dialog.getByText("Elige la modalidad de contratación.", { exact: true }).count(), 0);
  // Escape cierra el modal (un único diálogo) sin crear nada.
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
});

test("unidad: solo unidades registradas, con su símbolo, búsqueda y una sola por servicio", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  // Una unidad inactiva no se ofrece para nuevas selecciones.
  backend.denominations.push(denominationRecord({ id: 90, denomination: "de archivo", isActive: false, unit: "m2" }));
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  await dialog.locator("#service-form-name").fill("Servicio de prueba del formulario");
  await chooseModality(page, "Detalle por detalle");
  await dialog.getByPlaceholder("Descripción del servicio.").fill("Descripción de prueba del formulario.");
  await dialog.getByPlaceholder("0.00").fill("12.50");

  const input = page.locator("#service-form-unit");
  const readsBeforeClick = requestsOf(backend, "GET", /measurement-unit-denominations$/).length;
  assert.equal(await input.getAttribute("placeholder"), "Selecciona un símbolo");
  assert.equal(await input.evaluate((element) => element.readOnly), true);
  await input.click();
  await input.press("ArrowDown");
  await input.press("Enter");
  assert.deepEqual(await unitSuggestions(page), [], "Sin símbolo no se abre ninguna sugerencia");
  assert.ok(readsBeforeClick >= 1, "La lectura inicial permite construir solo símbolos registrados");
  assert.equal(requestsOf(backend, "GET", /measurement-unit-denominations$/).length, readsBeforeClick, "El clic sin base no provoca otra lectura");
  assert.deepEqual((await baseOptionNames(page)).sort(), ["m², Metro cuadrado", "m³, Metro cúbico", "pto., Punto"]);
  await chooseBase(page, "m², Metro cuadrado");
  assert.equal(await input.evaluate((element) => element.readOnly), false);
  assert.equal(await input.getAttribute("placeholder"), "Buscar unidad");
  // La lectura completa se reutiliza al cambiar de base o buscar, sin consultas por pulsación.
  await page.waitForFunction(() => !document.querySelector("[data-service-form]")?.textContent.includes("Cargando unidades de medida"));
  const reads = requestsOf(backend, "GET", /measurement-unit-denominations$/);
  assert.ok(reads.length >= 1 && reads.every((request) => request.params.status === "active" && !request.params.measurementUnitId), JSON.stringify(reads.map((r) => r.params)));
  // Sugerencias: solo las registradas activas, con símbolo y texto; nada de bases sueltas ni inactivas.
  assert.deepEqual(await unitSuggestions(page), ["m² a intervenir", "m² de construcción"]);

  // Búsqueda: escribir filtra las sugerencias.
  await page.locator("#service-form-unit").fill("constru");
  assert.deepEqual(await dialog.getByRole("button", { name: /^Seleccionar / }).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), ["Seleccionar m² de construcción"]);
  await page.locator("#service-form-unit").fill("");

  // Elegir una unidad fija su base: el prefijo muestra su símbolo y el Tag su texto.
  await chooseDenomination(page, "m² a intervenir");
  await dialog.getByRole("button", { name: "Quitar a intervenir" }).waitFor();
  assert.equal(await dialog.getByRole("combobox", { name: /^Unidad base del servicio/ }).innerText(), "m²");
  // Una sola unidad: elegir otra (de otra base) la sustituye junto con su símbolo.
  await page.locator("#service-form-unit").fill("constru");
  await chooseBase(page, "m³, Metro cúbico");
  assert.equal(await input.inputValue(), "", "Cambiar de símbolo vacía la consulta anterior");
  assert.equal(await dialog.getByRole("button", { name: "Quitar a intervenir" }).count(), 0);
  assert.deepEqual(await unitSuggestions(page), ["m³ de excavación"], "La base filtra las sugerencias");
  await chooseDenomination(page, "m³ de excavación");
  await dialog.getByRole("button", { name: "Quitar de excavación" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: /^Quitar / }).count(), 1);
  // Escribir y pulsar Enter con un texto que no existe no crea unidades.
  await page.locator("#service-form-unit").fill("inventada");
  await page.keyboard.press("Enter");
  assert.equal(await dialog.getByRole("button", { name: "Quitar inventada" }).count(), 0);
  await page.locator("#service-form-unit").fill("");
  assert.equal(requestsOf(backend, "GET", /measurement-unit-denominations$/).length, reads.length, "La búsqueda y los cambios de base reutilizan el catálogo");

  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const [post] = requestsOf(backend, "POST", /^\/api\/admin\/services$/);
  assert.deepEqual(post.body, {
    name: "Servicio de prueba del formulario",
    kind: "individual",
    description: "Descripción de prueba del formulario.",
    measurementUnitId: 13,
    unitDenominationId: 13,
    referenceRate: "12.50",
  }, "Con la modalidad elegida, sin código; tarifa como texto");
  await page.getByRole("alert").getByText("SERV-006 · Servicio de prueba del formulario").waitFor();
  const row = rowFor(page, "SERV-006");
  await row.waitFor();
  assert.deepEqual((await row.locator("td").allInnerTexts()).slice(1, 5).map((text) => text.trim()), ["Servicio de prueba del formulario", "Detalle por detalle", "m³ de excavación", "$12.50"]);
  // La descripción alimenta el tooltip del tabulador.
  await row.getByRole("button", { name: "Ver descripción de Servicio de prueba del formulario" }).hover();
  await page.getByRole("tooltip").getByText("Descripción de prueba del formulario.", { exact: true }).waitFor();
});

test("unidad: una base sin unidad registrada no basta y sin unidades registradas se indica crear una", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  await dialog.locator("#service-form-name").fill("Sin unidad registrada");
  await chooseModality(page, "Detalle por detalle");
  await dialog.getByPlaceholder("0.00").fill("100");
  // Elegir solo el símbolo no es una unidad: se exige una unidad registrada.
  await chooseBase(page, "m², Metro cuadrado");
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await dialog.getByText("Elige la unidad de medida.", { exact: true }).waitFor();
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });

  // Sin unidades registradas activas: estado vacío con la indicación de crear una.
  backend.denominations.splice(0, backend.denominations.length, denominationRecord({ id: 90, denomination: "de archivo", isActive: false, unit: "m2" }));
  const empty = await openCreate(page);
  assert.deepEqual(await unitSuggestions(page), []);
  await empty.getByText("No hay unidades de medida registradas. Crea una con «+ Crear unidad».", { exact: true }).waitFor();
  assert.deepEqual(await unitSuggestions(page), []);
  assert.equal(await empty.getByRole("combobox", { name: /^Unidad base del servicio/ }).count(), 0, "No se ofrecen bases sin denominaciones");
  assert.equal(await empty.getByRole("button", { name: "Crear unidad" }).isEnabled(), true);
  const row = await openUnitCreation(page);
  await row.getByRole("combobox", { name: /^Unidad base de la nueva unidad/ }).click();
  await page.getByRole("option", { name: "m.l., Metro lineal", exact: true }).click();
  assert.equal(await row.getByRole("combobox", { name: /^Unidad base de la nueva unidad/ }).innerText(), "m.l.");
  await row.locator("#service-form-new-unit").fill("de canalización");
  await row.getByRole("button", { name: "Guardar", exact: true }).click();
  await empty.getByRole("button", { name: "Quitar de canalización" }).waitFor();
  assert.equal(await empty.getByRole("combobox", { name: /^Unidad base del servicio/ }).innerText(), "m.l.");
  assert.equal(await empty.locator("#service-form-unit").inputValue(), "", "El alta contextual vacía la consulta");
  await empty.getByRole("button", { name: "Quitar de canalización" }).click();
  assert.equal(await empty.locator("#service-form-unit").inputValue(), "", "Quitar la unidad creada no recupera la consulta anterior");
  await chooseDenomination(page, "m.l. de canalización");
  assert.equal(requestsOf(backend, "POST", /measurement-unit-denominations$/).at(-1).body.measurementUnitId, 6);
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0, "Crear una unidad no crea el servicio");
});

test("unidad: teclado selecciona primero el símbolo y después una única denominación compatible", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  const prefix = page.getByRole("combobox", { name: /^Unidad base del servicio/ });
  await prefix.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("listbox", { name: "Unidad base del servicio" }).waitFor();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  assert.equal(await prefix.innerText(), "m²");
  assert.equal(await prefix.getAttribute("aria-expanded"), "false");
  // Elegir el símbolo lleva el foco a la búsqueda de sus denominaciones, sin otro Tab.
  assert.equal(await page.locator("#service-form-unit").evaluate((element) => document.activeElement === element), true);
  assert.deepEqual(await unitSuggestions(page), ["m² a intervenir", "m² de construcción"]);
  await page.keyboard.type("intervenir");
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Quitar a intervenir" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: /^Quitar / }).count(), 1);
  assert.equal(await page.locator("#service-form-unit").inputValue(), "");
  await page.keyboard.press("Backspace");
  assert.equal(await dialog.getByRole("button", { name: "Quitar a intervenir" }).count(), 0);
  assert.equal(await prefix.innerText(), "m²", "Quitar la denominación conserva la base");
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0, "Enter selecciona sin enviar el servicio");
});

/**
 * Mide el campo de unidad y las sugerencias visibles bajo él: posición, tamaño y estilo de cada
 * etiqueta. Permite comparar la apertura automática con la apertura manual existente.
 *
 * @param {import("playwright").Page} page - Página con el formulario abierto.
 * @returns {Promise<Object>} Medidas del campo y de las sugerencias.
 */
function measureUnitOptions(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return [box.x, box.y, box.width, box.height].map(Math.round);
    };
    const input = document.querySelector("[data-service-form] #service-form-unit");
    const shell = input.closest("[data-input-shell]");
    const group = document.getElementById("service-form-unit-tags");
    return {
      shell: rect(shell).slice(2),
      group: group ? rect(group) : null,
      options: [...(group?.querySelectorAll("button") ?? [])].map((button) => {
        const style = getComputedStyle(button);
        return {
          label: button.getAttribute("aria-label"),
          box: rect(button),
          style: [style.backgroundColor, style.color, style.borderTopWidth, style.borderTopColor, style.borderRadius, style.padding, style.fontSize, style.lineHeight],
        };
      }),
    };
  });
}

test("unidad en Crear: elegir el símbolo muestra sus denominaciones sin otro clic y con el mismo diseño", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  const input = page.locator("#service-form-unit");
  const shellBefore = (await measureUnitOptions(page)).shell;
  assert.equal(await dialog.getByRole("button", { name: /^Seleccionar / }).count(), 0, "Sin símbolo no hay sugerencias");

  await chooseBase(page, "m², Metro cuadrado");
  await dialog.getByRole("button", { name: "Seleccionar m² de construcción", exact: true }).waitFor();
  assert.equal(await input.evaluate((element) => document.activeElement === element), true, "La búsqueda queda lista para escribir");
  const automatic = await measureUnitOptions(page);
  assert.deepEqual(automatic.options.map((option) => option.label).sort(), ["Seleccionar m² a intervenir", "Seleccionar m² de construcción"]);
  // La altura enfocada (borde de Focused) se compara abajo con la apertura manual, también enfocada.
  assert.equal(automatic.shell[0], shellBefore[0], "El campo conserva su ancho");
  assert.ok(automatic.group[1] >= (await input.boundingBox()).y, "Las etiquetas siguen debajo del campo");

  // La apertura manual existente (salir y volver a enfocar) produce exactamente la misma presentación.
  await page.keyboard.press("Shift+Tab");
  await dialog.getByRole("button", { name: /^Seleccionar / }).first().waitFor({ state: "detached" });
  await input.focus();
  await dialog.getByRole("button", { name: "Seleccionar m² de construcción", exact: true }).waitFor();
  assert.deepEqual(await measureUnitOptions(page), automatic);

  // Cambiar de símbolo sustituye las opciones; búsqueda y selección siguen igual.
  await chooseBase(page, "m³, Metro cúbico");
  await dialog.getByRole("button", { name: "Seleccionar m³ de excavación", exact: true }).waitFor();
  assert.deepEqual((await measureUnitOptions(page)).options.map((option) => option.label), ["Seleccionar m³ de excavación"]);
  await page.keyboard.type("excav");
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Quitar de excavación" }).waitFor();
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0);
});

test("unidad en Editar (móvil oscuro): abre sin sugerencias y las muestra solo al cambiar el símbolo", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend, { theme: "dark", viewport: { width: 375, height: 812 } });
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  const dialog = page.getByRole("dialog", { name: "Servicio" });
  await dialog.getByRole("button", { name: "Quitar de construcción" }).waitFor();
  await page.waitForFunction(() => !document.querySelector("[data-service-form]")?.textContent.includes("Cargando unidades de medida"));
  const prefix = dialog.getByRole("combobox", { name: /^Unidad base del servicio/ });
  assert.equal(await prefix.innerText(), "m²", "Conserva la unidad precargada");
  assert.equal(await dialog.getByRole("button", { name: /^Seleccionar / }).count(), 0, "Abrir la edición no despliega opciones");
  const shellBefore = (await measureUnitOptions(page)).shell;

  await chooseBase(page, "m³, Metro cúbico");
  await dialog.getByRole("button", { name: "Seleccionar m³ de excavación", exact: true }).waitFor();
  const automatic = await measureUnitOptions(page);
  assert.deepEqual(automatic.options.map((option) => option.label), ["Seleccionar m³ de excavación"]);
  // La altura enfocada (borde de Focused) se compara abajo con la apertura manual, también enfocada.
  assert.equal(automatic.shell[0], shellBefore[0], "El campo conserva su ancho");
  assert.equal(await dialog.getByRole("button", { name: "Quitar de construcción" }).count(), 0, "Cambiar la base retira la unidad anterior");
  const { group } = automatic;
  assert.ok(group[0] >= 0 && group[0] + group[2] <= 375, `Las etiquetas caben en el viewport ${JSON.stringify(group)}`);

  await page.keyboard.press("Shift+Tab");
  await dialog.getByRole("button", { name: /^Seleccionar / }).first().waitFor({ state: "detached" });
  await page.locator("#service-form-unit").focus();
  await dialog.getByRole("button", { name: "Seleccionar m³ de excavación", exact: true }).waitFor();
  assert.deepEqual(await measureUnitOptions(page), automatic, "Misma presentación que la apertura manual");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).length, 0);
});

test("alta contextual durante una lectura lenta conserva el catálogo completo y la selección creada", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  backend.delays["GET /api/admin/measurement-unit-denominations"] = 3000;
  const page = await openTabulator(context, backend);
  await page.getByRole("button", { name: "Añadir servicio" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo servicio" });
  await dialog.getByText("Cargando unidades de medida...", { exact: true }).waitFor();
  const row = await openUnitCreation(page);
  await row.getByRole("combobox", { name: /^Unidad base de la nueva unidad/ }).click();
  await page.getByRole("option", { name: "m.l., Metro lineal", exact: true }).click();
  await row.locator("#service-form-new-unit").fill("de canalización nueva");
  await row.getByRole("button", { name: "Guardar", exact: true }).click();
  await dialog.getByRole("button", { name: "Quitar de canalización nueva" }).waitFor();
  assert.equal(await dialog.getByText("Cargando unidades de medida...", { exact: true }).isVisible(), true, "El alta no da por terminada ni aborta la lectura inicial");
  await unitSuggestions(page);
  assert.deepEqual((await baseOptionNames(page)).sort(), ["m.l., Metro lineal", "m², Metro cuadrado", "m³, Metro cúbico", "pto., Punto"]);
  assert.equal(await dialog.getByRole("combobox", { name: /^Unidad base del servicio/ }).innerText(), "m.l.");
  await chooseBase(page, "m², Metro cuadrado");
  assert.deepEqual(await unitSuggestions(page), ["m² a intervenir", "m² de construcción"]);
  await chooseBase(page, "m.l., Metro lineal");
  assert.deepEqual(await unitSuggestions(page), ["m.l. de canalización nueva"], "La unidad creada no se duplica al terminar la lectura");
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0);
});

test("unidad: una lectura lenta y su reintento no fabrican símbolos ni unidades", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  backend.delays["GET /api/admin/measurement-unit-denominations"] = 350;
  backend.failures["GET /api/admin/measurement-unit-denominations"] = { status: 503, body: { code: "UNAVAILABLE", message: "Catálogo temporalmente no disponible" } };
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  await dialog.getByText("Catálogo temporalmente no disponible", { exact: true }).waitFor();
  assert.deepEqual(await unitSuggestions(page), []);
  assert.equal(await dialog.getByRole("combobox", { name: /^Unidad base del servicio/ }).count(), 0);
  delete backend.failures["GET /api/admin/measurement-unit-denominations"];
  await dialog.getByRole("button", { name: "Reintentar carga de unidades" }).click();
  await dialog.getByText("Cargando unidades de medida...", { exact: true }).waitFor();
  assert.deepEqual(await unitSuggestions(page), [], "La respuesta no elige automáticamente una base");
  await chooseBase(page, "m³, Metro cúbico");
  assert.deepEqual(await unitSuggestions(page), ["m³ de excavación"]);
  assert.equal(await dialog.getByRole("combobox", { name: /^Unidad base del servicio/ }).innerText(), "m³");
});

test("unidad en la edición: conserva la unidad guardada aunque esté inactiva y un servicio con solo la base", async (context) => {
  const archived = { ...service(7, { code: "TST-007", name: "Archivo de prueba", denomination: "construccion", rate: "20.00" }),
    unitDenomination: { id: 90, denomination: "de archivo", isActive: false }, unitLabel: "m² de archivo" };
  const backend = createServiceCatalogBackend([...sampleCatalog(), archived]);
  backend.denominations.push(denominationRecord({ id: 90, denomination: "de archivo", isActive: false, unit: "m2" }));
  const page = await openTabulator(context, backend);

  // Unidad inactiva guardada: se muestra y se conserva al guardar otro cambio.
  await page.getByRole("button", { name: "Editar TST-007 Archivo de prueba" }).click();
  const dialog = page.getByRole("dialog", { name: "Servicio" });
  await dialog.locator("#service-form-name").waitFor();
  await dialog.getByRole("button", { name: "Quitar de archivo" }).waitFor();
  assert.equal(await dialog.getByRole("combobox", { name: /^Unidad base del servicio/ }).innerText(), "m²");
  await dialog.locator("#service-form-name").fill("Archivo de prueba editado");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/7$/).at(-1).body, { expectedVersion: 1, name: "Archivo de prueba editado" });

  // Si retira la guardada, la inactiva no vuelve a aparecer entre las nuevas opciones.
  await page.getByRole("button", { name: "Editar TST-007 Archivo de prueba editado" }).click();
  await dialog.getByRole("button", { name: "Quitar de archivo" }).click();
  assert.deepEqual(await unitSuggestions(page), ["m² a intervenir", "m² de construcción"]);
  await chooseBase(page, "m³, Metro cúbico");
  assert.deepEqual(await unitSuggestions(page), ["m³ de excavación"]);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });

  // Servicio guardado solo con la base (TST-004, m.l.): se muestra y se puede guardar sin cambiarla.
  await page.getByRole("button", { name: "Editar TST-004 Canalizaciones de prueba" }).click();
  await dialog.locator("#service-form-name").waitFor();
  assert.equal(await dialog.getByRole("combobox", { name: /^Unidad base del servicio/ }).innerText(), "m.l.");
  await dialog.getByPlaceholder("0.00").fill("15");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/4$/).at(-1).body, { expectedVersion: 1, referenceRate: "0.15" });
});

const DRAFT = { name: "Borrador conservado", description: "Texto del borrador.", rate: "30.00", modality: "Detalle por detalle" };

test("Crear y Editar comparten símbolos registrados: no ofrecen las 48 bases ni denominaciones inactivas", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  backend.baseUnits.push(...Array.from({ length: 44 }, (_, index) => ({ id: index + 100, code: `unused_${index}`, symbol: `u${index}`, name: `Base sin denominaciones ${index}`, isActive: true })));
  backend.denominations.push(denominationRecord({ id: 90, denomination: "de archivo", isActive: false, unit: "ml" }));
  const page = await openTabulator(context, backend);
  let dialog = await openCreate(page);
  const createOptions = await baseOptionNames(page);
  assert.equal(createOptions.length, 3);
  assert.equal(createOptions.includes("m.l., Metro lineal"), false);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  dialog = page.getByRole("dialog", { name: "Servicio", exact: true });
  await unitSuggestions(page);
  assert.deepEqual(await baseOptionNames(page), createOptions, "Mismas opciones y mismo componente en ambos modos");
  await dialog.getByRole("button", { name: "Quitar de construcción" }).waitFor();
  assert.equal(await dialog.getByRole("combobox", { name: /^Unidad base del servicio/ }).innerText(), "m²");
});

test("edición histórica: base inactiva visible sin ofrecerla, con o sin denominación, en móvil oscuro", async (context) => {
  for (const [withDenomination, kind] of [[true, "individual"], [false, "individual"], [false, "turnkey"]]) {
    const original = service(7, { code: "TST-007", name: "Unidad histórica", unit: "ml", kind });
    const saved = { ...original, measurementUnit: { ...original.measurementUnit, isActive: false },
      unitDenomination: withDenomination ? { id: 91, denomination: "de archivo lineal", isActive: true } : null,
      unitLabel: withDenomination ? "m.l. de archivo lineal" : "m.l." };
    const backend = createServiceCatalogBackend([...sampleCatalog(), saved]);
    backend.baseUnits.find((unit) => unit.id === 6).isActive = false;
    backend.denominations.push({ ...denominationRecord({ id: 91, denomination: "de archivo lineal", unit: "ml" }), measurementUnit: saved.measurementUnit });
    const page = await openTabulator(context, backend, { theme: "dark", viewport: { width: 375, height: 812 } });
    await page.getByRole("button", { name: "Editar TST-007 Unidad histórica" }).click();
    const dialog = page.getByRole("dialog", { name: "Servicio", exact: true });
    assert.deepEqual(await unitSuggestions(page), []);
    assert.equal(await dialog.getByRole("combobox", { name: /^Unidad base del servicio/ }).innerText(), "m.l.");
    assert.equal((await baseOptionNames(page)).includes("m.l., Metro lineal"), false, "El valor histórico no es una opción nueva");
    assert.equal(await dialog.getByRole("button", { name: /^Quitar / }).count(), withDenomination ? 1 : 0);
    if (!withDenomination) assert.equal(await dialog.locator("#service-form-unit").getAttribute("placeholder"), "Sin denominación guardada");
    assert.equal(await dialog.evaluate((element) => element.querySelector("form").scrollWidth <= element.querySelector("form").clientWidth), true);
    await dialog.locator("#service-form-name").fill("Unidad histórica editada");
    await dialog.getByPlaceholder("Descripción del servicio.").fill("Se conserva la unidad guardada.");
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/7$/).at(-1).body,
      { expectedVersion: 1, name: "Unidad histórica editada", description: "Se conserva la unidad guardada." });
    const updated = backend.items.find((item) => item.id === 7);
    assert.equal(updated.measurementUnit.id, 6);
    assert.equal(updated.measurementUnit.isActive, false);
    assert.equal(updated.unitDenomination?.id ?? null, withDenomination ? 91 : null);
    assert.equal(updated.kind, kind);
  }
});

test("edición: restaurar base y denominación originales no envía PATCH; cancelar conserva los registros", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const openEdit = async () => {
    await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
    const dialog = page.getByRole("dialog", { name: "Servicio", exact: true });
    await unitSuggestions(page);
    return dialog;
  };
  let dialog = await openEdit();
  await chooseBase(page, "m³, Metro cúbico");
  await chooseDenomination(page, "m³ de excavación");
  await chooseBase(page, "m², Metro cuadrado");
  await chooseDenomination(page, "m² de construcción");
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("alert").getByText("Sin cambios", { exact: true }).waitFor();
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).length, 0);
  dialog = await openEdit();
  await chooseBase(page, "m³, Metro cúbico");
  await chooseDenomination(page, "m³ de excavación");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).length, 0);
  assert.equal(backend.items[0].measurementUnit.id, 1);
  assert.equal(backend.items[0].unitDenomination.id, 10);
});

/**
 * Abre «Nuevo servicio» con un borrador completo y la base m² elegida.
 *
 * @param {import("playwright").Page} page - Página del tabulador.
 * @returns {Promise<import("playwright").Locator>} Diálogo.
 */
async function openDraft(page) {
  const dialog = await openCreate(page);
  await dialog.locator("#service-form-name").fill(DRAFT.name);
  await chooseModality(page, DRAFT.modality);
  await dialog.getByPlaceholder("Descripción del servicio.").fill(DRAFT.description);
  await dialog.getByPlaceholder("0.00").fill("3000");
  await chooseBase(page, "m², Metro cuadrado");
  return dialog;
}

test("crear unidad en el mismo modal: oculta al inicio, se despliega sin otro diálogo y se cancela conservando el borrador", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openDraft(page);
  assert.equal(await page.locator("[data-service-unit-create]").count(), 0, "Oculta al inicio");

  const row = await openUnitCreation(page);
  assert.equal(await page.getByRole("dialog").count(), 1, "Sin segundo modal ni overlay");
  assert.equal(await page.getByRole("dialog", { name: "Nueva unidad de medida" }).count(), 0);
  // Figma 5767:342334: el botón cede su lugar a la fila; el foco va al campo nuevo.
  assert.equal(await dialog.getByRole("button", { name: "Crear unidad" }).count(), 0);
  await page.waitForFunction(() => document.activeElement?.id === "service-form-new-unit");
  assert.equal(await row.getByText("Nombre de la unidad", { exact: true }).count(), 1);
  assert.equal(await row.getByPlaceholder("Ej. “de recorrido comercial”").count(), 1);
  assert.equal(await row.getByRole("button", { name: "Guardar" }).isVisible(), true);
  // La base del servicio se precarga y las opciones son las bases activas reales.
  assert.match(await page.getByRole("combobox", { name: /^Unidad base de la nueva unidad/ }).innerText(), /m²/);
  assert.equal((await newUnitBaseOptions(page)).length, 4);
  // Ocupa su propio espacio debajo de la unidad y la tarifa, sin superponerse.
  const geometry = await page.evaluate(() => {
    const rate = document.querySelector('input[placeholder="0.00"]').getBoundingClientRect();
    const created = document.querySelector("[data-service-unit-create]").getBoundingClientRect();
    return { below: created.top >= rate.bottom };
  });
  assert.deepEqual(geometry, { below: true });

  // Escape cierra solo la fila: el modal sigue abierto y el foco vuelve a «Crear unidad».
  await row.getByPlaceholder("Ej. “de recorrido comercial”").fill("no se guarda");
  await page.keyboard.press("Escape");
  await row.waitFor({ state: "detached" });
  assert.equal(await dialog.isVisible(), true);
  await page.waitForFunction(() => document.activeElement?.matches("[data-service-create-unit]"));
  await assertDraftKept(page, DRAFT);
  assert.equal(await dialog.getByRole("combobox", { name: /^Unidad base del servicio/ }).innerText(), "m²");

  // El enlace discreto «Cancelar» también la cierra sin escribir nada.
  const again = await openUnitCreation(page);
  await again.getByPlaceholder("Ej. “de recorrido comercial”").fill("tampoco");
  await again.getByRole("button", { name: "Cancelar la creación de la unidad" }).click();
  await again.waitFor({ state: "detached" });
  await assertDraftKept(page, DRAFT);
  assert.equal(requestsOf(backend, "POST", /measurement-unit-denominations$/).length, 0, "Cancelar no escribe");
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0);
});

test("crear unidad en el mismo modal: guarda con la API, la selecciona y el servicio se crea después", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openDraft(page);
  const row = await openUnitCreation(page);

  // Validación compartida con Unidades.
  await row.getByRole("button", { name: "Guardar" }).click();
  await row.getByText("Escribe el nombre de la unidad.", { exact: true }).waitFor();
  assert.equal(requestsOf(backend, "POST", /measurement-unit-denominations$/).length, 0);

  // Un doble clic con la petición en curso envía una sola vez.
  backend.delays["POST /api/admin/measurement-unit-denominations"] = 400;
  await row.getByPlaceholder("Ej. “de recorrido comercial”").fill("  de   prueba nueva ");
  await row.getByRole("button", { name: "Guardar" }).dblclick();
  await row.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "POST", /measurement-unit-denominations$/).map((request) => request.body),
    [{ denomination: "de prueba nueva", measurementUnitId: 1 }], "Una sola alta, normalizada como en Unidades");
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0, "Crear la unidad no guarda el servicio");

  // Queda elegida, con alerta de éxito y el foco en la unidad; el modal sigue abierto.
  await dialog.getByRole("button", { name: "Quitar de prueba nueva" }).waitFor();
  await page.getByRole("alert").getByText("Unidad creada", { exact: true }).waitFor();
  await page.getByRole("alert").getByText("m² de prueba nueva", { exact: true }).waitFor();
  assert.equal(await dialog.getByText(/creada y seleccionada/).count(), 0);
  await page.waitForFunction(() => document.activeElement?.id === "service-form-unit");
  await dialog.getByRole("button", { name: "Crear unidad" }).waitFor();
  await assertDraftKept(page, DRAFT);

  // El servicio se crea después, con la denominación nueva.
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("alert").getByText("Servicio creado", { exact: true }).waitFor();
  const [post] = requestsOf(backend, "POST", /^\/api\/admin\/services$/);
  assert.deepEqual([post.body.measurementUnitId, post.body.unitDenominationId], [1, 14]);
  await rowFor(page, "SERV-006").getByText("m² de prueba nueva", { exact: true }).waitFor();
});

test("crear unidad en el mismo modal: Enter guarda la unidad y no envía el servicio", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openDraft(page);
  const row = await openUnitCreation(page);
  await row.getByPlaceholder("Ej. “de recorrido comercial”").fill("de teclado");
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Quitar de teclado" }).waitFor();
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0);
  assert.equal(await dialog.isVisible(), true);
});

test("crear unidad en el mismo modal: duplicados, 400, otros 409 y error de red sin perder lo escrito", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  // Una denominación inactiva equivalente: no está entre las activas leídas, solo el backend la conoce.
  backend.denominations.push(denominationRecord({ id: 90, denomination: "de archivo", isActive: false, unit: "m2" }));
  const page = await openTabulator(context, backend);
  const dialog = await openDraft(page);
  let row = await openUnitCreation(page);
  const text = row.getByPlaceholder("Ej. “de recorrido comercial”");
  const save = row.getByRole("button", { name: "Guardar" });
  const posts = () => requestsOf(backend, "POST", /measurement-unit-denominations$/).length;

  // Duplicado evidente (misma clave que el índice de PostgreSQL): no se envía y se ofrece la existente.
  await text.fill("DE CONSTRUCCIÓN");
  await save.click();
  await row.getByText("Ya existe «m² de construcción» en esta unidad base.", { exact: true }).waitFor();
  assert.equal(posts(), 0);
  assert.equal(await text.inputValue(), "DE CONSTRUCCIÓN");

  // 409 de duplicado del backend (equivalente inactiva): mensaje del backend, sin ofrecer una opción que no existe.
  await text.fill("De Archivo");
  await save.click();
  await row.getByText("Ya existe una denominación equivalente para esa unidad de medida.", { exact: true }).waitFor();
  assert.equal(await row.getByRole("button", { name: /^Usar/ }).count(), 0);
  assert.equal(posts(), 1);

  // 400 con error de campo.
  backend.failures["POST /api/admin/measurement-unit-denominations"] = { status: 400, body: { code: "VALIDATION_ERROR", message: "Datos inválidos.", fields: { "body.denomination": "No admite ese texto." } } };
  await text.fill("de otra prueba");
  await save.click();
  await row.getByText("No admite ese texto.", { exact: true }).waitFor();

  // Otro 409 (no es un duplicado): mensaje general, sin ofrecer la existente.
  backend.failures["POST /api/admin/measurement-unit-denominations"] = { status: 409, body: { code: "MEASUREMENT_UNIT_CONFLICT", message: "La unidad de medida entra en conflicto con un registro existente." } };
  await save.click();
  await row.getByRole("alert").getByText("La unidad de medida entra en conflicto con un registro existente.", { exact: true }).waitFor();
  assert.equal(await row.getByRole("button", { name: /^Usar/ }).count(), 0);
  delete backend.failures["POST /api/admin/measurement-unit-denominations"];

  // Error de red: se explica y se conserva el texto.
  await page.route("**/api/admin/measurement-unit-denominations", (route) => (route.request().method() === "POST" ? route.abort("failed") : route.fallback()));
  await save.click();
  await row.getByRole("alert").waitFor();
  assert.equal(await text.inputValue(), "de otra prueba");
  await page.unroute("**/api/admin/measurement-unit-denominations");
  await assertDraftKept(page, DRAFT);

  // «Usar» elige la existente equivalente sin crear nada.
  await text.fill("de Construcción");
  await save.click();
  const postsBefore = posts();
  await row.getByRole("button", { name: "Usar «m² de construcción»" }).click();
  await row.waitFor({ state: "detached" });
  await dialog.getByRole("button", { name: "Quitar de construcción" }).waitFor();
  assert.equal(posts(), postsBefore);
  await assertDraftKept(page, DRAFT);
  row = page.locator("[data-service-unit-create]");
  assert.equal(await row.count(), 0);
});

test("crear unidad en la edición: precarga la base del servicio, la crea y la guarda con expectedVersion", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  await page.getByRole("button", { name: "Editar TST-002 Diseño interior de prueba" }).click();
  const dialog = page.getByRole("dialog", { name: "Servicio" });
  await dialog.locator("#service-form-name").waitFor();
  const row = await openUnitCreation(page);
  assert.match(await page.getByRole("combobox", { name: /^Unidad base de la nueva unidad/ }).innerText(), /m²/);
  await row.getByPlaceholder("Ej. “de recorrido comercial”").fill("de edición");
  await row.getByRole("button", { name: "Guardar" }).click();
  await dialog.getByRole("button", { name: "Quitar de edición" }).waitFor();
  assert.equal(await dialog.locator("#service-form-name").inputValue(), "Diseño interior de prueba");
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/2$/).at(-1).body, { expectedVersion: 1, unitDenominationId: 14 });
});

test("crear unidad en el mismo modal: responsive, scroll interno con poca altura y pie visible (claro y oscuro)", async (context) => {
  for (const theme of ["light", "dark"]) {
    const backend = createServiceCatalogBackend(sampleCatalog());
    const page = await openTabulator(context, backend, { theme, viewport: { width: 375, height: 560 } });
    for (const [width, height] of [[375, 560], [375, 812], [768, 1024], [1024, 768], [1440, 700]]) {
      await page.setViewportSize({ width, height });
      const dialog = await openCreate(page);
      await chooseBase(page, "m², Metro cuadrado");
      const row = await openUnitCreation(page);
      await page.waitForFunction(() => document.activeElement?.id === "service-form-new-unit");
      const layout = await page.evaluate(() => {
        const box = document.querySelector("[data-service-form]").getBoundingClientRect();
        const form = document.querySelector("#service-form");
        const footer = document.querySelector("[data-service-form] footer").getBoundingClientRect();
        const field = document.querySelector("#service-form-new-unit").getBoundingClientRect();
        const createRow = document.querySelector("[data-service-unit-create]").getBoundingClientRect();
        const save = [...document.querySelectorAll("[data-service-unit-create] button")].find((button) => button.textContent.trim() === "Guardar").getBoundingClientRect();
        const rate = document.querySelector('input[placeholder="0.00"]').getBoundingClientRect();
        const formBox = form.getBoundingClientRect();
        return {
          inside: box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight + 0.5,
          noHorizontalOverflow: form.scrollWidth <= form.clientWidth && document.documentElement.scrollWidth <= window.innerWidth,
          footerVisible: footer.top >= box.top && footer.bottom <= box.bottom + 0.5,
          // Toda la fila (campo, Guardar y Cancelar) queda a la vista dentro del área con scroll.
          fieldVisible: createRow.top >= formBox.top - 0.5 && createRow.bottom <= formBox.bottom + 0.5,
          saveBesideField: save.left >= field.right - 0.5 && save.right <= box.right,
          belowRate: field.top > rate.bottom,
          scrolls: form.scrollHeight > form.clientHeight,
        };
      });
      const label = `${theme} ${width}x${height}: ${JSON.stringify(layout)}`;
      assert.deepEqual({ ...layout, scrolls: undefined }, { inside: true, noHorizontalOverflow: true, footerVisible: true, fieldVisible: true, saveBesideField: true, belowRate: true, scrolls: undefined }, label);
      if (height <= 560) assert.equal(layout.scrolls, true, `${label}: con poca altura el contenido desplaza dentro del modal`);
      assert.notEqual(await row.evaluate((element) => getComputedStyle(element.closest("[data-service-form]")).backgroundColor), "rgba(0, 0, 0, 0)");
      // Escape cierra la fila; un segundo Escape cierra el modal.
      await page.keyboard.press("Escape");
      await row.waitFor({ state: "detached" });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    }
  }
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
  await dialog.getByPlaceholder("0.00").fill("1500");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).at(-1).body, { expectedVersion: 1, referenceRate: "15.00" });
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

  // Cambiar de unidad a otra base (el símbolo filtra las sugerencias) envía la base y la unidad juntas.
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  await dialog.locator("#service-form-name").waitFor();
  await chooseBase(page, "m³, Metro cúbico");
  await chooseDenomination(page, "m³ de excavación");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).at(-1).body, { expectedVersion: 3, measurementUnitId: 13, unitDenominationId: 13 });
});

test("edición: el mismo modal valida los campos y Cancelar descarta lo escrito sin enviar nada", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  const dialog = page.getByRole("dialog", { name: "Servicio" });
  await dialog.locator("#service-form-name").waitFor();
  // Un único modal: en edición cambian título y acción, no el formulario.
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(await dialog.getByRole("button", { name: "Crear", exact: true }).count(), 0);
  assert.equal(await dialog.getByRole("button", { name: "Guardar" }).isVisible(), true);

  // Las validaciones del alta también se aplican al editar.
  await dialog.locator("#service-form-name").fill("");
  await dialog.getByPlaceholder("0.00").fill("");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  for (const message of ["Escribe el nombre del servicio.", "Indica la tarifa."]) {
    await dialog.getByText(message, { exact: true }).waitFor();
  }
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).length, 0, "No se envía una edición inválida");

  // Cancelar descarta lo escrito: no hay PATCH, la fila no cambia y al reabrir se leen los datos vigentes.
  await dialog.locator("#service-form-name").fill("Nombre que no se guarda");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).length, 0);
  await rowFor(page, "TST-001").getByText("Anteproyecto de prueba", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  await dialog.locator("#service-form-name").waitFor();
  await page.waitForFunction(() => document.querySelector("#service-form-name")?.value === "Anteproyecto de prueba");
  assert.equal(await dialog.getByPlaceholder("0.00").inputValue(), "12.00");
});

test("edición de un servicio llave en mano: no envía el tipo y la fila conserva su modalidad", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  assert.equal((await rowFor(page, "TST-003").locator("[data-service-modality]").innerText()).trim(), "Llave en mano");
  await page.getByRole("button", { name: "Editar TST-003 Paisajismo de prueba" }).click();
  const dialog = page.getByRole("dialog", { name: "Servicio" });
  await dialog.locator("#service-form-name").waitFor();
  // La modalidad guardada se precarga y, sin cambiarla, no viaja en el PATCH.
  assert.match(await page.getByRole("button", { name: "Modalidad de contratación", exact: true }).innerText(), /Llave en mano/);
  assert.deepEqual(await baseOptionNames(page), ["m², Metro cuadrado"], "Llave en mano solo ofrece m²");
  await dialog.locator("#service-form-name").fill("Paisajismo de prueba editado");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/3$/).at(-1).body, { expectedVersion: 1, name: "Paisajismo de prueba editado" });
  await rowFor(page, "TST-003").getByText("Paisajismo de prueba editado", { exact: true }).waitFor();
  assert.equal((await rowFor(page, "TST-003").locator("[data-service-modality]").innerText()).trim(), "Llave en mano");
});

test("alta llave en mano: solo unidades m², retira la unidad incompatible y crea el servicio turnkey", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  await dialog.locator("#service-form-name").fill("Residencial de prueba");
  await dialog.getByPlaceholder("0.00").fill("85000");
  assert.deepEqual(await unitSuggestions(page), [], "Sin base no se ofrecen denominaciones");
  await chooseBase(page, "pto., Punto");
  assert.deepEqual(await unitSuggestions(page), ["pto. eléctrico"]);
  await chooseDenomination(page, "pto. eléctrico");

  // Llave en mano: la unidad de puntos ya elegida es incompatible y se retira; solo quedan las de m².
  await chooseModality(page, "Llave en mano");
  assert.equal(await dialog.getByRole("button", { name: "Quitar eléctrico" }).count(), 0);
  assert.deepEqual(await baseOptionNames(page), ["m², Metro cuadrado"]);
  assert.deepEqual(await unitSuggestions(page), [], "Cambiar la modalidad no inventa una base seleccionada");
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await dialog.getByText("Elige la unidad de medida.", { exact: true }).waitFor();
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0);

  // «+ Crear unidad» en llave en mano solo permite la base m² (sin otro diálogo).
  const unitRow = await openUnitCreation(page);
  // Única base permitida: el selector queda fijado en m² (deshabilitado) y no ofrece otras.
  const newUnitBase = page.getByRole("combobox", { name: /^Unidad base de la nueva unidad/ });
  assert.match(await newUnitBase.innerText(), /m²/);
  assert.equal(await newUnitBase.isDisabled(), true);
  await unitRow.getByRole("button", { name: "Cancelar la creación de la unidad" }).click();
  await unitRow.waitFor({ state: "detached" });

  await chooseBase(page, "m², Metro cuadrado");
  assert.deepEqual(await unitSuggestions(page), ["m² a intervenir", "m² de construcción"]);
  await chooseDenomination(page, "m² de construcción");
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const [post] = requestsOf(backend, "POST", /^\/api\/admin\/services$/);
  assert.deepEqual(post.body, { name: "Residencial de prueba", kind: "turnkey", measurementUnitId: 1, unitDenominationId: 10, referenceRate: "850.00" });
  const row = rowFor(page, "SERV-006");
  await row.waitFor();
  assert.equal((await row.locator("[data-service-modality]").innerText()).trim(), "Llave en mano");
  assert.equal(await row.locator("[data-service-modality]").getAttribute("data-service-modality"), "turnkey");
});

test("alta: cambiar de llave en mano a individual conserva la unidad m² elegida", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  await chooseModality(page, "Llave en mano");
  await chooseBase(page, "m², Metro cuadrado");
  await chooseDenomination(page, "m² a intervenir");
  await chooseModality(page, "Detalle por detalle");
  await dialog.getByRole("button", { name: "Quitar a intervenir" }).waitFor();
  assert.equal((await baseOptionNames(page)).length, 3, "Individual vuelve a ofrecer las bases con denominaciones activas");
});

test("edición: la modalidad cambia solo por elección explícita y llave en mano exige m²", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  // TST-005: individual con unidad «pto. eléctrico».
  await page.getByRole("button", { name: "Editar TST-005 Puntos eléctricos de prueba" }).click();
  const dialog = page.getByRole("dialog", { name: "Servicio" });
  await dialog.locator("#service-form-name").waitFor();
  assert.match(await page.getByRole("button", { name: "Modalidad de contratación", exact: true }).innerText(), /Detalle por detalle/);

  // Pasar a llave en mano retira la unidad incompatible: no se puede guardar sin elegir m².
  await chooseModality(page, "Llave en mano");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.getByText("Elige la unidad de medida.", { exact: true }).waitFor();
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/5$/).length, 0);

  // Volver a individual sin guardar no envía nada: la modalidad no cambia sola.
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/5$/).length, 0);
  assert.equal((await rowFor(page, "TST-005").locator("[data-service-modality]").innerText()).trim(), "Detalle por detalle");

  // Cambio explícito con una unidad m²: viaja la modalidad con la unidad y la versión leída.
  await page.getByRole("button", { name: "Editar TST-005 Puntos eléctricos de prueba" }).click();
  await dialog.locator("#service-form-name").waitFor();
  await chooseModality(page, "Llave en mano");
  await chooseBase(page, "m², Metro cuadrado");
  await chooseDenomination(page, "m² de construcción");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/5$/).at(-1).body, {
    expectedVersion: 1, kind: "turnkey", measurementUnitId: 1, unitDenominationId: 10,
  });
  // El listado se recarga tras guardar: se espera a la fila actualizada.
  await rowFor(page, "TST-005").locator("[data-service-modality]", { hasText: "Llave en mano" }).waitFor();
});

test("precisión y errores: tarifa decimal exacta, 400 por campo y 409 de versión sin perder lo escrito", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  await page.getByRole("button", { name: "Editar TST-002 Diseño interior de prueba" }).click();
  const dialog = page.getByRole("dialog", { name: "Servicio" });
  await dialog.locator("#service-form-name").waitFor();
  assert.equal(await dialog.getByPlaceholder("0.00").inputValue(), "1250.50");

  // Caja registradora: los dígitos entran por la derecha con dos céntimos fijos; letras y signos
  // se ignoran, Backspace quita el último dígito y no se superan 12 enteros y 2 decimales.
  const rate = dialog.getByPlaceholder("0.00");
  assert.equal(await rate.evaluate((input) => getComputedStyle(input).textAlign), "right");
  await rate.fill("");
  const typed = [];
  for (const key of ["1", "0", "0", "a", "-", "."]) {
    await rate.press(key);
    typed.push(await rate.inputValue());
  }
  assert.deepEqual(typed, ["0.01", "0.10", "1.00", "1.00", "1.00", "1.00"]);
  await rate.press("Backspace");
  assert.equal(await rate.inputValue(), "0.10");
  await rate.press("Backspace");
  await rate.press("Backspace");
  assert.equal(await rate.inputValue(), "", "Borrar hasta el final vacía el campo");
  await rate.pressSequentially("1234567890123456");
  assert.equal(await rate.inputValue(), "123456789012.34", "Tope de NUMERIC(14,2)");
  // Pegar un importe lo respeta como importe (no como dígitos desplazados).
  await rate.evaluate((input) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text", "12.5");
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  assert.equal(await rate.inputValue(), "12.50");
  // Un campo vaciado sigue validándose localmente, sin petición.
  await rate.fill("");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.getByText("Indica la tarifa.", { exact: true }).waitFor();
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
      await chooseDenomination(page, "m² de construcción");
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
