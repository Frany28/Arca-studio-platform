import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Módulo «Servicios y cotizaciones» (Figma 5790:339391, 5771:487550, 5790:359521) contra un
// backend simulado con estado: nunca se usan Supabase ni datos reales.
const BASE_UNITS = [
  { id: 1, code: "square_meter", name: "Metro cuadrado", symbol: "m²", allowsDecimals: true, isActive: true, sortOrder: 101 },
  { id: 6, code: "linear_meter", name: "Metro lineal", symbol: "m.l.", allowsDecimals: true, isActive: true, sortOrder: 201 },
  { id: 13, code: "cubic_meter", name: "Metro cúbico", symbol: "m³", allowsDecimals: true, isActive: true, sortOrder: 301 },
  { id: 20, code: "hour", name: "Hora", symbol: "hrs", allowsDecimals: true, isActive: true, sortOrder: 601 },
  { id: 21, code: "unit", name: "Unidad", symbol: "und.", allowsDecimals: false, isActive: true, sortOrder: 501 },
  { id: 22, code: "piece", name: "Pieza", symbol: "pza.", allowsDecimals: false, isActive: true, sortOrder: 502 },
];
const SERVICES = [{ id: 1, isActive: true }, { id: 2, isActive: true }, { id: 3, isActive: false }];
const BASE_IN_USE_MESSAGE = "La unidad base no se puede cambiar porque la denominación ya se usa en servicios o en su historial. Crea otra denominación con la unidad deseada.";
const BASE_LOCKED_NOTE = "UNID-001 · La abreviatura no se puede cambiar porque esta unidad ya se usa en servicios o en su historial.";
const EDITABLE_NOTE = "UNID-001 · Puedes cambiar la abreviatura mientras ningún servicio use esta unidad.";

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
 * Crea una denominación simulada con la forma del contrato (publicCode generado como PostgreSQL).
 *
 * @param {number} id - Identificador.
 * @param {number} unitId - Unidad base.
 * @param {string} text - Denominación.
 * @param {Object} [overrides] - Campos sustituidos.
 * @returns {Object} Denominación.
 */
function denomination(id, unitId, text, overrides = {}) {
  const unit = BASE_UNITS.find((item) => item.id === unitId);
  return {
    id,
    publicCode: `UNID-${String(id).padStart(3, "0")}`,
    denomination: text,
    label: `${unit.symbol} ${text}`,
    isActive: true,
    activeServiceCount: 0,
    baseUnitEditable: true,
    measurementUnit: unit,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Backend simulado: aplica búsqueda literal y paginación por cursor sobre un arreglo en memoria,
 * crea, edita (texto y, si `baseUnitEditable`, unidad base) y cambia estado como el contrato, y
 * permite inyectar fallos por operación.
 *
 * @param {Array<Object>} initial - Denominaciones iniciales.
 * @returns {Object} Estado, registro de peticiones y manejador de rutas.
 */
function createBackend(initial) {
  const state = {
    items: initial.map((item) => ({ ...item })),
    nextId: Math.max(0, ...initial.map((item) => item.id)) + 1,
    requests: [],
    failures: {},
    delays: {},
    pageSize: null,
    // Catálogo base servido; las pruebas de scroll lo amplían a 48 unidades como el seed.
    baseUnits: BASE_UNITS,
  };
  const json = (route, status, body) => route.fulfill({ status, json: body });

  state.handle = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    state.requests.push({ method, path, search: url.search, body });
    const failure = state.failures[`${method} ${path.replace(/\d+/g, ":id")}`];
    const delay = state.delays[url.searchParams.get("search") ?? ""];
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

    if (path === "/api/auth/me") return json(route, 200, { user: { id: 1, firstName: "Ana", lastName: "Admin", email: "ana@example.test", role: "admin", status: "active" } });
    if (path === "/api/projects") return json(route, 200, { projects: [], nextCursor: null });
    if (failure) return json(route, failure.status, failure.body);
    if (path === "/api/admin/services") return json(route, 200, { services: SERVICES, nextCursor: null });
    if (path === "/api/admin/measurement-units") return json(route, 200, { measurementUnits: state.baseUnits });
    // Gestión de usuarios: solo para abrir el selector telefónico de referencia del modal «Nuevo usuario».
    if (path === "/api/admin/users") return json(route, 200, { users: [], nextCursor: null, metrics: { total: 0, active: 0, suspended: 0, disabled: 0 } });
    if (path === "/api/admin/roles") return json(route, 200, { roles: [{ id: 1, code: "client", name: "Cliente" }] });

    if (path === "/api/admin/measurement-unit-denominations" && method === "GET") {
      const search = (url.searchParams.get("search") || "").toLowerCase();
      const limit = Number(url.searchParams.get("limit") || 25);
      const start = Number(url.searchParams.get("cursor") || 0);
      const matches = state.items.filter((item) => !search
        || [item.publicCode, item.denomination, item.measurementUnit.symbol].some((text) => text.toLowerCase().includes(search)));
      const page = matches.slice(start, start + limit);
      return json(route, 200, { unitDenominations: page, nextCursor: start + limit < matches.length ? String(start + limit) : null });
    }
    if (path === "/api/admin/measurement-unit-denominations" && method === "POST") {
      const created = denomination(state.nextId, body.measurementUnitId, body.denomination);
      state.nextId += 1;
      state.items.unshift(created);
      return json(route, 201, { message: "Unidad de medida creada correctamente.", unitDenomination: created });
    }
    const match = /^\/api\/admin\/measurement-unit-denominations\/(\d+)(\/status)?$/.exec(path);
    if (match && method === "PATCH") {
      const item = state.items.find((candidate) => candidate.id === Number(match[1]));
      if (!item) return json(route, 404, { code: "MEASUREMENT_UNIT_DENOMINATION_NOT_FOUND", message: "La denominación seleccionada no existe." });
      if (match[2]) item.isActive = body.isActive;
      else {
        if (body.measurementUnitId !== undefined && body.measurementUnitId !== item.measurementUnit.id) {
          if (!item.baseUnitEditable) return json(route, 409, { code: "MEASUREMENT_UNIT_BASE_IN_USE", message: BASE_IN_USE_MESSAGE });
          item.measurementUnit = state.baseUnits.find((unit) => unit.id === body.measurementUnitId);
        }
        Object.assign(item, { denomination: body.denomination, label: `${item.measurementUnit.symbol} ${body.denomination}` });
      }
      return json(route, 200, { changed: true, message: "Unidad de medida actualizada correctamente.", unitDenomination: { ...item } });
    }
    state.requests.push({ unexpected: true, method, path });
    return json(route, 404, { code: "TEST_ROUTE_MISSING", message: "Fixture no definida" });
  };
  return state;
}

/**
 * Abre el módulo con sesión de administrador y el backend simulado; vigila errores de página
 * y peticiones no previstas.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {Object} backend - Backend de createBackend.
 * @param {Object} [options] - Viewport y tema.
 * @returns {Promise<import("playwright").Page>} Página.
 */
async function openModule(context, backend, { path = "/servicios-cotizaciones", theme = "light", viewport = { width: 1440, height: 1000 } } = {}) {
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
  await page.goto(`${origin}${path}`);
  return page;
}

const rowCodes = (page) => page.locator("tbody tr th[scope=row]").allTextContents();
const denominationGets = (backend) => backend.requests.filter((request) => request.method === "GET" && request.path === "/api/admin/measurement-unit-denominations");

test("contenedor: título, indicadores reales, pestañas de Figma y redirección a Unidades", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend);
  await page.waitForURL(`${origin}/servicios-cotizaciones/unidades`, { timeout: NAVIGATION_TIMEOUT_MS });
  await page.getByRole("heading", { name: "Servicios y cotizaciones", level: 1 }).waitFor();
  const metrics = page.getByLabel("Indicadores de servicios y cotizaciones");
  await metrics.getByText("Servicios totales").waitFor();
  const values = await metrics.locator("strong").allTextContents();
  assert.deepEqual(values.slice(0, 3), ["3", "2", "1"], "Totales derivados del catálogo real de servicios");
  assert.match(values[3], /^—No disponible/, "Cotizaciones no tiene fuente de datos: no se inventa un total");

  const tabs = page.getByRole("tablist", { name: "Secciones de servicios y cotizaciones" });
  assert.deepEqual(await tabs.getByRole("tab").allInnerTexts(), ["Cotizaciones", "Tabulador de servicios", "Unidades"]);
  assert.equal(await tabs.getByRole("tab", { name: "Unidades" }).getAttribute("aria-selected"), "true");
  assert.equal(await tabs.getByRole("tab", { name: "Unidades" }).evaluate((tab) => getComputedStyle(tab).borderBottomWidth), "2px");
  // Una subruta desconocida vuelve a Unidades sin pantalla vacía.
  await page.goto(`${origin}/servicios-cotizaciones/inexistente`);
  await page.waitForURL(`${origin}/servicios-cotizaciones/unidades`);
  await page.getByText("UNID-001", { exact: true }).waitFor();
});

test("pestañas: clic y teclado navegan sin recargar, con Atrás/Adelante y enlaces directos", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.evaluate(() => { window.__arcaNoReload = true; });
  const tabs = page.getByRole("tablist", { name: "Secciones de servicios y cotizaciones" });

  await tabs.getByRole("tab", { name: "Tabulador de servicios" }).click();
  await page.waitForURL(`${origin}/servicios-cotizaciones/tabulador`);
  await page.getByText("Tabulador de servicios en desarrollo", { exact: true }).waitFor();
  // Teclado del tablist: flecha izquierda activa Cotizaciones y la enfoca.
  await page.keyboard.press("ArrowLeft");
  await page.waitForURL(`${origin}/servicios-cotizaciones/cotizaciones`);
  await page.getByText("Cotizaciones en desarrollo", { exact: true }).waitFor();
  assert.equal(await tabs.getByRole("tab", { name: "Cotizaciones" }).evaluate((tab) => tab === document.activeElement), true);

  await page.goBack();
  await page.waitForURL(`${origin}/servicios-cotizaciones/tabulador`);
  assert.equal(await tabs.getByRole("tab", { name: "Tabulador de servicios" }).getAttribute("aria-selected"), "true");
  await page.goBack();
  await page.waitForURL(`${origin}/servicios-cotizaciones/unidades`);
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.goForward();
  await page.waitForURL(`${origin}/servicios-cotizaciones/tabulador`);
  assert.equal(await page.evaluate(() => window.__arcaNoReload), true, "Las pestañas no deben recargar la aplicación");

  // El destino del riel permanece activo en todas las pestañas.
  const navItem = page.locator('aside[aria-label="Navegación lateral"]:visible nav[aria-label="Secciones"] button[aria-label="Servicios y cotizaciones"]');
  const selectedColor = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--color-neutral-200)";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  await page.mouse.move(1300, 900);
  assert.equal(await navItem.evaluate((element) => getComputedStyle(element).backgroundColor), selectedColor);
  // Las pestañas provisionales no consultan servicios ni cotizaciones adicionales.
  assert.equal(backend.requests.some((request) => /quotes|cotizacion/.test(request.path)), false);
});

test("tabla: código público y etiqueta de la API, estado inactivo con texto y contador de selección", async (context) => {
  const backend = createBackend([
    denomination(1, 1, "de construcción"),
    denomination(2, 1, "a intervenir", { isActive: false }),
    denomination(3, 20, "de supervisión", { activeServiceCount: 2 }),
  ]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  assert.deepEqual(await rowCodes(page), ["UNID-001", "UNID-002", "UNID-003"]);
  assert.deepEqual(await page.locator("thead th").allInnerTexts(), ["", "N°", "Unidad", "Acciones"]);
  await page.getByText("m² de construcción", { exact: true }).waitFor();
  const inactiveRow = page.locator("tbody tr", { hasText: "UNID-002" });
  assert.equal(await inactiveRow.getByText("Inactiva", { exact: true }).count(), 1);
  // En uso por servicios activos: edición bloqueada con el motivo en el nombre accesible.
  const inUseEdit = page.getByRole("button", { name: /Editar UNID-003 .*En uso por 2 servicios activos/ });
  assert.equal(await inUseEdit.isDisabled(), true);

  const footer = page.getByLabel("Selección y paginación de unidades");
  await footer.getByText("0 de 3 seleccionados").waitFor();
  await page.getByRole("checkbox", { name: "Seleccionar UNID-001" }).click();
  await footer.getByText("1 de 3 seleccionados").waitFor();
  await page.getByRole("checkbox", { name: "Seleccionar todas las unidades visibles" }).click();
  await footer.getByText("3 de 3 seleccionados").waitFor();
  assert.equal(await page.getByRole("button", { name: "Anterior" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Siguiente pág." }).isDisabled(), true);
});

test("búsqueda: debounce, una sola petición por pausa, respuestas obsoletas descartadas y sin coincidencias", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción"), denomination(2, 20, "de supervisión"), denomination(3, 6, "de muro")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-003", { exact: true }).waitFor();
  const search = page.getByRole("textbox", { name: "Buscar unidades por código, abreviatura o texto" });
  const before = denominationGets(backend).length;

  // "de" responde tarde; "de muro" llega antes y debe prevalecer.
  backend.delays.de = 900;
  await search.pressSequentially("de", { delay: 40 });
  await page.waitForTimeout(400);
  await search.pressSequentially(" muro", { delay: 40 });
  await page.waitForFunction(() => [...document.querySelectorAll("tbody tr th[scope=row]")].map((cell) => cell.textContent).join() === "UNID-003");
  await page.waitForTimeout(1100);
  assert.deepEqual(await rowCodes(page), ["UNID-003"], "Una respuesta antigua no sustituye la búsqueda reciente");
  const searches = denominationGets(backend).slice(before).map((request) => new URLSearchParams(request.search).get("search"));
  assert.deepEqual(searches, ["de", "de muro"], "Cada pausa genera una única petición con la búsqueda de la API");

  await search.fill("UNID-002");
  await page.waitForFunction(() => [...document.querySelectorAll("tbody tr th[scope=row]")].map((cell) => cell.textContent).join() === "UNID-002");
  await search.fill("zzz");
  await page.getByText("No hay coincidencias", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Limpiar búsqueda" }).click();
  await page.getByText("UNID-001", { exact: true }).waitFor();
  assert.equal(await search.inputValue(), "");
});

test("paginación por cursor: Siguiente usa nextCursor, Anterior vuelve y la selección se reinicia", async (context) => {
  const items = Array.from({ length: 13 }, (_, index) => denomination(index + 1, 1, `variante ${String(index + 1).padStart(2, "0")}`));
  const backend = createBackend(items);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-010", { exact: true }).waitFor();
  assert.equal((await rowCodes(page)).length, 10);
  await page.getByRole("checkbox", { name: "Seleccionar UNID-001" }).click();
  await page.getByText("1 de 10 seleccionados").waitFor();

  await page.getByRole("button", { name: "Siguiente pág." }).click();
  await page.getByText("UNID-013", { exact: true }).waitFor();
  assert.deepEqual(await rowCodes(page), ["UNID-011", "UNID-012", "UNID-013"]);
  await page.getByText("0 de 3 seleccionados").waitFor();
  assert.equal(new URLSearchParams(denominationGets(backend).at(-1).search).get("cursor"), "10");
  assert.equal(await page.getByRole("button", { name: "Siguiente pág." }).isDisabled(), true);

  await page.getByRole("button", { name: "Anterior" }).click();
  await page.getByText("UNID-001", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Anterior" }).isDisabled(), true);
  await page.getByText("0 de 10 seleccionados").waitFor();
});

test("alta: selector de abreviaturas desde la API, teclado, un único envío y código devuelto por el backend", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Añadir unidad" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await dialog.waitFor();
  const combobox = dialog.getByRole("combobox", { name: /Abreviatura de la unidad base/ });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("m²"));
  assert.equal(backend.requests.filter((request) => request.path === "/api/admin/measurement-units").length, 1);

  // Foco inicial en el texto; el selector se abre con teclado y Escape no cierra el modal.
  await page.waitForFunction(() => document.activeElement?.matches?.("input[type='text']"));
  await combobox.focus();
  await page.keyboard.press("ArrowDown");
  const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
  await listbox.waitFor();
  assert.equal(await listbox.getByRole("option").count(), BASE_UNITS.length);
  // Solo la abreviatura es visible; el nombre completo queda en el nombre accesible.
  const selectedOption = listbox.getByRole("option", { selected: true });
  assert.equal(await selectedOption.textContent(), "m²");
  assert.equal(await selectedOption.getAttribute("aria-label"), "m², Metro cuadrado");
  assert.equal(await listbox.getByRole("option", { name: "m.l., Metro lineal" }).count(), 1);
  assert.equal(await listbox.getByText("Metro cuadrado").count(), 0, "La descripción no se muestra");
  await page.keyboard.press("Escape");
  await listbox.waitFor({ state: "detached" });
  assert.equal(await dialog.isVisible(), true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.startsWith("m.l."));
  // Búsqueda por letras y selección con el puntero.
  await combobox.click();
  await listbox.getByRole("option", { name: /hrs/ }).click();
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.startsWith("hrs"));

  const text = dialog.getByRole("textbox", { name: "Nombre de la unidad" });
  await text.fill("   ");
  await dialog.getByRole("button", { name: "Crear" }).click();
  await dialog.getByText("Escribe el nombre de la unidad.").waitFor();
  await text.fill("  de   asesoría ");
  await dialog.getByText("Se mostrará como «hrs de asesoría».").waitFor();

  const create = dialog.getByRole("button", { name: "Crear" });
  await create.dblclick();
  await page.getByRole("alert").getByText("UNID-002 · hrs de asesoría").waitFor();
  const posts = backend.requests.filter((request) => request.method === "POST");
  assert.equal(posts.length, 1, "Un doble clic no crea dos registros");
  assert.deepEqual(posts[0].body, { denomination: "de asesoría", measurementUnitId: 20 });
  await dialog.waitFor({ state: "detached" });
  // La tabla se recarga desde la primera página con el código generado por el backend.
  await page.getByText("UNID-002", { exact: true }).waitFor();
});

test("alta: un duplicado 409 marca el campo, conserva lo escrito y no cierra el formulario", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  backend.failures["POST /api/admin/measurement-unit-denominations"] = {
    status: 409,
    body: { code: "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS", message: "Ya existe una denominación equivalente para esa unidad de medida." },
  };
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Añadir unidad" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("m²"));
  const text = dialog.getByRole("textbox", { name: "Nombre de la unidad" });
  await text.fill("DE CONSTRUCCIÓN");
  await dialog.getByRole("button", { name: "Crear" }).click();
  await dialog.getByText("Ya existe una denominación equivalente para esa unidad de medida.").waitFor();
  assert.equal(await text.inputValue(), "DE CONSTRUCCIÓN");
  assert.equal(await text.getAttribute("aria-invalid"), "true");
  assert.equal(await dialog.getByRole("button", { name: "Crear" }).isEnabled(), true);
  // Escape cierra el formulario y devuelve el foco al disparador.
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
});

/**
 * Abre la edición de UNID-001 desde la tabla.
 *
 * @param {import("playwright").Page} page - Página del módulo.
 * @returns {Promise<import("playwright").Locator>} Diálogo de edición.
 */
async function openEditDialog(page) {
  await page.getByRole("button", { name: /Editar UNID-001/ }).click();
  const dialog = page.getByRole("dialog", { name: "Editar unidad de medida" });
  await dialog.waitFor();
  return dialog;
}

/**
 * Espera a que el selector de abreviaturas del formulario se habilite (catálogo cargado).
 *
 * @param {import("playwright").Page} page - Página del módulo.
 * @returns {Promise<void>}
 */
async function waitForEnabledBaseSelector(page) {
  await page.waitForFunction(() => document.querySelector('[data-measurement-unit-form] [role="combobox"]')?.disabled === false);
}

const baseUnitGets = (backend) => backend.requests.filter((request) => request.path === "/api/admin/measurement-units");

test("edición: sin referencias la abreviatura se cambia, se previsualiza y solo se envía si cambia", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  const dialog = await openEditDialog(page);
  const combobox = dialog.getByRole("combobox", { name: /Abreviatura de la unidad base/ });
  // El catálogo se pide al abrir y la base actual sigue seleccionada.
  await waitForEnabledBaseSelector(page);
  assert.equal(baseUnitGets(backend).length, 1);
  assert.equal((await combobox.textContent()).startsWith("m²"), true);
  await dialog.getByText(EDITABLE_NOTE).waitFor();
  await dialog.getByText("Se mostrará como «m² de construcción».").waitFor();

  await combobox.click();
  const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
  assert.equal(await listbox.getByRole("option").count(), BASE_UNITS.length);
  await listbox.getByRole("option", { name: "m.l., Metro lineal" }).click();
  await dialog.getByText("Se mostrará como «m.l. de construcción».").waitFor();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("m.l. de construcción", { exact: true }).waitFor();
  await page.getByText("UNID-001", { exact: true }).waitFor();
  const patches = () => backend.requests.filter((request) => request.method === "PATCH");
  assert.equal(patches()[0].path, "/api/admin/measurement-unit-denominations/1");
  assert.deepEqual(patches()[0].body, { denomination: "de construcción", measurementUnitId: 6 });

  // Sin tocar la abreviatura, el PATCH solo lleva el texto.
  const again = await openEditDialog(page);
  await waitForEnabledBaseSelector(page);
  assert.equal((await again.getByRole("combobox").textContent()).startsWith("m.l."), true);
  await again.getByRole("textbox", { name: "Nombre de la unidad" }).fill("de obra nueva");
  await again.getByRole("button", { name: "Guardar" }).click();
  await again.waitFor({ state: "detached" });
  await page.getByText("m.l. de obra nueva", { exact: true }).waitFor();
  assert.deepEqual(patches()[1].body, { denomination: "de obra nueva" });
  // El catálogo base se conserva entre aperturas.
  assert.equal(baseUnitGets(backend).length, 1);
});

test("edición: con referencias la abreviatura queda bloqueada con su motivo y el texto se sigue editando", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción", { baseUnitEditable: false })]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  const dialog = await openEditDialog(page);
  const combobox = dialog.getByRole("combobox", { name: /Abreviatura de la unidad base/ });
  assert.equal(await combobox.isDisabled(), true);
  assert.equal((await combobox.textContent()).startsWith("m²"), true);
  await dialog.getByText(BASE_LOCKED_NOTE).waitFor();
  // Sin base editable no hace falta el catálogo.
  assert.equal(baseUnitGets(backend).length, 0);
  const text = dialog.getByRole("textbox", { name: "Nombre de la unidad" });
  assert.equal(await text.inputValue(), "de construcción");
  await text.fill("de obra nueva");
  await dialog.getByText("Se mostrará como «m² de obra nueva».").waitFor();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("m² de obra nueva", { exact: true }).waitFor();
  assert.deepEqual(backend.requests.find((request) => request.method === "PATCH").body, { denomination: "de obra nueva" });
});

test("edición: un 409 de base en uso marca la abreviatura, la bloquea, recarga la tabla y conserva el texto", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  const listLoads = denominationGets(backend).length;
  const dialog = await openEditDialog(page);
  await waitForEnabledBaseSelector(page);
  // Otro administrador asignó la unidad a un servicio después de la lectura.
  backend.items[0].baseUnitEditable = false;
  const combobox = dialog.getByRole("combobox", { name: /Abreviatura de la unidad base/ });
  await combobox.click();
  await page.getByRole("listbox", { name: "Abreviatura de la unidad base" }).getByRole("option", { name: "hrs, Hora" }).click();
  const text = dialog.getByRole("textbox", { name: "Nombre de la unidad" });
  await text.fill("de obra");
  await dialog.getByRole("button", { name: "Guardar" }).click();

  await dialog.getByText(BASE_IN_USE_MESSAGE).waitFor();
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await text.inputValue(), "de obra");
  assert.equal(await text.getAttribute("aria-invalid"), "true");
  assert.equal(await combobox.isDisabled(), true);
  assert.equal((await combobox.textContent()).startsWith("m²"), true, "Vuelve a la base actual");
  for (let attempt = 0; attempt < 100 && denominationGets(backend).length <= listLoads; attempt += 1) await page.waitForTimeout(20);
  assert.ok(denominationGets(backend).length > listLoads, "La tabla se recarga para reflejar el nuevo uso");

  // Al escribir desaparece el error y se explica el bloqueo; guardar envía solo el texto.
  await text.fill("de obra final");
  await dialog.getByText(BASE_LOCKED_NOTE).waitFor();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("m² de obra final", { exact: true }).waitFor();
  const patches = backend.requests.filter((request) => request.method === "PATCH");
  assert.deepEqual(patches.map((request) => request.body), [
    { denomination: "de obra", measurementUnitId: 20 },
    { denomination: "de obra final" },
  ]);
});

test("edición responsive: en móvil y tema oscuro el selector editable cabe y abre dentro del viewport", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", theme: "dark", viewport: { width: 375, height: 720 } });
  const dialog = await openEditDialog(page);
  await waitForEnabledBaseSelector(page);
  const box = await dialog.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 375, `Diálogo dentro del viewport: ${JSON.stringify(box)}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await dialog.getByText(EDITABLE_NOTE).waitFor();
  await dialog.getByRole("combobox", { name: /Abreviatura de la unidad base/ }).click();
  const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
  await listbox.waitFor();
  const panel = await listbox.boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 375 && panel.y + panel.height <= 720, `Listado dentro del viewport: ${JSON.stringify(panel)}`);
  await listbox.getByRole("option", { name: "m³, Metro cúbico" }).click();
  await dialog.getByText("Se mostrará como «m³ de construcción».").waitFor();
});

test("estado: desactivar y activar con confirmación; los errores 409 y 429 se comunican con el aviso", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción"), denomination(2, 20, "de supervisión", { activeServiceCount: 1 })]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("UNID-001", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Más opciones para UNID-001" }).click();
  await page.getByRole("menuitem", { name: "Desactivar" }).click();
  const confirm = page.getByRole("dialog", { name: "¿Deseas desactivar la unidad de medida?" });
  await confirm.waitFor();
  await confirm.getByRole("button", { name: "Desactivar" }).click();
  await page.locator("tbody tr", { hasText: "UNID-001" }).getByText("Inactiva", { exact: true }).waitFor();
  assert.deepEqual(backend.requests.find((request) => request.path.endsWith("/1/status")).body, { isActive: false });

  // Una unidad inactiva ofrece Activar.
  await page.getByRole("button", { name: "Más opciones para UNID-001" }).click();
  await page.getByRole("menuitem", { name: "Activar" }).click();
  await page.getByRole("dialog", { name: "¿Deseas activar la unidad de medida?" }).getByRole("button", { name: "Activar" }).click();
  await page.waitForFunction(() => !document.querySelector("tbody tr")?.textContent?.includes("Inactiva"));

  // En uso: la opción aparece bloqueada con el motivo como encabezado del menú.
  await page.getByRole("button", { name: "Más opciones para UNID-002" }).click();
  assert.equal(await page.getByRole("menuitem", { name: "Desactivar" }).isDisabled(), true);
  await page.getByRole("menu").getByText("En uso por 1 servicio activo").waitFor();
  await page.keyboard.press("Escape");

  backend.failures["PATCH /api/admin/measurement-unit-denominations/:id/status"] = {
    status: 429,
    body: { code: "RATE_LIMITED", message: "Demasiadas solicitudes." },
  };
  await page.getByRole("button", { name: "Más opciones para UNID-001" }).click();
  await page.getByRole("menuitem", { name: "Desactivar" }).click();
  await page.getByRole("dialog", { name: "¿Deseas desactivar la unidad de medida?" }).getByRole("button", { name: "Desactivar" }).click();
  await page.getByText("Realizaste demasiados cambios en poco tiempo. Espera unos minutos e inténtalo de nuevo.").waitFor();
  backend.failures["PATCH /api/admin/measurement-unit-denominations/:id/status"] = {
    status: 409,
    body: { code: "MEASUREMENT_UNIT_IN_USE", message: "La denominación está asignada a 1 servicio(s) activo(s). Crea otra denominación y reasigna esos servicios." },
  };
  await page.getByRole("button", { name: "Más opciones para UNID-001" }).click();
  await page.getByRole("menuitem", { name: "Desactivar" }).click();
  await page.getByRole("dialog", { name: "¿Deseas desactivar la unidad de medida?" }).getByRole("button", { name: "Desactivar" }).click();
  await page.getByText(/asignada a 1 servicio\(s\) activo\(s\)/).waitFor();
  // Ninguna llamada de eliminación física.
  assert.equal(backend.requests.some((request) => request.method === "DELETE"), false);
});

test("estados: carga, vacío con acción, error recuperable y 403 comprensible", async (context) => {
  const backend = createBackend([]);
  backend.failures["GET /api/admin/measurement-unit-denominations"] = { status: 500, body: { code: "INTERNAL_SERVER_ERROR", message: "Ocurrió un error inesperado." } };
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByText("No se pudieron cargar las unidades de medida", { exact: true }).waitFor();
  delete backend.failures["GET /api/admin/measurement-unit-denominations"];
  await page.getByRole("button", { name: "Reintentar" }).click();
  await page.getByText("Aún no hay unidades de medida", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Selección y paginación de unidades").count(), 0);
  await page.getByRole("button", { name: "Añadir unidad" }).last().click();
  await page.getByRole("dialog", { name: "Nueva unidad de medida" }).waitFor();
  await page.keyboard.press("Escape");

  backend.failures["POST /api/admin/measurement-unit-denominations"] = { status: 403, body: { code: "FORBIDDEN", message: "No tienes permisos para realizar esta acción." } };
  await page.getByRole("button", { name: "Añadir unidad" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("m²"));
  await dialog.getByRole("textbox", { name: "Nombre de la unidad" }).fill("de prueba");
  await dialog.getByRole("button", { name: "Crear" }).click();
  await dialog.getByText("No tienes permisos para gestionar unidades de medida.").waitFor();
});

/**
 * Mide la presentación de un listado unido a un selector del Input y de su primera opción.
 *
 * @param {import("playwright").Locator} listbox - Listado abierto.
 * @returns {Promise<Object>} Estilos calculados comparables entre selectores.
 */
function measureOptionsPanel(listbox) {
  return listbox.evaluate((panel) => {
    const style = getComputedStyle(panel);
    const viewport = panel.firstElementChild;
    const option = panel.querySelector('[role="option"]');
    const optionStyle = getComputedStyle(option);
    return {
      background: style.backgroundColor,
      borderColor: style.borderLeftColor,
      borderTop: style.borderTopWidth,
      boxShadow: style.boxShadow,
      optionFont: `${optionStyle.fontSize}/${optionStyle.lineHeight}`,
      optionGap: optionStyle.columnGap,
      optionHeight: option.getBoundingClientRect().height,
      optionPadding: `${optionStyle.paddingLeft} ${optionStyle.paddingRight}`,
      optionRadius: optionStyle.borderTopLeftRadius,
      padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
      radius: `${style.borderBottomLeftRadius} ${style.borderBottomRightRadius}`,
      scrollbarHidden: getComputedStyle(viewport).scrollbarWidth,
      selectedBackground: getComputedStyle(panel.querySelector('[aria-selected="true"]')).backgroundColor,
      viewportHeight: viewport.getBoundingClientRect().height,
    };
  });
}

for (const theme of ["light", "dark"]) {
  test(`consistencia (${theme}): el listado de unidades replica el del selector telefónico`, async (context) => {
    const backend = createBackend([denomination(1, 1, "de construcción")]);
    const page = await openModule(context, backend, { path: "/usuarios", theme });
    await page.getByRole("button", { name: "Nuevo", exact: true }).click();
    const phoneDialog = page.getByRole("dialog", { name: "Nuevo usuario" });
    await phoneDialog.waitFor();
    await phoneDialog.getByRole("combobox", { name: /Buscar código de país/ }).first().focus();
    const phoneList = page.getByRole("listbox", { name: "Países y códigos telefónicos" });
    await phoneList.waitFor();
    const phone = await measureOptionsPanel(phoneList);
    assert.equal(await page.getByRole("scrollbar", { name: "Desplazar países" }).count(), 1);
    // Relación del menú telefónico con su segmento: envoltorio del prefijo y divisor bajo él.
    const phoneAnchor = await phoneList.evaluate((list) => {
      const segment = list.parentElement.getBoundingClientRect();
      const rect = list.getBoundingClientRect();
      return {
        dx: Math.round(rect.left - segment.left),
        dy: Math.round(rect.top - segment.bottom),
        extraWidth: Math.round(rect.width - segment.width),
        divider: getComputedStyle(list.parentElement.firstElementChild, "::after").height,
      };
    });

    await page.goto(`${origin}/servicios-cotizaciones/unidades`);
    await page.getByText("UNID-001", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Añadir unidad" }).click();
    await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("m²"));
    await page.getByRole("dialog", { name: "Nueva unidad de medida" }).getByRole("combobox").click();
    const unitList = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
    await unitList.waitFor();
    const units = await measureOptionsPanel(unitList);

    assert.deepEqual(units, phone, "Carcasa, filas, tipografía, colores, scroll y altura idénticos");
    // El menú de unidades es una extensión del segmento m², con el mismo anclaje que el teléfono;
    // solo el ancho crece lo necesario para abreviatura y nombre, sin ocupar el campo completo.
    const unitAnchor = await unitList.evaluate((list) => {
      const trigger = document.querySelector('[data-measurement-unit-form] [role="combobox"]');
      const segment = trigger.getBoundingClientRect();
      const field = trigger.closest("[data-input-shell]").getBoundingClientRect();
      const rect = list.getBoundingClientRect();
      return {
        dx: Math.round(rect.left - segment.left),
        dy: Math.round(rect.top - segment.bottom),
        extraWidth: Math.round(rect.width - segment.width),
        divider: getComputedStyle(trigger, "::after").height,
        narrowerThanField: rect.width < field.width,
        fitsContent: [...list.querySelectorAll('[role="option"] span:last-child')].every((span) => span.scrollWidth <= span.clientWidth),
      };
    });
    assert.deepEqual({ dx: unitAnchor.dx, dy: unitAnchor.dy, divider: unitAnchor.divider }, { dx: phoneAnchor.dx, dy: phoneAnchor.dy, divider: phoneAnchor.divider });
    assert.equal(phoneAnchor.extraWidth, 1);
    assert.ok(unitAnchor.extraWidth >= 1, "Nunca más estrecho que el segmento");
    assert.equal(unitAnchor.narrowerThanField, true);
    assert.equal(unitAnchor.fitsContent, true, "Los nombres completos caben sin recortarse");
    assert.equal(units.viewportHeight, 113);
    assert.equal(units.optionHeight, 35);
    assert.equal(units.borderTop, "0px");
    // El listado de unidades usa el mismo ScrollBar del sistema y conserva las 6 unidades simuladas.
    assert.equal(await page.getByRole("scrollbar", { name: "Desplazar abreviatura de la unidad base" }).count(), 1);
    assert.equal(await unitList.getByRole("option").count(), BASE_UNITS.length);
    // Abreviatura y descripción en cada opción.
    assert.deepEqual(await unitList.getByRole("option").allTextContents(), BASE_UNITS.map((unit) => unit.symbol));
    // Compacto: proporcional a la abreviatura más larga, no a nombres completos.
    assert.ok(unitAnchor.extraWidth <= 40, `Demasiado ancho para solo abreviaturas (+${unitAnchor.extraWidth} px)`);

    // Teclado: anillo primary-10 en la opción activa, como el foco visible del telefónico; el
    // puntero solo aplica hover y retira el anillo.
    await page.keyboard.press("ArrowDown");
    const ring = await unitList.getByRole("option").nth(1).evaluate((option) => getComputedStyle(option).boxShadow);
    assert.notEqual(ring, "none");
    await unitList.getByRole("option").nth(2).hover();
    assert.equal(await unitList.getByRole("option").nth(1).evaluate((option) => getComputedStyle(option).boxShadow), "none");
    // Desplazarse hasta la última opción mueve también el ScrollBar.
    await page.keyboard.press("End");
    await page.waitForFunction(() => {
      const viewport = document.querySelector('[role="listbox"]').firstElementChild;
      return viewport.scrollTop > 0;
    });
  });
}

// 48 unidades base como el catálogo aprobado: muchas quedan fuera de las tres filas visibles.
const FORTY_EIGHT_UNITS = Array.from({ length: 48 }, (_, index) => ({
  id: 100 + index,
  code: `unit_${index}`,
  name: `Unidad de prueba ${index + 1}`,
  symbol: `u${index + 1}`,
  allowsDecimals: true,
  isActive: true,
  sortOrder: index + 1,
}));

/**
 * Lee el desplazamiento del área de opciones del listado abierto.
 *
 * @param {import("playwright").Page} page - Página con un listado abierto.
 * @returns {Promise<number>} scrollTop del área desplazable.
 */
function optionsScrollTop(page) {
  return page.getByRole("listbox").evaluate((list) => list.firstElementChild.scrollTop);
}

/**
 * Arrastra el thumb del ScrollBar con el ratón real (pointerdown, pointermove, pointerup).
 *
 * @param {import("playwright").Page} page - Página con un listado abierto.
 * @param {string} name - Nombre accesible del ScrollBar.
 * @param {number} deltaY - Desplazamiento vertical del puntero.
 * @returns {Promise<void>}
 */
async function dragScrollThumb(page, name, deltaY) {
  const thumb = page.getByRole("scrollbar", { name }).locator("div").first();
  // El thumb anima `top` (150 ms): se espera a que su posición se estabilice antes de agarrarlo.
  let box = await thumb.boundingBox();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(50);
    const next = await thumb.boundingBox();
    if (Math.abs(next.y - box.y) < 0.5) break;
    box = next;
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + deltaY, { steps: 8 });
  await page.mouse.up();
}

for (const [label, viewport, theme] of [["escritorio claro", { width: 1440, height: 1000 }, "light"], ["móvil oscuro", { width: 375, height: 812 }, "dark"]]) {
  test(`scroll (${label}): arrastrar el ScrollBar, rueda y teclado desplazan las 48 unidades sin cerrar el menú`, async (context) => {
    const backend = createBackend([denomination(1, 1, "de construcción")]);
    backend.baseUnits = FORTY_EIGHT_UNITS;
    const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", theme, viewport });
    await page.getByText("UNID-001", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Añadir unidad" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
    await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("u1"));
    const combobox = dialog.getByRole("combobox");
    await combobox.click();
    const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
    await listbox.waitFor();
    const scrollbarName = "Desplazar abreviatura de la unidad base";

    // Hay opciones fuera del área visible y solo se muestran las abreviaturas.
    const overflow = await listbox.evaluate((list) => {
      const area = list.firstElementChild;
      const bottom = area.getBoundingClientRect().bottom;
      return { hidden: [...area.querySelectorAll('[role="option"]')].filter((option) => option.getBoundingClientRect().top >= bottom).length, scrollable: area.scrollHeight > area.clientHeight };
    });
    assert.ok(overflow.scrollable && overflow.hidden > 40, JSON.stringify(overflow));
    assert.equal(await listbox.getByRole("option").first().textContent(), "u1");

    // Arrastrar hacia abajo aumenta scrollTop; hacia arriba lo reduce; el menú sigue abierto.
    await dragScrollThumb(page, scrollbarName, 40);
    const afterDown = await optionsScrollTop(page);
    assert.ok(afterDown > 300, `El arrastre hacia abajo debe desplazar el listado (scrollTop=${afterDown})`);
    assert.equal(await listbox.isVisible(), true);
    await dragScrollThumb(page, scrollbarName, -20);
    const afterUp = await optionsScrollTop(page);
    assert.ok(afterUp < afterDown && afterUp > 0, `El arrastre hacia arriba debe reducir scrollTop (0 < ${afterUp} < ${afterDown})`);
    assert.equal(await listbox.isVisible(), true);
    assert.equal(await combobox.getAttribute("aria-expanded"), "true");
    // El ScrollBar refleja la posición real del listado.
    assert.ok(Number(await page.getByRole("scrollbar", { name: scrollbarName }).getAttribute("aria-valuenow")) > 0);

    // Seleccionar una opción que solo era visible tras desplazarse.
    const target = listbox.getByRole("option").filter({ hasText: /^u(1[2-9]|2\d)$/ }).first();
    const targetSymbol = await target.textContent();
    await target.click();
    await listbox.waitFor({ state: "detached" });
    assert.equal(await combobox.textContent(), targetSymbol);

    // Rueda del ratón (y deltas pequeños, como un panel táctil).
    await combobox.click();
    await listbox.waitFor();
    const startWheel = await optionsScrollTop(page);
    const listBox = await listbox.boundingBox();
    await page.mouse.move(listBox.x + 16, listBox.y + 30);
    await page.mouse.wheel(0, 120);
    for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, 10);
    await page.waitForFunction((start) => document.querySelector('[role="listbox"]').firstElementChild.scrollTop >= start + 150, startWheel);

    // Teclado: End lleva a la última opción aunque el puntero esté sobre el listado, Home a la
    // primera, y Enter selecciona la activa; Escape cierra sin cerrar el modal.
    await combobox.focus();
    await page.keyboard.press("End");
    await page.waitForFunction(() => {
      const area = document.querySelector('[role="listbox"]').firstElementChild;
      return area.scrollTop + area.clientHeight >= area.scrollHeight - 1;
    });
    assert.match(await combobox.getAttribute("aria-activedescendant"), /-prefix-option-47$/);
    await page.keyboard.press("Home");
    await page.waitForFunction(() => document.querySelector('[role="listbox"]').firstElementChild.scrollTop === 0);
    assert.match(await combobox.getAttribute("aria-activedescendant"), /-prefix-option-0$/);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await listbox.waitFor({ state: "detached" });
    assert.equal(await combobox.textContent(), "u2");
    assert.equal(await combobox.evaluate((element) => element === document.activeElement), true, "El foco vuelve al disparador");
    await page.keyboard.press("ArrowDown");
    await listbox.waitFor();
    await page.keyboard.press("Escape");
    await listbox.waitFor({ state: "detached" });
    assert.equal(await dialog.isVisible(), true);
  });
}

/**
 * Mide el listado abierto frente al modal, su footer de acciones, el segmento m² y el viewport,
 * y comprueba con elementFromPoint que los botones del footer siguen accesibles.
 *
 * @param {import("playwright").Page} page - Página con el formulario y el listado abiertos.
 * @returns {Promise<Object>} Relaciones geométricas reales.
 */
function measureDropdownLayout(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector("[data-measurement-unit-form]");
    const footer = dialog.querySelector("footer");
    const list = document.querySelector('[role="listbox"]').getBoundingClientRect();
    const segment = dialog.querySelector('[role="combobox"]').getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    const buttonsReachable = [...footer.querySelectorAll("button")].every((button) => {
      const rect = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    });
    return {
      insideDialog: list.top >= dialogRect.top - 0.5 && list.bottom <= dialogRect.bottom + 0.5,
      insideViewport: list.top >= 0 && list.bottom <= window.innerHeight + 0.5 && list.right <= window.innerWidth,
      clearOfFooter: list.bottom <= footerRect.top + 0.5 || list.top >= footerRect.bottom - 0.5,
      anchored: Math.abs(list.left - (segment.left - 1)) < 0.5
        && (Math.abs(list.top - segment.bottom) < 0.5 || Math.abs(list.bottom - segment.top) < 0.5),
      buttonsReachable,
      placement: Math.abs(list.top - segment.bottom) < 0.5 ? "bottom" : "top",
      dialogHeight: Math.round(dialogRect.height),
      gapToFooter: Math.round(footerRect.top - list.bottom),
    };
  });
}

for (const theme of ["light", "dark"]) {
  test(`posicionamiento (${theme}): el listado se abre dentro del modal sin tapar las acciones en 375–1440 px`, async (context) => {
    const backend = createBackend([denomination(1, 1, "de construcción")]);
    backend.baseUnits = FORTY_EIGHT_UNITS;
    const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", theme, viewport: { width: 1440, height: 1000 } });
    await page.getByText("UNID-001", { exact: true }).waitFor();
    for (const [width, height] of [[375, 812], [768, 1024], [1024, 768], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      await page.getByRole("button", { name: "Añadir unidad" }).click();
      const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
      await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("u1"));
      const closedHeight = Math.round((await dialog.boundingBox()).height);
      const combobox = dialog.getByRole("combobox");
      await combobox.click();
      const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
      await listbox.waitFor();
      // Espera a que el modal haya crecido y el panel se haya recolocado tras la reserva.
      await page.waitForFunction(() => {
        const list = document.querySelector('[role="listbox"]')?.getBoundingClientRect();
        const footer = document.querySelector("[data-measurement-unit-form] footer")?.getBoundingClientRect();
        return list && footer && list.bottom <= footer.top + 0.5;
      });
      const layout = await measureDropdownLayout(page);
      assert.deepEqual(
        { insideDialog: layout.insideDialog, insideViewport: layout.insideViewport, clearOfFooter: layout.clearOfFooter, anchored: layout.anchored, buttonsReachable: layout.buttonsReachable },
        { insideDialog: true, insideViewport: true, clearOfFooter: true, anchored: true, buttonsReachable: true },
        `${width}x${height}: ${JSON.stringify(layout)}`,
      );
      // Solo se reserva el espacio que falta: el listado termina justo en el footer, sin huecos.
      assert.equal(layout.gapToFooter, 0, `${width}x${height}: hueco innecesario de ${layout.gapToFooter} px`);
      assert.ok(layout.dialogHeight > closedHeight, "El modal crece para contener el listado");
      // El listado sigue siendo utilizable: scroll con la rueda y selección.
      const box = await listbox.boundingBox();
      await page.mouse.move(box.x + 16, box.y + 30);
      await page.mouse.wheel(0, 120);
      await page.waitForFunction(() => document.querySelector('[role="listbox"]').firstElementChild.scrollTop > 0);
      // Escape cierra el listado (no el modal) y el modal recupera su altura.
      await page.keyboard.press("Escape");
      await listbox.waitFor({ state: "detached" });
      await page.waitForFunction((expected) => Math.round(document.querySelector("[data-measurement-unit-form]").getBoundingClientRect().height) === expected, closedHeight);
      assert.equal(await dialog.isVisible(), true);
      // Un clic fuera también cierra y libera el espacio.
      await combobox.click();
      await listbox.waitFor();
      await dialog.getByRole("heading", { name: "Nueva unidad de medida" }).click();
      await listbox.waitFor({ state: "detached" });
      // Al perder el foco, el campo deja su borde enfocado de 2 px: se admite esa diferencia.
      await page.waitForFunction((expected) => !document.querySelector("[data-input-options-reserve]")
        && Math.abs(Math.round(document.querySelector("[data-measurement-unit-form]").getBoundingClientRect().height) - expected) <= 2, closedHeight);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    }
  });
}

test("posicionamiento: con poco alto el modal desplaza su contenido y el listado lo acompaña sin salir del viewport", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  backend.baseUnits = FORTY_EIGHT_UNITS;
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", viewport: { width: 1024, height: 300 } });
  await page.getByText("UNID-001", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Añadir unidad" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("u1"));
  await dialog.getByRole("combobox").click();
  const listbox = page.getByRole("listbox", { name: "Abreviatura de la unidad base" });
  await listbox.waitFor();
  await page.waitForTimeout(150);
  let layout = await measureDropdownLayout(page);
  assert.equal(layout.insideViewport, true, JSON.stringify(layout));
  assert.equal(layout.anchored, true, JSON.stringify(layout));
  // El modal está limitado al viewport: su formulario desplaza y el listado sigue al segmento.
  const scrolled = await page.evaluate(() => {
    const form = document.querySelector("#measurement-unit-form");
    const before = form.scrollTop;
    form.scrollTop = form.scrollHeight;
    return { before, after: form.scrollTop, scrollable: form.scrollHeight > form.clientHeight };
  });
  assert.equal(scrolled.scrollable, true, "Con 300 px de alto el formulario debe desplazarse");
  await page.waitForFunction(() => {
    const list = document.querySelector('[role="listbox"]')?.getBoundingClientRect();
    const segment = document.querySelector("[data-measurement-unit-form] [role=combobox]").getBoundingClientRect();
    return list && (Math.abs(list.top - segment.bottom) < 0.5 || Math.abs(list.bottom - segment.top) < 0.5);
  });
  layout = await measureDropdownLayout(page);
  assert.equal(layout.anchored, true, `Tras desplazar el modal: ${JSON.stringify(layout)}`);
  // El ScrollBar del listado sigue arrastrándose en este espacio reducido.
  const before = await optionsScrollTop(page);
  await dragScrollThumb(page, "Desplazar abreviatura de la unidad base", 20);
  assert.ok(await optionsScrollTop(page) > before);
});

test("scroll: el ScrollBar del selector telefónico sigue arrastrándose (sin regresión)", async (context) => {
  const backend = createBackend([]);
  const page = await openModule(context, backend, { path: "/usuarios" });
  await page.getByRole("button", { name: "Nuevo", exact: true }).click();
  const phoneDialog = page.getByRole("dialog", { name: "Nuevo usuario" });
  await phoneDialog.waitFor();
  await phoneDialog.getByRole("combobox", { name: /Buscar código de país/ }).first().focus();
  await page.getByRole("listbox", { name: "Países y códigos telefónicos" }).waitFor();
  await dragScrollThumb(page, "Desplazar países", 40);
  const afterDown = await optionsScrollTop(page);
  assert.ok(afterDown > 100, `scrollTop=${afterDown}`);
  await dragScrollThumb(page, "Desplazar países", -20);
  assert.ok(await optionsScrollTop(page) < afterDown);
  assert.equal(await page.getByRole("listbox", { name: "Países y códigos telefónicos" }).isVisible(), true);
});

for (const theme of ["light", "dark"]) {
  test(`responsive (${theme}): sin desborde de página; tabla, modal y listado dentro del viewport`, async (context) => {
    const backend = createBackend([denomination(1, 1, "de recorrido comercial con un nombre bastante largo para probar el truncado")]);
    const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades", theme, viewport: { width: 375, height: 812 } });
    await page.getByText("UNID-001", { exact: true }).waitFor();
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const scroller = document.querySelector("main > div > .overflow-y-auto");
        const tabs = document.querySelector('[role="tablist"][aria-label="Secciones de servicios y cotizaciones"]');
        const table = document.querySelector("table").closest(".overflow-x-auto");
        return {
          page: Math.max(scroller.scrollWidth - scroller.clientWidth, document.documentElement.scrollWidth - window.innerWidth),
          tabsInside: tabs.getBoundingClientRect().right <= scroller.getBoundingClientRect().right + 0.5,
          tableInside: table.getBoundingClientRect().right <= scroller.getBoundingClientRect().right + 0.5,
        };
      });
      assert.deepEqual(layout, { page: 0, tabsInside: true, tableInside: true }, `desborde a ${width} px`);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: "Añadir unidad" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva unidad de medida" });
    await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.textContent?.includes("m²"));
    await dialog.getByRole("combobox").click();
    const geometry = await page.evaluate(() => {
      const rect = (element) => element.getBoundingClientRect();
      const dialogRect = rect(document.querySelector("[data-measurement-unit-form]"));
      const listRect = rect(document.querySelector('[role="listbox"]'));
      const segment = rect(document.querySelector('[data-measurement-unit-form] [role="combobox"]'));
      const field = rect(document.querySelector("[data-measurement-unit-form] [data-input-shell]"));
      return {
        dialogInside: dialogRect.left >= 0 && dialogRect.right <= window.innerWidth,
        listInside: listRect.top >= 0 && listRect.bottom <= window.innerHeight && listRect.right <= window.innerWidth,
        // Extensión del segmento m² (no del campo): borde izquierdo y ancho mínimo del segmento.
        listAnchored: Math.abs(listRect.left - (segment.left - 1)) < 0.5 && listRect.width >= segment.width + 0.5,
        notFieldWidth: listRect.width < field.width - 1,
      };
    });
    assert.deepEqual(geometry, { dialogInside: true, listInside: true, listAnchored: true, notFieldWidth: true });

    // Poco espacio vertical: el listado se reubica (abajo o arriba) sin salir del viewport ni
    // quedar por detrás del modal.
    await page.setViewportSize({ width: 1024, height: 360 });
    await page.waitForFunction(() => {
      const list = document.querySelector('[role="listbox"]')?.getBoundingClientRect();
      const segment = document.querySelector('[data-measurement-unit-form] [role="combobox"]')?.getBoundingClientRect();
      return list && segment && Math.abs(list.left - (segment.left - 1)) < 0.5 && list.top >= 0 && list.bottom <= window.innerHeight;
    });
    const stacking = await page.evaluate(() => {
      const list = document.querySelector('[role="listbox"]');
      const rect = list.getBoundingClientRect();
      const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 20);
      return list.contains(topElement);
    });
    assert.equal(stacking, true, "El listado queda por encima del modal y su overlay");
  });
}
