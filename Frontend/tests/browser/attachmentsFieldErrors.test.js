import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";

import { applyBrowserTimeouts } from "../helpers/browserTimeouts.js";

// Errores de adjuntos de la solicitud: el motivo de un archivo concreto va en su tarjeta y la
// navegación enfoca su «Eliminar archivo …»; los errores de la sección van bajo la zona de carga,
// junto a «Elige un archivo». Caso de origen: 375 × 667 px con 11 archivos.

const MOBILE = { height: 667, width: 375 };
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

/** Registra cada desplazamiento programático con su contenedor y su `behavior`. */
function recordScrollCalls() {
  window.__scrollCalls = [];
  const original = Element.prototype.scrollTo;
  Element.prototype.scrollTo = function scrollTo(...args) {
    const target = this === document.scrollingElement ? "document" : this.id || this.tagName;
    window.__scrollCalls.push({ behavior: args[0]?.behavior ?? null, target });
    return original.apply(this, args);
  };
}

/**
 * Abre el arnés del campo real en un contexto aislado.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @param {Object} [options] - Variante, borrador en curso, viewport y movimiento.
 * @returns {Promise<import("playwright").Page>} Página lista.
 */
async function openField(context, { draft = false, layout = "page", reducedMotion = "reduce", viewport = MOBILE } = {}) {
  const session = await browser.newContext({ reducedMotion, viewport });
  const page = applyBrowserTimeouts(await session.newPage());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(recordScrollCalls);
  context.after(async () => {
    await session.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(`${origin}/tests/browser/fixtures/attachments-field.html?layout=${layout}&draft=${draft ? 1 : 0}`);
  await page.getByRole("button", { name: "Elige un archivo" }).waitFor();
  return page;
}

const png = (name) => ({ buffer: Buffer.from(`fake-${name}`), mimeType: "image/png", name });
const txt = (name) => ({ buffer: Buffer.from("texto"), mimeType: "text/plain", name });

/**
 * Lista de `count` imágenes válidas con archivos de texto (formato no permitido) en `invalidAt`.
 *
 * @param {number} count - Archivos.
 * @param {number[]} [invalidAt] - Posiciones inválidas.
 * @returns {Array<Object>} Archivos para setInputFiles.
 */
function fileList(count, invalidAt = []) {
  return Array.from({ length: count }, (_, index) => (invalidAt.includes(index) ? txt(`notas-${index + 1}.txt`) : png(`vista-${index + 1}.png`)));
}

/** Adjunta archivos con el input real y vuelve al inicio, con el campo fuera de la pantalla. */
async function attach(page, files) {
  await page.locator('input[type="file"]').setInputFiles(files);
  await page.evaluate(() => {
    // Instantáneo: con movimiento suave la página anima también este desplazamiento previo.
    window.scrollTo({ behavior: "instant", top: 0 });
    document.getElementById("attachments-form")?.scrollTo({ behavior: "instant", top: 0 });
  });
  await page.evaluate(() => { window.__scrollCalls = []; });
}

/**
 * Pulsa Enviar y espera a que el foco llegue al campo y el desplazamiento termine.
 *
 * @param {import("playwright").Page} page - Página.
 * @param {{viaKeyboardlessSubmit?: boolean}} [options] - Envía con requestSubmit en lugar del clic.
 * @returns {Promise<void>}
 */
async function submitAndWait(page, { viaKeyboardlessSubmit = false } = {}) {
  // requestSubmit evita que Playwright desplace antes la página hasta «Enviar» (con movimiento
  // suave esa animación seguiría en curso al medir la navegación).
  if (viaKeyboardlessSubmit) await page.evaluate(() => document.getElementById("attachments-form").requestSubmit());
  else await page.getByRole("button", { exact: true, name: "Enviar" }).click();
  await page.waitForFunction(() => document.activeElement?.closest("[role='group'][aria-invalid='true']") !== null);
  await page.evaluate(() => new Promise((resolve) => {
    const position = () => `${window.scrollY}:${document.getElementById("attachments-form")?.scrollTop ?? 0}`;
    let last = position();
    let stable = 0;
    const check = () => {
      stable = position() === last ? stable + 1 : 0;
      last = position();
      if (stable >= 5) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }));
}

/**
 * Foco y visibilidad: nombre accesible del control enfocado, sus mensajes (aria-describedby), los
 * del grupo, y si control y mensajes se ven a la vez en el viewport y en el área del formulario.
 *
 * @param {import("playwright").Page} page - Página.
 * @returns {Promise<Object>} Estado.
 */
function focusState(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    const form = document.getElementById("attachments-form");
    const areas = [{ bottom: window.innerHeight, top: 0 }];
    if (getComputedStyle(form).overflowY === "auto") areas.push(form.getBoundingClientRect());
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      return areas.every((area) => rect.top >= area.top - 1 && rect.bottom <= area.bottom + 1);
    };
    const described = (node) => (node?.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id));
    const group = element.closest("[role='group']");
    // El tooltip del botón de icono también describe el control; no es un mensaje de validación.
    const ownMessages = described(element).filter((node) => node.getAttribute("role") !== "tooltip" && !node.closest("[role='tooltip']"));
    return {
      cards: document.querySelectorAll("[id*='-file-'][id$='-remove']").length,
      groupControls: group?.getAttribute("data-invalid-field-control")?.split(" ").length ?? 0,
      groupMessages: described(group).map((node) => node.textContent.trim()),
      label: element.getAttribute("aria-label") || element.textContent.trim(),
      messages: ownMessages.map((node) => node.textContent.trim()),
      pageScroll: document.scrollingElement.scrollTop,
      visible: visible(element) && ownMessages.every(visible) && described(group).every((node) => !element.matches("[aria-label^='Elige'], button:not([aria-label])") || visible(node)),
    };
  });
}

test("375 × 667 con 11 archivos (error de la sección): enfoca «Elige un archivo» y el motivo se ve a la vez", async (context) => {
  const page = await openField(context);
  await attach(page, fileList(11));
  await submitAndWait(page);
  const state = await focusState(page);
  assert.equal(state.label, "Elige un archivo", "Error general: no se enfoca un «Eliminar» arbitrario");
  assert.deepEqual(state.groupMessages, ["Puedes adjuntar un máximo de 10 archivos."]);
  const both = await page.evaluate(() => {
    const inView = (node) => { const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= window.innerHeight; };
    const group = document.activeElement.closest("[role='group']");
    return inView(document.activeElement) && inView(document.getElementById(group.getAttribute("aria-describedby")));
  });
  assert.equal(both, true, "Control y motivo visibles simultáneamente");
  assert.equal(await page.locator("[data-file-upload-card-invalid]").count(), 0, "Ninguna tarjeta se marca");
  assert.equal(await page.locator("[data-file-count]").innerText(), "11 archivos", "No se quita nada");
});

for (const [label, invalidAt] of [["primero", [0]], ["en medio", [5]], ["último", [9]]]) {
  test(`375 × 667, archivo inválido ${label}: enfoca su «Eliminar archivo» con el motivo junto a la tarjeta`, async (context) => {
    const page = await openField(context);
    await attach(page, fileList(10, invalidAt));
    await submitAndWait(page);
    const state = await focusState(page);
    const name = `notas-${invalidAt[0] + 1}.txt`;
    assert.equal(state.label, `Eliminar archivo ${name}`);
    assert.deepEqual(state.messages, [`${name}: formato no permitido.`]);
    assert.equal(state.visible, true, "Botón y motivo visibles a la vez");
    assert.deepEqual(state.groupMessages, [], "Sin errores de sección");
    assert.equal(await page.locator("[data-file-count]").innerText(), "10 archivos", "Enfocar no elimina");
    // El motivo está en la tarjeta del archivo, no al final de la lista.
    const card = page.locator("[data-file-upload-card-invalid]");
    assert.equal(await card.count(), 1);
    assert.equal(await card.getByText(name.replace(/\.txt$/, ""), { exact: true }).count(), 1);
  });
}

test("varios archivos inválidos: cada tarjeta muestra su motivo y se enfoca el primero de la lista", async (context) => {
  const page = await openField(context);
  await attach(page, fileList(10, [3, 7]));
  await submitAndWait(page);
  const state = await focusState(page);
  assert.equal(state.label, "Eliminar archivo notas-4.txt");
  assert.equal(state.visible, true);
  assert.equal(state.groupControls, 2, "Ambos botones son destinos, en orden");
  assert.deepEqual(await page.locator("[data-file-upload-card-invalid] [role='alert']").allInnerTexts(), ["notas-4.txt: formato no permitido.", "notas-8.txt: formato no permitido."]);
  // Sin anuncios duplicados: cada motivo aparece una sola vez como alerta.
  const alerts = await page.getByRole("alert").allInnerTexts();
  assert.equal(new Set(alerts).size, alerts.length);
});

test("errores de archivo y de sección a la vez: prima el archivo concreto y su motivo queda visible", async (context) => {
  const page = await openField(context);
  await attach(page, fileList(11, [8]));
  await submitAndWait(page);
  const state = await focusState(page);
  assert.equal(state.label, "Eliminar archivo notas-9.txt");
  assert.equal(state.visible, true);
  assert.deepEqual(state.groupMessages, ["Puedes adjuntar un máximo de 10 archivos."], "El general sigue bajo la zona de carga");
});

test("teclado: quitar el archivo inválido con Enter conserva los válidos, mueve el foco a la tarjeta siguiente y permite enviar", async (context) => {
  const page = await openField(context);
  await attach(page, fileList(10, [5]));
  await submitAndWait(page);
  assert.equal((await focusState(page)).label, "Eliminar archivo notas-6.txt");

  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Eliminar archivo vista-7.png");
  assert.equal(await page.locator("[data-file-count]").innerText(), "9 archivos", "Solo se quitó el inválido");
  assert.equal(await page.getByRole("group", { name: "Subir imágenes / archivos (opcional)" }).getAttribute("aria-invalid"), null);
  assert.equal(await page.locator("[data-file-upload-card-invalid]").count(), 0);
  assert.equal(await page.getByRole("alert").count(), 0, "El motivo desaparece al corregirlo");

  // Tab recorre los demás botones, identificados por su archivo.
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Eliminar archivo vista-8.png");

  await page.evaluate(() => { window.__scrollCalls = []; });
  await page.getByRole("button", { exact: true, name: "Enviar" }).click();
  await page.waitForFunction(() => window.attachmentsHarness.submissions === 1);
  assert.deepEqual(await page.evaluate(() => window.__scrollCalls), [], "Sin errores no hay desplazamiento");
});

test("quitar el último archivo lleva el foco al anterior; sin tarjetas, a «Elige un archivo»", async (context) => {
  const page = await openField(context);
  await attach(page, [png("a.png"), txt("b.txt")]);
  await submitAndWait(page);
  assert.equal((await focusState(page)).label, "Eliminar archivo b.txt");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Eliminar archivo a.png");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.textContent.trim() === "Elige un archivo");
  assert.equal(await page.locator("[data-file-count]").innerText(), "0 archivos");
});

test("selección rechazada que no llega a la lista: el motivo se muestra bajo la zona de carga y describe el grupo", async (context) => {
  const page = await openField(context, { draft: true, viewport: { height: 900, width: 1280 } });
  await page.locator('input[type="file"]').setInputFiles([png("fachada.png")]);
  const group = page.getByRole("group", { name: "Subir imágenes / archivos (opcional)" });
  await page.getByText("Ya existe un borrador en proceso. Reintenta el envío antes de cambiar los archivos.").waitFor();
  assert.equal(await group.getAttribute("aria-invalid"), "true");
  assert.equal(await group.getAttribute("data-invalid-field-control"), null, "Sin tarjeta a la que dirigir el foco");
  assert.equal(await page.locator("[data-file-count]").innerText(), "0 archivos");
  const placement = await page.evaluate(() => {
    const message = document.getElementById(document.querySelector("[role='group']").getAttribute("aria-describedby"));
    const choose = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === "Elige un archivo");
    return message.getBoundingClientRect().top - choose.getBoundingClientRect().bottom;
  });
  assert.equal(placement > 0 && placement < 120, true, "Junto al control de carga");
});

test("modal con scroll interno: enfoca el archivo afectado dentro del formulario sin mover la página", async (context) => {
  const page = await openField(context, { layout: "modal" });
  await page.getByRole("dialog", { name: "Adjuntos en modal" }).waitFor();
  await attach(page, fileList(10, [6]));
  await submitAndWait(page);
  const state = await focusState(page);
  assert.equal(state.label, "Eliminar archivo notas-7.txt");
  assert.equal(state.visible, true, "Visible en el área desplazable del modal");
  assert.equal(state.pageScroll, 0, "La página bajo el modal no se mueve");
  const targets = await page.evaluate(() => window.__scrollCalls.map((call) => call.target));
  assert.deepEqual(targets, ["attachments-form"]);
});

test("movimiento: suave por defecto e inmediato con prefers-reduced-motion", async (context) => {
  for (const [reducedMotion, behavior] of [["no-preference", "smooth"], ["reduce", "auto"]]) {
    const page = await openField(context, { reducedMotion });
    await attach(page, fileList(10, [9]));
    await submitAndWait(page, { viaKeyboardlessSubmit: true });
    assert.deepEqual(await page.evaluate(() => window.__scrollCalls.map((call) => call.behavior)), [behavior]);
    assert.equal((await focusState(page)).visible, true, `${reducedMotion}: botón y motivo visibles`);
  }
});

test("sin errores: tarjetas, nombres y envío no cambian salvo el nombre accesible con el archivo", async (context) => {
  const page = await openField(context, { viewport: { height: 900, width: 1280 } });
  await attach(page, [png("fachada.png"), png("terraza.png")]);
  assert.equal(await page.getByRole("group", { name: "Subir imágenes / archivos (opcional)" }).getAttribute("aria-invalid"), null);
  assert.equal(await page.locator("[data-file-upload-card-invalid]").count(), 0);
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.deepEqual(await page.getByRole("button", { name: /^Eliminar archivo/ }).evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("aria-label"), node.getAttribute("aria-describedby")])),
    [["Eliminar archivo fachada.png", null], ["Eliminar archivo terraza.png", null]]);
  await page.getByRole("button", { exact: true, name: "Enviar" }).click();
  await page.waitForFunction(() => window.attachmentsHarness.submissions === 1);
  assert.deepEqual(await page.evaluate(() => window.__scrollCalls), []);
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Enviar");
});
