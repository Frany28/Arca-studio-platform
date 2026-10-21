import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

// Galería de imágenes del proyecto: el ScrollBar propio vive en el margen derecho del modal y
// debe verse entero, arrastrarse y acompañar la rueda y el teclado sin tapar las imágenes.
const DESKTOP = { width: 1440, height: 900 };
const NARROW = { width: 600, height: 800 };
const TABLET = { width: 768, height: 1024 };
const MOBILE = { width: 375, height: 740 };

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
 * Abre la galería del fixture en un contexto aislado con la sesión simulada y vigila errores
 * de la página y peticiones no previstas.
 *
 * @param {import("node:test").TestContext} context Contexto que cierra la sesión.
 * @param {object} options Escenario.
 * @param {{width: number, height: number}} options.viewport Tamaño de la ventana.
 * @param {number} [options.count=12] Imágenes de la galería.
 * @param {"light"|"dark"} [options.theme="light"] Tema.
 * @returns {Promise<import("playwright").Page>} Página con la galería abierta.
 */
async function openGallery(context, { count = 12, theme = "light", viewport }) {
  const session = await browser.newContext({ viewport });
  const page = applyBrowserTimeouts(await session.newPage());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") {
      await route.fulfill({ json: { user: { email: "visor@example.test", firstName: "Visor", id: 1, role: "architect", status: "active" } } });
      return;
    }
    errors.push(`HTTP inesperado: ${path}`);
    await route.fulfill({ json: { message: "Fixture no definida" }, status: 404 });
  });
  context.after(async () => {
    await session.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(`${origin}/tests/browser/fixtures/gallery-images-modal.html?count=${count}&theme=${theme}`);
  // El primer render forma parte de la carga en frío del fixture (compilación y optimización de
  // dependencias de Vite), no de la interacción probada: usa el límite de navegación.
  await page.getByRole("dialog", { name: "Galería de Imágenes" }).waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  // El ScrollBar se sincroniza en el siguiente frame tras abrir.
  await page.waitForFunction(() => document.querySelector('[role="dialog"] .overflow-y-auto')?.scrollHeight > 0);
  return page;
}

/**
 * Mide el ScrollBar, su pulgar, el área desplazable y el diálogo, y calcula qué parte del
 * ScrollBar queda recortada por los ancestros con overflow distinto de visible.
 *
 * @param {import("playwright").Page} page Página con la galería abierta.
 * @returns {Promise<object>} Geometría observada en coordenadas de viewport.
 */
async function measureGallery(page) {
  // El pulgar anima top/height (150 ms): se mide cuando no queda ninguna transición en curso.
  await page.waitForFunction(() => !document.querySelector('[role="scrollbar"]')?.firstElementChild?.getAnimations().length);
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Galería de Imágenes"]');
    const scrollbar = dialog.querySelector('[role="scrollbar"]');
    const track = scrollbar?.parentElement;
    const viewport = dialog.querySelector(".overflow-y-auto");
    const plain = (rect) => ({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height });
    if (!track || track.getBoundingClientRect().width === 0) {
      return { dialog: plain(dialog.getBoundingClientRect()), hasScrollbar: false, viewport: plain(viewport.getBoundingClientRect()) };
    }
    const trackRect = track.getBoundingClientRect();
    let visible = { top: trackRect.top, right: trackRect.right, bottom: trackRect.bottom, left: trackRect.left };
    for (let node = track.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === "visible" && style.overflowY === "visible") continue;
      const rect = node.getBoundingClientRect();
      visible = {
        top: Math.max(visible.top, rect.top),
        right: Math.min(visible.right, rect.right),
        bottom: Math.min(visible.bottom, rect.bottom),
        left: Math.max(visible.left, rect.left),
      };
    }
    const visibleArea = Math.max(0, visible.right - visible.left) * Math.max(0, visible.bottom - visible.top);
    return {
      dialog: plain(dialog.getBoundingClientRect()),
      hasScrollbar: true,
      thumb: plain(scrollbar.firstElementChild.getBoundingClientRect()),
      track: plain(trackRect),
      content: plain(viewport.firstElementChild.getBoundingClientRect()),
      viewport: plain(viewport.getBoundingClientRect()),
      visibleRatio: visibleArea / (trackRect.width * trackRect.height),
    };
  });
}

/**
 * Comprueba que el diálogo cabe en la ventana y que el ScrollBar se ve entero, dentro del
 * diálogo y sin cubrir ninguna parte de las imágenes (el track tiene fondo propio).
 *
 * @param {object} layout Geometría de measureGallery.
 * @param {{width: number, height: number}} viewport Ventana del escenario.
 * @returns {void}
 */
function assertScrollbarFullyVisible(layout, viewport) {
  const label = JSON.stringify(layout);
  assert.ok(layout.dialog.left >= 0 && layout.dialog.right <= viewport.width, `Diálogo dentro del ancho: ${label}`);
  assert.ok(layout.dialog.top >= 0 && layout.dialog.bottom <= viewport.height, `Diálogo dentro del alto: ${label}`);
  assert.equal(layout.hasScrollbar, true, label);
  assert.ok(layout.visibleRatio > 0.999, `ScrollBar recortado (${layout.visibleRatio}): ${label}`);
  assert.ok(layout.track.right <= layout.dialog.right + 0.5 && layout.track.top >= layout.dialog.top, `ScrollBar dentro del diálogo: ${label}`);
  assert.ok(layout.track.left >= layout.content.right - 0.5, `El ScrollBar no tapa las imágenes: ${label}`);
}

const scrollTop = (page) => page.evaluate(() => document.querySelector('[role="dialog"] .overflow-y-auto').scrollTop);
const scrollValue = (page) => page.getByRole("scrollbar").getAttribute("aria-valuenow").then(Number);

for (const theme of ["light", "dark"]) {
  for (const [name, viewport] of [["escritorio", DESKTOP], ["tablet", TABLET], ["ancho intermedio", NARROW]]) {
    test(`regresión: el ScrollBar se ve completo y no tapa las imágenes (${name}, ${theme})`, async (context) => {
      const page = await openGallery(context, { theme, viewport });
      assertScrollbarFullyVisible(await measureGallery(page), viewport);
    });
  }
}

test("arrastre del ScrollBar y rueda desplazan la galería y mantienen el pulgar sincronizado", async (context) => {
  const page = await openGallery(context, { viewport: DESKTOP });
  const before = await measureGallery(page);
  assert.ok(before.thumb.height < before.track.height, "Con contenido largo el pulgar es menor que el track");

  // Arrastre: el centro del pulgar es visible, así que el puntero lo alcanza.
  const startX = before.thumb.left + before.thumb.width / 2;
  const startY = before.thumb.top + before.thumb.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 120, { steps: 6 });
  await page.mouse.up();
  const dragged = await scrollTop(page);
  assert.ok(dragged > 0, "Arrastrar el pulgar desplaza el contenido");
  assert.ok(await scrollValue(page) > 0);

  // Rueda sobre las imágenes.
  await page.mouse.move(before.viewport.left + 100, before.viewport.top + 100);
  await page.mouse.wheel(0, 400);
  await page.waitForFunction((previous) => document.querySelector('[role="dialog"] .overflow-y-auto').scrollTop > previous, dragged);
  const afterWheel = await measureGallery(page);
  assert.ok(afterWheel.thumb.top > before.thumb.top, "El pulgar acompaña la rueda");
  assertScrollbarFullyVisible(afterWheel, DESKTOP);
});

test("teclado: Tab recorre las imágenes desplazando la galería, AvPág desplaza y Escape cierra; se puede reabrir", async (context) => {
  const page = await openGallery(context, { viewport: DESKTOP });
  const cards = page.locator('[role="dialog"] .overflow-y-auto button');
  const total = await cards.count();
  await cards.first().focus();
  await page.keyboard.press("PageDown");
  await page.waitForFunction(() => document.querySelector('[role="dialog"] .overflow-y-auto').scrollTop > 0);
  // Tab hasta la última imagen: cada imagen enfocada se desplaza a la vista.
  for (let index = 1; index < total; index += 1) await page.keyboard.press("Tab");
  assert.equal(await cards.nth(total - 1).evaluate((card) => card === document.activeElement), true);
  const visible = await page.evaluate(() => {
    const viewport = document.querySelector('[role="dialog"] .overflow-y-auto').getBoundingClientRect();
    const card = document.activeElement.getBoundingClientRect();
    return card.top >= viewport.top - 1 && card.bottom <= viewport.bottom + 1;
  });
  assert.equal(visible, true, "La imagen enfocada queda visible");
  assert.ok(await scrollValue(page) > 90, "El pulgar llega al final");

  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Galería de Imágenes" }).waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Abrir galería" }).click();
  await page.getByRole("dialog", { name: "Galería de Imágenes" }).waitFor();
  // Reabierta, el ScrollBar vuelve a medirse entero; el botón Cerrar también la cierra.
  await page.waitForFunction(() => document.querySelector('[role="scrollbar"]'));
  assertScrollbarFullyVisible(await measureGallery(page), DESKTOP);
  await page.getByRole("button", { name: "Cerrar galería de imágenes" }).click();
  await page.getByRole("dialog", { name: "Galería de Imágenes" }).waitFor({ state: "detached" });
});

test("contenido corto: sin desplazamiento, el pulgar ocupa todo el track y sigue visible", async (context) => {
  const page = await openGallery(context, { count: 2, viewport: DESKTOP });
  const layout = await measureGallery(page);
  assertScrollbarFullyVisible(layout, DESKTOP);
  assert.ok(Math.abs(layout.thumb.height - (layout.track.height - 8)) <= 1, JSON.stringify(layout));
  await page.mouse.move(layout.viewport.left + 100, layout.viewport.top + 100);
  await page.mouse.wheel(0, 400);
  assert.equal(await scrollTop(page), 0);
});

test("móvil: el modal cabe en la ventana, el ScrollBar propio se oculta y la galería se desplaza", async (context) => {
  const page = await openGallery(context, { theme: "dark", viewport: MOBILE });
  const layout = await measureGallery(page);
  assert.ok(layout.dialog.left >= 0 && layout.dialog.right <= MOBILE.width && layout.dialog.bottom <= MOBILE.height, JSON.stringify(layout));
  assert.equal(layout.hasScrollbar, false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.mouse.move(layout.viewport.left + 50, layout.viewport.top + 50);
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => document.querySelector('[role="dialog"] .overflow-y-auto').scrollTop > 0);
});
