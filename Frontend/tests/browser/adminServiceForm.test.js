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

const UNIT_LISTBOX = { name: "Unidades de medida registradas", exact: true };

/**
 * Escapa un texto para usarlo literalmente en una expresión regular.
 *
 * @param {string} text - Texto literal.
 * @returns {string} Patrón equivalente.
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Contenedor visible del campo de unidad (prefijo, Tag y texto). Con una unidad elegida el campo
 * nativo no ocupa ancho, así que el usuario (y las pruebas) pulsan el contenedor.
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {import("playwright").Locator} Contenedor del campo.
 */
function unitShell(page) {
  return page.locator("[data-service-form] [data-input-shell]", { has: page.locator("#service-form-unit") });
}

/**
 * Espera a que el catálogo de unidades termine de cargar y hace clic en el combobox de unidad.
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<void>}
 */
async function openUnitList(page) {
  await page.locator("#service-form-unit").waitFor({ state: "attached" });
  await page.waitForFunction(() => !document.querySelector("[data-service-form]")?.textContent.includes("Cargando unidades de medida"));
  await unitShell(page).click();
}

/**
 * Elige una unidad registrada en el combobox «Unidad de medida» (clic y opción del listado).
 *
 * @param {import("playwright").Page} page - Página.
 * @param {string} label - Etiqueta de la unidad con su símbolo («m² de construcción»).
 * @returns {Promise<void>}
 */
async function chooseUnit(page, label) {
  await openUnitList(page);
  const listbox = page.getByRole("listbox", UNIT_LISTBOX);
  await listbox.getByRole("option", { name: new RegExp(`^${escapeRegExp(label)}(,|$)`) }).click();
  await listbox.waitFor({ state: "detached" });
}

/**
 * Abre el combobox y devuelve sus opciones ordenadas: las unidades registradas (denominaciones,
 * sin el nombre de la base) o, con `baseOnly`, las bases ofrecidas sin denominación. Lo cierra
 * quitando el foco, sin pulsar Escape (que con el listado vacío cerraría el modal).
 *
 * @param {import("playwright").Page} page - Página.
 * @param {{baseOnly?: boolean}} [options] - Qué filas leer.
 * @returns {Promise<Array<string>>} Etiquetas ofrecidas.
 */
async function unitSuggestions(page, { baseOnly = false } = {}) {
  await openUnitList(page);
  const listbox = page.getByRole("listbox", UNIT_LISTBOX);
  const names = (await listbox.count())
    ? await listbox.getByRole("option").evaluateAll((options, wantBaseOnly) => options
      .filter((option) => option.hasAttribute("data-unit-base-only") === wantBaseOnly)
      .map((option) => option.getAttribute("aria-label").replace(/, [^,]+$/, "")), baseOnly)
    : [];
  await page.locator("#service-form-unit").evaluate((element) => element.blur());
  await listbox.waitFor({ state: "detached" });
  return names.sort();
}

/**
 * Símbolos distintos de las unidades registradas ofrecidas (denominaciones), ordenados.
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<Array<string>>} Símbolos («m²», «m³»…).
 */
async function unitSymbolsOffered(page) {
  await openUnitList(page);
  const listbox = page.getByRole("listbox", UNIT_LISTBOX);
  const symbols = (await listbox.count())
    ? await listbox.locator('[role="option"]:not([data-unit-base-only])').evaluateAll((options) => options.map((option) => option.querySelector("span").textContent.trim()))
    : [];
  await page.locator("#service-form-unit").evaluate((element) => element.blur());
  return [...new Set(symbols)].sort();
}

/**
 * Símbolo que muestra el prefijo del campo de unidad (vacío sin unidad elegida).
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<string>} Símbolo visible.
 */
async function unitSymbol(page) {
  const prefix = page.locator("[data-service-form] [data-input-prefix-display]");
  return (await prefix.count()) ? (await prefix.innerText()).trim() : "";
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

test("unidad: un único combobox con búsqueda en el campo, símbolo y categoría, y una sola por servicio", async (context) => {
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
  const listbox = page.getByRole("listbox", UNIT_LISTBOX);
  await page.waitForFunction(() => !document.querySelector("[data-service-form]")?.textContent.includes("Cargando unidades de medida"));
  const reads = requestsOf(backend, "GET", /measurement-unit-denominations$/);
  assert.ok(reads.length >= 1 && reads.every((request) => request.params.status === "active" && !request.params.measurementUnitId), JSON.stringify(reads.map((r) => r.params)));
  // Un solo control: el propio campo es el combobox, sin selector de símbolo ni buscador aparte.
  assert.equal(await input.getAttribute("role"), "combobox");
  assert.equal(await input.getAttribute("placeholder"), "Buscar unidad");
  assert.equal(await input.evaluate((element) => element.readOnly), false);
  assert.equal(await input.getAttribute("aria-expanded"), "false");
  assert.equal(await dialog.getByRole("combobox").count(), 1, "Sin un segundo desplegable anidado");
  assert.equal(await unitSymbol(page), "", "Sin unidad no hay símbolo");

  // Clic: se despliegan las unidades registradas activas de todas las bases.
  await input.click();
  await listbox.waitFor();
  assert.equal(await input.getAttribute("aria-expanded"), "true");
  assert.equal(await input.getAttribute("aria-controls"), await listbox.getAttribute("id"));
  assert.deepEqual(await unitSuggestions(page), ["m² a intervenir", "m² de construcción", "m³ de excavación", "pto. eléctrico"]);

  // Agrupadas por unidad base en el orden del catálogo de bases: un encabezado «Nombre (símbolo)»
  // por grupo (no es una opción), primero la base sola (sin denominación) y después sus unidades.
  const grouped = () => listbox.getByRole("group").evaluateAll((groups) => groups.map((group) => [
    group.querySelector("[data-option-group-header]").textContent,
    [...group.querySelectorAll("[role=option]")].map((option) => option.getAttribute("aria-label").replace(/, [^,]+$/, "")),
  ]));
  await input.click();
  await listbox.waitFor();
  assert.deepEqual(await grouped(), [
    ["Metro cuadrado (m²)", ["m²", "m² de construcción", "m² a intervenir"]],
    ["Metro lineal (m.l.)", ["m.l."]],
    ["Metro cúbico (m³)", ["m³", "m³ de excavación"]],
    ["Punto (pto.)", ["pto.", "pto. eléctrico"]],
  ]);
  assert.equal(await listbox.getByRole("group", { name: "Metro cuadrado (m²)" }).count(), 1, "El encabezado nombra su grupo");
  assert.equal(await listbox.locator("[data-unit-base-only]").first().innerText(), "m²\nsin denominación");
  // El teclado recorre solo opciones (circular): aria-activedescendant nunca señala un encabezado.
  const visited = [];
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("ArrowDown");
    const activeId = await input.getAttribute("aria-activedescendant");
    visited.push(await page.locator(`[id="${activeId}"]`).getAttribute("aria-label"));
  }
  assert.deepEqual(visited.map((label) => label.replace(/, [^,]+$/, "")),
    ["m² de construcción", "m² a intervenir", "m.l.", "m³", "m³ de excavación"]);
  await page.keyboard.press("End");
  assert.equal(await page.locator(`[id="${await input.getAttribute("aria-activedescendant")}"]`).getAttribute("role"), "option");
  await input.evaluate((element) => element.blur());
  await listbox.waitFor({ state: "detached" });

  // Escribir filtra en el mismo campo por categoría, símbolo o nombre de la base, sin mayúsculas ni acentos.
  const offered = () => listbox.getByRole("option").evaluateAll((options) => options.map((option) => option.getAttribute("aria-label")));
  await input.click();
  await input.fill("CONSTRUCCION");
  assert.deepEqual(await offered(), ["m² de construcción, Metro cuadrado"]);
  await input.fill("m2");
  assert.deepEqual(await offered(), ["m², Metro cuadrado", "m² de construcción, Metro cuadrado", "m² a intervenir, Metro cuadrado"], "En el orden del catálogo");
  await input.fill("cubico");
  assert.deepEqual(await offered(), ["m³, Metro cúbico", "m³ de excavación, Metro cúbico"]);
  assert.deepEqual(await grouped(), [["Metro cúbico (m³)", ["m³", "m³ de excavación"]]], "Solo grupos con resultados");
  // Sin resultados: el listado se cierra y se indica crear la unidad.
  await input.fill("volumen");
  await listbox.waitFor({ state: "detached" });
  await dialog.getByText("No hay unidades que coincidan con «volumen». Puedes crearla con «Crear unidad».", { exact: true }).waitFor();
  await input.fill("");

  // Elegir una unidad cierra el listado: el prefijo muestra su símbolo y el Tag su categoría.
  await chooseUnit(page, "m² a intervenir");
  await dialog.getByRole("button", { name: "Quitar a intervenir" }).waitFor();
  assert.equal(await unitSymbol(page), "m²");
  assert.equal(await input.inputValue(), "");
  assert.equal(await page.locator("#service-form-unit-selection").innerText(), "Seleccionada: m² a intervenir");
  // Volver a hacer clic permite buscar otra; la vigente figura como seleccionada.
  await unitShell(page).click();
  assert.equal(await listbox.getByRole("option", { name: /^m² a intervenir/ }).getAttribute("aria-selected"), "true");
  await page.keyboard.type("excav");
  await listbox.getByRole("option", { name: /^m³ de excavación/ }).click();
  await dialog.getByRole("button", { name: "Quitar de excavación" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: /^Quitar / }).count(), 1, "Una sola unidad por servicio");
  assert.equal(await unitSymbol(page), "m³", "El símbolo acompaña a la nueva unidad");
  // Escribir y pulsar Enter con un texto que no existe no crea unidades; Escape descarta la
  // búsqueda y vuelve a mostrar la unidad elegida.
  await page.keyboard.type("inventada");
  await page.keyboard.press("Enter");
  assert.equal(await dialog.getByRole("button", { name: "Quitar inventada" }).count(), 0);
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Quitar de excavación" }).waitFor();
  assert.equal(await input.inputValue(), "");
  assert.equal(await dialog.isVisible(), true, "Escape con búsqueda no cierra el modal");
  assert.equal(requestsOf(backend, "GET", /measurement-unit-denominations$/).length, reads.length, "La búsqueda reutiliza el catálogo leído");
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0, "Enter en la búsqueda no envía el servicio");

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

/**
 * Mide la presentación de la unidad elegida dentro del campo: el símbolo en el segmento
 * izquierdo y el Tag en el derecho, ambos visibles (el punto central de cada uno pertenece al
 * propio elemento, no a otro que lo tape o lo recorte) y dentro del borde del campo.
 *
 * @param {import("playwright").Page} page - Página con el formulario abierto.
 * @returns {Promise<Object>} Geometría y textos visibles.
 */
function measureUnitSelection(page) {
  return page.evaluate(() => {
    const input = document.querySelector("#service-form-unit");
    const shell = input.closest("[data-input-shell]");
    const prefix = shell.querySelector("[data-input-prefix-display]");
    const close = shell.querySelector("button[aria-label^='Quitar']");
    const tag = close?.parentElement ?? null;
    const box = (element) => element?.getBoundingClientRect() ?? null;
    const visibleAt = (element) => {
      const rect = box(element);
      if (!rect || !rect.width || !rect.height) return false;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(hit && (element === hit || element.contains(hit)));
    };
    const shellBox = box(shell);
    const prefixBox = box(prefix);
    const tagBox = box(tag);
    const inside = (rect) => Boolean(rect) && rect.left >= shellBox.left - 0.5 && rect.right <= shellBox.right + 0.5
      && rect.top >= shellBox.top - 0.5 && rect.bottom <= shellBox.bottom + 0.5;
    return {
      symbol: prefix?.innerText.trim() ?? "",
      tag: tag?.querySelector("span.truncate")?.textContent ?? "",
      symbolVisible: visibleAt(prefix) && inside(prefixBox),
      tagVisible: visibleAt(tag) && inside(tagBox),
      symbolBeforeTag: Boolean(prefixBox && tagBox) && prefixBox.right <= tagBox.left + 0.5,
      notScrolled: input.parentElement.scrollLeft === 0,
      placeholder: input.placeholder,
      value: input.value,
    };
  });
}

for (const theme of ["light", "dark"]) {
  test(`unidad (${theme}): «m² de construcción» muestra símbolo y Tag visibles en 375 y 1440 px, también al buscar, cancelar y salir del campo`, async (context) => {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }]) {
      const backend = createServiceCatalogBackend(sampleCatalog());
      backend.denominations.push(denominationRecord({ id: 77, denomination: "de construcción con acabados", unit: "m2" }));
      const page = await openTabulator(context, backend, { theme, viewport });
      const label = `${theme} ${viewport.width}px`;
      const selected = (tag) => ({ notScrolled: true, placeholder: "", symbol: "m²", symbolBeforeTag: true, symbolVisible: true, tag, tagVisible: true, value: "" });
      const listbox = page.getByRole("listbox", UNIT_LISTBOX);
      const dialog = await openCreate(page);

      // Clic: ambos segmentos visibles en su lugar, con y sin foco.
      await chooseUnit(page, "m² de construcción");
      assert.deepEqual(await measureUnitSelection(page), selected("de construcción"), `${label}: tras elegir`);
      await dialog.locator("#service-form-name").click();
      assert.deepEqual(await measureUnitSelection(page), selected("de construcción"), `${label}: sin foco`);

      // Buscar sustituye temporalmente el Tag por el texto; Escape lo restaura sin perder la unidad.
      await unitShell(page).click();
      await page.keyboard.type("acabados");
      const searching = await measureUnitSelection(page);
      assert.equal(searching.symbol, "m²", `${label}: el símbolo se conserva al buscar`);
      assert.equal(searching.value, "acabados");
      await page.keyboard.press("Escape");
      await listbox.waitFor({ state: "detached" });
      assert.deepEqual(await measureUnitSelection(page), selected("de construcción"), `${label}: Escape restaura la unidad`);
      assert.equal(await dialog.isVisible(), true);

      // Salir del campo en plena búsqueda también la descarta.
      await unitShell(page).click();
      await page.keyboard.type("acab");
      await dialog.locator("#service-form-name").click();
      assert.deepEqual(await measureUnitSelection(page), selected("de construcción"), `${label}: salir descarta la búsqueda`);

      // Reemplazar por una denominación larga (teclado) cambia símbolo y Tag juntos y no la desplaza fuera de la vista.
      await unitShell(page).click();
      await page.keyboard.type("acabados");
      await page.keyboard.press("Enter");
      await listbox.waitFor({ state: "detached" });
      assert.deepEqual(await measureUnitSelection(page), selected("de construcción con acabados"), `${label}: reemplazo por teclado`);
      // Volver a elegir la misma unidad tras buscar la mantiene visible.
      await unitShell(page).click();
      await page.keyboard.type("acabados");
      await page.keyboard.press("Enter");
      assert.deepEqual(await measureUnitSelection(page), selected("de construcción con acabados"), `${label}: misma unidad`);

      // El borrador guarda la unidad elegida.
      await dialog.locator("#service-form-name").fill("Servicio con unidad visible");
      await chooseModality(page, "Detalle por detalle");
      await dialog.getByPlaceholder("0.00").fill("100");
      await dialog.getByRole("button", { name: "Crear", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      const [post] = requestsOf(backend, "POST", /^\/api\/admin\/services$/);
      assert.deepEqual([post.body.measurementUnitId, post.body.unitDenominationId], [1, 77], `${label}: se guarda la unidad mostrada`);

      // Servicio existente: la unidad precargada se presenta igual.
      await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
      const editDialog = page.getByRole("dialog", { name: "Servicio" });
      await editDialog.getByRole("button", { name: "Quitar de construcción" }).waitFor();
      assert.deepEqual(await measureUnitSelection(page), selected("de construcción"), `${label}: edición precargada`);
      await editDialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      await editDialog.waitFor({ state: "detached" });
    }
  });
}

test("unidad: quitar la selección retira símbolo y Tag, y sin denominaciones activas se ofrecen las bases solas", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  await dialog.locator("#service-form-name").fill("Sin unidad registrada");
  await chooseModality(page, "Detalle por detalle");
  await dialog.getByPlaceholder("0.00").fill("100");
  // Retroceso con el campo vacío quita la unidad elegida junto con su símbolo.
  await chooseUnit(page, "m² de construcción");
  await page.keyboard.press("Backspace");
  assert.equal(await dialog.getByRole("button", { name: "Quitar de construcción" }).count(), 0);
  assert.equal(await unitSymbol(page), "");
  // El cierre del Tag también la quita, y permite elegir otra.
  await chooseUnit(page, "pto. eléctrico");
  await dialog.getByRole("button", { name: "Quitar eléctrico" }).click();
  assert.equal(await unitSymbol(page), "");
  assert.equal(await dialog.getByRole("button", { name: /^Quitar / }).count(), 0);
  await dialog.locator("#service-form-name").focus();
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await dialog.getByText("Elige la unidad de medida.", { exact: true }).waitFor();
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });

  // Sin denominaciones activas: las bases activas siguen ofreciéndose solas (sin denominación) y
  // «+ Crear unidad» permite registrar una denominación.
  backend.denominations.splice(0, backend.denominations.length, denominationRecord({ id: 90, denomination: "de archivo", isActive: false, unit: "m2" }));
  const empty = await openCreate(page);
  await page.waitForFunction(() => !document.querySelector("[data-service-form]")?.textContent.includes("Cargando unidades de medida"));
  assert.deepEqual(await unitSuggestions(page), []);
  assert.deepEqual(await unitSuggestions(page, { baseOnly: true }), ["m.l.", "m²", "m³", "pto."]);
  assert.equal(await empty.getByText("No hay unidades de medida registradas", { exact: false }).count(), 0);
  assert.equal(await unitSymbol(page), "");
  assert.equal(await empty.getByRole("button", { name: "Crear unidad" }).isEnabled(), true);
  const row = await openUnitCreation(page);
  await row.getByRole("combobox", { name: /^Unidad base de la nueva unidad/ }).click();
  await page.getByRole("option", { name: "m.l., Metro lineal", exact: true }).click();
  assert.equal(await row.getByRole("combobox", { name: /^Unidad base de la nueva unidad/ }).innerText(), "m.l.");
  await row.locator("#service-form-new-unit").fill("de canalización");
  await row.getByRole("button", { name: "Guardar", exact: true }).click();
  // La unidad creada queda elegida con su símbolo y su Tag, sin desplegar el listado.
  await empty.getByRole("button", { name: "Quitar de canalización" }).waitFor();
  assert.equal(await unitSymbol(page), "m.l.");
  assert.equal(await page.getByRole("listbox", UNIT_LISTBOX).count(), 0);
  assert.equal(await empty.locator("#service-form-unit").inputValue(), "", "El alta contextual vacía la consulta");
  // Y queda disponible en el listado para elegirla de nuevo.
  await empty.getByRole("button", { name: "Quitar de canalización" }).click();
  assert.deepEqual(await unitSuggestions(page), ["m.l. de canalización"]);
  await chooseUnit(page, "m.l. de canalización");
  assert.equal(requestsOf(backend, "POST", /measurement-unit-denominations$/).at(-1).body.measurementUnitId, 6);
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0, "Crear una unidad no crea el servicio");
});

test("unidad: teclado del combobox con flechas, Home/End, Enter, Escape y Tab sin enviar ni cerrar el modal", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  const input = page.locator("#service-form-unit");
  const listbox = page.getByRole("listbox", UNIT_LISTBOX);
  const activeOption = () => input.evaluate((element) => document.getElementById(element.getAttribute("aria-activedescendant") ?? "")?.getAttribute("aria-label") ?? null);
  await page.waitForFunction(() => !document.querySelector("[data-service-form]")?.textContent.includes("Cargando unidades de medida"));
  // Un foco programático (o con Tab) no despliega opciones.
  await input.focus();
  assert.equal(await listbox.count(), 0);

  await page.keyboard.press("ArrowDown");
  await listbox.waitFor();
  const order = await listbox.getByRole("option").evaluateAll((options) => options.map((option) => option.getAttribute("aria-label")));
  // Cuatro bases solas y cuatro unidades registradas.
  assert.equal(order.length, 8);
  const last = order.length - 1;
  assert.equal(await activeOption(), order[0], "Abre con la primera opción activa");
  await page.keyboard.press("ArrowDown");
  assert.equal(await activeOption(), order[1]);
  await page.keyboard.press("ArrowUp");
  assert.equal(await activeOption(), order[0]);
  await page.keyboard.press("End");
  assert.equal(await activeOption(), order[last]);
  await page.keyboard.press("ArrowDown");
  assert.equal(await activeOption(), order[0], "La navegación es circular");
  await page.keyboard.press("ArrowUp");
  assert.equal(await activeOption(), order[last]);
  await page.keyboard.press("Home");
  assert.equal(await activeOption(), order[0]);

  // Escribir filtra y activa la primera coincidencia; Enter la elige sin enviar el servicio.
  await page.keyboard.type("excava");
  assert.equal(await activeOption(), "m³ de excavación, Metro cúbico");
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Quitar de excavación" }).waitFor();
  await listbox.waitFor({ state: "detached" });
  assert.equal(await input.inputValue(), "");
  assert.equal(await unitSymbol(page), "m³");
  assert.equal(await input.evaluate((element) => document.activeElement === element), true, "El foco sigue en el campo");

  // Escape cierra solo el listado: el modal sigue abierto y la selección intacta.
  await page.keyboard.press("ArrowDown");
  await listbox.waitFor();
  await page.keyboard.press("Escape");
  await listbox.waitFor({ state: "detached" });
  assert.equal(await dialog.isVisible(), true);
  await dialog.getByRole("button", { name: "Quitar de excavación" }).waitFor();

  // Tab cierra el listado y continúa el recorrido del foco.
  await page.keyboard.press("ArrowDown");
  await listbox.waitFor();
  await page.keyboard.press("Tab");
  await listbox.waitFor({ state: "detached" });
  assert.equal(await input.evaluate((element) => document.activeElement === element), false);
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0, "El teclado del combobox no envía el servicio");
});

/**
 * Mide el campo de unidad y su listado abierto: el panel debe unirse al borde inferior del campo
 * (o al superior si no cabe) con su mismo ancho y quedar dentro del viewport.
 *
 * @param {import("playwright").Page} page - Página con el listado abierto.
 * @returns {Promise<Object>} Rectángulos redondeados del campo, del panel y de la primera fila.
 */
function measureUnitList(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom), width: Math.round(box.width), height: Math.round(box.height) };
    };
    const shell = document.querySelector("#service-form-unit").closest("[data-input-shell]");
    const panel = document.querySelector('[role="listbox"][aria-label="Unidades de medida registradas"]');
    return { shell: rect(shell), panel: rect(panel), row: rect(panel.querySelector('[role="option"]')), viewport: window.innerWidth };
  });
}

/**
 * Lee los bordes, radios y sombra que deciden si campo y listado se ven como una sola pieza.
 *
 * @param {import("playwright").Page} page - Página con el listado abierto.
 * @returns {Promise<Object>} Estilos computados del campo, de su contenedor interior y del panel.
 */
function measureUnitJoin(page) {
  return page.evaluate(() => {
    const shell = document.querySelector("#service-form-unit").closest("[data-input-shell]");
    const content = shell.firstElementChild;
    const panel = document.querySelector('[role="listbox"][aria-label="Unidades de medida registradas"]');
    const css = (element) => getComputedStyle(element);
    const corners = (style) => ({
      topLeft: style.borderTopLeftRadius, topRight: style.borderTopRightRadius,
      bottomLeft: style.borderBottomLeftRadius, bottomRight: style.borderBottomRightRadius,
    });
    const shellStyle = css(shell);
    const panelStyle = css(panel);
    return {
      shell: {
        corners: corners(shellStyle), shadow: shellStyle.boxShadow, borderColor: shellStyle.borderLeftColor,
        borderWidth: shellStyle.borderLeftWidth, borderTopWidth: shellStyle.borderTopWidth, borderBottomWidth: shellStyle.borderBottomWidth,
      },
      contentBorderColor: css(content).borderLeftColor,
      panel: {
        corners: corners(panelStyle), borderColor: panelStyle.borderLeftColor, borderWidth: panelStyle.borderLeftWidth,
        borderTopWidth: panelStyle.borderTopWidth, borderBottomWidth: panelStyle.borderBottomWidth,
      },
    };
  });
}

/**
 * Comprueba que campo y listado forman una sola pieza: mismos bordes laterales, sin hueco, el
 * campo sin radio en el lado unido y el panel solo con el radio del lado libre, mismo borde de
 * 1 px sin el marco de foco ni sombra, y el lado unido del campo como divisor.
 *
 * @param {import("playwright").Page} page - Página con el listado abierto.
 * @param {"bottom"|"top"} placement - Lado por el que debe unirse el listado.
 * @param {string} label - Contexto del mensaje de error.
 * @returns {Promise<void>}
 */
async function assertUnitListJoined(page, placement, label) {
  // El campo anima su borde y sombra (150 ms): se mide el estado final, no un fotograma intermedio.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  const layout = await measureUnitList(page);
  const join = await measureUnitJoin(page);
  const message = `${label}: ${JSON.stringify({ layout, join })}`;
  assert.equal(layout.panel.left, layout.shell.left, message);
  assert.equal(layout.panel.width, layout.shell.width, message);
  if (placement === "bottom") {
    assert.ok(Math.abs(layout.panel.top - layout.shell.bottom) <= 1, `Unido al borde inferior. ${message}`);
    assert.deepEqual([join.shell.corners.bottomLeft, join.shell.corners.bottomRight], ["0px", "0px"], message);
    assert.notEqual(join.shell.corners.topLeft, "0px", message);
    assert.deepEqual([join.panel.corners.topLeft, join.panel.corners.topRight], ["0px", "0px"], message);
    assert.notEqual(join.panel.corners.bottomLeft, "0px", message);
    assert.equal(join.panel.borderTopWidth, "0px", message);
    assert.equal(join.shell.borderBottomWidth, "1px", `Divisor entre campo y opciones. ${message}`);
  } else {
    assert.ok(Math.abs(layout.panel.bottom - layout.shell.top) <= 1, `Unido al borde superior. ${message}`);
    assert.deepEqual([join.shell.corners.topLeft, join.shell.corners.topRight], ["0px", "0px"], message);
    assert.notEqual(join.shell.corners.bottomLeft, "0px", message);
    assert.deepEqual([join.panel.corners.bottomLeft, join.panel.corners.bottomRight], ["0px", "0px"], message);
    assert.notEqual(join.panel.corners.topLeft, "0px", message);
    assert.equal(join.panel.borderBottomWidth, "0px", message);
    assert.equal(join.shell.borderTopWidth, "1px", `Divisor entre campo y opciones. ${message}`);
  }
  assert.equal(join.shell.borderWidth, join.panel.borderWidth, `Mismo grosor de borde. ${message}`);
  assert.equal(join.shell.borderColor, join.panel.borderColor, `Mismo color de borde. ${message}`);
  assert.equal(join.contentBorderColor, "rgba(0, 0, 0, 0)", `Sin borde interior de foco. ${message}`);
  // Tailwind compone `box-shadow` como lista de capas; sin sombra, todas son transparentes.
  const visibleShadow = join.shell.shadow !== "none" && join.shell.shadow.split(/,(?![^(]*\))/).some((layer) => !layer.includes("rgba(0, 0, 0, 0)"));
  assert.equal(visibleShadow, false, `Sin sombra. ${message}`);
}

test("unidad en Crear y en Editar (móvil oscuro): el listado se une al campo, cabe en el viewport y no se abre solo", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  let dialog = await openCreate(page);
  await openUnitList(page);
  let layout = await measureUnitList(page);
  await assertUnitListJoined(page, "bottom", "Crear (claro, 1440 px)");
  assert.equal(layout.row.height, 35, "Filas del patrón de opciones del Input");
  // El listado flota sobre el formulario: Escape lo cierra antes de usar el pie.
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });

  const mobile = await openTabulator(context, backend, { theme: "dark", viewport: { width: 375, height: 812 } });
  await mobile.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  dialog = mobile.getByRole("dialog", { name: "Servicio" });
  await dialog.getByRole("button", { name: "Quitar de construcción" }).waitFor();
  await mobile.waitForFunction(() => !document.querySelector("[data-service-form]")?.textContent.includes("Cargando unidades de medida"));
  assert.equal(await unitSymbol(mobile), "m²", "Conserva la unidad precargada");
  assert.equal(await mobile.getByRole("listbox", UNIT_LISTBOX).count(), 0, "Abrir la edición no despliega opciones");
  // El clic en el símbolo también despliega el listado, sin otro selector.
  await mobile.locator("[data-service-form] [data-input-prefix-display]").click();
  const listbox = mobile.getByRole("listbox", UNIT_LISTBOX);
  await listbox.waitFor();
  assert.equal(await listbox.getByRole("option", { name: /^m² de construcción/ }).getAttribute("aria-selected"), "true");
  layout = await measureUnitList(mobile);
  assert.ok(layout.panel.left >= 0 && layout.panel.right <= layout.viewport, `El listado cabe en 375 px ${JSON.stringify(layout)}`);
  await assertUnitListJoined(mobile, "bottom", "Editar (oscuro, 375 px)");
  // El panel usa el fondo del tema (no transparente) para leerse sobre el modal.
  assert.notEqual(await listbox.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
  await mobile.keyboard.press("Escape");
  await listbox.waitFor({ state: "detached" });
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).length, 0);
});

for (const theme of ["light", "dark"]) {
  test(`unidad (${theme}): sin espacio debajo, el listado se une al borde superior con los radios invertidos`, async (context) => {
    const backend = createServiceCatalogBackend(sampleCatalog());
    const page = await openTabulator(context, backend, { theme, viewport: { width: 1024, height: 480 } });
    await openCreate(page);
    // Lleva el campo al borde inferior del área visible del formulario para que no quepa debajo.
    await page.locator("#service-form-unit").evaluate((input) => input.closest("[data-input-shell]").scrollIntoView({ block: "end" }));
    await openUnitList(page);
    await assertUnitListJoined(page, "top", `${theme}, 1024×480`);
  });
}

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
  assert.equal(await unitSymbol(page), "m.l.");
  assert.deepEqual(await unitSuggestions(page),
    ["m.l. de canalización nueva", "m² a intervenir", "m² de construcción", "m³ de excavación", "pto. eléctrico"],
    "La unidad creada no se duplica al terminar la lectura");
  await dialog.getByRole("button", { name: "Quitar de canalización nueva" }).waitFor();
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0);
});

test("unidad: una lectura fallida y su reintento no fabrican unidades ni eligen una", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  backend.delays["GET /api/admin/measurement-unit-denominations"] = 350;
  backend.failures["GET /api/admin/measurement-unit-denominations"] = { status: 503, body: { code: "UNAVAILABLE", message: "Catálogo temporalmente no disponible" } };
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  await dialog.getByText("Catálogo temporalmente no disponible", { exact: true }).waitFor();
  assert.deepEqual(await unitSuggestions(page), []);
  assert.equal(await unitSymbol(page), "");
  delete backend.failures["GET /api/admin/measurement-unit-denominations"];
  await dialog.getByRole("button", { name: "Reintentar carga de unidades" }).click();
  await dialog.getByText("Cargando unidades de medida...", { exact: true }).waitFor();
  assert.deepEqual(await unitSuggestions(page), ["m² a intervenir", "m² de construcción", "m³ de excavación", "pto. eléctrico"]);
  assert.equal(await unitSymbol(page), "", "La respuesta no elige automáticamente una unidad");
  await chooseUnit(page, "m³ de excavación");
  assert.equal(await unitSymbol(page), "m³");
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
  assert.equal(await unitSymbol(page), "m²");
  await dialog.locator("#service-form-name").fill("Archivo de prueba editado");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/7$/).at(-1).body, { expectedVersion: 1, name: "Archivo de prueba editado" });

  // Si retira la guardada, la inactiva no vuelve a aparecer entre las nuevas opciones.
  await page.getByRole("button", { name: "Editar TST-007 Archivo de prueba editado" }).click();
  await dialog.getByRole("button", { name: "Quitar de archivo" }).click();
  assert.deepEqual(await unitSuggestions(page), ["m² a intervenir", "m² de construcción", "m³ de excavación", "pto. eléctrico"]);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });

  // Servicio guardado solo con la base (TST-004, m.l.): se muestra y se puede guardar sin cambiarla.
  await page.getByRole("button", { name: "Editar TST-004 Canalizaciones de prueba" }).click();
  await dialog.locator("#service-form-name").waitFor();
  assert.equal(await unitSymbol(page), "m.l.");
  // Sin denominación, el Tag nombra la base guardada y puede quitarse como cualquier unidad.
  await dialog.getByRole("button", { name: "Quitar Metro lineal" }).waitFor();
  assert.equal(await dialog.locator("#service-form-unit").getAttribute("placeholder"), "");
  await dialog.getByPlaceholder("0.00").fill("15");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/4$/).at(-1).body, { expectedVersion: 1, referenceRate: "0.15" });
});

/**
 * Elige una opción en el combobox de una unidad alternativa (mismo listado que la principal).
 *
 * @param {import("playwright").Page} page - Página.
 * @param {number} index - Fila de alternativa.
 * @param {string} label - Etiqueta de la opción («pto. eléctrico» o la abreviatura de una base sola).
 * @returns {Promise<void>}
 */
async function chooseAlternativeUnit(page, index, label) {
  // Como unitShell: el campo nativo puede no tener ancho propio; se pulsa la carcasa del Input.
  await page.locator(`[data-input-shell]:has(#service-form-alternative-${index})`).click();
  const listbox = page.getByRole("listbox", UNIT_LISTBOX);
  await listbox.getByRole("option", { name: new RegExp(`^${escapeRegExp(label)}(,|$)`) }).click();
  await listbox.waitFor({ state: "detached" });
}

for (const theme of ["light", "dark"]) {
  test(`varias unidades (${theme}): base sin denominación, alternativa pendiente y texto comercial sin inventar tarifas`, async (context) => {
    const backend = createServiceCatalogBackend(sampleCatalog());
    const page = await openTabulator(context, backend, { theme });

    // Una sola unidad base, sin denominación: el Tag nombra la base y viaja con el atajo del contrato.
    let dialog = await openCreate(page);
    await dialog.locator("#service-form-name").fill("Canalización base sola");
    await chooseModality(page, "Detalle por detalle");
    await dialog.getByPlaceholder("0.00").fill("13.00");
    await chooseUnit(page, "m.l.");
    await dialog.getByRole("button", { name: "Quitar Metro lineal" }).waitFor();
    assert.equal(await unitSymbol(page), "m.l.");
    await dialog.getByRole("button", { name: "Crear", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(requestsOf(backend, "POST", /^\/api\/admin\/services$/).at(-1).body,
      { name: "Canalización base sola", kind: "individual", measurementUnitId: 6, referenceRate: "13.00" });

    // Principal con texto comercial y una alternativa con la tarifa pendiente de validación comercial.
    dialog = await openCreate(page);
    await dialog.locator("#service-form-name").fill("Servicio con dos unidades");
    await chooseModality(page, "Detalle por detalle");
    await dialog.getByPlaceholder("0.00").fill("450.00");
    // Sin unidad principal no se añaden alternativas.
    assert.equal(await dialog.locator("[data-service-add-alternative]").isDisabled(), true);
    await chooseUnit(page, "m.l.");
    await dialog.locator("[data-service-add-alternative]").click();
    // La principal parte de la tarifa que tenía como unidad única; la alternativa empieza pendiente.
    assert.equal(await dialog.locator("#service-form-primary-rate").inputValue(), "450.00");
    assert.equal(await dialog.locator("#service-form-alternative-rate-0").inputValue(), "");
    await dialog.getByText("Sin tarifa: pendiente de validación comercial. No se podrá cotizar con esta unidad.", { exact: true }).waitFor();
    // Repetir la principal se rechaza antes de enviar.
    await chooseAlternativeUnit(page, 0, "m.l.");
    await dialog.getByRole("button", { name: "Crear", exact: true }).click();
    await dialog.getByText("Esta unidad ya está incluida en el servicio.", { exact: true }).waitFor();
    assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 1);
    await chooseAlternativeUnit(page, 0, "pto. eléctrico");
    await dialog.getByRole("button", { name: "Añadir texto comercial" }).click();
    await dialog.locator("#service-form-presentation-label").fill("Por metro lineal");
    // Sin desbordamiento horizontal en el modal con la sección desplegada.
    assert.equal(await dialog.evaluate((element) => element.querySelector("form").scrollWidth <= element.querySelector("form").clientWidth), true);
    await dialog.getByRole("button", { name: "Crear", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(requestsOf(backend, "POST", /^\/api\/admin\/services$/).at(-1).body, {
      name: "Servicio con dos unidades",
      kind: "individual",
      unitOptions: [
        { measurementUnitId: 6, unitDenominationId: null, presentationLabel: "Por metro lineal", referenceRate: "450.00" },
        { measurementUnitId: 30, unitDenominationId: 12, presentationLabel: null, referenceRate: null },
      ],
      referenceRate: "450.00",
    });

    // Tabla: una Badge por unidad; la pendiente lo indica en su título.
    const row = rowFor(page, "SERV-007");
    await row.waitFor();
    const badges = row.locator("td[data-service-units] > div > *");
    assert.deepEqual(await badges.allInnerTexts(), ["Por metro lineal", "pto. eléctrico"]);
    assert.equal(await badges.nth(1).getAttribute("title"), "pto. eléctrico: tarifa pendiente de validación comercial");

    // Edición: confirmar la tarifa de la alternativa envía la lista completa con su tarifa.
    await row.getByRole("button", { name: /^Editar SERV-007/ }).click();
    dialog = page.getByRole("dialog", { name: "Servicio", exact: true });
    await dialog.locator("#service-form-alternative-rate-0").waitFor();
    assert.equal(await dialog.locator("#service-form-presentation-label").inputValue(), "Por metro lineal");
    await dialog.locator("#service-form-alternative-rate-0").fill("38.00");
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/7$/).at(-1).body, {
      expectedVersion: 1,
      unitOptions: [
        { measurementUnitId: 6, unitDenominationId: null, presentationLabel: "Por metro lineal", referenceRate: "450.00" },
        { measurementUnitId: 30, unitDenominationId: 12, presentationLabel: null, referenceRate: "38.00" },
      ],
    });
    // Quitar la alternativa vuelve a una sola unidad y la principal deja de tener tarifa propia.
    await row.getByRole("button", { name: /^Editar SERV-007/ }).click();
    await dialog.getByRole("button", { name: "Quitar unidad alternativa 1" }).click();
    assert.equal(await dialog.locator("#service-form-primary-rate").count(), 0);
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/7$/).at(-1).body.unitOptions,
      [{ measurementUnitId: 6, unitDenominationId: null, presentationLabel: "Por metro lineal" }]);
  });
}

const DRAFT = { name: "Borrador conservado", description: "Texto del borrador.", rate: "30.00", modality: "Detalle por detalle" };

test("Crear y Editar comparten el catálogo registrado: no ofrecen las 48 bases ni denominaciones inactivas", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  backend.baseUnits.push(...Array.from({ length: 44 }, (_, index) => ({ id: index + 100, code: `unused_${index}`, symbol: `u${index}`, name: `Base sin denominaciones ${index}`, isActive: true })));
  backend.denominations.push(denominationRecord({ id: 90, denomination: "de archivo", isActive: false, unit: "ml" }));
  const page = await openTabulator(context, backend);
  let dialog = await openCreate(page);
  const createOptions = await unitSuggestions(page);
  assert.deepEqual(createOptions, ["m² a intervenir", "m² de construcción", "m³ de excavación", "pto. eléctrico"]);
  assert.deepEqual(await unitSymbolsOffered(page), ["m²", "m³", "pto."], "Solo símbolos con unidades registradas activas");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  dialog = page.getByRole("dialog", { name: "Servicio", exact: true });
  await dialog.getByRole("button", { name: "Quitar de construcción" }).waitFor();
  assert.deepEqual(await unitSuggestions(page), createOptions, "Mismas opciones y mismo componente en ambos modos");
  assert.equal(await unitSymbol(page), "m²");
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
    await dialog.locator("#service-form-name").waitFor();
    // La unidad guardada se muestra, pero una base inactiva no se ofrece como nueva asignación.
    const offered = await unitSuggestions(page);
    assert.equal(offered.some((label) => label.startsWith("m.l.")), false, `El valor histórico no es una opción nueva: ${offered}`);
    assert.deepEqual(offered, ["m² a intervenir", "m² de construcción", "m³ de excavación", "pto. eléctrico"], `Misma oferta en ${kind}`);
    assert.equal(await unitSymbol(page), "m.l.");
    // Con o sin denominación hay un Tag: la denominación o, sin ella, el nombre de la base guardada.
    assert.equal(await dialog.getByRole("button", { name: /^Quitar / }).count(), 1);
    assert.equal((await unitSuggestions(page, { baseOnly: true })).includes("m.l."), false, "La base inactiva no se ofrece sola");
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
    await dialog.getByRole("button", { name: "Quitar de construcción" }).waitFor();
    return dialog;
  };
  let dialog = await openEdit();
  await chooseUnit(page, "m³ de excavación");
  await chooseUnit(page, "m² de construcción");
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("alert").getByText("Sin cambios", { exact: true }).waitFor();
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).length, 0);
  dialog = await openEdit();
  await chooseUnit(page, "m³ de excavación");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).length, 0);
  assert.equal(backend.items[0].measurementUnit.id, 1);
  assert.equal(backend.items[0].unitDenomination.id, 10);
});

/**
 * Abre «Nuevo servicio» con un borrador completo, todavía sin unidad.
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
  assert.equal(await unitSymbol(page), "", "Cancelar el alta no elige ninguna unidad");

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
  await page.getByRole("alert").getByText("Unidad creada correctamente", { exact: true }).waitFor();
  await page.getByRole("alert").getByText(/^UNID-\d+ · m² de prueba nueva$/).waitFor();
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
  await row.getByText("Ya hay una denominación equivalente para la unidad base seleccionada", { exact: true }).waitFor();
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
  assert.equal(await dialog.getByPlaceholder("0.00").inputValue(), "14.00", "La tarifa guardada, sin conversión");
  await dialog.getByRole("button", { name: "Quitar de construcción" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Guardar" }).isVisible(), true);

  // Sin cambios: no hay PATCH.
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("alert").getByText("Sin cambios").first().waitFor();
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/1$/).length, 0);

  // Cambiar solo la tarifa (14 equivale a 14.00, así que se cambia de verdad a 15).
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

  // Cambiar a una unidad de otra base envía la base y la unidad juntas.
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  await dialog.locator("#service-form-name").waitFor();
  await chooseUnit(page, "m³ de excavación");
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
  assert.equal(await dialog.getByPlaceholder("0.00").inputValue(), "14.00");
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
  assert.deepEqual(await unitSymbolsOffered(page), ["m²", "m³", "pto."], "Llave en mano ofrece todas las unidades registradas activas");
  await dialog.locator("#service-form-name").fill("Paisajismo de prueba editado");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/3$/).at(-1).body, { expectedVersion: 1, name: "Paisajismo de prueba editado" });
  await rowFor(page, "TST-003").getByText("Paisajismo de prueba editado", { exact: true }).waitFor();
  assert.equal((await rowFor(page, "TST-003").locator("[data-service-modality]").innerText()).trim(), "Llave en mano");
});

// Llave en mano admite cualquier unidad registrada y activa: m², m³ y puntos del catálogo simulado.
for (const [unitLabel, measurementUnitId, unitDenominationId] of [["m² de construcción", 1, 10], ["m³ de excavación", 13, 13], ["pto. eléctrico", 30, 12]]) {
  test(`alta llave en mano con «${unitLabel}»: ofrece todas las unidades y crea el servicio turnkey`, async (context) => {
    const backend = createServiceCatalogBackend(sampleCatalog());
    const page = await openTabulator(context, backend);
    const dialog = await openCreate(page);
    await dialog.locator("#service-form-name").fill("Residencial de prueba");
    await dialog.getByPlaceholder("0.00").fill("85000");
    await chooseModality(page, "Llave en mano");
    assert.deepEqual(await unitSuggestions(page), ["m² a intervenir", "m² de construcción", "m³ de excavación", "pto. eléctrico"],
      "Llave en mano ofrece las mismas unidades que individual");
    await chooseUnit(page, unitLabel);
    await dialog.getByRole("button", { name: "Crear", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const [post] = requestsOf(backend, "POST", /^\/api\/admin\/services$/);
    assert.deepEqual(post.body, { name: "Residencial de prueba", kind: "turnkey", measurementUnitId, unitDenominationId, referenceRate: "850.00" });
    const row = rowFor(page, "SERV-006");
    await row.waitFor();
    assert.equal(await row.locator("[data-service-modality]").getAttribute("data-service-modality"), "turnkey");
    await row.getByText(unitLabel, { exact: true }).waitFor();
  });
}

test("alta: cambiar la modalidad en ambos sentidos conserva la unidad elegida, sea cual sea su base", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  await chooseUnit(page, "pto. eléctrico");
  for (const modality of ["Llave en mano", "Detalle por detalle", "Llave en mano"]) {
    await chooseModality(page, modality);
    await dialog.getByRole("button", { name: "Quitar eléctrico" }).waitFor();
    assert.equal(await unitSymbol(page), "pto.", `${modality}: conserva el símbolo`);
    assert.deepEqual(await unitSymbolsOffered(page), ["m²", "m³", "pto."], `${modality}: ofrece todas las unidades registradas activas`);
  }
});

test("alta llave en mano: «+ Crear unidad» permite cualquier base activa y elige la unidad creada", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = await openCreate(page);
  await chooseModality(page, "Llave en mano");
  const row = await openUnitCreation(page);
  const newUnitBase = row.getByRole("combobox", { name: /^Unidad base de la nueva unidad/ });
  assert.equal(await newUnitBase.isDisabled(), false, "La modalidad no fija la base");
  assert.equal((await newUnitBaseOptions(page)).length, 4, "Ofrece todas las bases activas del catálogo");
  await newUnitBase.click();
  await page.getByRole("option", { name: "m.l., Metro lineal", exact: true }).click();
  await row.locator("#service-form-new-unit").fill("de canalización");
  await row.getByRole("button", { name: "Guardar", exact: true }).click();
  await dialog.getByRole("button", { name: "Quitar de canalización" }).waitFor();
  assert.equal(await unitSymbol(page), "m.l.");
  // Crear la unidad no guarda el servicio.
  assert.equal(requestsOf(backend, "POST", /^\/api\/admin\/services$/).length, 0);
});

test("edición: la modalidad cambia solo por elección explícita y conserva la unidad de cualquier base", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  // TST-005: individual con unidad «pto. eléctrico».
  await page.getByRole("button", { name: "Editar TST-005 Puntos eléctricos de prueba" }).click();
  const dialog = page.getByRole("dialog", { name: "Servicio" });
  await dialog.locator("#service-form-name").waitFor();
  assert.match(await page.getByRole("button", { name: "Modalidad de contratación", exact: true }).innerText(), /Detalle por detalle/);

  // Pasar a llave en mano conserva la unidad de puntos; cancelar no envía nada.
  await chooseModality(page, "Llave en mano");
  await dialog.getByRole("button", { name: "Quitar eléctrico" }).waitFor();
  assert.equal(await unitSymbol(page), "pto.");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/5$/).length, 0);
  assert.equal((await rowFor(page, "TST-005").locator("[data-service-modality]").innerText()).trim(), "Detalle por detalle");

  // Cambio explícito solo de modalidad: viaja la modalidad con la versión leída, sin reenviar la unidad.
  await page.getByRole("button", { name: "Editar TST-005 Puntos eléctricos de prueba" }).click();
  await dialog.locator("#service-form-name").waitFor();
  await chooseModality(page, "Llave en mano");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/5$/).at(-1).body, { expectedVersion: 1, kind: "turnkey" });
  // El listado se recarga tras guardar: se espera a la fila actualizada, con su unidad intacta.
  const row = rowFor(page, "TST-005");
  await row.locator("[data-service-modality]", { hasText: "Llave en mano" }).waitFor();
  await row.getByText("pto. eléctrico", { exact: true }).waitFor();

  // Editar la unidad de un servicio llave en mano a otra base (m³) también se acepta.
  await page.getByRole("button", { name: "Editar TST-005 Puntos eléctricos de prueba" }).click();
  await dialog.locator("#service-form-name").waitFor();
  await chooseUnit(page, "m³ de excavación");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/5$/).at(-1).body, {
    expectedVersion: 2, measurementUnitId: 13, unitDenominationId: 13,
  });
  await row.getByText("m³ de excavación", { exact: true }).waitFor();
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
  // Figma 5764:226084: la tarifa se alinea a la izquierda, como el resto de campos.
  assert.equal(await rate.evaluate((input) => getComputedStyle(input).textAlign), "start");
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
      await chooseUnit(page, "m² de construcción");
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

const SERVICE_FORM_SKELETON = "[data-service-form] [data-skeleton-preset='serviceForm']";
const serviceDetailGets = (backend) => requestsOf(backend, "GET", /^\/api\/admin\/services\/\d+$/);

/**
 * Registra en el navegador cuántos formularios de servicio llegan a coexistir y marca el diálogo
 * visible, para comprobar después que la carga lo sustituye sin desmontarlo ni abrir otro.
 *
 * @param {import("playwright").Page} page - Página con el formulario abierto.
 * @returns {Promise<() => Promise<{maxInstances: number, sameDialog: boolean, open: boolean}>>} Lectura.
 */
async function trackServiceFormDialog(page) {
  await page.evaluate(() => {
    const state = { maxInstances: 1, marked: document.querySelector("[data-service-form]") };
    new MutationObserver(() => {
      state.maxInstances = Math.max(state.maxInstances, document.querySelectorAll("[data-service-form]").length);
    }).observe(document.body, { childList: true, subtree: true });
    window.__serviceFormDialog = state;
  });
  return () => page.evaluate(() => {
    const state = window.__serviceFormDialog;
    const current = document.querySelector("[data-service-form]");
    return { maxInstances: state.maxInstances, sameDialog: current === state.marked, open: Boolean(current) };
  });
}

/**
 * Mide el diálogo del formulario y su pie para comparar el skeleton con el formulario cargado.
 *
 * @param {import("playwright").Page} page - Página con el formulario abierto.
 * @returns {Promise<{dialog: Array<number>, footer: Array<number>}>} Cajas redondeadas.
 */
function measureServiceFormDialog(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return [box.x, box.y, box.width, box.height].map((value) => Math.round(value));
    };
    return { dialog: rect(document.querySelector("[data-service-form]")), footer: rect(document.querySelector("[data-service-form] footer")) };
  });
}

for (const theme of ["light", "dark"]) {
  test(`edición con lectura lenta (${theme}): skeleton del formulario con sus medidas, pie real y sin otro diálogo, 375–1440 px`, async (context) => {
    const backend = createServiceCatalogBackend(sampleCatalog());
    const page = await openTabulator(context, backend, { theme, viewport: { width: 375, height: 812 } });
    backend.delays["GET /api/admin/services/1"] = 900;
    for (const [width, height] of [[375, 812], [768, 1024], [1024, 768], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
      const dialog = page.getByRole("dialog", { name: "Servicio" });
      const skeleton = page.locator(SERVICE_FORM_SKELETON);
      await skeleton.waitFor();
      const readDialog = await trackServiceFormDialog(page);
      // El título real se mantiene; el skeleton no muestra textos ni valores de ejemplo.
      assert.equal(await dialog.getByRole("heading", { level: 2 }).innerText(), "Servicio");
      assert.equal(await dialog.getAttribute("aria-busy"), "true");
      assert.equal(await dialog.getByRole("status").getByText("Cargando servicio", { exact: true }).count(), 1);
      assert.equal((await skeleton.innerText()).trim(), "");
      assert.equal(await skeleton.locator("button, input, textarea, [tabindex]").count(), 0, "Los bloques no son controles");
      assert.equal(await dialog.getByRole("button", { name: "Guardar", exact: true }).isDisabled(), true);
      assert.equal(await dialog.getByRole("button", { name: "Cancelar", exact: true }).isEnabled(), true);
      // Cada bloque replica un campo real: etiqueta de 17 px, controles de 42/41/134/44/42 px y
      // los botones de 36 px («+ Crear unidad», «Añadir unidad alternativa» y «Añadir texto comercial»).
      const blocks = await skeleton.evaluate((element) => [...element.querySelectorAll(".skeleton-shimmer")].map((block) => Math.round(block.getBoundingClientRect().height)));
      assert.deepEqual(blocks, [17, 42, 17, 41, 17, 134, 17, 44, 36, 17, 42, 36, 36]);
      const loadingBox = await measureServiceFormDialog(page);

      await dialog.locator("#service-form-name").waitFor();
      assert.equal(await page.locator(SERVICE_FORM_SKELETON).count(), 0);
      assert.equal(await dialog.locator("#service-form-name").inputValue(), "Anteproyecto de prueba");
      assert.equal(await dialog.getAttribute("aria-busy"), null);
      assert.deepEqual(await measureServiceFormDialog(page), loadingBox, `${width}x${height}: mismas dimensiones al cargar`);
      assert.deepEqual(await readDialog(), { maxInstances: 1, sameDialog: true, open: true }, "Mismo diálogo, sin remontaje ni segunda instancia");
      const layout = await page.evaluate(() => {
        const box = document.querySelector("[data-service-form]").getBoundingClientRect();
        return { inside: box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight, overflow: document.documentElement.scrollWidth - window.innerWidth };
      });
      assert.deepEqual(layout, { inside: true, overflow: 0 }, `${width}x${height}`);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
    }
    // StrictMode (desarrollo) repite el efecto y aborta la primera lectura; solo se lee el servicio editado.
    assert.equal(serviceDetailGets(backend).every((request) => request.path === "/api/admin/services/1"), true);
  });
}

test("edición durante la carga: Cancelar y cerrar descartan la respuesta tardía y otra edición no recibe datos ajenos", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  backend.delays["GET /api/admin/services/1"] = 1200;
  const dialog = page.getByRole("dialog", { name: "Servicio" });

  // Cancelar con la lectura en curso: la respuesta posterior no vuelve a abrir el formulario.
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  await page.locator(SERVICE_FORM_SKELETON).waitFor();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.waitForTimeout(1500);
  assert.equal(await page.locator("[data-service-form]").count(), 0, "La respuesta tardía no reabre el modal");

  // El botón de cierre también funciona durante la carga; otra edición muestra solo sus datos.
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  await page.locator(SERVICE_FORM_SKELETON).waitFor();
  await dialog.getByRole("button", { name: "Cerrar formulario del servicio", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Editar TST-002 Diseño interior de prueba" }).click();
  await dialog.locator("#service-form-name").waitFor();
  assert.equal(await dialog.locator("#service-form-name").inputValue(), "Diseño interior de prueba");
  await page.waitForTimeout(1500);
  assert.equal(await dialog.locator("#service-form-name").inputValue(), "Diseño interior de prueba", "La lectura atrasada de TST-001 no sustituye a TST-002");
  assert.equal(await page.locator("[data-service-form]").count(), 1);
  assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/\d+$/).length, 0);
});

test("edición con error de lectura: 500 permite reintentar y 404 recarga la lista sin ofrecer reintento ni guardar", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const dialog = page.getByRole("dialog", { name: "Servicio" });

  backend.failures["GET /api/admin/services/:id"] = { status: 500, body: { code: "INTERNAL_SERVER_ERROR", message: "Ocurrió un error inesperado." } };
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await page.locator(SERVICE_FORM_SKELETON).count(), 0);
  assert.equal(await dialog.locator("#service-form-name").count(), 0, "Sin formulario con datos incompletos");
  assert.equal(await dialog.getByRole("button", { name: "Guardar", exact: true }).isDisabled(), true);
  delete backend.failures["GET /api/admin/services/:id"];
  await dialog.getByRole("button", { name: "Reintentar", exact: true }).click();
  await dialog.locator("#service-form-name").waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Guardar", exact: true }).isEnabled(), true);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });

  const listReads = () => requestsOf(backend, "GET", /^\/api\/admin\/services$/).filter((request) => request.params.limit === "10").length;
  const readsBefore = listReads();
  backend.failures["GET /api/admin/services/:id"] = { status: 404, body: { code: "SERVICE_NOT_FOUND", message: "El servicio no existe." } };
  await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).click();
  await dialog.getByText("Este servicio ya no existe. Actualizamos la lista.", { exact: true }).waitFor();
  for (let attempt = 0; attempt < 40 && listReads() === readsBefore; attempt += 1) await page.waitForTimeout(50);
  assert.equal(listReads(), readsBefore + 1, "La lista se recarga una sola vez");
  assert.equal(await dialog.getByRole("button", { name: "Reintentar", exact: true }).count(), 0);
  assert.equal(await dialog.getByRole("button", { name: "Guardar", exact: true }).isDisabled(), true);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
});

test("alta: no muestra el skeleton de detalle ni lee un servicio", async (context) => {
  const backend = createServiceCatalogBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  await page.evaluate(() => {
    window.__serviceFormSkeletonSeen = false;
    new MutationObserver(() => {
      if (document.querySelector("[data-skeleton-preset='serviceForm']")) window.__serviceFormSkeletonSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  const dialog = await openCreate(page);
  await dialog.locator("#service-form-name").waitFor();
  assert.equal(await page.evaluate(() => window.__serviceFormSkeletonSeen), false);
  assert.equal(serviceDetailGets(backend).length, 0);
});

for (const theme of ["light", "dark"]) {
  test(`unidad en Editar llave en mano (${theme}): quitarla y volver a buscar ofrece todas las unidades registradas`, async (context) => {
    const backend = createServiceCatalogBackend(sampleCatalog());
    const page = await openTabulator(context, backend, { theme, viewport: { width: 508, height: 700 } });
    await page.getByRole("button", { name: "Editar TST-003 Paisajismo de prueba" }).click();
    const dialog = page.getByRole("dialog", { name: "Servicio" });
    await dialog.getByRole("button", { name: "Quitar a intervenir" }).waitFor();
    await page.waitForFunction(() => !document.querySelector("[data-service-form]")?.textContent.includes("Cargando unidades de medida"));
    const input = page.locator("#service-form-unit");
    const listbox = page.getByRole("listbox", UNIT_LISTBOX);

    // Quitar la unidad retira su símbolo y despliega todas las unidades registradas.
    await dialog.getByRole("button", { name: "Quitar a intervenir" }).click();
    await listbox.waitFor();
    assert.equal(await unitSymbol(page), "");
    assert.deepEqual(await unitSuggestions(page), ["m² a intervenir", "m² de construcción", "m³ de excavación", "pto. eléctrico"]);

    // Escribir una unidad de otra base la encuentra: llave en mano no restringe la base.
    await input.click();
    await input.fill("excavación");
    await listbox.getByRole("option", { name: /^m³ de excavación/ }).waitFor();

    // Sin coincidencias el listado se cierra y propone crear la unidad.
    await input.fill("inexistente");
    await listbox.waitFor({ state: "detached" });
    await dialog.getByText("No hay unidades que coincidan con «inexistente». Puedes crearla con «Crear unidad».", { exact: true }).waitFor();

    // Salir del campo cierra el listado y vacía la búsqueda.
    await dialog.locator("#service-form-name").focus();
    assert.equal(await input.inputValue(), "");
    assert.equal(await listbox.count(), 0);

    // La selección sigue igual: elegir una registrada la fija con su símbolo y su Tag.
    await chooseUnit(page, "m² de construcción");
    await dialog.getByRole("button", { name: "Quitar de construcción" }).waitFor();
    assert.equal(await unitSymbol(page), "m²");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(requestsOf(backend, "PATCH", /^\/api\/admin\/services\/3$/).length, 0);
  });
}
