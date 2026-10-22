import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";

import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Tabulador de servicios (Figma 5790:332031) contra un backend simulado con estado. Los servicios
// son datos de prueba con la forma del contrato: nunca se usan Supabase ni el catálogo comercial.
const UNITS = {
  m2: { id: 1, code: "square_meter", name: "Metro cuadrado", symbol: "m²", allowsDecimals: true, isActive: true },
  ml: { id: 6, code: "linear_meter", name: "Metro lineal", symbol: "m.l.", allowsDecimals: true, isActive: true },
  pto: { id: 30, code: "point", name: "Punto", symbol: "pto.", allowsDecimals: false, isActive: true },
};
const DENOMINATIONS = {
  construccion: { id: 10, denomination: "de construcción", isActive: true, unit: "m2" },
  intervenir: { id: 11, denomination: "a intervenir", isActive: true, unit: "m2" },
  electrico: { id: 12, denomination: "eléctrico", isActive: true, unit: "pto" },
};
const LONG_DESCRIPTION = "Diseña las áreas exteriores de prueba, con vegetación, superficies e iluminación, e integra jardines y terrazas con el resto del proyecto para comprobar textos extensos.";

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
 * Crea un servicio simulado con la forma del contrato: `unitLabel` compuesto como el backend
 * (abreviatura + denominación) y `referenceRate` como texto decimal.
 *
 * @param {number} id - Identificador.
 * @param {Object} fields - Código, nombre, unidad, denominación y demás campos.
 * @returns {Object} Servicio.
 */
function service(id, { code, name, unit = "m2", denomination = null, rate = "10.00", description = null, isActive = true, currentVersion = 1 }) {
  const measurementUnit = UNITS[unit];
  const unitDenomination = denomination ? { id: DENOMINATIONS[denomination].id, denomination: DENOMINATIONS[denomination].denomination, isActive: DENOMINATIONS[denomination].isActive } : null;
  return {
    id,
    code,
    name,
    description,
    kind: "individual",
    measurementUnit,
    unitDenomination,
    unitLabel: unitDenomination ? `${measurementUnit.symbol} ${unitDenomination.denomination}` : measurementUnit.symbol,
    referenceRate: rate,
    currency: "USD",
    isActive,
    sortOrder: id,
    currentVersion,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  };
}

/**
 * Catálogo de prueba: describe servicios con y sin descripción, con y sin denominación, activos
 * e inactivos y tarifas con céntimos y miles.
 *
 * @returns {Array<Object>} Servicios.
 */
function sampleCatalog() {
  return [
    service(1, { code: "TST-001", name: "Anteproyecto de prueba", denomination: "construccion", rate: "12.00", description: "Primera propuesta del espacio." }),
    service(2, { code: "TST-002", name: "Diseño interior de prueba", denomination: "intervenir", rate: "1250.50", description: "   " }),
    service(3, { code: "TST-003", name: "Paisajismo de prueba", denomination: "intervenir", rate: "18.00", description: LONG_DESCRIPTION }),
    service(4, { code: "TST-004", name: "Canalizaciones de prueba", unit: "ml", rate: "0.05", isActive: false }),
    service(5, { code: "TST-005", name: "Puntos eléctricos de prueba", unit: "pto", denomination: "electrico", rate: "45.00", description: "Cada punto incluye cableado." }),
  ];
}

/**
 * Backend simulado: búsqueda literal (nombre o código), filtros del contrato, paginación por
 * cursor, cambio de estado versionado (409 si la versión no coincide; 400 al reactivar con la
 * denominación inactiva) y fallos y retrasos inyectables.
 *
 * @param {Array<Object>} initial - Servicios iniciales.
 * @returns {Object} Estado, registro de peticiones y manejador de rutas.
 */
function createBackend(initial) {
  const state = { items: initial.map((item) => ({ ...item })), requests: [], failures: {}, delays: {} };
  const json = (route, status, body) => route.fulfill({ status, json: body });

  state.handle = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    const params = Object.fromEntries(url.searchParams);
    state.requests.push({ method, path, params, body });
    const failure = state.failures[`${method} ${path.replace(/\d+/g, ":id")}`];
    const delay = state.delays[params.search ?? (params.limit === "100" ? "summary" : "")];
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

    if (path === "/api/auth/me") return json(route, 200, { user: { id: 1, firstName: "Ana", lastName: "Admin", email: "ana@example.test", role: "admin", status: "active" } });
    if (path === "/api/projects") return json(route, 200, { projects: [], nextCursor: null });
    // El resumen de los indicadores (limit=100) no se ve afectado por los fallos de la tabla.
    if (failure && !(method === "GET" && params.limit === "100")) return json(route, failure.status, failure.body);

    if (path === "/api/admin/services" && method === "GET") {
      const search = (params.search || "").toLowerCase();
      const matches = state.items.filter((item) => (!search || item.name.toLowerCase().includes(search) || item.code.toLowerCase().includes(search))
        && (!params.status || item.isActive === (params.status === "active"))
        && (!params.measurementUnitId || item.measurementUnit.id === Number(params.measurementUnitId))
        && (!params.unitDenominationId || item.unitDenomination?.id === Number(params.unitDenominationId)));
      const limit = Number(params.limit || 25);
      const start = Number(params.cursor || 0);
      return json(route, 200, { services: matches.slice(start, start + limit), nextCursor: start + limit < matches.length ? String(start + limit) : null });
    }
    const match = /^\/api\/admin\/services\/(\d+)\/status$/.exec(path);
    if (match && method === "PATCH") {
      const item = state.items.find((candidate) => candidate.id === Number(match[1]));
      if (!item) return json(route, 404, { code: "SERVICE_NOT_FOUND", message: "El servicio no existe." });
      if (body.expectedVersion !== item.currentVersion) return json(route, 409, { code: "SERVICE_VERSION_CONFLICT", message: "Versión desactualizada." });
      if (body.isActive && item.unitDenomination && !item.unitDenomination.isActive) {
        return json(route, 400, { code: "VALIDATION_ERROR", message: "Datos inválidos.", fields: { unitDenominationId: "La denominación está inactiva." } });
      }
      const changed = item.isActive !== body.isActive;
      if (changed) Object.assign(item, { isActive: body.isActive, currentVersion: item.currentVersion + 1 });
      return json(route, 200, { changed, changedFields: changed ? ["isActive"] : [], message: "Servicio actualizado.", service: { ...item } });
    }
    state.requests.push({ unexpected: true, method, path });
    return json(route, 404, { code: "TEST_ROUTE_MISSING", message: "Fixture no definida" });
  };
  return state;
}

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
  assert.deepEqual(await page.locator("thead th").allInnerTexts(), ["", "N°", "Servicio", "Unidad", "Tarifa base", "Estado", "Acciones"]);
  assert.deepEqual(await rowCodes(page), ["TST-001", "TST-002", "TST-003", "TST-004", "TST-005"]);
  // Unidad: etiqueta oficial de la API (con o sin denominación).
  assert.deepEqual(await page.locator("tbody tr td:nth-child(4)").allInnerTexts(), ["m² de construcción", "m² a intervenir", "m² a intervenir", "m.l.", "pto. eléctrico"]);
  // Tarifa: texto decimal formateado sin redondear (céntimos solo si no son cero, miles agrupados).
  assert.deepEqual(await page.locator("tbody tr td:nth-child(5)").allInnerTexts(), ["$12", "$1,250.50", "$18", "$0.05", "$45"]);
  assert.deepEqual(await page.locator("tbody tr td:nth-child(6)").allInnerTexts(), ["Activo", "Activo", "Activo", "Inactivo", "Activo"]);
  // Indicadores derivados de la colección completa.
  await page.waitForFunction(() => document.querySelector('[aria-label="Indicadores de servicios y cotizaciones"]')?.textContent.includes("Servicios totales5"));
  assert.equal(await metricValue(page, "Servicios activos").textContent(), "4");
  assert.equal(await metricValue(page, "Servicios Inactivos").textContent(), "1");
  // Primera lectura: 10 filas por página y sin filtros.
  assert.deepEqual(tableGets(backend)[0].params, { limit: "10" });
  // Sin «Ver» hasta que exista su diseño; alta y edición visibles pero deshabilitadas con motivo.
  assert.equal(await page.getByRole("button", { name: /^Ver (detalle|servicio)/ }).count(), 0);
  const add = page.getByRole("button", { name: "Añadir servicio" });
  assert.equal(await add.isDisabled(), true);
  assert.equal(await add.getAttribute("aria-describedby"), "service-catalog-add-pending");
  const edit = page.getByRole("button", { name: /^Editar TST-001 Anteproyecto de prueba \(edición disponible/ });
  assert.equal(await edit.isDisabled(), true);
  assert.equal(backend.requests.some((request) => request.method === "DELETE"), false);
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
  // Sin acciones masivas: el backend no tiene un endpoint para ellas.
  assert.equal(await footer.getByRole("button", { name: /Desactivar|Activar/ }).count(), 0);

  await page.getByRole("checkbox", { name: "Seleccionar TST-002 Servicio de prueba 2" }).click();
  await page.getByRole("button", { name: "Siguiente pág." }).click();
  await page.getByText("TST-013", { exact: true }).waitFor();
  assert.deepEqual(await rowCodes(page), ["TST-011", "TST-012", "TST-013"]);
  assert.equal(tableGets(backend).at(-1).params.cursor, "10");
  await footer.getByText("0 de 3 seleccionados").waitFor();
  assert.equal(await page.getByRole("button", { name: "Siguiente pág." }).isDisabled(), true);
  await page.getByRole("button", { name: "Anterior" }).click();
  await page.getByText("TST-001", { exact: true }).waitFor();
  await footer.getByText("0 de 10 seleccionados").waitFor();
  assert.equal(await page.getByRole("button", { name: "Anterior" }).isDisabled(), true);

  // Filtrar también reinicia la selección y vuelve a la primera página.
  await page.getByRole("checkbox", { name: "Seleccionar TST-003 Servicio de prueba 3" }).click();
  await chooseFilter(page, "Filtrar servicios por estado", "Activos");
  await footer.getByText("0 de 10 seleccionados").waitFor();
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
  const dialog = page.getByRole("dialog", { name: "¿Deseas desactivar el servicio?" });
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(backend.requests.filter((request) => request.method === "PATCH").length, 0);

  await page.getByRole("button", { name: "Más opciones para TST-001" }).click();
  await page.getByRole("menuitem", { name: "Desactivar" }).click();
  await dialog.getByRole("button", { name: "Desactivar" }).click();
  await page.getByRole("alert").getByText("TST-001 · Anteproyecto de prueba").waitFor();
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
  await page.getByRole("dialog", { name: "¿Deseas activar el servicio?" }).getByRole("button", { name: "Activar" }).click();
  await rowFor(page, "TST-001").getByText("Activo", { exact: true }).waitFor();
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
  await page.getByRole("dialog", { name: "¿Deseas desactivar el servicio?" }).getByRole("button", { name: "Desactivar" }).click();
  await page.getByRole("alert").getByText(/Otro administrador modificó este servicio/).waitFor();
  await waitFor(() => tableGets(backend).length > readsBefore, "La tabla se vuelve a leer tras el 409");
  await rowFor(page, "TST-001").getByText("Activo", { exact: true }).waitFor();

  // Reactivar con la unidad de medida inactiva: 400 sin cambios en la fila.
  await page.getByRole("button", { name: "Más opciones para TST-004" }).click();
  await page.getByRole("menuitem", { name: "Activar" }).click();
  await page.getByRole("dialog", { name: "¿Deseas activar el servicio?" }).getByRole("button", { name: "Activar" }).click();
  await page.getByRole("alert").getByText(/No se puede activar: su unidad de medida está inactiva/).waitFor();
  assert.equal(await rowFor(page, "TST-004").getByText("Inactivo", { exact: true }).count(), 1);

  for (const [status, code, message] of [
    [403, "FORBIDDEN", "No tienes permisos para gestionar el tabulador de servicios."],
    [429, "RATE_LIMITED", "Realizaste demasiados cambios en poco tiempo. Espera unos minutos e inténtalo de nuevo."],
  ]) {
    backend.failures["PATCH /api/admin/services/:id/status"] = { status, body: { code, message: "Texto técnico del backend" } };
    await page.getByRole("button", { name: "Más opciones para TST-002" }).click();
    await page.getByRole("menuitem", { name: "Desactivar" }).click();
    await page.getByRole("dialog", { name: "¿Deseas desactivar el servicio?" }).getByRole("button", { name: "Desactivar" }).click();
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

test("responsive: sin desborde de página, tabla con scroll propio y barra según Figma (claro y oscuro)", async (context) => {
  for (const theme of ["light", "dark"]) {
    const backend = createBackend(sampleCatalog());
    const page = await openTabulator(context, backend, { theme, viewport: { width: 375, height: 812 } });
    for (const [width, height] of [[375, 812], [768, 1024], [1024, 768], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const scroller = document.querySelector("main > div > .overflow-y-auto") ?? document.scrollingElement;
        const table = document.querySelector("table").closest(".overflow-x-auto");
        const search = rect('input[aria-label="Buscar servicios por nombre o código"]');
        const add = rect("[data-service-add-action]");
        return {
          pageOverflow: Math.max(scroller.scrollWidth - scroller.clientWidth, document.documentElement.scrollWidth - window.innerWidth),
          tableScrollsInside: table.scrollWidth >= table.clientWidth && table.getBoundingClientRect().right <= window.innerWidth + 0.5,
          addSameRow: Math.abs(add.top + add.height / 2 - (search.top + search.height / 2)) < 4,
          addFullWidth: Math.abs(add.width - document.querySelector("[data-service-add-action]").parentElement.getBoundingClientRect().width) < 1,
          rowBackground: getComputedStyle(document.querySelector("tbody tr")).backgroundColor,
        };
      });
      assert.equal(layout.pageOverflow, 0, `${theme} ${width}px: ${JSON.stringify(layout)}`);
      assert.equal(layout.tableScrollsInside, true, `${theme} ${width}px`);
      if (width >= 1440) assert.equal(layout.addSameRow, true, `${theme} ${width}px: «Añadir servicio» en la fila de la búsqueda`);
      if (width < 768) assert.equal(layout.addFullWidth, true, `${theme} ${width}px: «Añadir servicio» a todo el ancho`);
      assert.notEqual(layout.rowBackground, "rgba(0, 0, 0, 0)");
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
