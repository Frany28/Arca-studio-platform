import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { buildQuoteDocument } from "../../../Backend/src/domain/quoteDocument.js";
import { QUOTE_REFERENCE_VAT, REFERENCE_VAT_NOT_APPLIED, resolveQuoteReferenceVat } from "../../../Backend/src/domain/quoteReferenceVat.js";
import { calculateQuoteTotals } from "../../../Backend/src/domain/quoteTotals.js";
import { loadQuotePdfAssets } from "../../../Backend/src/services/quotePdfAssets.js";
import { renderQuotePdf } from "../../../Backend/src/services/quotePdfRenderer.js";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Pestaña Cotizaciones y formulario de cotización (Figma 5771:488497 y 5771:452483) sobre un
// backend simulado con la forma del contrato: datos en memoria, importes calculados con el motor
// real del backend y PDF generado por su maquetación real. Nunca usa Supabase ni datos de Figma.

let browser;
let server;
let origin;

const SERVICES = [
  { code: "SERV-001", currency: "USD", currentVersion: 1, description: "Planos y memoria descriptiva.", id: 1, isActive: true, kind: "individual", kindLocked: false, measurementUnit: { allowsDecimals: true, code: "square_meter", id: 1, isActive: true, name: "Metro cuadrado", symbol: "m²" }, name: "Anteproyecto arquitectónico", referenceRate: "14.00", sortOrder: 1, unitDenomination: { denomination: "de construcción", id: 10, isActive: true }, unitLabel: "m² de construcción" },
  { code: "SERV-002", currency: "USD", currentVersion: 1, description: null, id: 2, isActive: true, kind: "individual", kindLocked: false, measurementUnit: { allowsDecimals: false, code: "point", id: 30, isActive: true, name: "Punto", symbol: "pt." }, name: "Puntos eléctricos y fuerza", referenceRate: "47.00", sortOrder: 2, unitDenomination: { denomination: "eléctrico", id: 12, isActive: true }, unitLabel: "pt. eléctrico" },
  { code: "SERV-003", currency: "USD", currentVersion: 1, description: null, id: 3, isActive: false, kind: "individual", kindLocked: false, measurementUnit: { allowsDecimals: true, code: "square_meter", id: 1, isActive: true, name: "Metro cuadrado", symbol: "m²" }, name: "Servicio retirado", referenceRate: "8.00", sortOrder: 3, unitDenomination: null, unitLabel: "m²" },
];
const CLIENTS = [
  { companyName: null, contactUser: null, email: "leonel@example.test", id: 3, name: "Leonel Pérez" },
  { companyName: "Arca", contactUser: null, email: "jane@example.test", id: 4, name: "Jane Smith" },
];
const PROJECTS = { 3: [{ id: 9, name: "Apto. 910", status: "pending" }], 4: [{ id: 10, name: "Casa Jane", status: "pending" }] };

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
 * Construye una cotización con la forma de `GET /admin/quotes/:id`, con los importes calculados
 * por el motor real del backend.
 *
 * @param {number} id - Identificador.
 * @param {Object} payload - Cuerpo de alta o edición.
 * @param {number} version - Versión vigente.
 * @param {string} createdAt - Fecha de creación.
 * @param {Array<Object>} [services] - Servicios del tabulador simulado.
 * @param {{enabled: boolean, rate: string|null}} [referenceVat] - IVA referencial aplicado (como el backend).
 * @returns {Object} Cotización.
 */
function buildQuote(id, payload, version, createdAt, services = SERVICES, referenceVat = QUOTE_REFERENCE_VAT) {
  const totals = calculateQuoteTotals({ items: payload.items, referenceVat });
  const client = CLIENTS.find((candidate) => candidate.id === payload.clientId);
  const project = PROJECTS[payload.clientId].find((candidate) => candidate.id === payload.projectId);
  return {
    client: { id: client.id, name: client.name },
    code: `COT-${String(id).padStart(3, "0")}`,
    createdAt,
    createdBy: { id: 1, name: "Ana Admin" },
    currency: "USD",
    currentVersion: version,
    id,
    items: payload.items.map((item, index) => {
      const service = services.find((candidate) => candidate.id === item.serviceId);
      // Como la API: la única unidad del servicio, con la tarifa del tabulador como referencia.
      return {
        lineNumber: index + 1,
        quantity: totals.items[index].quantity,
        referenceRate: service.referenceRate,
        service: { code: service.code, description: service.description, id: service.id, isActive: service.isActive, kind: service.kind, name: service.name, versionId: service.id * 10 },
        subtotal: totals.items[index].subtotal,
        unit: { allowsDecimals: service.measurementUnit.allowsDecimals, label: service.unitLabel, optionId: service.id * 100 + 1, position: 1 },
        unitRate: totals.items[index].unitRate,
      };
    }),
    notes: payload.notes ?? null,
    project: { id: project.id, name: project.name },
    estimatedTotalWithVat: totals.estimatedTotalWithVat,
    referenceVat: { ...totals.referenceVat, rate: referenceVat.enabled ? totals.referenceVat.rate : null },
    servicesTotal: totals.servicesTotal,
    updatedAt: createdAt,
    version: { createdAt, createdBy: { hasProfilePhoto: false, id: 1, name: "Ana Admin" }, id: version },
  };
}

/**
 * Backend simulado de cotizaciones con estado en memoria y registro de peticiones.
 *
 * @param {Object} [options] - Fallos inyectados por operación (`PATCH /api/admin/quotes/:id`) y
 * servicios del tabulador (por defecto, SERVICES). Las altas y ediciones aplican el IVA referencial
 * con las reglas reales: 16 % al crear y, al editar, el de la versión guardada.
 * @returns {Object} Estado y manejador de rutas.
 */
function createBackend({ failures = {}, services = SERVICES } = {}) {
  const state = {
    quotes: [
      buildQuote(1, { clientId: 3, items: [{ quantity: "200", serviceId: 1, unitRate: "14" }, { quantity: "35", serviceId: 2, unitRate: "47" }], notes: "Incluye visitas.", projectId: 9 }, 1, "2026-03-23T15:00:00.000Z"),
      buildQuote(2, { clientId: 4, items: [{ quantity: "10", serviceId: 1, unitRate: "14" }], projectId: 10 }, 1, "2026-04-12T15:00:00.000Z"),
    ],
    requests: [],
  };
  let pdfAssets;

  const json = (route, status, body) => route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });

  state.handle = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname: path } = url;
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    state.requests.push({ body, method, path, search: Object.fromEntries(url.searchParams) });
    const operation = `${method} ${path.replace(/\/\d+(?=\/|$)/g, "/:id")}`;
    if (failures[operation]) return json(route, failures[operation].status, failures[operation].body);

    if (path === "/api/auth/me") return json(route, 200, { user: { email: "ana@example.test", firstName: "Ana", id: 1, lastName: "Admin", role: "admin", status: "active" } });
    if (path === "/api/projects") return json(route, 200, { nextCursor: null, projects: [] });
    if (path === "/api/admin/services") return json(route, 200, { nextCursor: null, services });
    if (path === "/api/admin/quotes/summary") return json(route, 200, { summary: { total: state.quotes.length } });
    if (path === "/api/admin/quotes/clients") {
      const search = (url.searchParams.get("search") || "").toLowerCase();
      return json(route, 200, { clients: CLIENTS.filter((client) => client.name.toLowerCase().includes(search)), nextCursor: null });
    }
    const projectsMatch = /^\/api\/admin\/quotes\/clients\/(\d+)\/projects$/.exec(path);
    if (projectsMatch) return json(route, 200, { nextCursor: null, projects: PROJECTS[projectsMatch[1]] || [] });
    if (path === "/api/admin/quotes" && method === "GET") {
      let quotes = [...state.quotes];
      const search = (url.searchParams.get("search") || "").toLowerCase();
      if (search) quotes = quotes.filter((quote) => `${quote.code} ${quote.client.name} ${quote.project.name}`.toLowerCase().includes(search));
      if (url.searchParams.get("sort") === "total") quotes.sort((left, right) => Number(left.servicesTotal) - Number(right.servicesTotal));
      if (url.searchParams.get("direction") === "desc") quotes.reverse();
      return json(route, 200, { nextCursor: null, quotes });
    }
    if (path === "/api/admin/quotes" && method === "POST") {
      const vat = resolveQuoteReferenceVat({ stored: null });
      const quote = buildQuote(state.quotes.length + 1, body, 1, new Date().toISOString(), services, vat);
      state.quotes.push(quote);
      return json(route, 201, { message: "Cotización creada correctamente.", quote });
    }
    const pdfMatch = /^\/api\/admin\/quotes\/(\d+)\/pdf$/.exec(path);
    if (pdfMatch) {
      const quote = state.quotes.find((candidate) => candidate.id === Number(pdfMatch[1]));
      pdfAssets ??= await loadQuotePdfAssets();
      const chunks = [];
      for await (const chunk of renderQuotePdf(buildQuoteDocument(quote, { timeZone: url.searchParams.get("timeZone") }), pdfAssets)) chunks.push(chunk);
      return route.fulfill({ body: Buffer.concat(chunks), contentType: "application/pdf", headers: { "Content-Disposition": `attachment; filename="${quote.code}.pdf"` }, status: 200 });
    }
    const quoteMatch = /^\/api\/admin\/quotes\/(\d+)$/.exec(path);
    if (quoteMatch) {
      const index = state.quotes.findIndex((candidate) => candidate.id === Number(quoteMatch[1]));
      if (index < 0) return json(route, 404, { code: "QUOTE_NOT_FOUND", message: "La cotización solicitada no existe." });
      if (method === "GET") return json(route, 200, { quote: state.quotes[index] });
      const current = state.quotes[index];
      const { expectedVersion, ...content } = body;
      if (expectedVersion !== current.currentVersion) return json(route, 409, { code: "QUOTE_VERSION_CONFLICT", message: "Otro administrador modificó esta cotización. Recarga los datos antes de guardar." });
      const vat = resolveQuoteReferenceVat({ stored: current.referenceVat });
      state.quotes[index] = buildQuote(current.id, content, current.currentVersion + 1, current.createdAt, services, vat);
      return json(route, 200, { changed: true, message: "Cotización actualizada correctamente.", quote: state.quotes[index] });
    }
    state.requests.push({ method, path, unexpected: true });
    return json(route, 404, { code: "TEST_ROUTE_MISSING", message: "Ruta no simulada" });
  };
  return state;
}

/**
 * Abre el módulo con sesión de administrador; vigila errores de página y peticiones no previstas.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {Object} backend - Backend de createBackend.
 * @param {Object} [options] - Ruta, viewport y tema.
 * @returns {Promise<import("playwright").Page>} Página cargada.
 */
async function openQuotes(context, backend, { path = "/servicios-cotizaciones/cotizaciones", theme = "light", viewport = { height: 1000, width: 1440 } } = {}) {
  const browserContext = await browser.newContext({ timezoneId: "America/Caracas", viewport });
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
  await page.goto(`${origin}${path}`);
  await page.getByRole("heading", { level: 1 }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  return page;
}

const listRequests = (backend) => backend.requests.filter((request) => request.method === "GET" && request.path === "/api/admin/quotes");

test("listado: filas reales, indicador, orden por Total, búsqueda e intervalo de fechas en la API", async (context) => {
  const backend = createBackend();
  const page = await openQuotes(context, backend);
  await page.getByRole("rowheader", { name: "COT-001" }).waitFor();
  const cells = await page.locator("tbody tr").first().locator("td, th").allInnerTexts();
  assert.deepEqual(cells.slice(1, 6), ["COT-001", "Leonel Pérez", "Apto. 910", "23/03/2026", "$4,445.00"]);
  const metrics = page.getByLabel("Indicadores de servicios y cotizaciones");
  assert.equal((await metrics.locator("strong").allTextContents())[3], "2");

  await page.getByRole("button", { name: "Ordenar por Total" }).click();
  await page.waitForFunction(() => document.querySelector("tbody tr th")?.textContent === "COT-002");
  assert.equal(await page.locator("th[aria-sort=ascending]").innerText(), "Total");
  assert.deepEqual(listRequests(backend).at(-1).search, { direction: "asc", limit: "10", sort: "total" });

  await page.getByRole("textbox", { name: "Buscar cotizaciones por número, cliente o proyecto" }).fill("jane");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  assert.equal(listRequests(backend).at(-1).search.search, "jane");

  await page.getByRole("button", { name: "Quitar filtros" }).click();
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 2);

  await page.getByRole("button", { name: /^Filtrar cotizaciones por fecha/ }).click();
  const picker = page.getByRole("dialog", { name: "Seleccionar intervalo de fechas" });
  await picker.waitFor();
  const firstMonth = picker.getByRole("grid").first();
  const monthTitle = await firstMonth.getAttribute("aria-label");
  await firstMonth.getByRole("button").nth(9).click();
  await firstMonth.getByRole("button").nth(14).click();
  await picker.getByRole("button", { name: "Seleccionar" }).click();
  await picker.waitFor({ state: "detached" });
  const { createdBefore, createdFrom } = listRequests(backend).at(-1).search;
  assert.ok(createdFrom && createdBefore, `Intervalo enviado para ${monthTitle}`);
  // Seis días locales de Caracas (UTC−4): del día 10 a las 00:00 al día 16 a las 00:00.
  assert.equal(Date.parse(createdBefore) - Date.parse(createdFrom), 6 * 24 * 3600 * 1000);
  assert.match(createdFrom, /T04:00:00\.000Z$/);
});

test("visor: PDF real del backend en el visor PDF.js, con archivo, peso y acciones Cerrar y Editar", async (context) => {
  const backend = createBackend();
  const page = await openQuotes(context, backend);
  const trigger = page.getByRole("button", { name: "Ver COT-001" });
  await trigger.click();
  const viewer = page.locator("[data-quote-pdf-viewer]");
  await viewer.getByText("COT-001.pdf", { exact: true }).waitFor();
  await viewer.locator("canvas[aria-label='Cotización COT-001, página 1']").waitFor();
  assert.match(await viewer.innerText(), /\d+KB • 23 Mar 2026/);
  const pdfRequest = backend.requests.find((request) => request.path === "/api/admin/quotes/1/pdf");
  assert.equal(pdfRequest.search.timeZone, "America/Caracas");

  await viewer.getByRole("button", { name: "Cerrar" }).click();
  await viewer.waitFor({ state: "detached" });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true, "El foco vuelve a la fila");

  await trigger.click();
  await viewer.getByRole("button", { name: "Editar" }).click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones/1/editar`);
});

const PROJECT_UNIT = { allowsDecimals: false, code: "project", id: 38, isActive: true, name: "Proyecto", symbol: "proy." };
const SPACE_UNIT = { allowsDecimals: false, code: "space", id: 39, isActive: true, name: "Espacio", symbol: "esp." };
const MINUTE_UNIT = { allowsDecimals: false, code: "minute", id: 31, isActive: true, name: "Minuto", symbol: "min" };

/**
 * Servicio de una sola unidad sin denominación, con la forma de la API (tarifas ficticias).
 *
 * @param {number} id - Identificador (también el código SERV-00N).
 * @param {string} name - Nombre con su forma de cobro.
 * @param {Object} measurementUnit - Unidad base.
 * @param {string} referenceRate - Tarifa base del tabulador.
 * @returns {Object} Servicio.
 */
function singleUnitService(id, name, measurementUnit, referenceRate) {
  return {
    ...SERVICES[0], code: `SERV-${String(id).padStart(3, "0")}`, description: null, id, measurementUnit, name, presentationLabel: null,
    referenceRate, unitDenomination: null, unitLabel: measurementUnit.symbol,
  };
}

// Tabulador 3.2 con una unidad por servicio: cada forma de cobro de Modelado y del Recorrido VR es un servicio.
const VARIANT_SERVICES = [
  singleUnitService(4, "Modelado 3D & Renders — Por proyecto", PROJECT_UNIT, "320.00"),
  singleUnitService(20, "Modelado 3D & Renders — Por espacio", SPACE_UNIT, "320.00"),
  singleUnitService(14, "Recorrido Virtual / VR — Por minuto", MINUTE_UNIT, "275.00"),
  singleUnitService(21, "Recorrido Virtual / VR — Por proyecto", PROJECT_UNIT, "275.00"),
];

test("seleccionar servicios: cinco filas visibles con ScrollBar vertical, sin paginación; buscar vuelve al inicio", async (context) => {
  // Doce servicios activos ficticios (más de cinco filas).
  const many = Array.from({ length: 12 }, (_, index) => ({
    ...SERVICES[0], code: `SERV-${String(index + 1).padStart(3, "0")}`, description: null, id: index + 1, name: `Servicio de lista ${String(index + 1).padStart(2, "0")}`, sortOrder: index + 1,
  }));
  const backend = createBackend({ services: many });
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/nueva" });
  const picker = page.getByRole("region", { name: "Seleccionar servicios" });
  const viewport = picker.locator("[data-service-picker-viewport]");
  const scrollBar = picker.getByRole("scrollbar", { name: "Desplazar servicios disponibles verticalmente" });
  const search = picker.getByRole("textbox", { name: "Buscar servicios por nombre o código" });
  // Filas cuyo centro queda dentro del viewport, bajo la cabecera fija.
  const visibleNames = () => viewport.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const header = node.querySelector("thead").getBoundingClientRect();
    return [...node.querySelectorAll("tbody tr")].filter((row) => {
      const rect = row.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      return center > header.bottom && center < box.bottom;
    }).map((row) => row.querySelector("td:nth-child(2) span").textContent);
  });
  await picker.getByText("Servicio de lista 01", { exact: true }).waitFor();

  // Todas las filas están en la tabla, pero solo cinco caben: cabecera de 49 px y filas de 50 px.
  assert.equal(await picker.locator("tbody tr").count(), 12);
  assert.equal(await viewport.evaluate((node) => node.clientHeight), 49 + 5 * 50);
  assert.deepEqual(await visibleNames(), ["01", "02", "03", "04", "05"].map((n) => `Servicio de lista ${n}`));
  assert.equal(await picker.getByRole("navigation", { name: "Paginación de servicios disponibles" }).count(), 0);
  assert.equal(await picker.getByRole("button", { name: "Siguiente pág." }).count(), 0);
  await scrollBar.waitFor();
  assert.equal(await scrollBar.getAttribute("aria-valuenow"), "0");
  await picker.getByRole("checkbox", { name: "Seleccionar Servicio de lista 02" }).click();

  // Una fila desplazada bajo la cabecera no se pinta encima: con 50 px, la casilla de la primera
  // fila queda justo bajo «Seleccionar todos», y el punto central sigue siendo de la cabecera.
  const coveredByRow = await viewport.evaluate((node) => {
    node.scrollTop = 50;
    const headerBox = node.querySelector("thead [role='checkbox']").getBoundingClientRect();
    const hit = document.elementFromPoint(headerBox.left + headerBox.width / 2, headerBox.top + headerBox.height / 2);
    node.scrollTop = 0;
    return !node.querySelector("thead").contains(hit);
  });
  assert.equal(coveredByRow, false, "La casilla de una fila no tapa la de la cabecera fija");

  // Arrastrar el ScrollBar hasta el final muestra las últimas filas con la cabecera fija.
  const track = await scrollBar.boundingBox();
  await page.mouse.move(track.x + track.width / 2, track.y + 4);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width / 2, track.y + track.height + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector("[aria-label='Desplazar servicios disponibles verticalmente']")?.getAttribute("aria-valuenow") === "100");
  assert.deepEqual(await visibleNames(), ["08", "09", "10", "11", "12"].map((n) => `Servicio de lista ${n}`));
  assert.equal(await viewport.evaluate((node) => Math.round(node.querySelector("thead").getBoundingClientRect().top - node.getBoundingClientRect().top)), 0, "La cabecera queda fija");
  await picker.getByRole("checkbox", { name: "Seleccionar Servicio de lista 12" }).click();

  // La rueda también desplaza: sube de nuevo al principio.
  await viewport.hover();
  await page.mouse.wheel(0, -2000);
  await page.waitForFunction(() => document.querySelector("[aria-label='Desplazar servicios disponibles verticalmente']")?.getAttribute("aria-valuenow") === "0");

  // Con cinco resultados o menos no hay ScrollBar; «Seleccionar todos» marca los resultados de la búsqueda.
  await search.fill("lista 1");
  await picker.getByText("Servicio de lista 10", { exact: true }).waitFor();
  assert.deepEqual(await visibleNames(), ["10", "11", "12"].map((n) => `Servicio de lista ${n}`));
  await scrollBar.waitFor({ state: "detached" });
  await picker.getByRole("checkbox", { name: "Seleccionar todos los servicios visibles" }).click();
  await picker.getByText("4 de 12 seleccionados", { exact: true }).waitFor();

  // Volver a la lista completa la muestra desde el principio.
  await search.fill("");
  await scrollBar.waitFor();
  assert.equal(await viewport.evaluate((node) => node.scrollTop), 0);
  await picker.getByRole("button", { name: "Agregar seleccionados" }).click();
  for (const n of ["02", "10", "11", "12"]) {
    await page.getByRole("textbox", { name: `Cantidad de Servicio de lista ${n}` }).waitFor();
  }
});

test("una unidad por servicio: cada forma de cobro es un concepto con su unidad fija y tarifa editable", async (context) => {
  const backend = createBackend({ services: [...SERVICES, ...VARIANT_SERVICES] });
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/nueva" });
  await page.locator("#quote-client").fill("Leo");
  await page.getByRole("button", { name: /Leonel Pérez/ }).first().click();
  await page.locator("#quote-project").click();
  await page.getByRole("button", { name: /Apto\. 910/ }).first().click();

  // El selector muestra una sola unidad por servicio, sin estados de tarifa pendiente.
  const picker = page.getByRole("region", { name: "Seleccionar servicios" });
  for (const service of VARIANT_SERVICES) {
    const row = picker.locator("tbody tr", { hasText: service.name });
    assert.deepEqual(await row.locator("td").nth(2).locator(":scope > div > *").allInnerTexts(), [service.unitLabel], service.name);
    await picker.getByRole("checkbox", { name: `Seleccionar ${service.name}` }).click();
  }
  assert.equal(await picker.getByText(/pendiente de validación comercial/).count(), 0);
  await picker.getByRole("button", { name: "Agregar seleccionados" }).click();

  // En la tabla de incluidos la unidad es fija (sin desplegable) y la tarifa base se propone editable.
  for (const service of VARIANT_SERVICES) {
    await page.getByRole("textbox", { name: `Cantidad de ${service.name}` }).fill(service.id === 14 ? "3" : "1");
    assert.equal(await page.getByRole("textbox", { name: `Tarifa base de ${service.name} en USD` }).inputValue(), String(Number(service.referenceRate)));
    assert.equal(await page.getByRole("button", { name: new RegExp(`^Unidad de ${service.name}`) }).count(), 0, "Sin selector de unidad");
  }
  // La tarifa aplicada se modifica en esta cotización sin alterar la del tabulador.
  await page.getByRole("textbox", { name: "Tarifa base de Recorrido Virtual / VR — Por proyecto en USD" }).fill("250");

  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Has creado la cotización exitosamente").waitFor();
  const [post] = backend.requests.filter((request) => request.method === "POST" && request.path === "/api/admin/quotes");
  assert.deepEqual(post.body.items, [
    { quantity: "1", serviceId: 4, unitRate: "320" },
    { quantity: "1", serviceId: 20, unitRate: "320" },
    { quantity: "3", serviceId: 14, unitRate: "275" },
    { quantity: "1", serviceId: 21, unitRate: "250" },
  ]);
});

test("alta: validación local, cliente y proyecto reales, servicios del tabulador, total y POST exacto", async (context) => {
  const backend = createBackend();
  const page = await openQuotes(context, backend);
  await page.getByRole("button", { name: "Nueva cotización" }).click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones/nueva`);
  await page.getByRole("navigation", { name: "Ruta de navegación" }).getByText("Nueva cotización").waitFor();

  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Selecciona el cliente de la cotización.").waitFor();
  await page.getByText("Añade al menos un servicio a la cotización.").waitFor();
  assert.equal(backend.requests.some((request) => request.method === "POST"), false, "Un borrador inválido no se envía");

  await page.locator("#quote-client").fill("Leo");
  await page.getByRole("button", { name: /Leonel Pérez/ }).first().click();
  await page.locator("#quote-project").click();
  await page.getByRole("button", { name: /Apto\. 910/ }).first().click();

  // El servicio inactivo no se ofrece en cotizaciones nuevas.
  const picker = page.getByRole("region", { name: "Seleccionar servicios" });
  assert.equal(await picker.getByText("Servicio retirado").count(), 0);
  await picker.getByRole("checkbox", { name: "Seleccionar Anteproyecto arquitectónico" }).click();
  await picker.getByRole("checkbox", { name: "Seleccionar Puntos eléctricos y fuerza" }).click();
  await picker.getByText("2 de 2 seleccionados").waitFor();
  await picker.getByRole("button", { name: "Agregar seleccionados" }).click();
  await picker.getByRole("checkbox", { name: "Anteproyecto arquitectónico ya está incluido" }).waitFor();

  await page.getByRole("textbox", { name: "Cantidad de Anteproyecto arquitectónico" }).fill("200");
  await page.getByRole("textbox", { name: "Cantidad de Puntos eléctricos y fuerza" }).fill("2.5");
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("La unidad de este servicio solo admite cantidades enteras.").waitFor();
  await page.getByRole("textbox", { name: "Cantidad de Puntos eléctricos y fuerza" }).fill("35");
  await page.getByText("$4,445.00", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Observaciones (opcional)" }).fill("  Incluye dos visitas.  ");

  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Has creado la cotización exitosamente").waitFor();
  const posts = backend.requests.filter((request) => request.method === "POST" && request.path === "/api/admin/quotes");
  assert.equal(posts.length, 1, "Una sola alta");
  assert.deepEqual(posts[0].body, {
    clientId: 3,
    // Con una sola unidad cotizable, el concepto envía su posición (1, la principal).
    items: [{ quantity: "200", serviceId: 1, unitRate: "14" }, { quantity: "35", serviceId: 2, unitRate: "47" }],
    notes: "Incluye dos visitas.",
    projectId: 9,
  });

  await page.getByRole("button", { name: "Aceptar" }).click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones`);
  await page.getByText("Cotización creada", { exact: true }).waitFor();
  await page.getByRole("rowheader", { name: "COT-003" }).waitFor();
});

test("cancelar: con cambios pide confirmación y «Volver» conserva el borrador", async (context) => {
  const backend = createBackend();
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/nueva" });
  await page.getByRole("region", { name: "Seleccionar servicios" }).getByRole("checkbox", { name: "Seleccionar Anteproyecto arquitectónico" }).click();
  await page.getByRole("button", { name: "Agregar seleccionados" }).click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).last().click();
  const dialog = page.locator("[data-quote-discard-dialog]");
  await dialog.getByText("¿Deseas cancelar la cotización?").waitFor();
  await dialog.getByRole("button", { name: "Volver" }).click();
  await page.getByRole("textbox", { name: "Cantidad de Anteproyecto arquitectónico" }).waitFor();
  await page.getByRole("button", { name: "Cancelar", exact: true }).last().click();
  await dialog.getByRole("button", { name: "Cancelar cotización" }).click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones`);
  assert.equal(backend.requests.some((request) => request.method === "POST"), false);
});

test("servicios incluidos: el desplegable de la fila cambia el servicio sin recortarse y el contador separa los incluidos", async (context) => {
  const backend = createBackend();
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/nueva", viewport: { height: 900, width: 1024 } });
  const picker = page.getByRole("region", { name: "Seleccionar servicios" });
  await picker.getByRole("checkbox", { name: "Seleccionar Anteproyecto arquitectónico" }).click();
  await picker.getByText("1 de 2 seleccionados", { exact: true }).waitFor();
  await picker.getByRole("button", { name: "Agregar seleccionados" }).click();
  // Las nuevas selecciones se cuentan sobre lo que aún puede agregarse; los incluidos, aparte.
  await picker.getByText("0 de 1 seleccionados · 1 ya incluido", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Cantidad de Anteproyecto arquitectónico" }).fill("10");

  const trigger = page.getByRole("button", { name: "Servicio de la fila: Anteproyecto arquitectónico" });
  await trigger.click();
  const option = page.getByRole("menuitem", { name: "Puntos eléctricos y fuerza" });
  await option.waitFor();
  const layout = await page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]');
    const viewport = document.querySelector('[aria-labelledby="quote-items-title"] table').parentElement;
    const anchor = [...document.querySelectorAll("button[aria-expanded=true]")].find((button) => button.getAttribute("aria-label")?.startsWith("Servicio de la fila"));
    const menuBox = menu.getBoundingClientRect();
    const anchorBox = anchor.closest(".relative.inline-flex").getBoundingClientRect();
    const item = [...menu.querySelectorAll('[role="menuitem"]')].at(-1).getBoundingClientRect();
    const hit = document.elementFromPoint(item.left + item.width / 2, item.top + item.height / 2);
    return {
      inBody: menu.parentElement === document.body,
      joined: Math.abs(menuBox.left - anchorBox.left) < 0.6 && Math.abs(menuBox.width - anchorBox.width) < 0.6
        && (Math.abs(menuBox.top - anchorBox.bottom) < 0.6 || Math.abs(menuBox.bottom - anchorBox.top) < 0.6),
      lastItemReachable: Boolean(hit?.closest('[role="menu"]')),
      insideWindow: menuBox.top >= 0 && menuBox.bottom <= window.innerHeight,
      tableScrolls: viewport.scrollWidth > viewport.clientWidth,
    };
  });
  // El menú vive fuera de la tabla (no lo recorta su overflow) y la tabla conserva su scroll horizontal.
  assert.deepEqual(layout, { inBody: true, joined: true, lastItemReachable: true, insideWindow: true, tableScrolls: true });
  assert.deepEqual(await page.getByRole("menuitem").allInnerTexts(), ["Anteproyecto arquitectónico", "Puntos eléctricos y fuerza"], "El actual y los activos no incluidos; nunca el inactivo");
  assert.equal(await page.getByRole("scrollbar", { name: /^Desplazar opciones/ }).count(), 0, "Con tres opciones o menos no hay ScrollBar");

  // Cambiar el servicio trae su unidad y su tarifa, y conserva la cantidad escrita.
  await option.click();
  const quantity = page.getByRole("textbox", { name: "Cantidad de Puntos eléctricos y fuerza" });
  await quantity.waitFor();
  assert.equal(await quantity.inputValue(), "10");
  assert.equal(await page.getByRole("textbox", { name: "Tarifa base de Puntos eléctricos y fuerza en USD" }).inputValue(), "47");
  assert.equal(await page.getByRole("textbox", { name: "Cantidad de Anteproyecto arquitectónico" }).count(), 0);
  await picker.getByText("0 de 1 seleccionados · 1 ya incluido", { exact: true }).waitFor();
  await picker.getByRole("checkbox", { name: "Seleccionar Anteproyecto arquitectónico" }).waitFor();
});

test("servicios incluidos: el desplegable muestra tres opciones con ScrollBar y recorta los nombres largos", async (context) => {
  // Ocho servicios ficticios con nombres más anchos que la columna Servicio.
  const many = Array.from({ length: 8 }, (_, index) => ({
    ...SERVICES[0], code: `SERV-${String(index + 1).padStart(3, "0")}`, description: null, id: index + 1, sortOrder: index + 1,
    name: `Servicio ${index + 1} con un nombre comercial muy largo — Por proyecto`,
  }));
  const backend = createBackend({ services: many });
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/nueva" });
  const picker = page.getByRole("region", { name: "Seleccionar servicios" });
  await picker.getByRole("checkbox", { name: `Seleccionar ${many[0].name}` }).click();
  await picker.getByRole("button", { name: "Agregar seleccionados" }).click();

  await page.getByRole("button", { name: `Servicio de la fila: ${many[0].name}` }).click();
  const scrollBar = page.getByRole("scrollbar", { name: `Desplazar opciones: Servicio de la fila: ${many[0].name}` });
  await scrollBar.waitFor();
  const measure = () => page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]');
    const viewport = menu.querySelector("[data-dropdown-menu-viewport]");
    const box = viewport.getBoundingClientRect();
    const menuBox = menu.getBoundingClientRect();
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    return {
      height: viewport.clientHeight,
      // Opciones completamente visibles dentro del viewport.
      visible: items.filter((item) => {
        const rect = item.getBoundingClientRect();
        return rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5;
      }).map((item) => item.textContent),
      total: items.length,
      // Ninguna etiqueta sale del panel: se recorta con elipsis y conserva el texto en title.
      labelsInside: items.every((item) => {
        const label = item.querySelector("p");
        return label.getBoundingClientRect().right <= menuBox.right && label.title === label.textContent;
      }),
      truncated: items.some((item) => item.querySelector("p").scrollWidth > item.querySelector("p").clientWidth),
    };
  });

  const start = await measure();
  assert.equal(start.height, 3 * 35 + 2 * 4, "Tres opciones de 35 px con huecos de 4 px");
  assert.equal(start.total, 8, "Todas las opciones están en el menú");
  assert.deepEqual(start.visible, many.slice(0, 3).map((service) => service.name));
  assert.equal(start.labelsInside, true);
  assert.equal(start.truncated, true, "Los nombres largos se recortan");

  // Arrastrar el ScrollBar hasta el final muestra las tres últimas opciones.
  const track = await scrollBar.boundingBox();
  await page.mouse.move(track.x + track.width / 2, track.y + 4);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width / 2, track.y + track.height + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction((label) => document.querySelector(`[aria-label='${label}']`)?.getAttribute("aria-valuenow") === "100", `Desplazar opciones: Servicio de la fila: ${many[0].name}`);
  assert.deepEqual((await measure()).visible, many.slice(5).map((service) => service.name));

  // Elegir una opción del final sigue funcionando.
  await page.getByRole("menuitem", { name: many[7].name }).click();
  await page.getByRole("textbox", { name: `Cantidad de ${many[7].name}` }).waitFor();
});

test("salir sin guardar: sidebar, breadcrumb, Atrás y cierre del navegador piden confirmación", async (context) => {
  const backend = createBackend();
  const page = await openQuotes(context, backend);
  const listUrl = `${origin}/servicios-cotizaciones/cotizaciones`;
  const editorUrl = `${listUrl}/nueva`;
  const breadcrumb = page.getByRole("navigation", { name: "Ruta de navegación" }).getByRole("link", { name: "Servicios y cotizaciones" });
  const dialog = page.locator("[data-quote-discard-dialog]");
  const question = dialog.getByText("¿Deseas cancelar la cotización?");
  const quantity = page.getByRole("textbox", { name: "Cantidad de Anteproyecto arquitectónico" });

  // Sin cambios no se pregunta nada.
  await page.getByRole("button", { name: "Nueva cotización" }).click();
  await page.waitForURL(editorUrl);
  await breadcrumb.click();
  await page.waitForURL(listUrl);
  assert.equal(await question.count(), 0);

  await page.getByRole("button", { name: "Nueva cotización" }).click();
  await page.waitForURL(editorUrl);
  await page.getByRole("region", { name: "Seleccionar servicios" }).getByRole("checkbox", { name: "Seleccionar Anteproyecto arquitectónico" }).click();
  await page.getByRole("button", { name: "Agregar seleccionados" }).click();
  await quantity.fill("150");

  /**
   * Comprueba que la salida quedó detenida y vuelve al formulario con el borrador intacto.
   *
   * @param {string} origin - Vía de salida probada.
   * @returns {Promise<void>}
   */
  async function stayInEditor(origin) {
    await question.waitFor();
    await dialog.getByRole("button", { name: "Volver" }).click();
    await question.waitFor({ state: "hidden" });
    assert.equal(page.url(), editorUrl, `${origin}: la URL no cambia`);
    assert.equal(await quantity.inputValue(), "150", `${origin}: el borrador se conserva`);
  }

  await page.getByRole("button", { name: "Usuarios", exact: true }).click();
  await stayInEditor("sidebar");
  await breadcrumb.click();
  await stayInEditor("breadcrumb");
  await page.goBack({ waitUntil: "commit" });
  await stayInEditor("Atrás");

  // Recarga o cierre: confirmación nativa del navegador (beforeunload); descartarla mantiene la página.
  const unloadDialog = new Promise((resolve) => {
    page.once("dialog", async (nativeDialog) => {
      resolve(nativeDialog.type());
      await nativeDialog.dismiss();
    });
  });
  await page.close({ runBeforeUnload: true });
  assert.equal(await unloadDialog, "beforeunload");
  assert.equal(page.isClosed(), false);
  assert.equal(await quantity.inputValue(), "150");

  // Confirmar el descarte completa la navegación pendiente sin enviar nada.
  await page.goBack({ waitUntil: "commit" });
  await question.waitFor();
  await dialog.getByRole("button", { name: "Cancelar cotización" }).click();
  await page.waitForURL(listUrl);
  assert.equal(backend.requests.some((request) => request.method === "POST"), false);
});

test("edición: datos guardados, PATCH con expectedVersion y conflicto de versión sin perder el borrador", async (context) => {
  const backend = createBackend({ failures: { "PATCH /api/admin/quotes/:id": { body: { code: "QUOTE_VERSION_CONFLICT", message: "Otro administrador modificó esta cotización. Recarga los datos antes de guardar." }, status: 409 } } });
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/1/editar" });
  await page.getByRole("heading", { level: 1, name: "Cotización" }).waitFor();
  const quantity = page.getByRole("textbox", { name: "Cantidad de Anteproyecto arquitectónico" });
  await quantity.waitFor();
  assert.equal(await quantity.inputValue(), "200");
  await page.getByText("$4,445.00", { exact: true }).waitFor();
  await quantity.fill("100");
  await page.getByRole("button", { name: "Actualizar" }).click();
  await page.getByText("La cotización cambió mientras la editabas").waitFor();
  assert.equal(await quantity.inputValue(), "100", "El borrador se conserva");
  const patch = backend.requests.find((request) => request.method === "PATCH");
  assert.equal(patch.body.expectedVersion, 1);
  // El concepto guardado conserva su unidad cotizada (posición 1).
  assert.deepEqual(patch.body.items[0], { quantity: "100", serviceId: 1, unitRate: "14" });
  await page.getByRole("button", { name: "Recargar cotización" }).waitFor();
});

test("responsive y tema oscuro: listado y formulario sin desplazamiento horizontal de la página", async (context) => {
  for (const viewport of [{ height: 812, width: 375 }, { height: 1024, width: 768 }, { height: 900, width: 1024 }]) {
    const backend = createBackend();
    const page = await openQuotes(context, backend, { theme: "dark", viewport });
    await page.getByRole("rowheader", { name: "COT-001" }).waitFor();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(await overflow(), 0, `Listado a ${viewport.width} px`);
    await page.getByRole("button", { name: "Nueva cotización" }).click();
    await page.getByRole("heading", { name: "Seleccionar servicios" }).waitFor();
    assert.equal(await overflow(), 0, `Formulario a ${viewport.width} px`);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), true);
  }
});

/**
 * Textos del resumen de importes como pares [etiqueta, valor].
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<Array<[string, string]>>} Filas del resumen.
 */
function readAmountsSummary(page) {
  return page.locator("[data-quote-amounts-summary] > div").evaluateAll((rows) => rows.map((row) => [
    row.querySelector("dt").textContent.trim(),
    row.querySelector("dd").textContent.trim(),
  ]));
}

/**
 * Añade Anteproyecto (200 m²) y Puntos eléctricos (35 pt.) al borrador: total de servicios 4445.00.
 *
 * @param {import("playwright").Page} page - Página del formulario.
 * @returns {Promise<void>}
 */
async function addSampleServices(page) {
  const picker = page.getByRole("region", { name: "Seleccionar servicios" });
  await picker.getByRole("checkbox", { name: "Seleccionar Anteproyecto arquitectónico" }).click();
  await picker.getByRole("checkbox", { name: "Seleccionar Puntos eléctricos y fuerza" }).click();
  await picker.getByRole("button", { name: "Agregar seleccionados" }).click();
  await page.getByRole("textbox", { name: "Cantidad de Anteproyecto arquitectónico" }).fill("200");
  await page.getByRole("textbox", { name: "Cantidad de Puntos eléctricos y fuerza" }).fill("35");
}

test("IVA referencial: IVA y total estimado informativos encima del total de la cotización (sin IVA), en tiempo real; el POST no envía IVA", async (context) => {
  const backend = createBackend();
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/nueva" });
  await page.getByText("IVA referencial (16 %)", { exact: true }).waitFor();
  assert.deepEqual(await readAmountsSummary(page), [
    ["IVA referencial (16 %)", "$0.00"], ["Total estimado con IVA (informativo)", "$0.00"], ["Total de la cotización", "$0.00"],
  ]);

  await addSampleServices(page);
  await page.getByText("$711.20", { exact: true }).waitFor();
  // El IVA y el total estimado son informativos; el total de la cotización es la suma sin IVA.
  assert.deepEqual(await readAmountsSummary(page), [
    ["IVA referencial (16 %)", "$711.20"], ["Total estimado con IVA (informativo)", "$5,156.20"], ["Total de la cotización", "$4,445.00"],
  ]);
  // Tarifa personalizada: 200 × 14.05 + 35 × 47 = 4455.00; IVA 712.80.
  await page.getByRole("textbox", { name: "Tarifa base de Anteproyecto arquitectónico en USD" }).fill("14.05");
  await page.getByText("$712.80", { exact: true }).waitFor();
  assert.deepEqual(await readAmountsSummary(page), [
    ["IVA referencial (16 %)", "$712.80"], ["Total estimado con IVA (informativo)", "$5,167.80"], ["Total de la cotización", "$4,455.00"],
  ]);
  // Una cantidad no válida no muestra cifras que el servidor rechazaría.
  await page.getByRole("textbox", { name: "Cantidad de Puntos eléctricos y fuerza" }).fill("");
  assert.deepEqual((await readAmountsSummary(page)).map(([, value]) => value), ["—", "—", "—"]);
  await page.getByRole("textbox", { name: "Cantidad de Puntos eléctricos y fuerza" }).fill("35");

  // La ayuda aclara que es solo una referencia que no se suma al total.
  await page.getByRole("button", { name: "Información sobre el IVA referencial" }).click();
  await page.getByText(/No se suma al total de la cotización/).waitFor();
  await page.keyboard.press("Escape");

  await page.locator("#quote-client").fill("Leo");
  await page.getByRole("button", { name: /Leonel Pérez/ }).first().click();
  await page.locator("#quote-project").click();
  await page.getByRole("button", { name: /Apto\. 910/ }).first().click();
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Has creado la cotización exitosamente").waitFor();
  const [post] = backend.requests.filter((request) => request.method === "POST" && request.path === "/api/admin/quotes");
  assert.deepEqual(Object.keys(post.body).sort(), ["clientId", "items", "notes", "projectId"], "La tasa la decide el servidor");
  assert.deepEqual(backend.quotes.at(-1).referenceVat, { amount: "712.80", enabled: true, isReferenceOnly: true, rate: "16.00" });
});

test("IVA referencial: una versión guardada sin IVA lo indica y lo conserva al guardar, sin inventar una tasa", async (context) => {
  const backend = createBackend();
  // COT-001 se guardó antes del IVA referencial.
  const saved = backend.quotes[0];
  backend.quotes[0] = buildQuote(1, {
    clientId: saved.client.id, items: saved.items.map((item) => ({ quantity: item.quantity, serviceId: item.service.id, unitRate: item.unitRate })),
    notes: saved.notes, projectId: saved.project.id,
  }, 1, saved.createdAt, SERVICES, REFERENCE_VAT_NOT_APPLIED);
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/1/editar" });
  await page.getByText("No incluido en esta versión", { exact: true }).waitFor();
  assert.deepEqual(await readAmountsSummary(page), [
    ["IVA referencial", "No incluido en esta versión"], ["Total estimado con IVA (informativo)", "—"], ["Total de la cotización", "$4,445.00"],
  ]);
  await page.getByRole("button", { name: "Información sobre el IVA referencial" }).click();
  await page.getByText(/se guardó antes del IVA referencial/).waitFor();
  await page.keyboard.press("Escape");

  await page.getByRole("textbox", { name: "Cantidad de Anteproyecto arquitectónico" }).fill("100");
  await page.getByText("$3,045.00", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Actualizar" }).click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones`);
  assert.deepEqual([backend.quotes[0].currentVersion, backend.quotes[0].referenceVat.enabled, backend.quotes[0].referenceVat.rate], [2, false, null]);
});

test("IVA referencial al editar: conserva la tasa histórica de la versión guardada y recalcula al cambiar cantidades", async (context) => {
  const backend = createBackend();
  // COT-001 se guardó con 12.5 %; la tasa fija actual es 16 %.
  const saved = backend.quotes[0];
  backend.quotes[0] = buildQuote(1, {
    clientId: saved.client.id, items: saved.items.map((item) => ({ quantity: item.quantity, serviceId: item.service.id, unitRate: item.unitRate })),
    notes: saved.notes, projectId: saved.project.id,
  }, 1, saved.createdAt, SERVICES, { enabled: true, rate: "12.50" });
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/1/editar" });
  await page.getByText("IVA referencial (12.5 %)", { exact: true }).waitFor();
  // 4445.00 × 12.5 % = 555.625 → 555.63.
  assert.deepEqual(await readAmountsSummary(page), [
    ["IVA referencial (12.5 %)", "$555.63"], ["Total estimado con IVA (informativo)", "$5,000.63"], ["Total de la cotización", "$4,445.00"],
  ]);

  await page.getByRole("textbox", { name: "Cantidad de Anteproyecto arquitectónico" }).fill("100");
  // 3045.00 × 12.5 % = 380.625 → 380.63.
  await page.getByText("$380.63", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Actualizar" }).click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones`);
  assert.deepEqual([backend.quotes[0].currentVersion, backend.quotes[0].referenceVat.rate, backend.quotes[0].referenceVat.amount], [2, "12.50", "380.63"]);
});

test("IVA referencial: resumen dentro del viewport en móvil y escritorio, claro y oscuro", async (context) => {
  for (const [theme, viewport] of [["dark", { height: 812, width: 375 }], ["light", { height: 812, width: 375 }], ["dark", { height: 900, width: 1440 }]]) {
    const backend = createBackend();
    const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/nueva", theme, viewport });
    await addSampleServices(page);
    await page.getByText("$711.20", { exact: true }).waitFor();
    const layout = await page.locator("[data-quote-amounts-summary]").evaluate((summary) => ({
      inside: [...summary.querySelectorAll("dt, dd")].every((cell) => {
        const box = cell.getBoundingClientRect();
        return box.left >= 0 && box.right <= document.documentElement.clientWidth;
      }),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    assert.deepEqual(layout, { inside: true, overflow: 0 }, `${theme} ${viewport.width} px`);
  }
});

test("servicios incluidos: dos filas visibles con ScrollBar, casillas y «Eliminar» para los seleccionados", async (context) => {
  // Cinco servicios ficticios incluidos en la cotización.
  const many = Array.from({ length: 5 }, (_, index) => ({
    ...SERVICES[0], code: `SERV-${String(index + 1).padStart(3, "0")}`, description: null, id: index + 1, name: `Servicio incluido ${index + 1}`, sortOrder: index + 1,
  }));
  const backend = createBackend({ services: many });
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/nueva" });
  const picker = page.getByRole("region", { name: "Seleccionar servicios" });
  await picker.getByRole("checkbox", { name: "Seleccionar todos los servicios visibles" }).click();
  await picker.getByRole("button", { name: "Agregar seleccionados" }).click();

  const section = page.getByRole("region", { name: "Servicios incluidos" });
  const viewport = section.locator("[data-quote-items-viewport]");
  const bulk = section.locator("[data-quote-items-bulk-actions]");
  const scrollBar = section.getByRole("scrollbar", { name: "Desplazar servicios incluidos verticalmente" });
  await section.getByRole("textbox", { name: "Cantidad de Servicio incluido 1" }).waitFor();
  // Filas cuyo centro queda dentro del viewport, bajo la cabecera fija.
  const visibleRows = () => viewport.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const header = node.querySelector("thead").getBoundingClientRect();
    return [...node.querySelectorAll("tbody tr")].filter((row) => {
      const rect = row.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      return center > header.bottom && center < box.bottom;
    }).length;
  });

  // Figma 5771:367432: cabecera de 49 px y dos filas de 71 px; el resto con el ScrollBar vertical.
  assert.equal(await viewport.evaluate((node) => node.clientHeight), 49 + 2 * 71);
  assert.equal(await visibleRows(), 2);
  await scrollBar.waitFor();
  assert.equal(await bulk.count(), 0, "Sin selección no hay acciones");

  // Seleccionar dos filas muestra el contador y «Eliminar» debajo de la tabla.
  await section.getByRole("checkbox", { name: "Seleccionar Servicio incluido 1" }).click();
  await section.getByRole("checkbox", { name: "Seleccionar Servicio incluido 5" }).click();
  await bulk.getByText("2 de 5 seleccionados", { exact: true }).waitFor();
  // Una fila bajo la cabecera fija no tapa la casilla «Seleccionar todos».
  const headerCovered = await viewport.evaluate((node) => {
    node.scrollTop = 71;
    const box = node.querySelector("thead [role='checkbox']").getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return !node.querySelector("thead").contains(hit);
  });
  assert.equal(headerCovered, false);
  // «Eliminar» queda centrado bajo la tabla.
  const offCenter = await bulk.evaluate((node) => {
    const bar = node.getBoundingClientRect();
    const button = node.querySelector("button").getBoundingClientRect();
    return Math.abs((button.left + button.width / 2) - (bar.left + bar.width / 2));
  });
  assert.ok(offCenter <= 1, `«Eliminar» desplazado ${offCenter}px del centro`);
  // Eliminar pide confirmación con el diálogo de advertencia; cancelar no quita nada.
  const confirmDialog = page.locator("[data-quote-items-remove-modal]");
  await bulk.getByRole("button", { name: "Eliminar 2 servicios seleccionados" }).click();
  await confirmDialog.getByText("¿Eliminar servicios?", { exact: true }).waitFor();
  await confirmDialog.getByText("Se quitarán 2 servicios seleccionados de la cotización. El cambio se aplica al guardar.", { exact: true }).waitFor();
  assert.equal(await confirmDialog.locator('[data-quote-items-remove-icon="deactivate"]').count(), 1);
  await confirmDialog.getByRole("button", { name: "Cancelar" }).click();
  await confirmDialog.waitFor({ state: "detached" });
  assert.equal(await section.getByRole("textbox", { name: "Cantidad de Servicio incluido 1" }).count(), 1);
  await bulk.getByText("2 de 5 seleccionados", { exact: true }).waitFor();

  await bulk.getByRole("button", { name: "Eliminar 2 servicios seleccionados" }).click();
  await confirmDialog.getByRole("button", { name: "Eliminar" }).click();
  for (const n of [2, 3, 4]) await section.getByRole("textbox", { name: `Cantidad de Servicio incluido ${n}` }).waitFor();
  assert.equal(await section.getByRole("textbox", { name: "Cantidad de Servicio incluido 1" }).count(), 0);
  assert.equal(await section.getByRole("textbox", { name: "Cantidad de Servicio incluido 5" }).count(), 0);
  await bulk.waitFor({ state: "detached" });
  // Los quitados vuelven a poder elegirse en el selector.
  await picker.getByRole("checkbox", { name: "Seleccionar Servicio incluido 1" }).waitFor();

  // «Seleccionar todos» y «Eliminar» vacían la tabla.
  await section.getByRole("checkbox", { name: "Seleccionar todos los servicios incluidos" }).click();
  await bulk.getByText("3 de 3 seleccionados", { exact: true }).waitFor();
  await bulk.getByRole("button", { name: "Eliminar 3 servicios seleccionados" }).click();
  await confirmDialog.getByRole("button", { name: "Eliminar" }).click();
  await section.getByText("No se han agregado servicios", { exact: true }).waitFor();
  assert.equal(await scrollBar.count(), 0);
});

test("servicios incluidos: el badge de unidad sigue su variante de Figma en claro y oscuro, al crear y al editar", async (context) => {
  // Figma claro 5771:367444 y oscuro I5833:360601;5832:359967: misma geometría, colores por tema.
  const expected = {
    dark: { background: "rgb(42, 41, 41)", border: "rgb(42, 41, 41)", color: "rgb(255, 255, 255)" },
    light: { background: "rgba(42, 41, 41, 0.1)", border: "rgba(42, 41, 41, 0.1)", color: "rgb(42, 41, 41)" },
  };
  const cases = [
    ["light", "/servicios-cotizaciones/cotizaciones/nueva", { height: 1000, width: 1440 }],
    ["dark", "/servicios-cotizaciones/cotizaciones/nueva", { height: 1000, width: 1440 }],
    ["light", "/servicios-cotizaciones/cotizaciones/1/editar", { height: 812, width: 375 }],
    ["dark", "/servicios-cotizaciones/cotizaciones/1/editar", { height: 812, width: 375 }],
  ];
  for (const [theme, path, viewport] of cases) {
    const page = await openQuotes(context, createBackend(), { path, theme, viewport });
    if (path.endsWith("nueva")) await addSampleServices(page);
    const badge = page.getByRole("region", { name: "Servicios incluidos" }).locator("[data-quote-line-unit]").first();
    await badge.waitFor();
    const style = await badge.evaluate((node) => {
      const box = getComputedStyle(node);
      const text = getComputedStyle(node.querySelector("span"));
      return {
        background: box.backgroundColor, border: box.borderTopColor, borderWidth: box.borderTopWidth, color: text.color,
        fontSize: text.fontSize, height: node.getBoundingClientRect().height, lineHeight: text.lineHeight,
        padding: `${box.paddingTop} ${box.paddingRight} ${box.paddingBottom} ${box.paddingLeft}`, radius: box.borderTopLeftRadius,
      };
    });
    assert.deepEqual(style, {
      ...expected[theme], borderWidth: "1px", fontSize: "12px", height: 20, lineHeight: "14px", padding: "2px 8px 2px 8px", radius: style.radius,
    }, `${theme} ${path}`);
    assert.ok(Number.parseFloat(style.radius) >= 10, "Radio completo");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
  }
});

test("observaciones: caja de Figma a todo el ancho del formulario y 130 px de alto", async (context) => {
  for (const viewport of [{ height: 1000, width: 1440 }, { height: 812, width: 375 }]) {
    const page = await openQuotes(context, createBackend(), { path: "/servicios-cotizaciones/cotizaciones/nueva", viewport });
    const notes = page.getByRole("textbox", { name: "Observaciones (opcional)" });
    await notes.waitFor();
    const box = await notes.evaluate((textarea) => {
      // Figma 5771:452385: el marco con relleno 12/16 mide 130 px y ocupa el ancho del formulario.
      const frame = textarea.parentElement.parentElement.getBoundingClientRect();
      const form = textarea.closest("form").getBoundingClientRect();
      return { height: Math.round(frame.height), width: Math.round(frame.width) - Math.round(form.width) };
    });
    assert.deepEqual(box, { height: 130, width: 0 }, `${viewport.width} px`);
  }
});
