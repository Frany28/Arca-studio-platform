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
    measurementUnit: unit,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Backend simulado: aplica búsqueda literal y paginación por cursor sobre un arreglo en memoria,
 * crea, edita y cambia estado como el contrato, y permite inyectar fallos por operación.
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
    if (path === "/api/admin/measurement-units") return json(route, 200, { measurementUnits: BASE_UNITS });

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
      else Object.assign(item, { denomination: body.denomination, label: `${item.measurementUnit.symbol} ${body.denomination}` });
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
  assert.equal(await listbox.getByRole("option", { selected: true }).textContent(), "m²Metro cuadrado");
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

test("edición: abreviatura bloqueada, PATCH solo con el texto y fila actualizada con la respuesta", async (context) => {
  const backend = createBackend([denomination(1, 1, "de construcción")]);
  const page = await openModule(context, backend, { path: "/servicios-cotizaciones/unidades" });
  await page.getByRole("button", { name: /Editar UNID-001/ }).click();
  const dialog = page.getByRole("dialog", { name: "Editar unidad de medida" });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("combobox").isDisabled(), true);
  await dialog.getByText("UNID-001 · La unidad base no se puede cambiar.").waitFor();
  const text = dialog.getByRole("textbox", { name: "Nombre de la unidad" });
  assert.equal(await text.inputValue(), "de construcción");
  await text.fill("de obra nueva");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("m² de obra nueva", { exact: true }).waitFor();
  const patch = backend.requests.find((request) => request.method === "PATCH");
  assert.equal(patch.path, "/api/admin/measurement-unit-denominations/1");
  assert.deepEqual(patch.body, { denomination: "de obra nueva" });
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
      const field = rect(document.querySelector("[data-measurement-unit-form] [data-input-shell]"));
      return {
        dialogInside: dialogRect.left >= 0 && dialogRect.right <= window.innerWidth,
        listInside: listRect.top >= 0 && listRect.bottom <= window.innerHeight,
        listAligned: Math.abs(listRect.left - field.left) < 1 && Math.abs(listRect.width - field.width) < 1,
      };
    });
    assert.deepEqual(geometry, { dialogInside: true, listInside: true, listAligned: true });
  });
}
