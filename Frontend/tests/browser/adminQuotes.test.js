import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { buildQuoteDocument } from "../../../Backend/src/domain/quoteDocument.js";
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
 * @returns {Object} Cotización.
 */
function buildQuote(id, payload, version, createdAt, services = SERVICES) {
  const totals = calculateQuoteTotals({ items: payload.items, referenceVat: { enabled: false } });
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
      // Como la API: la unidad elegida (la principal si el servicio tiene una sola) y su tarifa.
      const position = item.unitOptionPosition ?? 1;
      const option = service.unitOptions?.find((candidate) => candidate.position === position)
        ?? { label: service.unitLabel, measurementUnit: service.measurementUnit, position: 1, referenceRate: service.referenceRate };
      return {
        lineNumber: index + 1,
        quantity: totals.items[index].quantity,
        referenceRate: option.referenceRate,
        service: { code: service.code, description: service.description, id: service.id, isActive: service.isActive, kind: service.kind, name: service.name, versionId: service.id * 10 },
        subtotal: totals.items[index].subtotal,
        unit: { allowsDecimals: option.measurementUnit.allowsDecimals, label: option.label, optionId: service.id * 100 + position, position },
        unitRate: totals.items[index].unitRate,
      };
    }),
    notes: payload.notes ?? null,
    project: { id: project.id, name: project.name },
    servicesTotal: totals.servicesTotal,
    updatedAt: createdAt,
    version: { createdAt, createdBy: { hasProfilePhoto: false, id: 1, name: "Ana Admin" }, id: version },
  };
}

/**
 * Backend simulado de cotizaciones con estado en memoria y registro de peticiones.
 *
 * @param {Object} [options] - Fallos inyectados por operación (`PATCH /api/admin/quotes/:id`) y
 * servicios del tabulador (por defecto, SERVICES).
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
      const quote = buildQuote(state.quotes.length + 1, body, 1, new Date().toISOString(), services);
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
      state.quotes[index] = buildQuote(current.id, content, current.currentVersion + 1, current.createdAt, services);
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
const HOUR_UNIT = { allowsDecimals: true, code: "hour", id: 30, isActive: true, name: "Hora", symbol: "hrs" };
const WEEK_UNIT = { allowsDecimals: true, code: "week", id: 33, isActive: true, name: "Semana", symbol: "sem." };

/**
 * Unidad de un servicio con la forma de la API (`unitOptions`).
 *
 * @param {number} position - Posición (1 = principal).
 * @param {Object} measurementUnit - Unidad base.
 * @param {string|null} referenceRate - Tarifa o null (pendiente de validación comercial).
 * @returns {Object} Unidad del servicio.
 */
function unitOption(position, measurementUnit, referenceRate) {
  return {
    id: 900 + position, label: measurementUnit.symbol, measurementUnit, position, presentationLabel: null,
    ratePending: referenceRate === null, referenceRate, unitDenomination: null,
  };
}

// Tabulador 3.2: «Por Proyecto / Espacio» (proyecto con tarifa, espacio pendiente) y «Por Minuto /
// Proyecto» (ambas con la misma tarifa); tarifas ficticias, y un servicio ficticio sin ninguna tarifa confirmada.
const MULTI_UNIT_SERVICES = [
  { ...SERVICES[0], code: "SERV-004", description: null, id: 4, measurementUnit: PROJECT_UNIT, name: "Modelado 3D & Renders", referenceRate: "320.00",
    unitDenomination: null, unitLabel: "proy.", unitOptions: [unitOption(1, PROJECT_UNIT, "320.00"), unitOption(2, SPACE_UNIT, null)] },
  { ...SERVICES[0], code: "SERV-005", description: null, id: 5, measurementUnit: MINUTE_UNIT, name: "Recorrido Virtual / VR", referenceRate: "275.00",
    unitDenomination: null, unitLabel: "min", unitOptions: [unitOption(1, MINUTE_UNIT, "275.00"), unitOption(2, PROJECT_UNIT, "275.00")] },
  { ...SERVICES[0], code: "SERV-006", description: null, id: 6, measurementUnit: HOUR_UNIT, name: "Servicio sin tarifa confirmada", referenceRate: "300.00",
    unitDenomination: null, unitLabel: "hrs", unitOptions: [unitOption(1, HOUR_UNIT, null), unitOption(2, WEEK_UNIT, null)] },
];

test("seleccionar servicios: diez por página, la selección se conserva entre páginas y buscar vuelve a la primera", async (context) => {
  // Doce servicios activos ficticios (más de una página).
  const many = Array.from({ length: 12 }, (_, index) => ({
    ...SERVICES[0], code: `SERV-${String(index + 1).padStart(3, "0")}`, description: null, id: index + 1, name: `Servicio de página ${String(index + 1).padStart(2, "0")}`, sortOrder: index + 1,
  }));
  const backend = createBackend({ services: many });
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/nueva" });
  const picker = page.getByRole("region", { name: "Seleccionar servicios" });
  const pagination = picker.getByRole("navigation", { name: "Paginación de servicios disponibles" });
  const names = () => picker.locator("tbody tr td:nth-child(2) span.text-heading-8").allInnerTexts();
  await picker.getByText("Servicio de página 01", { exact: true }).waitFor();

  assert.equal(await picker.locator("tbody tr").count(), 10, "Una página muestra diez servicios");
  assert.equal(await pagination.getByRole("button", { name: "Anterior" }).isDisabled(), true);
  await picker.getByRole("checkbox", { name: "Seleccionar Servicio de página 02" }).click();
  await pagination.getByRole("button", { name: "Siguiente pág." }).click();
  assert.deepEqual(await names(), ["Servicio de página 11", "Servicio de página 12"]);
  assert.equal(await pagination.getByRole("button", { name: "Siguiente pág." }).isDisabled(), true);
  // «Seleccionar todos» marca solo la página visible; la selección de la página anterior se conserva.
  await picker.getByRole("checkbox", { name: "Seleccionar todos los servicios visibles" }).click();
  await picker.getByText("3 de 12 seleccionados", { exact: true }).waitFor();

  // Buscar vuelve a la primera página de los resultados.
  await picker.getByRole("textbox", { name: "Buscar servicios por nombre o código" }).fill("página 0");
  assert.deepEqual(await names(), Array.from({ length: 9 }, (_, index) => `Servicio de página 0${index + 1}`));
  assert.equal(await pagination.getByRole("button", { name: "Anterior" }).isDisabled(), true);
  assert.equal(await pagination.getByRole("button", { name: "Siguiente pág." }).isDisabled(), true);

  await picker.getByRole("textbox", { name: "Buscar servicios por nombre o código" }).fill("");
  await picker.getByRole("button", { name: "Agregar seleccionados" }).click();
  for (const name of ["Servicio de página 02", "Servicio de página 11", "Servicio de página 12"]) {
    await page.getByRole("textbox", { name: `Cantidad de ${name}` }).waitFor();
  }
});

test("varias unidades: solo se cotiza con tarifa confirmada, se elige la unidad y se envía su posición", async (context) => {
  const backend = createBackend({ services: [...SERVICES, ...MULTI_UNIT_SERVICES] });
  const page = await openQuotes(context, backend, { path: "/servicios-cotizaciones/cotizaciones/nueva" });
  await page.locator("#quote-client").fill("Leo");
  await page.getByRole("button", { name: /Leonel Pérez/ }).first().click();
  await page.locator("#quote-project").click();
  await page.getByRole("button", { name: /Apto\. 910/ }).first().click();

  // Un servicio sin ninguna tarifa confirmada se ve con sus unidades, pero no se puede elegir.
  const picker = page.getByRole("region", { name: "Seleccionar servicios" });
  const pendingRow = picker.locator("tbody tr", { hasText: "Servicio sin tarifa confirmada" });
  assert.equal(await pendingRow.getByRole("checkbox").count(), 0, "Sin tarifa confirmada no hay casilla que marcar");
  assert.deepEqual(await pendingRow.locator("td").nth(2).locator(":scope > div > *").allInnerTexts(), ["hrs", "sem."]);
  await pendingRow.getByText("Tarifa pendiente de validación comercial: aún no se puede cotizar.").waitFor();
  // El Recorrido VR está disponible con sus dos unidades.
  const tourRow = picker.locator("tbody tr", { hasText: "Recorrido Virtual / VR" });
  assert.deepEqual(await tourRow.locator("td").nth(2).locator(":scope > div > *").allInnerTexts(), ["min", "proy."]);
  assert.equal(await tourRow.getByText("Tarifa pendiente de validación comercial: aún no se puede cotizar.").count(), 0);

  await picker.getByRole("checkbox", { name: "Seleccionar Modelado 3D & Renders" }).click();
  await picker.getByRole("checkbox", { name: "Seleccionar Recorrido Virtual / VR" }).click();
  await picker.getByRole("button", { name: "Agregar seleccionados" }).click();

  // Modelado: proyecto es su única unidad cotizable y se elige sola con su tarifa; espacio se nombra pendiente.
  await page.getByRole("button", { name: "Unidad de Modelado 3D & Renders: proy." }).waitFor();
  await page.getByText("Tarifa pendiente de validación comercial: esp.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Tarifa base de Modelado 3D & Renders en USD" }).inputValue(), "320");
  // Recorrido VR: con dos unidades cotizables hay que elegir minuto o proyecto antes de guardar.
  await page.getByRole("textbox", { name: "Cantidad de Modelado 3D & Renders" }).fill("1");
  await page.getByRole("textbox", { name: "Cantidad de Recorrido Virtual / VR" }).fill("3");
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Elige la unidad de medida con la que se cotiza este servicio.", { exact: true }).waitFor();
  assert.equal(backend.requests.some((request) => request.method === "POST"), false, "Sin unidad elegida no se envía");
  await page.getByRole("button", { name: "Unidad de Recorrido Virtual / VR" }).click();
  assert.deepEqual(await page.getByRole("menuitem").allInnerTexts(), ["min", "proy."]);
  await page.getByRole("menuitem", { name: "proy." }).click();
  const tourRate = page.getByRole("textbox", { name: "Tarifa base de Recorrido Virtual / VR en USD" });
  assert.equal(await tourRate.inputValue(), "275");
  await page.getByRole("button", { name: "Unidad de Recorrido Virtual / VR: proy." }).click();
  await page.getByRole("menuitem", { name: "min" }).click();
  assert.equal(await tourRate.inputValue(), "275");
  // La tarifa propuesta se puede modificar en esta cotización.
  await tourRate.fill("250");

  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Has creado la cotización exitosamente").waitFor();
  const [post] = backend.requests.filter((request) => request.method === "POST" && request.path === "/api/admin/quotes");
  assert.deepEqual(post.body.items, [
    { quantity: "1", serviceId: 4, unitOptionPosition: 1, unitRate: "320" },
    { quantity: "3", serviceId: 5, unitOptionPosition: 1, unitRate: "250" },
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
    items: [{ quantity: "200", serviceId: 1, unitOptionPosition: 1, unitRate: "14" }, { quantity: "35", serviceId: 2, unitOptionPosition: 1, unitRate: "47" }],
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
  assert.deepEqual(patch.body.items[0], { quantity: "100", serviceId: 1, unitOptionPosition: 1, unitRate: "14" });
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
