import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";

import { applyBrowserTimeouts } from "../helpers/browserTimeouts.js";

// Navegación al primer campo inválido (useInvalidFieldFocus + invalidFieldNavigation) con los
// componentes compartidos reales: página, modal, panel con scroll interno y formulario por pasos.

const DESKTOP = { height: 900, width: 1440 };
const VIEWPORTS = [
  { height: 667, label: "móvil", width: 375 },
  { height: 1024, label: "tablet", width: 768 },
  { ...DESKTOP, label: "escritorio" },
];
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), cacheDir: getBrowserTestCacheDir(import.meta.url),
    configFile: false,
    envDir: false,
    plugins: [react(), tailwindcss()],
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
 * Registra en la página cada desplazamiento programático (contenedor y `behavior`) para comprobar
 * que solo se desplaza lo necesario y una sola vez.
 *
 * @returns {void}
 */
function recordScrollCalls() {
  window.__scrollCalls = [];
  const describe = (target) => {
    if (target === window || target === document.scrollingElement || target === document.documentElement) return "document";
    if (target.matches?.("[data-scroll-panel]")) return "panel";
    return target.id || target.tagName;
  };
  const record = (target, options) => window.__scrollCalls.push({ behavior: options?.behavior ?? null, target: describe(target) });
  const elementScrollTo = Element.prototype.scrollTo;
  Element.prototype.scrollTo = function scrollTo(...args) {
    record(this, args[0]);
    return elementScrollTo.apply(this, args);
  };
  const windowScrollTo = window.scrollTo;
  window.scrollTo = function scrollTo(...args) {
    record(window, args[0]);
    return windowScrollTo.apply(this, args);
  };
  const scrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function patchedScrollIntoView(...args) {
    window.__scrollCalls.push({ behavior: args[0]?.behavior ?? null, target: `scrollIntoView:${this.id || this.tagName}` });
    return scrollIntoView.apply(this, args);
  };
}

/**
 * Abre el arnés en un contexto aislado y vigila errores de página.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {Object} [options] - Variante, backend simulado, viewport, movimiento reducido y error de lista.
 * @returns {Promise<import("playwright").Page>} Página lista.
 */
async function openHarness(context, { layout = "page", list = false, reducedMotion = "reduce", serverMode = "ok", viewport = DESKTOP } = {}) {
  const session = await browser.newContext({ reducedMotion, viewport });
  const page = applyBrowserTimeouts(await session.newPage());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(recordScrollCalls);
  context.after(async () => {
    await session.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(`${origin}/tests/browser/fixtures/invalid-field-focus.html?layout=${layout}&server=${serverMode}&list=${list ? 1 : 0}`);
  await page.locator("#harness-name").waitFor();
  return page;
}

/** Desplazamientos programáticos registrados, sin los que no afectan a la navegación. */
const scrollCalls = (page) => page.evaluate(() => window.__scrollCalls.filter((call) => ["document", "panel", "harness-modal-form"].includes(call.target) || call.target.startsWith("scrollIntoView")));
const resetScrollCalls = (page) => page.evaluate(() => { window.__scrollCalls = []; });

/**
 * Rellena los campos locales; `skip` deja vacíos los indicados.
 *
 * @param {import("playwright").Page} page - Página.
 * @param {string[]} [skip] - Campos sin rellenar.
 * @returns {Promise<void>}
 */
async function fillValid(page, skip = []) {
  if (!skip.includes("name")) await page.locator("#harness-name").fill("Casa Lago");
  if (!skip.includes("type")) {
    await page.getByRole("button", { exact: true, name: "Tipo" }).click();
    await page.getByRole("menuitem", { exact: true, name: "Residencial" }).click();
  }
  if (!skip.includes("city")) await page.locator("#harness-city").fill("Maracaibo");
  if (!skip.includes("notes")) await page.locator("#harness-notes").fill("Remodelación de cocina completa");
  if (!skip.includes("meeting")) await page.getByRole("button", { exact: true, name: "Presencial" }).click();
}

/**
 * Describe el elemento enfocado: identidad, invalidez, si se ve entero en el viewport y en su
 * contenedor desplazable, y si su mensaje (aria-describedby) también se ve.
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<Object>} Estado del foco.
 */
function focusedField(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    const inside = (rect, area) => rect.top >= area.top - 1 && rect.bottom <= area.bottom + 1 && rect.left >= area.left - 1 && rect.right <= area.right + 1;
    const viewport = { bottom: window.innerHeight, left: 0, right: window.innerWidth, top: 0 };
    const rect = element.getBoundingClientRect();
    let container = element.parentElement;
    while (container && !["auto", "scroll"].includes(getComputedStyle(container).overflowY)) container = container.parentElement;
    const containerArea = container ? container.getBoundingClientRect() : viewport;
    const messages = (element.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)).filter(Boolean);
    return {
      describedBy: messages.map((message) => message.textContent.trim()),
      expanded: element.getAttribute("aria-expanded"),
      focusVisible: element.matches(":focus-visible"),
      id: element.id || null,
      invalid: element.getAttribute("aria-invalid") ?? element.closest("[aria-invalid]")?.getAttribute("aria-invalid") ?? null,
      label: element.getAttribute("aria-label") || element.textContent.trim(),
      messagesVisible: messages.every((message) => inside(message.getBoundingClientRect(), viewport) && inside(message.getBoundingClientRect(), containerArea)),
      role: element.getAttribute("role"),
      tag: element.tagName,
      visible: inside(rect, viewport) && inside(rect, containerArea),
    };
  });
}

/**
 * Espera a que la navegación termine: el foco salió del botón de envío y la posición de scroll
 * se mantiene estable entre dos frames (con `behavior: smooth`, hasta que la animación acaba).
 *
 * @param {import("playwright").Page} page - Página.
 * @param {string} [expectedId] - Id esperado del elemento enfocado.
 * @returns {Promise<void>}
 */
async function waitForNavigation(page, expectedId) {
  await page.waitForFunction((id) => {
    const element = document.activeElement;
    return element && element.tagName !== "BODY" && (!id || element.id === id) && !/^(Guardar|Crear|Confirmar)$/.test(element.textContent.trim());
  }, expectedId);
  await page.evaluate(() => new Promise((resolve) => {
    const positions = () => [...document.querySelectorAll("*")].filter((node) => node.scrollTop).map((node) => node.scrollTop).join() + document.scrollingElement.scrollTop;
    let last = positions();
    let stableFrames = 0;
    const check = () => {
      const current = positions();
      stableFrames = current === last ? stableFrames + 1 : 0;
      last = current;
      if (stableFrames >= 5) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }));
}

/** Lleva la página al final para que el primer campo quede fuera de la pantalla. */
async function scrollToBottom(page) {
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
  await resetScrollCalls(page);
}

test("un único campo obligatorio vacío fuera de la pantalla: se desplaza, enfoca y conserva lo escrito", async (context) => {
  const page = await openHarness(context);
  await fillValid(page, ["name"]);
  await scrollToBottom(page);
  assert.equal(await page.locator("#harness-name").evaluate((element) => element.getBoundingClientRect().bottom < 0), true, "El campo empieza fuera de la pantalla");

  await page.getByRole("button", { exact: true, name: "Guardar" }).click();
  await waitForNavigation(page, "harness-name");
  const field = await focusedField(page);
  assert.equal(field.invalid, "true");
  assert.equal(field.visible, true, "El campo queda visible");
  assert.deepEqual(field.describedBy, ["Ingresa el nombre."], "El error está asociado al campo");
  assert.equal(field.messagesVisible, true, "El error bajo el campo queda visible");
  // Un único desplazamiento del documento: el foco usa preventScroll y no provoca otro.
  assert.deepEqual(await scrollCalls(page), [{ behavior: "auto", target: "document" }]);
  assert.equal(await page.locator("#harness-city").inputValue(), "Maracaibo", "Los datos se conservan");
  assert.equal(await page.locator("#harness-notes").inputValue(), "Remodelación de cocina completa");
  assert.equal(await page.evaluate(() => window.invalidFieldHarness.serverCalls), 0, "No se envía nada");
});

test("varios campos inválidos: gana el primero en orden visual y se ignoran los deshabilitados u ocultos", async (context) => {
  const page = await openHarness(context);
  await scrollToBottom(page);
  await page.getByRole("button", { exact: true, name: "Guardar" }).click();
  // El tipo va antes en el DOM, pero en escritorio se pinta en la segunda columna.
  await waitForNavigation(page, "harness-name");
  assert.equal(await page.locator("[aria-invalid='true']").count() >= 6, true, "Todos los errores siguen marcados");
  for (const message of ["Ingresa el nombre.", "Selecciona el tipo.", "Elige una ciudad de la lista.", "Escribe al menos 10 caracteres.", "Elige una opción de reunión."]) {
    await page.getByText(message, { exact: true }).waitFor();
  }
});

test("errores en select personalizado (DropdownMenu) y combobox: el foco va al control interactivo real", async (context) => {
  const page = await openHarness(context);
  await fillValid(page, ["type"]);
  await scrollToBottom(page);
  await page.getByRole("button", { exact: true, name: "Guardar" }).click();
  await waitForNavigation(page);
  let field = await focusedField(page);
  assert.equal(field.tag, "BUTTON", "Se enfoca el disparador del menú, no su contenedor");
  assert.equal(field.label, "Tipo");
  assert.equal(field.invalid, "true");
  assert.equal(field.expanded, "false", "Enfocar no abre el menú");
  assert.deepEqual(field.describedBy, ["Selecciona el tipo."]);
  assert.equal(field.visible && field.messagesVisible, true);
  assert.equal(field.focusVisible, true, "El foco es visible aunque el envío fuera con el ratón");

  // Elegir el tipo y vaciar la ciudad: el siguiente intento lleva al combobox.
  await page.getByRole("button", { exact: true, name: "Tipo" }).click();
  await page.getByRole("menuitem", { exact: true, name: "Comercial" }).click();
  await page.locator("#harness-city").fill("Valencia");
  await scrollToBottom(page);
  await page.getByRole("button", { exact: true, name: "Guardar" }).click();
  await waitForNavigation(page, "harness-city");
  field = await focusedField(page);
  assert.equal(field.role, "combobox");
  assert.deepEqual(field.describedBy, ["Elige una ciudad de la lista."]);
  assert.equal(field.visible && field.messagesVisible, true);
});

test("TextArea y grupo de opciones exponen aria-invalid y aria-describedby y reciben el foco", async (context) => {
  const page = await openHarness(context);
  await fillValid(page, ["notes", "meeting"]);
  await page.getByRole("button", { exact: true, name: "Guardar" }).click();
  await waitForNavigation(page, "harness-notes");
  const notes = await focusedField(page);
  assert.equal(notes.tag, "TEXTAREA");
  assert.equal(notes.invalid, "true");
  assert.deepEqual(notes.describedBy, ["Escribe al menos 10 caracteres."], "El error sigue visible con el foco");

  await page.locator("#harness-notes").fill("Remodelación completa");
  await page.getByRole("button", { exact: true, name: "Guardar" }).click();
  await waitForNavigation(page);
  const meeting = await focusedField(page);
  assert.equal(meeting.label, "Presencial", "Se enfoca la primera opción del grupo");
  assert.equal(meeting.invalid, "true");
  assert.equal(await page.getByRole("group", { name: "Reunión" }).getAttribute("aria-describedby") !== null, true);
});

test("corregir el primer error y reintentar lleva al siguiente; escribir no vuelve a navegar", async (context) => {
  const page = await openHarness(context);
  await page.getByRole("button", { exact: true, name: "Guardar" }).click();
  await waitForNavigation(page, "harness-name");
  await resetScrollCalls(page);

  await page.keyboard.type("Casa");
  assert.equal(await page.locator("#harness-name").inputValue(), "Casa");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => document.activeElement.id), "harness-name", "El foco sigue en el campo mientras se escribe");
  assert.deepEqual(await scrollCalls(page), [], "Escribir no desplaza");

  await scrollToBottom(page);
  await page.getByRole("button", { exact: true, name: "Guardar" }).click();
  await waitForNavigation(page);
  const field = await focusedField(page);
  assert.equal(field.label, "Tipo", "El siguiente error en orden visual");
  assert.equal(await page.locator("#harness-name").inputValue(), "Casa");
});

test("formulario válido: guarda sin desplazar ni mover el foco", async (context) => {
  const page = await openHarness(context);
  await fillValid(page);
  await scrollToBottom(page);
  const before = await page.evaluate(() => document.scrollingElement.scrollTop);
  await page.getByRole("button", { exact: true, name: "Guardar" }).click();
  await page.getByRole("status").getByText("Guardado").waitFor();
  assert.equal(await page.evaluate(() => window.invalidFieldHarness.submissions), 1);
  assert.deepEqual(await scrollCalls(page), []);
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), before);
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Guardar");
});

test("errores del backend por campo usan la misma navegación; los generales conservan su presentación", async (context) => {
  const page = await openHarness(context, { serverMode: "duplicate" });
  await fillValid(page);
  await page.locator("#harness-email").fill("ana@example.com");
  await page.evaluate(() => window.scrollTo(0, 0));
  await resetScrollCalls(page);
  await page.getByRole("button", { exact: true, name: "Guardar" }).click();
  await waitForNavigation(page, "harness-email");
  const field = await focusedField(page);
  assert.deepEqual(field.describedBy, ["Ese correo ya está registrado."]);
  assert.equal(field.visible && field.messagesVisible, true);
  assert.equal(await page.locator("#harness-name").inputValue(), "Casa Lago", "El borrador se conserva");

  // Corregido el campo, el reintento guarda.
  await page.locator("#harness-email").fill("ana.perez@example.com");
  await page.getByRole("button", { exact: true, name: "Guardar" }).click();
  await page.getByRole("status").getByText("Guardado").waitFor();

  const general = await openHarness(context, { serverMode: "general" });
  await fillValid(general);
  await scrollToBottom(general);
  await general.getByRole("button", { exact: true, name: "Guardar" }).click();
  await general.locator("[data-general-error]").waitFor();
  await general.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await general.evaluate(() => document.activeElement.textContent.trim()), "Guardar", "Sin campo asociado no se mueve el foco");
  assert.deepEqual(await scrollCalls(general), []);
});

test("modal: desplaza solo el formulario interno, nunca la página bloqueada", async (context) => {
  const page = await openHarness(context, { layout: "modal" });
  await page.getByRole("dialog", { name: "Formulario en modal" }).waitFor();
  await page.locator("#harness-modal-form").evaluate((form) => { form.scrollTop = form.scrollHeight; });
  await resetScrollCalls(page);
  await page.getByRole("button", { exact: true, name: "Crear" }).click();
  await waitForNavigation(page, "harness-name");
  const field = await focusedField(page);
  assert.equal(field.visible && field.messagesVisible, true);
  assert.deepEqual(await scrollCalls(page), [{ behavior: "auto", target: "harness-modal-form" }]);
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0, "La página bajo el modal no se mueve");
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest("[data-harness-dialog]"))), true, "El foco sigue dentro del diálogo");
});

test("panel con scroll interno dentro de una página desplazable: mueve el panel y lo justo de la página", async (context) => {
  const page = await openHarness(context, { layout: "panel" });
  await fillValid(page, ["name"]);
  await page.locator("[data-scroll-panel]").evaluate((panel) => { panel.scrollTop = panel.scrollHeight; });
  await page.getByRole("button", { exact: true, name: "Guardar" }).scrollIntoViewIfNeeded();
  await resetScrollCalls(page);
  await page.getByRole("button", { exact: true, name: "Guardar" }).click();
  await waitForNavigation(page, "harness-name");
  const field = await focusedField(page);
  assert.equal(field.visible && field.messagesVisible, true, "Visible en el panel y en el viewport");
  const targets = (await scrollCalls(page)).map((call) => call.target);
  assert.equal(targets[0], "panel", "Primero el contenedor más cercano");
  assert.equal(targets.filter((target) => target === "panel").length, 1);
  assert.equal(targets.filter((target) => target === "document").length <= 1, true);
});

test("formulario por pasos: un error del backend en un paso anterior lo muestra antes de enfocar", async (context) => {
  const page = await openHarness(context, { layout: "steps", serverMode: "duplicate" });
  await fillValid(page);
  await page.locator("#harness-email").fill("ana@example.com");
  await page.getByRole("button", { exact: true, name: "Siguiente" }).click();
  await page.getByRole("button", { exact: true, name: "Confirmar" }).click();
  await waitForNavigation(page, "harness-email");
  const field = await focusedField(page);
  assert.deepEqual(field.describedBy, ["Ese correo ya está registrado."]);
  assert.equal(await page.locator("#harness-name").inputValue(), "Casa Lago", "El paso vuelve con sus datos");
});

test("movimiento: suave por defecto e inmediato con prefers-reduced-motion", async (context) => {
  const smooth = await openHarness(context, { reducedMotion: "no-preference" });
  await scrollToBottom(smooth);
  await smooth.getByRole("button", { exact: true, name: "Guardar" }).click();
  await waitForNavigation(smooth, "harness-name");
  assert.deepEqual(await scrollCalls(smooth), [{ behavior: "smooth", target: "document" }]);
  assert.equal((await focusedField(smooth)).visible, true, "Tras la animación el campo queda visible");

  const reduced = await openHarness(context, { reducedMotion: "reduce" });
  await scrollToBottom(reduced);
  await reduced.getByRole("button", { exact: true, name: "Guardar" }).click();
  await waitForNavigation(reduced, "harness-name");
  assert.deepEqual(await scrollCalls(reduced), [{ behavior: "auto", target: "document" }]);
});

test("móvil, tablet y escritorio: el primer error en orden visual queda visible y enfocado", async (context) => {
  for (const viewport of VIEWPORTS) {
    const page = await openHarness(context, { viewport });
    await scrollToBottom(page);
    await page.getByRole("button", { exact: true, name: "Guardar" }).click();
    await waitForNavigation(page);
    const field = await focusedField(page);
    // En una columna (bajo 640 px) el tipo se pinta primero; con dos columnas, el nombre.
    const expected = viewport.width < 640 ? "Tipo" : "harness-name";
    assert.equal(field.id === expected || field.label === expected, true, `${viewport.label}: ${JSON.stringify(field)}`);
    assert.equal(field.visible && field.messagesVisible, true, `${viewport.label}: campo y error visibles`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${viewport.label}: sin scroll horizontal`);
  }
});

/**
 * Estado del error de lista: foco, visibilidad del control y del mensaje en el área del formulario
 * del modal, y desplazamiento de la página de fondo.
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<Object>} Estado.
 */
function listErrorState(page) {
  return page.evaluate(() => {
    const area = document.getElementById("harness-modal-form").getBoundingClientRect();
    const options = document.getElementById("harness-ref-options");
    const inside = (node, box) => { const rect = node.getBoundingClientRect(); return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1; };
    const element = document.activeElement;
    return {
      focused: element.id || element.textContent.trim(),
      messageVisible: inside(document.getElementById("harness-refs-error"), area),
      optionsScrollTop: options.scrollTop,
      pageScrollTop: document.scrollingElement.scrollTop,
      targetVisible: inside(element, area) && (!options.contains(element) || inside(element, options.getBoundingClientRect())),
    };
  });
}

test("error de lista en modal: enfoca su control en otro bloque con scroll propio, muestra el motivo y no mueve la página", async (context) => {
  const page = await openHarness(context, { layout: "modal", list: true });
  await page.getByRole("dialog", { name: "Formulario en modal" }).waitFor();
  await fillValid(page);
  await page.locator("#harness-ref-options").evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await page.locator("#harness-modal-form").evaluate((form) => { form.scrollTop = form.scrollHeight; });
  await resetScrollCalls(page);

  await page.getByRole("button", { exact: true, name: "Crear" }).click();
  await waitForNavigation(page);
  let state = await listErrorState(page);
  assert.equal(state.focused, "Añadir Plano", "La primera opción del selector");
  assert.equal(state.optionsScrollTop, 0, "El área de opciones se desplaza hasta ella");
  assert.equal(state.targetVisible && state.messageVisible, true, "Control y motivo visibles a la vez");
  assert.equal(state.pageScrollTop, 0, "La página bajo el modal no se mueve");
  assert.equal((await scrollCalls(page)).some((call) => call.target === "document"), false);
  const section = page.getByRole("region", { name: "Referencias añadidas" });
  assert.equal(await section.getAttribute("aria-invalid"), "true");
  assert.equal(await section.getAttribute("aria-describedby"), "harness-refs-error");

  // Sin opciones visibles, el siguiente control preferido es el buscador.
  await page.locator("#harness-ref-search").fill("zzz");
  await page.locator("#harness-modal-form").evaluate((form) => { form.scrollTop = form.scrollHeight; });
  await page.getByRole("button", { exact: true, name: "Crear" }).click();
  await waitForNavigation(page, "harness-ref-search");
  state = await listErrorState(page);
  assert.equal(state.targetVisible, true);
  assert.equal(await page.locator("#harness-ref-search").inputValue(), "zzz");

  // Añadir una referencia resuelve el error y el formulario se guarda.
  await page.locator("#harness-ref-search").fill("");
  await page.getByRole("button", { exact: true, name: "Añadir Fachada" }).click();
  await page.getByRole("button", { exact: true, name: "Crear" }).click();
  await page.getByRole("status").getByText("Guardado").waitFor();
});

test("error de lista con movimiento suave: el desplazamiento usa smooth y termina con control y motivo visibles", async (context) => {
  const page = await openHarness(context, { layout: "modal", list: true, reducedMotion: "no-preference" });
  await page.getByRole("dialog", { name: "Formulario en modal" }).waitFor();
  await fillValid(page);
  await page.locator("#harness-modal-form").evaluate((form) => { form.scrollTop = form.scrollHeight; });
  await resetScrollCalls(page);
  await page.getByRole("button", { exact: true, name: "Crear" }).click();
  await waitForNavigation(page);
  assert.deepEqual((await scrollCalls(page)).map((call) => call.behavior), ["smooth"]);
  const state = await listErrorState(page);
  assert.equal(state.targetVisible && state.messageVisible, true);
});
