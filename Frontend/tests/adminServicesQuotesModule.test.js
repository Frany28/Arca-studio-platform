import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { measurementUnitsApi } from "../src/api/measurementUnitsApi.js";
import { serviceCatalogApi } from "../src/api/serviceCatalogApi.js";
import {
  getInputOptionClassName,
  getInputOptionsViewportHeight,
} from "../src/components/ui/Input/options/inputOptionsConfig.js";
import {
  findPrefixOptionIndex,
  getPrefixSelectPanelHeight,
  getPrefixSelectPosition,
} from "../src/components/ui/Input/prefix/prefixSelectPosition.js";
import { getMeasurementUnitErrorFeedback } from "../src/pages/admin-services-quotes/measurement-units/utils/measurementUnitErrors.js";
import {
  getInUseReason,
  normalizeDenominationText,
  previewUnitLabel,
  toBaseUnitOptions,
  validateDenominationText,
} from "../src/pages/admin-services-quotes/measurement-units/utils/measurementUnitPresentation.js";
import {
  SERVICES_QUOTES_DEFAULT_TAB_SLUG,
  SERVICES_QUOTES_TABS,
  getServicesQuotesTabIndex,
  getServicesQuotesTabPath,
} from "../src/pages/admin-services-quotes/utils/servicesQuotesTabs.js";

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

/**
 * Sustituye fetch durante una prueba y registra cada petición; responde con el payload indicado.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria del mock.
 * @param {(request: {url: string, init: Object}) => {status?: number, body: Object}} respond - Respuesta.
 * @returns {Array<{url: string, init: Object}>} Peticiones registradas.
 */
function mockFetch(context, respond) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    calls.push(request);
    const { status = 200, body } = respond(request);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  context.after(() => { globalThis.fetch = original; });
  return calls;
}

test("pestañas: orden de Figma, subrutas coherentes y pestaña activa derivada de la URL", () => {
  assert.deepEqual(SERVICES_QUOTES_TABS.map(({ label }) => label), ["Cotizaciones", "Tabulador de servicios", "Unidades"]);
  assert.deepEqual(SERVICES_QUOTES_TABS.map(({ slug }) => getServicesQuotesTabPath(slug)), [
    "/servicios-cotizaciones/cotizaciones",
    "/servicios-cotizaciones/tabulador",
    "/servicios-cotizaciones/unidades",
  ]);
  assert.equal(SERVICES_QUOTES_DEFAULT_TAB_SLUG, "unidades");
  assert.equal(getServicesQuotesTabIndex("/servicios-cotizaciones/unidades"), 2);
  assert.equal(getServicesQuotesTabIndex("/servicios-cotizaciones/tabulador/detalle"), 1);
  assert.equal(getServicesQuotesTabIndex("/servicios-cotizaciones"), -1);
  assert.equal(getServicesQuotesTabIndex("/servicios-cotizaciones/otra"), -1);
  assert.equal(getServicesQuotesTabIndex("/archivos"), -1);
});

test("presentación: normaliza y valida como el contrato y previsualiza la etiqueta de la API", () => {
  assert.equal(normalizeDenominationText("  de   construcción "), "de construcción");
  assert.equal(validateDenominationText("   "), "Escribe el nombre de la unidad.");
  assert.equal(validateDenominationText("a".repeat(81)), "Admite como máximo 80 caracteres.");
  assert.equal(validateDenominationText(` ${"a".repeat(80)}  `), "");
  assert.equal(validateDenominationText("a\u0007b"), "No admite caracteres de control.");
  assert.equal(previewUnitLabel("m²", " de  construcción"), "m² de construcción");
  assert.equal(previewUnitLabel("m²", ""), "");
  assert.deepEqual(toBaseUnitOptions([{ id: 1, symbol: "m²", name: "Metro cuadrado", code: "square_meter" }]), [
    { id: 1, label: "m²", description: "Metro cuadrado" },
  ]);
  assert.deepEqual(toBaseUnitOptions(null), []);
  assert.equal(getInUseReason({ activeServiceCount: 0 }), "");
  assert.equal(getInUseReason({ activeServiceCount: 1 }), "En uso por 1 servicio activo");
  assert.equal(getInUseReason({ activeServiceCount: 3 }), "En uso por 3 servicios activos");
});

test("errores: 400 por campo, duplicado sobre el texto, 401/403/404/429 comprensibles y 409 del backend", () => {
  const validation = getMeasurementUnitErrorFeedback({ status: 400, code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos.", fields: { "body.measurementUnitId": "La unidad de medida está inactiva." } }, "x");
  assert.deepEqual(validation.fieldErrors, { measurementUnitId: "La unidad de medida está inactiva." });
  assert.equal(validation.message, "Revisa los datos marcados.");

  const duplicate = getMeasurementUnitErrorFeedback({ status: 409, code: "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS", message: "Ya existe una denominación equivalente para esa unidad de medida." }, "x");
  assert.deepEqual(duplicate.fieldErrors, { denomination: "Ya existe una denominación equivalente para esa unidad de medida." });

  const inUse = getMeasurementUnitErrorFeedback({ status: 409, code: "MEASUREMENT_UNIT_IN_USE", message: "La denominación está asignada a 2 servicio(s) activo(s)." }, "x");
  assert.equal(inUse.message, "La denominación está asignada a 2 servicio(s) activo(s).");
  assert.deepEqual(inUse.fieldErrors, {});

  assert.match(getMeasurementUnitErrorFeedback({ status: 401, code: "UNAUTHENTICATED", message: "Sesión requerida." }, "x").message, /sesión expiró/);
  assert.match(getMeasurementUnitErrorFeedback({ status: 403, code: "FORBIDDEN", message: "No" }, "x").message, /permisos/);
  const missing = getMeasurementUnitErrorFeedback({ status: 404, code: "MEASUREMENT_UNIT_DENOMINATION_NOT_FOUND", message: "No existe" }, "x");
  assert.equal(missing.shouldReload, true);
  assert.match(getMeasurementUnitErrorFeedback({ status: 429, code: "RATE_LIMITED", message: "Too many" }, "x").message, /demasiados cambios/);
  // Mensajes técnicos o vacíos usan el fallback; nunca se muestran textos internos.
  assert.equal(getMeasurementUnitErrorFeedback({ status: 500, message: "Internal Server Error" }, "No se pudo crear la unidad.").message, "No se pudo crear la unidad.");
});

test("selector de prefijo: tres filas como el telefónico, se abre hacia arriba si no cabe y busca por letras", () => {
  assert.equal(getPrefixSelectPanelHeight(48), 3 * 35 + 2 * 4 + 16);
  assert.equal(getInputOptionsViewportHeight(48), 113, "Misma área desplazable que el selector telefónico");
  assert.equal(getInputOptionsViewportHeight(2), 74);
  const row = getInputOptionClassName({ selected: true, columns: "grid-cols-[48px_minmax(0,1fr)]" });
  assert.match(row, /h-\[35px\]/);
  assert.match(row, /bg-\[var\(--color-neutral-200\)\]/);
  assert.doesNotMatch(row, /hover:/, "La opción seleccionada no cambia con hover");
  assert.match(getInputOptionClassName({ selected: false, highlighted: true, columns: "" }), /ring-2 ring-\[var\(--color-primary-10\)\]/);
  assert.doesNotMatch(getInputOptionClassName({ selected: false, disabled: true, columns: "" }), /hover:/);
  assert.equal(getPrefixSelectPanelHeight(1), 35 + 16);
  // Anclado al segmento selector (62 px) como el prefijo telefónico: 1 px a la izquierda, unido a
  // su borde y con al menos su ancho + 1 px; el contenido decide el resto hasta el viewport.
  const segment = { top: 600, bottom: 640, left: 20, width: 62 };
  assert.deepEqual(getPrefixSelectPosition(segment, 129, { width: 1440, height: 1000 }), { left: 19, top: 640, minWidth: 63, maxWidth: 1413, placement: "bottom" });
  assert.deepEqual(getPrefixSelectPosition(segment, 129, { width: 375, height: 700 }), { left: 19, top: 471, minWidth: 63, maxWidth: 348, placement: "top" });
  // Un viewport mínimo nunca deja el panel más estrecho que el segmento.
  assert.equal(getPrefixSelectPosition({ ...segment, left: 300 }, 129, { width: 320, height: 1000 }).maxWidth, 63);
  const options = [{ label: "m²", description: "Metro cuadrado" }, { label: "m.l.", description: "Metro lineal" }, { label: "hrs", description: "Hora" }];
  assert.equal(findPrefixOptionIndex(options, "m", 0), 1);
  assert.equal(findPrefixOptionIndex(options, "m", 1), 0);
  assert.equal(findPrefixOptionIndex(options, "ho", -1), 2);
  assert.equal(findPrefixOptionIndex(options, "z", 0), -1);
});

test("API de unidades: rutas, consultas sin valores vacíos y cuerpos del contrato (sin publicCode)", async (context) => {
  const calls = mockFetch(context, () => ({ body: { unitDenominations: [], nextCursor: null, measurementUnits: [] } }));
  await measurementUnitsApi.listBaseUnits();
  await measurementUnitsApi.listDenominations({ cursor: "abc", limit: 10, search: "UNID-001" });
  await measurementUnitsApi.listDenominations({ limit: 10, search: "" });
  await measurementUnitsApi.createDenomination({ denomination: "de construcción", measurementUnitId: 1 });
  await measurementUnitsApi.updateDenomination({ denomination: "de obra", denominationId: 7 });
  await measurementUnitsApi.changeDenominationStatus({ denominationId: 7, isActive: false });

  assert.deepEqual(calls.map(({ url, init }) => [init.method || "GET", url.replace(/^.*\/api/, "")]), [
    ["GET", "/admin/measurement-units"],
    ["GET", "/admin/measurement-unit-denominations?cursor=abc&limit=10&search=UNID-001"],
    ["GET", "/admin/measurement-unit-denominations?limit=10"],
    ["POST", "/admin/measurement-unit-denominations"],
    ["PATCH", "/admin/measurement-unit-denominations/7"],
    ["PATCH", "/admin/measurement-unit-denominations/7/status"],
  ]);
  assert.deepEqual(JSON.parse(calls[3].init.body), { denomination: "de construcción", measurementUnitId: 1 });
  assert.deepEqual(JSON.parse(calls[4].init.body), { denomination: "de obra" });
  assert.deepEqual(JSON.parse(calls[5].init.body), { isActive: false });
  assert.ok(calls.every(({ init }) => init.credentials === "include"));
});

test("API de unidades: los errores conservan status, code y fields del backend", async (context) => {
  mockFetch(context, () => ({ status: 409, body: { code: "MEASUREMENT_UNIT_IN_USE", message: "En uso." } }));
  await assert.rejects(measurementUnitsApi.changeDenominationStatus({ denominationId: 1, isActive: false }), { status: 409, code: "MEASUREMENT_UNIT_IN_USE", message: "En uso." });
});

test("catálogo de servicios: recorre todas las páginas por cursor sin duplicados", async (context) => {
  const pages = {
    "": { services: [{ id: 1, isActive: true }, { id: 2, isActive: false }], nextCursor: "c2" },
    c2: { services: [{ id: 2, isActive: false }, { id: 3, isActive: true }], nextCursor: null },
  };
  const calls = mockFetch(context, ({ url }) => ({ body: pages[new URL(url, "http://local").searchParams.get("cursor") || ""] }));
  const { services } = await serviceCatalogApi.listAllServices();
  assert.deepEqual(services.map(({ id }) => id), [1, 2, 3]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ url }) => url.includes("limit=100")));
});

test("estructura: módulo separado por responsabilidad y componentes compartidos reutilizados", async () => {
  const [panel, table, form, menu, api, input, loader] = await Promise.all([
    source("pages/admin-services-quotes/measurement-units/MeasurementUnitsPanel.jsx"),
    source("pages/admin-services-quotes/measurement-units/components/MeasurementUnitsTable.jsx"),
    source("pages/admin-services-quotes/measurement-units/components/MeasurementUnitFormModal.jsx"),
    source("pages/admin-services-quotes/components/ServicesQuotesTabMenu.jsx"),
    source("api/http.js"),
    source("components/ui/Input/Input.jsx"),
    source("components/ui/Loader/Loader.jsx"),
  ]);
  assert.match(api, /measurementUnits: measurementUnitsApi/);
  assert.match(api, /serviceCatalog: serviceCatalogApi/);
  assert.match(menu, /<HorizontalTabMenu[\s\S]*style="Underlined"/);
  assert.match(table, /<ActionMenu/);
  assert.match(table, /theme="Brand 2"/);
  assert.match(form, /type="Prefix select"/);
  assert.match(form, /useDialogKeyboard/);
  assert.match(panel, /preset="measurementUnitTable"/);
  assert.match(loader, /preset === "measurementUnitTable"/);
  assert.match(input, /resolvedType === "Prefix select"/);
  // Las capas de UI no hacen peticiones directas.
  for (const file of [panel, table, form, menu]) assert.doesNotMatch(file, /fetch\(|apiRequest\(/);
});
