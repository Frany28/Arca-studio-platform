import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";

import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";
import { SERVICE_CATALOG_TABLE_MIN_WIDTH } from "../../src/config/serviceCatalogTable.js";
import { LONG_DESCRIPTION, createServiceCatalogBackend as createBackend, sampleCatalog, service } from "../helpers/serviceCatalogBackend.js";

// Tabulador de servicios (Figma 5790:332031) contra un backend simulado con estado. Los servicios
// son datos de prueba con la forma del contrato: nunca se usan Supabase ni el catálogo comercial.
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
 * @param {Object} backend - Backend de createBackend.
 * @param {Object} [options] - Viewport, tema y soporte táctil.
 * @returns {Promise<import("playwright").Page>} Página con la primera lectura aplicada.
 */
async function openTabulator(context, backend, { theme = "light", viewport = { width: 1440, height: 1000 }, hasTouch = false, waitForRows = true } = {}) {
  const browserContext = await browser.newContext({ viewport, hasTouch });
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
  // El primer render compila en frío la ruta: se espera con el límite de navegación.
  await page.getByRole("heading", { name: "Tabulador de servicios", level: 2 }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  if (waitForRows) await page.locator("tbody tr").first().waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  // Layout estable antes de interactuar. Al aparecer las filas aún puede cargar Inter (el nombre
  // se ensancha y el icono informativo se movía ~13 px en horizontal) y sigue la entrada del panel
  // (`content-reveal`, ~7 px en vertical). Un hover en ese instante quedaba fuera del icono y
  // cerraba el tooltip: era el fallo intermitente de la prueba de tooltip.
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.animationName === "content-reveal")
    .map((animation) => animation.finished)));
  return page;
}

/**
 * Espera una condición del backend simulado (en Node), que el navegador no puede observar.
 *
 * @param {() => boolean} condition - Condición a cumplir.
 * @param {string} message - Mensaje si no se cumple a tiempo.
 * @returns {Promise<void>}
 */
async function waitFor(condition, message) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const rowCodes = (page) => page.locator("tbody tr th[scope=row]").allTextContents();
const tableGets = (backend) => backend.requests.filter((request) => request.method === "GET" && request.path === "/api/admin/services" && request.params.limit === "10");
const rowFor = (page, code) => page.locator("tbody tr", { has: page.locator("th[scope=row]", { hasText: code }) });
const metricValue = (page, label) => page.getByLabel("Indicadores de servicios y cotizaciones").getByText(label, { exact: true }).locator("xpath=following-sibling::*[1]");

/**
 * Elige una opción de un filtro de la barra (DropdownMenu de una sola selección).
 *
 * @param {import("playwright").Page} page - Página.
 * @param {string} filterName - Nombre accesible del disparador.
 * @param {string} option - Texto de la opción.
 * @returns {Promise<void>}
 */
async function chooseFilter(page, filterName, option) {
  await page.getByRole("button", { name: filterName, exact: true }).click();
  await page.getByRole("menuitem", { name: option, exact: true }).click();
}

test("carga: columnas de Figma, códigos, unidades, tarifas decimales y estados reales del backend", async (context) => {
  const backend = createBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  // Figma 5790:332040 con «Modalidad» (5924:439741) entre Servicio y Unidad.
  assert.deepEqual(await page.locator("thead th").allInnerTexts(), ["", "N°", "Servicio", "Modalidad", "Unidad", "Tarifa", "Estado", "Acciones"]);
  assert.deepEqual(await rowCodes(page), ["TST-001", "TST-002", "TST-003", "TST-004", "TST-005"]);
  // Modalidad: solo el `kind` real de la API (TST-003 es `turnkey`; el resto, `individual`).
  assert.deepEqual(await page.locator("tbody tr td:nth-child(4)").allInnerTexts(), ["Detalle por detalle", "Detalle por detalle", "Llave en mano", "Detalle por detalle", "Detalle por detalle"]);
  assert.deepEqual(await page.locator("tbody tr td:nth-child(4)").evaluateAll((cells) => cells.map((cell) => cell.dataset.serviceModality)), ["individual", "individual", "turnkey", "individual", "individual"]);
  // Unidad: etiqueta oficial de la API (con o sin denominación).
  assert.deepEqual(await page.locator("tbody tr td:nth-child(5)").allInnerTexts(), ["m² de construcción", "m² a intervenir", "m² a intervenir", "m.l.", "pto. eléctrico"]);
  // Tarifa: texto decimal formateado sin redondear (céntimos solo si no son cero, miles agrupados).
  assert.deepEqual(await page.locator("tbody tr td:nth-child(6)").allInnerTexts(), ["$12", "$1,250.50", "$18", "$0.05", "$45"]);
  assert.deepEqual(await page.locator("tbody tr td:nth-child(7)").allInnerTexts(), ["Activo", "Activo", "Activo", "Inactivo", "Activo"]);
  // Indicadores derivados de la colección completa.
  await page.waitForFunction(() => document.querySelector('[aria-label="Indicadores de servicios y cotizaciones"]')?.textContent.includes("Servicios totales5"));
  assert.equal(await metricValue(page, "Servicios activos").textContent(), "4");
  assert.equal(await metricValue(page, "Servicios Inactivos").textContent(), "1");
  // Primera lectura: 10 filas por página y sin filtros.
  assert.deepEqual(tableGets(backend)[0].params, { limit: "10" });
  // Sin «Ver» hasta que exista su diseño; alta y edición disponibles (formulario en adminServiceForm).
  assert.equal(await page.getByRole("button", { name: /^Ver (detalle|servicio)/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Añadir servicio" }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Editar TST-001 Anteproyecto de prueba" }).isEnabled(), true);
  assert.equal(backend.requests.some((request) => request.method === "DELETE"), false);
});

test("modalidad sin `kind` o con un valor fuera del contrato: estado controlado, sin inventar la modalidad", async (context) => {
  const missing = { ...service(1, { code: "TST-001", name: "Sin tipo de prueba" }) };
  delete missing.kind;
  const backend = createBackend([
    missing,
    service(2, { code: "TST-002", name: "Tipo vacío de prueba", kind: "" }),
    service(3, { code: "TST-003", name: "Tipo futuro de prueba", kind: "bundle" }),
  ]);
  const page = await openTabulator(context, backend);
  const cells = page.locator("tbody tr td:nth-child(4)");
  assert.deepEqual(await cells.allInnerTexts(), ["Sin modalidad", "Sin modalidad", "No reconocida"]);
  // El valor recibido queda disponible para diagnosticar la incompatibilidad con el contrato.
  assert.equal(await cells.nth(2).locator("[title]").getAttribute("title"), "Modalidad no reconocida: bundle");
  assert.equal(await page.getByText(/Llave en mano|Detalle por detalle/).count(), 0);
});

test("skeleton: mismas ocho columnas que la tabla y sin desplazamiento residual en escritorio", async (context) => {
  const backend = createBackend(sampleCatalog());
  backend.delays[""] = 1500;
  // 1920 px: el contenido mide 1104 px con la barra lateral expandida o plegada, así que la tabla cabe.
  const page = await openTabulator(context, backend, { waitForRows: false, viewport: { width: 1920, height: 1080 } });
  await page.getByText("Cargando tabulador de servicios", { exact: true }).waitFor();
  const skeleton = await page.evaluate(() => {
    const row = document.querySelector("[style*=\"grid-template-columns\"]");
    const scroller = row.closest(".overflow-x-auto");
    return { columns: getComputedStyle(row).gridTemplateColumns.split(" ").length, overflow: scroller.scrollWidth - scroller.clientWidth };
  });
  assert.deepEqual(skeleton, { columns: 8, overflow: 0 });
  await page.getByText("TST-001", { exact: true }).waitFor();
  // Mismo ancho en carga y con datos: la tabla no salta al terminar.
  assert.equal(await page.locator("table").evaluate((table) => table.closest(".overflow-x-auto").scrollWidth - table.closest(".overflow-x-auto").clientWidth), 0);
});

test("vacío, carga y error: estados del Design System con reintento", async (context) => {
  const empty = await openTabulator(context, createBackend([]), { waitForRows: false });
  await empty.getByText("Aún no hay servicios en el tabulador", { exact: true }).waitFor();
  assert.equal(await empty.getByRole("navigation", { name: "Paginación de servicios" }).count(), 0);

  const backend = createBackend(sampleCatalog());
  backend.failures["GET /api/admin/services"] = { status: 500, body: { code: "INTERNAL_SERVER_ERROR", message: "Ocurrió un error inesperado." } };
  const page = await openTabulator(context, backend, { waitForRows: false });
  await page.getByText("No se pudo cargar el tabulador de servicios", { exact: true }).waitFor();
  delete backend.failures["GET /api/admin/services"];
  backend.delays[""] = 600;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await page.getByText("Cargando tabulador de servicios", { exact: true }).waitFor();
  await page.getByText("TST-001", { exact: true }).waitFor();
});

test("búsqueda: debounce, una petición por pausa, respuestas obsoletas descartadas y sin coincidencias", async (context) => {
  const backend = createBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const searchBox = page.getByRole("textbox", { name: "Buscar servicios por nombre o código" });
  const before = tableGets(backend).length;
  backend.delays.de = 900;
  await searchBox.pressSequentially("de", { delay: 40 });
  await page.waitForTimeout(400);
  await searchBox.pressSequentially(" prueba", { delay: 40 });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 5);
  await page.waitForTimeout(1100);
  const searches = tableGets(backend).slice(before).map((request) => request.params.search);
  assert.deepEqual(searches, ["de", "de prueba"], "Cada pausa genera una única petición");
  assert.equal((await rowCodes(page)).length, 5, "La respuesta antigua no sustituye la búsqueda reciente");

  await searchBox.fill("tst-004");
  await page.waitForFunction(() => [...document.querySelectorAll("tbody th[scope=row]")].map((cell) => cell.textContent).join() === "TST-004");
  await searchBox.fill("zzz");
  await page.getByText("No hay coincidencias", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Quitar filtros" }).last().click();
  await page.getByText("TST-001", { exact: true }).waitFor();
  assert.equal(await searchBox.inputValue(), "");
});

test("filtros: unidad (base o denominación, excluyentes), estado y Quitar filtros restauran la consulta", async (context) => {
  const backend = createBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  // El estado vacío también ofrece «Quitar filtros»: se usa el de la barra.
  const clear = page.locator(".admin-table-toolbar").getByRole("button", { name: "Quitar filtros" });
  assert.equal(await clear.isDisabled(), true, "Sin filtros no hay nada que quitar");

  // Opciones derivadas de las unidades que usan los servicios reales.
  await page.getByRole("button", { name: "Filtrar servicios por unidad", exact: true }).click();
  assert.deepEqual(await page.getByRole("menuitem").allInnerTexts(), ["m.l.", "m² · todas", "m² a intervenir", "m² de construcción", "pto. · todas", "pto. eléctrico"]);
  await page.getByRole("menuitem", { name: "m² a intervenir", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("tbody th[scope=row]")].map((cell) => cell.textContent).join() === "TST-002,TST-003");
  assert.deepEqual(tableGets(backend).at(-1).params, { limit: "10", unitDenominationId: "11" });
  assert.match(await page.getByRole("button", { name: "Filtrar servicios por unidad", exact: true }).innerText(), /m² a intervenir/);

  // La base sustituye a la denominación: nunca se envían ambos parámetros.
  await chooseFilter(page, "Filtrar servicios por unidad", "m² · todas");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3);
  assert.deepEqual(tableGets(backend).at(-1).params, { limit: "10", measurementUnitId: "1" });

  await chooseFilter(page, "Filtrar servicios por estado", "Inactivos");
  await page.getByText("No hay coincidencias", { exact: true }).waitFor();
  assert.deepEqual(tableGets(backend).at(-1).params, { limit: "10", measurementUnitId: "1", status: "inactive" });

  await clear.click();
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 5);
  assert.deepEqual(tableGets(backend).at(-1).params, { limit: "10" });
  assert.equal(await clear.isDisabled(), true);
  assert.match(await page.getByRole("button", { name: "Filtrar servicios por unidad", exact: true }).innerText(), /Filtrar por unidad/);
  assert.match(await page.getByRole("button", { name: "Filtrar servicios por estado", exact: true }).innerText(), /Filtrar por estado/);

  await chooseFilter(page, "Filtrar servicios por estado", "Inactivos");
  await page.waitForFunction(() => [...document.querySelectorAll("tbody th[scope=row]")].map((cell) => cell.textContent).join() === "TST-004");
});

test("paginación y selección: cursor real, contador, todos, indeterminado y reinicio al cambiar de consulta", async (context) => {
  const items = Array.from({ length: 13 }, (_, index) => service(index + 1, { code: `TST-${String(index + 1).padStart(3, "0")}`, name: `Servicio de prueba ${index + 1}` }));
  const backend = createBackend(items);
  const page = await openTabulator(context, backend);
  const footer = page.getByLabel("Selección y paginación de servicios");
  await footer.getByText("0 de 10 seleccionados").waitFor();
  const header = page.getByRole("checkbox", { name: "Seleccionar todos los servicios visibles" });

  await page.getByRole("checkbox", { name: "Seleccionar TST-001 Servicio de prueba 1" }).click();
  await footer.getByText("1 de 10 seleccionados").waitFor();
  assert.equal(await rowFor(page, "TST-001").getAttribute("data-selected"), "true");
  assert.equal(await header.getAttribute("aria-checked"), "mixed");
  await header.click();
  await footer.getByText("10 de 10 seleccionados").waitFor();
  await header.click();
  await footer.getByText("0 de 10 seleccionados").waitFor();
  // Al quitar toda la selección desaparecen las acciones y su contenedor.
  const actions = footer.getByRole("button", { name: /Desactivar|Activar/ });
  assert.equal(await actions.count(), 0);
  assert.equal(await footer.locator("[data-service-bulk-actions]").count(), 0);

  await page.getByRole("checkbox", { name: "Seleccionar TST-002 Servicio de prueba 2" }).click();
  await page.getByRole("button", { name: "Siguiente pág." }).click();
  await page.getByText("TST-013", { exact: true }).waitFor();
  assert.deepEqual(await rowCodes(page), ["TST-011", "TST-012", "TST-013"]);
  assert.equal(tableGets(backend).at(-1).params.cursor, "10");
  await footer.getByText("0 de 3 seleccionados").waitFor();
  assert.equal(await actions.count(), 0, "Cambiar de página elimina las acciones junto con la selección");
  assert.equal(await page.getByRole("button", { name: "Siguiente pág." }).isDisabled(), true);
  await page.getByRole("button", { name: "Anterior" }).click();
  await page.getByText("TST-001", { exact: true }).waitFor();
  await footer.getByText("0 de 10 seleccionados").waitFor();
  assert.equal(await page.getByRole("button", { name: "Anterior" }).isDisabled(), true);

  // Filtrar también reinicia la selección y vuelve a la primera página.
  await page.getByRole("checkbox", { name: "Seleccionar TST-003 Servicio de prueba 3" }).click();
  await chooseFilter(page, "Filtrar servicios por estado", "Activos");
  await footer.getByText("0 de 10 seleccionados").waitFor();
  assert.equal(await actions.count(), 0);
  assert.equal(tableGets(backend).at(-1).params.cursor, undefined);
});

test("acciones: desactivar y activar con confirmación, versión esperada, fila e indicadores actualizados", async (context) => {
  const backend = createBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  await page.waitForFunction(() => document.querySelector('[aria-label="Indicadores de servicios y cotizaciones"]')?.textContent.includes("Servicios activos4"));
  await page.getByRole("checkbox", { name: "Seleccionar TST-001 Anteproyecto de prueba" }).click();

  // Cancelar no envía nada.
  await page.getByRole("button", { name: "Más opciones para TST-001" }).click();
  await page.getByRole("menuitem", { name: "Desactivar" }).click();
  const dialog = page.getByRole("dialog", { name: "¿Desactivar servicio?" });
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(backend.requests.filter((request) => request.method === "PATCH").length, 0);

  await page.getByRole("button", { name: "Más opciones para TST-001" }).click();
  await page.getByRole("menuitem", { name: "Desactivar" }).click();
  await dialog.getByRole("button", { name: "Desactivar" }).click();
  await page.getByRole("alert").getByText("Servicio desactivado correctamente", { exact: true }).waitFor();
  await page.getByRole("alert").getByText("Anteproyecto de prueba", { exact: true }).waitFor();
  await page.getByRole("alert").getByText("Ya no está disponible para nuevas cotizaciones", { exact: true }).waitFor();
  const [patch] = backend.requests.filter((request) => request.method === "PATCH");
  assert.equal(patch.path, "/api/admin/services/1/status");
  assert.deepEqual(patch.body, { expectedVersion: 1, isActive: false });
  await rowFor(page, "TST-001").getByText("Inactivo", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Indicadores de servicios y cotizaciones"]')?.textContent.includes("Servicios activos3"));
  // Reemplazar la fila conserva la selección.
  assert.equal(await rowFor(page, "TST-001").getAttribute("data-selected"), "true");

  // Reactivar usa la versión nueva leída de la respuesta.
  await page.getByRole("button", { name: "Más opciones para TST-001" }).click();
  await page.getByRole("menuitem", { name: "Activar" }).click();
  await page.getByRole("dialog", { name: "¿Activar servicio?" }).getByRole("button", { name: "Activar" }).click();
  await rowFor(page, "TST-001").getByText("Activo", { exact: true }).waitFor();
  await page.getByRole("alert").getByText("Servicio activado correctamente", { exact: true }).waitFor();
  await page.getByRole("alert").getByText("Vuelve a estar disponible para nuevas cotizaciones", { exact: true }).waitFor();
  assert.deepEqual(backend.requests.filter((request) => request.method === "PATCH").at(-1).body, { expectedVersion: 2, isActive: true });

  // Con filtro de estado, el servicio desactivado sale de la consulta: se recarga la página.
  await chooseFilter(page, "Filtrar servicios por estado", "Activos");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 4);
  await page.getByRole("button", { name: "Más opciones para TST-005" }).click();
  await page.getByRole("menuitem", { name: "Desactivar" }).click();
  await dialog.getByRole("button", { name: "Desactivar" }).click();
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3);
  assert.equal(backend.requests.some((request) => request.method === "DELETE"), false);
});

test("errores HTTP: conflicto de versión recarga, reactivación bloqueada por unidad inactiva, 403 y 429", async (context) => {
  const catalog = sampleCatalog();
  catalog[3] = { ...catalog[3], unitDenomination: { id: 99, denomination: "retirada", isActive: false }, unitLabel: "m.l. retirada" };
  const backend = createBackend(catalog);
  const page = await openTabulator(context, backend);

  // Otro administrador cambió la versión: 409, mensaje comprensible y nueva lectura.
  backend.items[0].currentVersion = 5;
  const readsBefore = tableGets(backend).length;
  await page.getByRole("button", { name: "Más opciones para TST-001" }).click();
  await page.getByRole("menuitem", { name: "Desactivar" }).click();
  await page.getByRole("dialog", { name: "¿Desactivar servicio?" }).getByRole("button", { name: "Desactivar" }).click();
  await page.getByRole("alert").getByText(/cambiaron desde que se cargó la tabla/).waitFor();
  assert.equal(await page.getByRole("alert").getAttribute("data-node-id"), "2068:22253");
  await waitFor(() => tableGets(backend).length > readsBefore, "La tabla se vuelve a leer tras el 409");
  await rowFor(page, "TST-001").getByText("Activo", { exact: true }).waitFor();

  // Reactivar con la unidad de medida inactiva: 400 sin cambios en la fila.
  await page.getByRole("button", { name: "Más opciones para TST-004" }).click();
  await page.getByRole("menuitem", { name: "Activar" }).click();
  await page.getByRole("dialog", { name: "¿Activar servicio?" }).getByRole("button", { name: "Activar" }).click();
  await page.getByRole("alert").getByText(/No se puede activar: su unidad de medida está inactiva/).waitFor();
  assert.equal(await page.getByRole("alert").getAttribute("data-node-id"), "2068:22253");
  assert.equal(await rowFor(page, "TST-004").getByText("Inactivo", { exact: true }).count(), 1);

  for (const [status, code, message] of [
    [403, "FORBIDDEN", "No tienes permisos para gestionar el tabulador de servicios."],
    [429, "RATE_LIMITED", "Realizaste demasiados cambios en poco tiempo. Espera unos minutos e inténtalo de nuevo."],
  ]) {
    backend.failures["PATCH /api/admin/services/:id/status"] = { status, body: { code, message: "Texto técnico del backend" } };
    await page.getByRole("button", { name: "Más opciones para TST-002" }).click();
    await page.getByRole("menuitem", { name: "Desactivar" }).click();
    await page.getByRole("dialog", { name: "¿Desactivar servicio?" }).getByRole("button", { name: "Desactivar" }).click();
    await page.getByRole("alert").getByText(message, { exact: true }).waitFor();
    assert.equal(await rowFor(page, "TST-002").getByText("Activo", { exact: true }).count(), 1);
  }
});

test("tooltip: descripción real por hover y teclado, Escape la cierra y sin descripción no hay icono", async (context) => {
  const backend = createBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  // Solo los servicios con descripción no vacía tienen icono (TST-002 tiene solo espacios).
  assert.equal(await page.locator("[data-service-description-hint]").count(), 3);
  assert.equal(await rowFor(page, "TST-002").locator("[data-service-description-hint]").count(), 0);
  assert.equal(await rowFor(page, "TST-004").locator("[data-service-description-hint]").count(), 0);

  const hint = page.getByRole("button", { name: "Ver descripción de Anteproyecto de prueba" });
  await hint.hover();
  const tooltip = page.getByRole("tooltip");
  await tooltip.getByText("Primera propuesta del espacio.", { exact: true }).waitFor();
  assert.equal(await hint.getAttribute("aria-describedby"), await tooltip.getAttribute("id"));
  // Encima del icono, con la flecha centrada, y por encima de la tabla (portal).
  const [hintBox, tooltipBox] = [await hint.boundingBox(), await tooltip.boundingBox()];
  assert.ok(tooltipBox.y + tooltipBox.height <= hintBox.y, "El tooltip queda encima del icono");
  await page.mouse.move(5, 5);
  await tooltip.waitFor({ state: "detached" });

  // Teclado: el foco visible lo abre y Escape lo cierra sin perder el foco.
  await page.getByRole("checkbox", { name: "Seleccionar TST-003 Paisajismo de prueba" }).focus();
  await page.keyboard.press("Tab");
  const longHint = page.getByRole("button", { name: "Ver descripción de Paisajismo de prueba" });
  assert.equal(await longHint.evaluate((element) => element === document.activeElement), true);
  await tooltip.getByText(LONG_DESCRIPTION, { exact: true }).waitFor();
  // Textos extensos: envuelven en el ancho de Figma (224 px) en varias líneas.
  const longBox = await tooltip.boundingBox();
  assert.ok(longBox.width <= 224.5 && longBox.height > 60, JSON.stringify(longBox));
  await page.keyboard.press("Escape");
  await tooltip.waitFor({ state: "detached" });
  assert.equal(await longHint.evaluate((element) => element === document.activeElement), true);
});

test("tooltip táctil (móvil, oscuro): un toque lo abre dentro del viewport y un toque fuera lo cierra", async (context) => {
  const backend = createBackend(sampleCatalog());
  const page = await openTabulator(context, backend, { theme: "dark", viewport: { width: 375, height: 812 }, hasTouch: true });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), true);
  const hint = page.getByRole("button", { name: "Ver descripción de Paisajismo de prueba" });
  await hint.scrollIntoViewIfNeeded();
  await hint.tap();
  const tooltip = page.getByRole("tooltip");
  await tooltip.getByText(LONG_DESCRIPTION, { exact: true }).waitFor();
  const box = await tooltip.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 375 && box.y >= 0, `Dentro del viewport: ${JSON.stringify(box)}`);
  // No lo recorta el overflow de la tabla: está en un portal fuera de ella.
  assert.equal(await tooltip.evaluate((element) => Boolean(element.closest("table"))), false);
  await page.getByRole("heading", { name: "Servicios y cotizaciones", level: 1 }).tap();
  await tooltip.waitFor({ state: "detached" });
});

test("capas: seleccionar descarta ayudas, un menú bloquea todos los tooltips y cerrar permite consultarlos de nuevo", async (context) => {
  const page = await openTabulator(context, createBackend(sampleCatalog()));
  const hint = page.getByRole("button", { name: "Ver descripción de Anteproyecto de prueba" });
  const checkbox = page.getByRole("checkbox", { name: "Seleccionar TST-001 Anteproyecto de prueba" });
  const header = page.getByRole("checkbox", { name: "Seleccionar todos los servicios visibles" });
  const tooltip = page.getByRole("tooltip");
  // Click programático: conserva el hover y evita que mouseleave/blur oculten el defecto.
  for (const target of [checkbox, checkbox, header, header]) {
    await page.mouse.move(5, 5);
    await hint.hover();
    await tooltip.getByText("Primera propuesta del espacio.").waitFor();
    await target.evaluate((element) => element.click());
    await tooltip.waitFor({ state: "detached" });
  }
  await page.mouse.move(5, 5);
  await hint.hover();
  await tooltip.waitFor();
  const trigger = page.getByRole("button", { name: "Más opciones para TST-001" });
  await trigger.evaluate((element) => element.click());
  const menu = page.getByRole("menu", { name: "Acciones para TST-001" });
  await menu.waitFor();
  await tooltip.waitFor({ state: "detached" });
  // Ni otra descripción ni un botón de otra fila pueden superponerse al menú.
  await page.getByRole("button", { name: "Ver descripción de Paisajismo de prueba" }).hover();
  await page.getByRole("button", { name: "Editar TST-002 Diseño interior de prueba" }).hover();
  assert.equal(await tooltip.count(), 0);
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  assert.equal(await tooltip.count(), 0, "Escape no restaura la ayuda del disparador");
  await hint.hover();
  await tooltip.getByText("Primera propuesta del espacio.").waitFor();
  await page.mouse.move(5, 5);
  await trigger.hover();
  await tooltip.getByText("Más opciones", { exact: true }).waitFor();
  await trigger.click();
  await menu.waitFor();
  await tooltip.waitFor({ state: "detached" });
  await page.getByRole("heading", { name: "Servicios y cotizaciones", level: 1 }).click();
  await menu.waitFor({ state: "detached" });
  await hint.hover();
  await tooltip.getByText("Primera propuesta del espacio.").waitFor();
});

test("footer: con selección muestra ambos botones sin ayuda y habilita solo acciones homogéneas", async (context) => {
  const backend = createBackend(sampleCatalog());
  backend.delays["PATCH /api/admin/services/:id/status"] = 200;
  const page = await openTabulator(context, backend);
  const footer = page.getByLabel("Selección y paginación de servicios");
  const patches = () => backend.requests.filter((request) => request.method === "PATCH");
  const selectAll = page.getByRole("checkbox", { name: "Seleccionar todos los servicios visibles" });
  await footer.getByText("0 de 5 seleccionados").waitFor();
  assert.equal(await footer.getByRole("button", { name: /Activar|Desactivar/ }).count(), 0);
  assert.equal(await footer.locator("[data-service-bulk-actions]").count(), 0, "No queda un grupo vacío que reserve espacio");
  assert.equal(await footer.locator(":scope > *").count(), 2, "Solo contador y paginación");
  await page.getByRole("checkbox", { name: "Seleccionar TST-001 Anteproyecto de prueba" }).click();
  assert.equal(await footer.getByRole("button", { name: /^Activar:/ }).isDisabled(), true);
  assert.equal(await footer.getByRole("button", { name: "Desactivar 1 servicio seleccionado" }).isEnabled(), true);
  // Seleccionar solo un inactivo mantiene los dos botones, con Activar habilitado.
  await page.getByRole("checkbox", { name: "Seleccionar TST-001 Anteproyecto de prueba" }).click();
  await page.getByRole("checkbox", { name: "Seleccionar TST-004 Canalizaciones de prueba" }).click();
  assert.equal(await footer.getByRole("button", { name: "Activar 1 servicio seleccionado" }).isEnabled(), true);
  assert.equal(await footer.getByRole("button", { name: /^Desactivar:/ }).isDisabled(), true);
  await selectAll.click();
  await footer.getByText("5 de 5 seleccionados").waitFor();
  assert.equal(await footer.getByRole("button", { name: /Activar|Desactivar/ }).count(), 2);
  assert.equal(await footer.getByRole("button", { name: /^Activar:/ }).isDisabled(), true);
  assert.equal(await footer.getByRole("button", { name: /^Desactivar:/ }).isDisabled(), true);
  assert.equal(await footer.getByRole("status").count(), 0);
  assert.equal(await footer.getByText("Selecciona solo servicios activos o solo inactivos.", { exact: true }).count(), 0);
  for (const action of await footer.getByRole("button", { name: /Desactivar|Activar/ }).all()) {
    assert.equal(await action.getAttribute("aria-describedby"), null);
    await action.evaluate((element) => element.click());
  }
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(patches().length, 0);
  // Deseleccionar el inactivo habilita desactivar TODOS los cuatro activos restantes.
  await page.getByRole("checkbox", { name: "Seleccionar TST-004 Canalizaciones de prueba" }).click();
  assert.equal(await footer.getByRole("button", { name: /^Activar:/ }).isDisabled(), true);
  await footer.getByRole("button", { name: "Desactivar 4 servicios seleccionados" }).click();
  const dialog = page.getByRole("dialog", { name: "¿Desactivar servicios?" });
  await dialog.getByText("Los 4 servicios seleccionados dejarán de estar disponibles para nuevas cotizaciones", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(patches().length, 0);
  await footer.getByRole("button", { name: "Desactivar 4 servicios seleccionados" }).click();
  // Dos eventos en el mismo turno ejercitan la guarda síncrona, antes del rerender del disabled.
  await dialog.getByRole("button", { name: "Desactivar", exact: true }).evaluate((element) => { element.click(); element.click(); });
  await page.getByRole("alert").getByText("Servicios desactivados correctamente", { exact: true }).waitFor();
  await page.getByRole("alert").getByText("Se desactivaron 4 servicios", { exact: true }).waitFor();
  await footer.getByText("0 de 5 seleccionados").waitFor();
  assert.equal(await footer.locator("[data-service-bulk-actions]").count(), 0, "Al terminar desaparecen las acciones");
  assert.deepEqual(patches().map((request) => request.path).sort(), [1, 2, 3, 5].map((id) => `/api/admin/services/${id}/status`));
  for (const request of patches()) assert.deepEqual(request.body, { expectedVersion: 1, isActive: false });
  assert.equal(backend.items.every((item) => !item.isActive), true);

  await selectAll.click();
  assert.equal(await footer.getByRole("button", { name: /^Desactivar:/ }).isDisabled(), true);
  assert.equal(await footer.getByRole("button", { name: "Activar 5 servicios seleccionados" }).isEnabled(), true);
  await footer.getByRole("button", { name: "Activar 5 servicios seleccionados" }).click();
  await page.getByRole("dialog", { name: "¿Activar servicios?" }).getByRole("button", { name: "Activar", exact: true }).click();
  await page.getByRole("alert").getByText("Servicios activados correctamente", { exact: true }).waitFor();
  await page.getByRole("alert").getByText("Se activaron 5 servicios", { exact: true }).waitFor();
  await footer.getByText("0 de 5 seleccionados").waitFor();
  assert.equal(await footer.getByRole("button", { name: /Activar|Desactivar/ }).count(), 0);
  const activationRequests = patches().slice(4);
  assert.equal(activationRequests.length, 5);
  for (const request of activationRequests) {
    assert.deepEqual(request.body, { expectedVersion: request.path.includes("/4/") ? 1 : 2, isActive: true });
  }
  await waitFor(() => backend.items.every((item) => item.isActive), "Todos los cambios terminaron");
  await page.waitForFunction(() => document.querySelector('[aria-label="Indicadores de servicios y cotizaciones"]')?.textContent.includes("Servicios activos5"));
});

test("reactivación: unidad o denominación inactiva cancela toda la selección antes de enviar cambios", async (context) => {
  const catalog = sampleCatalog().map((item) => ({ ...item, isActive: false }));
  catalog[0].measurementUnit = { ...catalog[0].measurementUnit, isActive: false };
  catalog[1].unitDenomination = { ...catalog[1].unitDenomination, isActive: false };
  const backend = createBackend(catalog);
  const page = await openTabulator(context, backend);
  const header = page.getByRole("checkbox", { name: "Seleccionar todos los servicios visibles" });
  const footer = page.getByLabel("Selección y paginación de servicios");
  await header.click();
  await footer.getByRole("button", { name: "Activar 5 servicios seleccionados" }).click();
  await page.getByRole("dialog", { name: "¿Activar servicios?" }).getByRole("button", { name: "Activar", exact: true }).click();
  const alert = page.getByRole("alert");
  await alert.getByText(/TST-001: No se puede activar: su unidad base está inactiva/).waitFor();
  await footer.getByText("0 de 5 seleccionados").waitFor();
  assert.equal(backend.requests.filter((request) => request.method === "PATCH").length, 0);
  assert.equal(backend.items.every((item) => !item.isActive), true);

  // Reparar la primera referencia permite detectar la segunda, sin escribir sobre las otras.
  backend.items[0].measurementUnit.isActive = true;
  await header.click();
  await footer.getByRole("button", { name: "Activar 5 servicios seleccionados" }).click();
  await page.getByRole("dialog", { name: "¿Activar servicios?" }).getByRole("button", { name: "Activar", exact: true }).click();
  await alert.getByText(/TST-002: No se puede activar: su unidad de medida está inactiva/).waitFor();
  await footer.getByText("0 de 5 seleccionados").waitFor();
  assert.equal(backend.requests.filter((request) => request.method === "PATCH").length, 0);
  backend.items[1].unitDenomination.isActive = true;
  await header.click();
  await footer.getByRole("button", { name: "Activar 5 servicios seleccionados" }).click();
  await page.getByRole("dialog", { name: "¿Activar servicios?" }).getByRole("button", { name: "Activar", exact: true }).click();
  await alert.getByText("Servicios activados correctamente", { exact: true }).waitFor();
  await footer.getByText("0 de 5 seleccionados").waitFor();
  assert.equal(backend.requests.filter((request) => request.method === "PATCH").length, 5);
});

test("9 inactivos y 1 activo: bloquea activar hasta deseleccionar el activo", async (context) => {
  const items = Array.from({ length: 10 }, (_, index) => service(index + 1, {
    code: `TEST-${index + 1}`, name: `Prueba ${index + 1}`, isActive: index === 9,
  }));
  const backend = createBackend(items);
  const page = await openTabulator(context, backend);
  const footer = page.getByLabel("Selección y paginación de servicios");
  await page.getByRole("checkbox", { name: "Seleccionar todos los servicios visibles" }).click();
  for (const action of await footer.getByRole("button", { name: /Activar|Desactivar/ }).all()) assert.equal(await action.isDisabled(), true);
  await page.getByRole("checkbox", { name: "Seleccionar TEST-10 Prueba 10" }).click();
  await footer.getByRole("button", { name: "Activar 9 servicios seleccionados" }).click();
  await page.getByRole("dialog", { name: "¿Activar servicios?" }).getByText("Los 9 servicios seleccionados volverán a estar disponibles para nuevas cotizaciones", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(backend.requests.some((request) => request.method === "PATCH"), false);
});

test("comprobación masiva: cambios antes de confirmar o durante las lecturas cancelan todo sin PATCH", async (context) => {
  for (const phase of ["antes", "durante", "versión"]) {
    const items = Array.from({ length: 10 }, (_, index) => service(index + 1, {
      code: `TEST-${index + 1}`, name: `Prueba ${index + 1}`, isActive: false,
    }));
    const backend = createBackend(items);
    const page = await openTabulator(context, backend);
    const footer = page.getByLabel("Selección y paginación de servicios");
    await page.getByRole("checkbox", { name: "Seleccionar todos los servicios visibles" }).click();
    await footer.getByRole("button", { name: "Activar 10 servicios seleccionados" }).click();
    const dialog = page.getByRole("dialog", { name: "¿Activar servicios?" });
    if (phase === "durante") {
      backend.delays["GET /api/admin/services/:id"] = 100;
      await dialog.getByRole("button", { name: "Activar", exact: true }).click();
      await waitFor(() => backend.requests.some((request) => request.path === "/api/admin/services/1"), "Comenzó la comprobación");
    }
    backend.items[9].currentVersion += 1;
    if (phase !== "versión") backend.items[9].isActive = true;
    if (phase !== "durante") await dialog.getByRole("button", { name: "Activar", exact: true }).click();
    await page.getByRole("alert").getByText(/cambiaron desde que se cargó la tabla/).waitFor();
    await footer.getByText("0 de 10 seleccionados").waitFor();
    assert.equal(backend.requests.filter((request) => request.method === "PATCH").length, 0, phase);
    assert.equal(backend.requests.filter((request) => request.method === "GET" && /\/services\/\d+$/.test(request.path)).length, 10);
    assert.equal(backend.items.slice(0, 9).every((item) => !item.isActive), true);
  }
});

test("lectura previa fallida cancela el conjunto y no presenta éxito", async (context) => {
  const backend = createBackend(sampleCatalog().map((item) => ({ ...item, isActive: false })));
  const page = await openTabulator(context, backend);
  backend.failures["GET /api/admin/services/2"] = { status: 403, body: { code: "FORBIDDEN", message: "Sin acceso" } };
  await page.getByRole("checkbox", { name: "Seleccionar todos los servicios visibles" }).click();
  await page.getByRole("button", { name: "Activar 5 servicios seleccionados" }).click();
  await page.getByRole("dialog", { name: "¿Activar servicios?" }).getByRole("button", { name: "Activar", exact: true }).click();
  await page.getByRole("alert").getByText(/No tienes permisos para gestionar el tabulador/).waitFor();
  assert.equal(backend.requests.some((request) => request.method === "PATCH"), false);
  assert.equal(backend.items.every((item) => !item.isActive), true);
});

test("conflicto posterior a la comprobación: conserva expectedVersion, detiene pendientes e informa resultados reales", async (context) => {
  const backend = createBackend(Array.from({ length: 7 }, (_, index) => service(index + 1, {
    code: `TEST-${index + 1}`, name: `Prueba ${index + 1}`, isActive: false,
  })));
  const page = await openTabulator(context, backend);
  backend.delays["PATCH /api/admin/services/2/status"] = 250;
  backend.delays["PATCH /api/admin/services/3/status"] = 250;
  backend.beforeStatusChange = (item) => {
    if (item.id === 1) {
      item.isActive = true;
      item.currentVersion += 1;
    }
  };
  const header = page.getByRole("checkbox", { name: "Seleccionar todos los servicios visibles" });
  const footer = page.getByLabel("Selección y paginación de servicios");
  await header.click();
  await footer.getByRole("button", { name: "Activar 7 servicios seleccionados" }).click();
  await page.getByRole("dialog", { name: "¿Activar servicios?" }).getByRole("button", { name: "Activar", exact: true }).click();
  await page.getByRole("alert").getByText(/Cancelados sin enviar: 4/).waitFor();
  assert.equal(await page.getByRole("alert").getAttribute("data-node-id"), "2068:22253", "Un éxito parcial conserva Danger");
  await footer.getByText("0 de 7 seleccionados").waitFor();
  const patches = () => backend.requests.filter((request) => request.method === "PATCH");
  assert.deepEqual(patches().map((request) => request.path).sort(), [1, 2, 3].map((id) => `/api/admin/services/${id}/status`));
  assert.equal(patches().every((request) => request.body.expectedVersion === 1), true);
  const firstWrite = backend.requests.findIndex((request) => request.method === "PATCH");
  assert.equal(backend.requests.slice(0, firstWrite).filter((request) => /\/services\/\d+$/.test(request.path)).length, 7);
  assert.equal(backend.items.slice(3).every((item) => !item.isActive), true);

  // Una selección nueva es mixta: exige retirar los activos y no repite cambios aplicados.
  backend.beforeStatusChange = null;
  await header.click();
  assert.equal(await footer.getByRole("button", { name: /^Activar:/ }).isDisabled(), true);
  for (const id of [1, 2, 3]) await page.getByRole("checkbox", { name: `Seleccionar TEST-${id} Prueba ${id}` }).click();
  await footer.getByRole("button", { name: "Activar 4 servicios seleccionados" }).click();
  await page.getByRole("dialog", { name: "¿Activar servicios?" }).getByRole("button", { name: "Activar", exact: true }).click();
  await page.getByRole("alert").getByText("Servicios activados correctamente", { exact: true }).waitFor();
  await page.getByRole("alert").getByText("Se activaron 4 servicios", { exact: true }).waitFor();
  assert.deepEqual(patches().slice(3).map((request) => request.path).sort(), [4, 5, 6, 7].map((id) => `/api/admin/services/${id}/status`));
});

test("menú individual: funciona con selección mixta y cancela si el estado cambia durante su comprobación", async (context) => {
  const backend = createBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  for (const name of ["Seleccionar TST-001 Anteproyecto de prueba", "Seleccionar TST-004 Canalizaciones de prueba"]) await page.getByRole("checkbox", { name }).click();
  await page.getByRole("button", { name: "Más opciones para TST-001" }).click();
  await page.getByRole("menuitem", { name: "Desactivar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "¿Desactivar servicio?" });
  await dialog.getByText("Este servicio dejará de estar disponible para nuevas cotizaciones", { exact: true }).waitFor();
  assert.equal(await page.getByRole("menu").count(), 0);
  assert.equal(await page.getByRole("tooltip").count(), 0);
  backend.delays["GET /api/admin/services/1"] = 100;
  await dialog.getByRole("button", { name: "Desactivar", exact: true }).click();
  await waitFor(() => backend.requests.some((request) => request.path === "/api/admin/services/1"), "Lectura individual iniciada");
  backend.items[0].isActive = false;
  backend.items[0].currentVersion += 1;
  await page.getByRole("alert").getByText(/cambiaron desde que se cargó la tabla/).waitFor();
  await rowFor(page, "TST-001").getByText("Inactivo", { exact: true }).waitFor();
  assert.equal(backend.requests.some((request) => request.method === "PATCH"), false);
  await page.getByRole("button", { name: "Más opciones para TST-001" }).click();
  await page.getByRole("menuitem", { name: "Activar", exact: true }).click();
  await page.getByRole("dialog", { name: "¿Activar servicio?" }).getByRole("button", { name: "Activar", exact: true }).click();
  await rowFor(page, "TST-001").getByText("Activo", { exact: true }).waitFor();
  assert.deepEqual(backend.requests.find((request) => request.method === "PATCH").body, { expectedVersion: 2, isActive: true });
});

test("confirmación Figma de servicios: cuatro variantes, iconos, colores, foco, responsive y ambos temas", async (context) => {
  const variants = ["light", "dark"].flatMap((theme) => [false, true].flatMap((activating) => [1, 2].map((count) => ({ theme, activating, count }))));
  for (const { theme, activating, count } of variants) {
    const backend = createBackend(sampleCatalog().map((item) => ({ ...item, isActive: !activating })));
    const page = await openTabulator(context, backend, { theme });
    const action = activating ? "Activar" : "Desactivar";
    const title = `¿${action} ${count === 1 ? "servicio" : "servicios"}?`;
    const description = count === 1
      ? `Este servicio ${activating ? "volverá a estar disponible" : "dejará de estar disponible"} para nuevas cotizaciones`
      : `Los 2 servicios seleccionados ${activating ? "volverán a estar disponibles" : "dejarán de estar disponibles"} para nuevas cotizaciones`;
    const origin = count === 1
      ? page.getByRole("button", { name: "Más opciones para TST-001", exact: true })
      : page.getByRole("button", { name: `${action} 2 servicios seleccionados`, exact: true });
    if (count === 1) {
      await origin.click();
      await page.getByRole("menuitem", { name: action, exact: true }).click();
    } else {
      await page.getByRole("checkbox", { name: "Seleccionar TST-001 Anteproyecto de prueba" }).click();
      await page.getByRole("checkbox", { name: "Seleccionar TST-002 Diseño interior de prueba" }).click();
      await origin.click();
    }
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await dialog.getByText(description, { exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent.trim() === "Cancelar");
    await page.mouse.move(4, 4);
    await dialog.evaluate(async (element) => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
    });
    assert.equal(await page.getByRole("menu").count(), 0);
    assert.equal(await dialog.getAttribute("aria-describedby"), await dialog.getByText(description, { exact: true }).getAttribute("id"));
    const palette = await dialog.evaluate((element, active) => {
      const icon = element.querySelector("[data-service-status-icon]");
      const card = icon.closest(".overflow-hidden");
      const footer = card.lastElementChild;
      const confirm = footer.querySelector("button:last-child");
      const cancel = footer.querySelector("button:first-child");
      const tokenColor = (token) => {
        const probe = document.createElement("span");
        probe.style.color = token.startsWith("--") ? `var(${token})` : token;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      return {
        icon: icon.getAttribute("data-service-status-icon"),
        iconColor: getComputedStyle(icon).color,
        expectedIcon: tokenColor(active ? "--color-success-200" : "--color-danger-100"),
        buttonColor: getComputedStyle(confirm).backgroundColor,
        expectedButton: tokenColor(active ? "--color-success-200" : "--color-danger-100"),
        cancelColor: getComputedStyle(cancel).color,
        cancelBorder: getComputedStyle(cancel).borderTopColor,
        expectedCancel: tokenColor(active ? (document.documentElement.classList.contains("dark")
          ? "--color-success-200" : "color-mix(in srgb, var(--color-success-200) 70%, var(--color-neutral-950-uniform))") : "--color-danger-100"),
        radius: getComputedStyle(card).borderRadius,
        footerBorder: getComputedStyle(footer).borderTopWidth,
        footerPadding: getComputedStyle(footer).padding,
        footerGap: getComputedStyle(footer).gap,
        iconSize: [icon.getBoundingClientRect().width, icon.getBoundingClientRect().height],
        buttons: [...footer.querySelectorAll("button")].map((button) => button.getBoundingClientRect().width),
      };
    }, activating);
    assert.equal(palette.icon, activating ? "activate" : "deactivate");
    assert.equal(palette.iconColor, palette.expectedIcon);
    assert.equal(palette.buttonColor, palette.expectedButton);
    assert.equal(palette.cancelColor, palette.expectedCancel);
    assert.equal(palette.cancelBorder, palette.expectedCancel);
    const confirmButton = dialog.getByRole("button", { name: action, exact: true });
    await confirmButton.hover();
    await confirmButton.evaluate(async (element) => {
      await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
    });
    const hover = await confirmButton.evaluate((element, active) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${active ? "--color-success-100" : "--color-danger-200"})`;
      document.body.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(element).backgroundColor, expected };
    }, activating);
    assert.equal(hover.actual, hover.expected);
    await page.mouse.down();
    assert.equal(await confirmButton.evaluate((element) => getComputedStyle(element).backgroundColor), hover.expected);
    // Soltar fuera evita confirmar; la operación solo se valida visualmente en este caso.
    await page.mouse.move(4, 4);
    await page.mouse.up();
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).focus();
    // focus-visible depende de interacción por teclado, no de foco programático tras el ratón.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    assert.notEqual(await dialog.getByRole("button", { name: "Cancelar", exact: true }).evaluate((element) => getComputedStyle(element).boxShadow), "none");
    assert.deepEqual({ radius: palette.radius, footerBorder: palette.footerBorder, padding: palette.footerPadding, gap: palette.footerGap, iconSize: palette.iconSize },
      { radius: "12px", footerBorder: "1px", padding: "16px", gap: "16px", iconSize: [20, 20] });
    assert.ok(Math.abs(palette.buttons[0] - palette.buttons[1]) <= 1, "Botones de igual ancho");
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 812 });
      await dialog.getByText(title, { exact: true }).evaluate(async (element) => {
        await Promise.allSettled(element.closest("[data-service-status-modal]").getAnimations({ subtree: true }).map((animation) => animation.finished));
      });
      const box = await dialog.getByText(title, { exact: true }).evaluate((element) => element.closest(".overflow-hidden").getBoundingClientRect().toJSON());
      assert.ok(box.width <= 400 && box.height < 330 && box.x >= 0 && box.right <= width && box.y >= 0 && box.bottom <= 812, `${theme} ${width}: ${JSON.stringify(box)}`);
      assert.ok(Math.abs(box.y + box.height / 2 - 406) < 1, "Centrado en el viewport como Figma");
      assert.doesNotMatch(await dialog.innerText(), /Deshabilitar usuario|Asignaciones de usuario/);
    }
    if (process.env.ARCA_SERVICE_STATUS_SCREENSHOTS) {
      await dialog.locator(".overflow-hidden").screenshot({ path: join(tmpdir(), `arca-service-status-${theme}-${activating ? "activate" : "deactivate"}-${count}.png`) });
    }
    // Tab cíclico incluye cerrar, cancelar y confirmar sin salir del diálogo.
    await dialog.getByRole("button", { name: action, exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await dialog.getByRole("button", { name: "Cerrar modal", exact: true }).evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await dialog.getByRole("button", { name: action, exact: true }).evaluate((element) => element === document.activeElement), true);
    if (count === 1) await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    else await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await origin.evaluate((element) => element === document.activeElement), true, "Restaura foco al disparador");
    assert.equal(backend.requests.some((request) => request.method === "PATCH"), false);
    assert.equal(backend.requests.some((request) => /\/services\/\d+$/.test(request.path)), false, "Cancelar no inicia la comprobación");
  }
});

test("avisos de Servicios: nombre largo consultable, código largo omitido y consecuencia visible en ambos temas", async (context) => {
  for (const theme of ["light", "dark"]) {
    for (const activating of [false, true]) {
      const name = "Servicio".repeat(18);
      const code = "PUBLICO-".repeat(30);
      const backend = createBackend([service(1, { name, code, isActive: !activating })]);
      const page = await openTabulator(context, backend, { theme });
      const action = activating ? "Activar" : "Desactivar";
      // La selección de un solo registro también debe producir el aviso singular con su nombre.
      await page.getByRole("checkbox", { name: `Seleccionar ${code} ${name}`, exact: true }).click();
      await page.getByRole("button", { name: `${action} 1 servicio seleccionado`, exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: action, exact: true }).click();
      const alert = page.getByRole("alert");
      const consequence = `${activating ? "Vuelve a estar disponible" : "Ya no está disponible"} para nuevas cotizaciones`;
      await alert.getByText(`Servicio ${activating ? "activado" : "desactivado"} correctamente`, { exact: true }).waitFor();
      await alert.getByText(consequence, { exact: true }).waitFor();
      await alert.evaluate(async (element) => {
        await Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
      });
      // Mantiene el aviso durante los cambios de viewport y ejercita lectura por teclado.
      await alert.getByRole("button", { name: "Cerrar alerta", exact: true }).focus();
      assert.equal((await alert.innerText()).includes(code), false);
      assert.equal(await alert.getAttribute("data-node-id"), "2068:22275");
      for (const width of [375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 812 });
        const bounds = await alert.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, bottom: rect.bottom, overflow: element.scrollWidth - element.clientWidth };
        });
        assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.bottom <= 812 && bounds.overflow <= 1, JSON.stringify(bounds));
        assert.equal(await alert.getByText(consequence, { exact: true }).isVisible(), true);
      }
      const subject = alert.getByText(name, { exact: true });
      assert.equal(await subject.evaluate((element) => element.scrollHeight > element.clientHeight), true, "El nombre se limita a dos líneas");
      await subject.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await page.getByRole("tooltip").getByText(name, { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("tooltip").waitFor({ state: "detached" });
      await page.mouse.move(4, 4);
      await subject.hover();
      await page.getByRole("tooltip").getByText(name, { exact: true }).waitFor();
      await page.mouse.move(4, 4);
      if (theme === "dark" && activating) {
        await page.waitForTimeout(5200);
        assert.equal(await alert.isVisible(), true, "No desaparece mientras se consulta el nombre con foco");
      }
      if (process.env.ARCA_SERVICE_STATUS_SCREENSHOTS) {
        await alert.screenshot({ path: join(tmpdir(), `arca-service-toast-${theme}-${activating ? "activate" : "deactivate"}.png`) });
      }
      if (theme === "dark" && activating) {
        await subject.hover();
        await page.getByRole("button", { name: "Añadir servicio", exact: true }).focus();
        await page.waitForTimeout(5200);
        assert.equal(await alert.isVisible(), true, "El puntero también pausa el cierre aunque el foco salga");
        await page.mouse.move(4, 4);
        await alert.waitFor({ state: "detached", timeout: 7000 });
      } else {
        await alert.getByRole("button", { name: "Cerrar alerta", exact: true }).click();
        await alert.waitFor({ state: "detached" });
      }
    }
  }
});

test("aviso móvil oscuro: nombre completo por pulsación larga sin perder la consecuencia", async (context) => {
  const name = "Servicio de prueba con nombre extenso ".repeat(4);
  const backend = createBackend([service(1, { name, code: "TEST-TOUCH", isActive: true })]);
  const page = await openTabulator(context, backend, { theme: "dark", hasTouch: true, viewport: { width: 375, height: 812 } });
  await page.getByRole("button", { name: "Más opciones para TEST-TOUCH", exact: true }).click();
  await page.getByRole("menuitem", { name: "Desactivar", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Desactivar", exact: true }).click();
  const alert = page.getByRole("alert");
  const subject = alert.getByText(name.trim(), { exact: true });
  await subject.waitFor();
  await alert.evaluate(async (element) => {
    await Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  await subject.dispatchEvent("pointerdown", { pointerType: "touch", clientX: 120, clientY: 700 });
  await page.getByRole("tooltip").getByText(name.trim(), { exact: true }).waitFor();
  await subject.dispatchEvent("pointerup", { pointerType: "touch", clientX: 120, clientY: 700 });
  assert.equal(await alert.getByText("Ya no está disponible para nuevas cotizaciones", { exact: true }).isVisible(), true);
  const box = await page.getByRole("tooltip").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 375 && box.y >= 0 && box.y + box.height <= 812, JSON.stringify(box));
  await alert.getByRole("button", { name: "Cerrar alerta", exact: true }).tap();
  await alert.waitFor({ state: "detached" });
});

test("confirmación Servicios: overlay cancela y la operación en curso bloquea cierre y doble envío", async (context) => {
  const backend = createBackend(sampleCatalog());
  const page = await openTabulator(context, backend);
  const openConfirmation = async () => {
    await page.getByRole("button", { name: "Más opciones para TST-001", exact: true }).click();
    await page.getByRole("menuitem", { name: "Desactivar", exact: true }).click();
    return page.getByRole("dialog", { name: "¿Desactivar servicio?", exact: true });
  };
  let dialog = await openConfirmation();
  await page.mouse.click(4, 4);
  await dialog.waitFor({ state: "detached" });
  assert.equal(backend.requests.some((request) => /\/services\/\d+(\/status)?$/.test(request.path)), false);
  backend.delays["GET /api/admin/services/1"] = 1500;
  dialog = await openConfirmation();
  await dialog.getByRole("button", { name: "Desactivar", exact: true }).evaluate((element) => { element.click(); element.click(); });
  await dialog.getByRole("button", { name: "Confirmando...", exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0, "Sin éxito antes de la confirmación de API");
  assert.equal(await dialog.getAttribute("aria-busy"), "true");
  for (const button of await dialog.getByRole("button").all()) assert.equal(await button.isDisabled(), true);
  await page.keyboard.press("Escape");
  await page.mouse.click(4, 4);
  assert.equal(await dialog.isVisible(), true);
  await rowFor(page, "TST-001").getByText("Activo", { exact: true }).waitFor();
  await rowFor(page, "TST-001").getByText("Inactivo", { exact: true }).waitFor();
  assert.equal(backend.requests.filter((request) => request.method === "PATCH").length, 1);
});

test("menú en límite inferior: abre arriba en portal, cierra con Escape/clic fuera y no bloquea ayudas tras paginar", async (context) => {
  const items = Array.from({ length: 11 }, (_, index) => service(index + 1, {
    code: `TST-${String(index + 1).padStart(3, "0")}`, name: `Prueba ${index + 1}`, description: `Descripción ${index + 1}`,
  }));
  const page = await openTabulator(context, createBackend(items), { viewport: { width: 1440, height: 600 } });
  const trigger = page.getByRole("button", { name: "Más opciones para TST-010" });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.evaluate((element) => {
    let scroller = element.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    // Sitúa el ancla a 16 px del borde: scrollIntoViewIfNeeded la centraba y sí cabía debajo.
    scroller.scrollTop += element.getBoundingClientRect().bottom - (window.innerHeight - 16);
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Acciones para TST-010" });
  await menu.waitFor();
  const [anchorBox, menuBox] = await Promise.all([trigger.boundingBox(), menu.boundingBox()]);
  assert.ok(menuBox.y + menuBox.height <= anchorBox.y, JSON.stringify({ anchorBox, menuBox }));
  assert.ok(menuBox.y >= 0 && menuBox.x + menuBox.width <= 1440);
  assert.equal(await menu.evaluate((element) => Boolean(element.closest("table"))), false);
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press("Enter");
  await menu.waitFor();
  await page.getByRole("heading", { name: "Servicios y cotizaciones", level: 1 }).click();
  await menu.waitFor({ state: "detached" });
  // Navegar por teclado mientras el menú está abierto desmonta la fila sin su evento de cierre.
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await page.getByRole("button", { name: "Siguiente pág." }).evaluate((element) => element.click());
  await page.getByText("TST-011", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Ver descripción de Prueba 11" }).hover();
  await page.getByRole("tooltip").getByText("Descripción 11", { exact: true }).waitFor();
});

test("responsive: sin desborde de página, tabla con scroll propio y barra según Figma (claro y oscuro)", async (context) => {
  for (const theme of ["light", "dark"]) {
    // Los casos más anchos previstos: código generado de cuatro cifras, tarifa de cuatro cifras
    // enteras con céntimos y «Inactivo». Tarifas mayores se truncan con el valor en `title`.
    const backend = createBackend([...sampleCatalog(), service(1000, { code: "SERV-1000", name: "Servicio de prueba con código largo", rate: "9999.99", isActive: false })]);
    const page = await openTabulator(context, backend, { theme, viewport: { width: 375, height: 812 } });
    await page.getByRole("checkbox", { name: "Seleccionar todos los servicios visibles" }).click();
    for (const [width, height] of [[375, 812], [768, 1024], [1024, 768], [1440, 1000], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      const selectAll = page.getByRole("checkbox", { name: "Seleccionar todos los servicios visibles" });
      await selectAll.click();
      const footer = page.getByLabel("Selección y paginación de servicios");
      assert.equal(await footer.locator("[data-service-bulk-actions]").count(), 0, `${theme} ${width}px: sin selección no hay grupo de acciones`);
      assert.equal(await footer.locator(":scope > *").count(), 2, "Sin espacio reservado para acciones ocultas");
      await selectAll.click();
      await page.evaluate(() => document.fonts.ready);
      // Cruzar el breakpoint del riel cambia su expansión con una transición. Medir durante
      // ella daba falsos positivos: a 1440 px la barra cabía antes de terminar de expandirse.
      // Se esperan frames y animaciones finitas; una transición sustituida puede cancelarse.
      await page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.allSettled(document.getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished));
      });
      const layout = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const textOverflows = (cell) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          const style = getComputedStyle(cell);
          return range.getBoundingClientRect().width > cell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) + 0.01;
        };
        const scroller = document.querySelector("main > div > .overflow-y-auto") ?? document.scrollingElement;
        const table = document.querySelector("table").closest(".overflow-x-auto");
        const search = rect('input[aria-label="Buscar servicios por nombre o código"]');
        const add = rect("[data-service-add-action]");
        return {
          pageOverflow: Math.max(scroller.scrollWidth - scroller.clientWidth, document.documentElement.scrollWidth - window.innerWidth),
          tableScrollsInside: table.scrollWidth >= table.clientWidth && table.getBoundingClientRect().right <= window.innerWidth + 0.5,
          tableHorizontalOverflow: table.scrollWidth - table.clientWidth,
          tableAreaWidth: table.clientWidth,
          addSameRow: Math.abs(add.top + add.height / 2 - (search.top + search.height / 2)) < 4,
          addFullWidth: Math.abs(add.width - document.querySelector("[data-service-add-action]").parentElement.getBoundingClientRect().width) < 1,
          rowBackground: getComputedStyle(document.querySelector("tbody tr")).backgroundColor,
          // Contenido que invade la celda vecina: se mide el contenido de cada celda frente a su caja.
          // Un SVG comprimido a 0 px por el flex (icono de cabecera sin espacio) también cuenta.
          squashedIcons: [...document.querySelectorAll("table svg")].filter((icon) => icon.getBoundingClientRect().width === 0).length,
          overflowingCells: [...document.querySelectorAll("thead th, tbody th, tbody td")].flatMap((cell) => {
            const box = cell.getBoundingClientRect();
            return [...cell.querySelectorAll("*")]
              .filter((child) => {
                const inner = child.getBoundingClientRect();
                return inner.width > 0 && (inner.left < box.left - 0.5 || inner.right > box.right + 0.5);
              })
              .map(() => cell.textContent.trim());
          }),
          // Ancho exacto del texto (Range) frente a la caja de contenido: scrollWidth redondea y
          // oculta recortes de menos de un píxel, que la elipsis sí muestra.
          truncatedCodes: [...document.querySelectorAll("tbody th[scope=row]")].filter(textOverflows).map((cell) => cell.textContent),
          truncatedRates: [...document.querySelectorAll("tbody td:nth-child(6)")].filter(textOverflows).map((cell) => cell.textContent),
          footerGroups: [...document.querySelector("[data-service-catalog-footer]").children].map((element) => {
            const box = element.getBoundingClientRect();
            return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
          }),
        };
      });
      assert.deepEqual([...new Set(layout.overflowingCells)], [], `${theme} ${width}px: celdas desbordadas`);
      assert.deepEqual(layout.truncatedCodes, [], `${theme} ${width}px: códigos recortados`);
      assert.deepEqual(layout.truncatedRates, [], `${theme} ${width}px: tarifas recortadas`);
      assert.equal(layout.squashedIcons, 0, `${theme} ${width}px: iconos comprimidos`);
      assert.equal(layout.pageOverflow, 0, `${theme} ${width}px: ${JSON.stringify(layout)}`);
      assert.equal(layout.tableScrollsInside, true, `${theme} ${width}px`);
      // Si la tabla cabe (1102 px de área: 1104 de Figma menos el borde) no hay desplazamiento
      // residual (antes 2 px); si no cabe, desplaza dentro de su contenedor.
      if (layout.tableAreaWidth >= SERVICE_CATALOG_TABLE_MIN_WIDTH) assert.equal(layout.tableHorizontalOverflow, 0, `${theme} ${width}px: desplazamiento residual`);
      else assert.ok(layout.tableHorizontalOverflow > 0, `${theme} ${width}px: la tabla debe desplazar`);
      if (width >= 1920) assert.ok(layout.tableAreaWidth >= SERVICE_CATALOG_TABLE_MIN_WIDTH, `${theme} ${width}px: en escritorio amplio la tabla cabe`);
      if (width <= 768) assert.ok(layout.tableHorizontalOverflow > 0, `${theme} ${width}px: en móvil y tablet la tabla desplaza`);
      // Con el riel expandido, 1440 px dejan 1032 px: la barra requiere 1053 px y puede envolver.
      if (width >= 1920) assert.equal(layout.addSameRow, true, `${theme} ${width}px: «Añadir servicio» en la fila de la búsqueda`);
      if (width < 768) assert.equal(layout.addFullWidth, true, `${theme} ${width}px: «Añadir servicio» a todo el ancho`);
      assert.notEqual(layout.rowBackground, "rgba(0, 0, 0, 0)");
      assert.equal(layout.footerGroups.length, 3, "Contador, acciones masivas y paginación");
      for (const [index, group] of layout.footerGroups.entries()) {
        assert.ok(group.left >= 0 && group.right <= width, `${theme} ${width}px: grupo fuera del viewport`);
        for (const next of layout.footerGroups.slice(index + 1)) {
          assert.ok(group.right <= next.left || next.right <= group.left || group.bottom <= next.top || next.bottom <= group.top,
            `${theme} ${width}px: grupos del footer superpuestos`);
        }
      }
    }
    // Menú de acciones dentro del viewport en móvil.
    await page.setViewportSize({ width: 375, height: 812 });
    const trigger = page.getByRole("button", { name: "Más opciones para TST-001" });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const menuBox = await page.getByRole("menuitem", { name: "Desactivar" }).boundingBox();
    assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 375, JSON.stringify(menuBox));
    await page.keyboard.press("Escape");
  }
});
