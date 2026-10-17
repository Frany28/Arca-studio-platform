import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { applyBrowserTimeouts } from "../helpers/browserTimeouts.js";

// Duración simulada del video y marcadores en 0 %, 5 %, 50 %, 95 % y 100 % de la barra.
const VIDEO_DURATION_SECONDS = 100;
const MARKER_TIMES = [0, 5, 50, 95, 100];
const RESPONSIVE_WIDTHS = [320, 375, 430, 768, 1024, 1440];
// Margen de seguridad del Tooltip respecto al viewport y tolerancia visual de la flecha.
const VIEWPORT_MARGIN_PX = 8;
const ARROW_TOLERANCE_PX = 1.5;
const LONG_TEXT =
  "Referencia pendiente en 0:04 con una observación extensa que debe ajustarse en varias líneas sin recortes";

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
 * Construye un comentario temporal de video con la forma que devuelve la API de proyectos.
 *
 * @param {number} timeSeconds Instante de la observación.
 * @param {number} index Posición del comentario en la lista.
 * @returns {object} Comentario de la API.
 */
function createVideoComment(timeSeconds, index) {
  return {
    author: { firstName: "Revisora", id: 2 },
    commentType: "video",
    createdAt: "2026-10-01T10:00:00.000Z",
    id: 100 + index,
    message: `Observación ${index + 1}`,
    parentCommentId: null,
    projectId: 15,
    selection: { durationSeconds: VIDEO_DURATION_SECONDS, kind: "video-time", timeSeconds },
    targetId: "video-1",
    userId: 2,
  };
}

/**
 * Abre un fixture en un contexto aislado con la API simulada y registra errores de la página.
 *
 * @param {import("node:test").TestContext} context Contexto que cierra la sesión.
 * @param {object} options Escenario.
 * @param {string} options.fixture HTML de la carpeta fixtures, con su query.
 * @param {number} [options.width=1280] Ancho del viewport.
 * @param {number} [options.height=800] Alto del viewport.
 * @returns {Promise<import("playwright").Page>} Página abierta.
 */
async function openFixture(context, { fixture, height = 800, width = 1280 }) {
  const session = await browser.newContext({ viewport: { height, width } });
  const page = await session.newPage();
  applyBrowserTimeouts(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/media/**", (route) => route.abort());
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") {
      await route.fulfill({ json: { user: { email: "visor@example.test", firstName: "Visor", id: 1, role: "architect", status: "active" } } });
      return;
    }
    if (path === "/api/projects/15/comments") {
      await route.fulfill({ json: { comments: MARKER_TIMES.map(createVideoComment), nextCursor: null } });
      return;
    }
    if (path === "/api/projects/15/events") {
      // 204 indica a EventSource que no debe reconectar.
      await route.fulfill({ status: 204 });
      return;
    }
    errors.push(`HTTP inesperado: ${path}`);
    await route.fulfill({ json: { message: "Fixture no definida" }, status: 404 });
  });
  context.after(async () => {
    await session.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(`${origin}/tests/browser/fixtures/${fixture}`);
  return page;
}

/**
 * Mide la burbuja visible con el texto indicado, su flecha y el ancla que la abrió.
 * Calcula la punta de la flecha según el lado de la burbuja en el que se dibuja.
 *
 * @param {import("playwright").Page} page Página con el Tooltip abierto.
 * @param {string} text Texto del Tooltip.
 * @param {import("playwright").Locator} anchor Elemento que abrió el Tooltip.
 * @returns {Promise<object>} Geometría observada.
 */
async function measureTooltip(page, text, anchor) {
  await page.waitForFunction(
    (label) => [...document.querySelectorAll('[role="tooltip"]')].some((node) => node.textContent === label),
    text,
  );
  const anchorRect = await anchor.evaluate((node) => node.getBoundingClientRect().toJSON());
  return page.evaluate(({ label, anchorBox }) => {
    const bubble = [...document.querySelectorAll('[role="tooltip"]')].find((node) => node.textContent === label);
    const tail = bubble.querySelector("svg");
    const paragraph = bubble.querySelector("p");
    const bubbleBox = bubble.getBoundingClientRect().toJSON();
    const tailBox = tail.getBoundingClientRect().toJSON();
    const tailCenterX = tailBox.left + tailBox.width / 2;
    const tailCenterY = tailBox.top + tailBox.height / 2;
    // La flecha se centra sobre el borde de la burbuja que mira al ancla.
    let side;
    if (tailCenterY >= bubbleBox.bottom - 2) side = "Top";
    else if (tailCenterY <= bubbleBox.top + 2) side = "Bottom";
    else if (tailCenterX >= bubbleBox.right - 2) side = "Left";
    else side = "Right";
    const fullscreenElement = document.fullscreenElement;
    return {
      anchor: anchorBox,
      bubble: bubbleBox,
      // La flecha absoluta forma parte del desbordamiento de la burbuja; el recorte se mide en el texto.
      clipped: paragraph.scrollWidth > paragraph.clientWidth + 1 || paragraph.scrollHeight > paragraph.clientHeight + 1,
      insideFullscreen: fullscreenElement ? fullscreenElement.contains(bubble) : null,
      side,
      tail: tailBox,
      tailCenterX,
      tailCenterY,
      viewport: { height: window.innerHeight, width: document.documentElement.clientWidth },
    };
  }, { anchorBox: anchorRect, label: text });
}

/**
 * Comprueba la geometría que exige el criterio de aceptación: burbuja visible dentro del viewport,
 * flecha dentro de la burbuja, en el lado que mira al ancla y apuntando a su centro.
 *
 * @param {object} geometry Resultado de measureTooltip.
 * @param {string} label Descripción del caso para los mensajes de error.
 * @param {string} [expectedSide] Lado esperado de la burbuja respecto al ancla.
 */
function assertTooltipGeometry(geometry, label, expectedSide) {
  const { anchor, bubble, tail, viewport } = geometry;
  const anchorCenterX = anchor.left + anchor.width / 2;
  const anchorCenterY = anchor.top + anchor.height / 2;
  const epsilon = 0.5;

  assert.ok(bubble.left >= VIEWPORT_MARGIN_PX - epsilon, `${label}: la burbuja sale por la izquierda (${bubble.left})`);
  assert.ok(bubble.right <= viewport.width - VIEWPORT_MARGIN_PX + epsilon, `${label}: la burbuja sale por la derecha (${bubble.right}/${viewport.width})`);
  assert.ok(bubble.top >= VIEWPORT_MARGIN_PX - epsilon, `${label}: la burbuja sale por arriba (${bubble.top})`);
  assert.ok(bubble.bottom <= viewport.height - VIEWPORT_MARGIN_PX + epsilon, `${label}: la burbuja sale por abajo (${bubble.bottom})`);
  assert.equal(geometry.clipped, false, `${label}: el texto queda recortado`);
  if (expectedSide) assert.equal(geometry.side, expectedSide, `${label}: lado de la burbuja`);

  if (geometry.side === "Top" || geometry.side === "Bottom") {
    assert.ok(tail.left >= bubble.left - epsilon && tail.right <= bubble.right + epsilon, `${label}: la flecha sale de la burbuja`);
    assert.ok(
      Math.abs(geometry.tailCenterX - anchorCenterX) <= ARROW_TOLERANCE_PX,
      `${label}: la flecha apunta a x=${geometry.tailCenterX.toFixed(1)} y el ancla está en x=${anchorCenterX.toFixed(1)}`,
    );
    if (geometry.side === "Top") assert.ok(bubble.bottom <= anchor.top + epsilon, `${label}: la burbuja superior cubre el ancla`);
    else assert.ok(bubble.top >= anchor.bottom - epsilon, `${label}: la burbuja inferior cubre el ancla`);
    return;
  }

  assert.ok(tail.top >= bubble.top - epsilon && tail.bottom <= bubble.bottom + epsilon, `${label}: la flecha sale de la burbuja`);
  assert.ok(
    Math.abs(geometry.tailCenterY - anchorCenterY) <= ARROW_TOLERANCE_PX,
    `${label}: la flecha apunta a y=${geometry.tailCenterY.toFixed(1)} y el ancla está en y=${anchorCenterY.toFixed(1)}`,
  );
  if (geometry.side === "Left") assert.ok(bubble.right <= anchor.left + epsilon, `${label}: la burbuja izquierda cubre el ancla`);
  else assert.ok(bubble.left >= anchor.right - epsilon, `${label}: la burbuja derecha cubre el ancla`);
}

/**
 * Abre el reproductor y simula la carga de metadatos del video para posicionar los marcadores.
 *
 * @param {import("node:test").TestContext} context Contexto de la prueba.
 * @param {object} [options] Viewport y tema.
 * @returns {Promise<import("playwright").Page>} Página con el reproductor listo.
 */
async function openVideoViewer(context, { height = 800, theme = "light", width = 1280 } = {}) {
  const page = await openFixture(context, { fixture: `video-viewer-tooltips.html?theme=${theme}`, height, width });
  await page.locator("video").first().waitFor({ state: "attached" });
  await page.evaluate((duration) => {
    const video = document.querySelector("section video");
    Object.defineProperty(video, "duration", { configurable: true, value: duration });
    Object.defineProperty(video, "currentTime", { configurable: true, value: 4, writable: true });
    video.dispatchEvent(new Event("durationchange"));
    video.dispatchEvent(new Event("loadeddata"));
  }, VIDEO_DURATION_SECONDS);
  await page.getByRole("button", { name: "Ir a la observación en 1:40" }).waitFor();
  return page;
}

/**
 * Pasa el puntero por el centro de un elemento y mide el Tooltip que abre.
 *
 * @param {import("playwright").Page} page Página del reproductor.
 * @param {import("playwright").Locator} anchor Control o marcador.
 * @param {string} text Texto esperado.
 * @returns {Promise<object>} Geometría observada.
 */
async function hoverAndMeasure(page, anchor, text) {
  const box = await anchor.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  return measureTooltip(page, text, anchor);
}

/**
 * Recorre los controles y marcadores del reproductor y valida cada Tooltip.
 *
 * @param {import("playwright").Page} page Página del reproductor.
 * @param {string} label Contexto del recorrido.
 * @returns {Promise<void>} Finaliza cuando todos los tooltips cumplen.
 */
async function assertVideoControlTooltips(page, label) {
  const controls = [
    ["Pantalla completa", "Pantalla completa"],
    ["Silenciar video", "Silenciar video"],
    ["Comentar video", "Comentar video"],
  ];
  for (const [name, text] of controls) {
    const geometry = await hoverAndMeasure(page, page.getByRole("button", { name, exact: true }), text);
    assertTooltipGeometry(geometry, `${label} · ${text}`, "Top");
  }

  for (const time of MARKER_TIMES) {
    const minutes = Math.floor(time / 60);
    const text = `Ir a la observación en ${minutes}:${String(time % 60).padStart(2, "0")}`;
    const geometry = await hoverAndMeasure(page, page.getByRole("button", { name: text }), text);
    assertTooltipGeometry(geometry, `${label} · marcador ${time} %`, "Top");
    assert.deepEqual(
      await page.locator('[role="tooltip"]').allTextContents(),
      [text],
      `${label} · marcador ${time} %: el tiempo de la pista no debe superponerse al marcador`,
    );
  }

  const track = page.getByRole("slider", { name: "Progreso del video" });
  const trackBox = await track.boundingBox();
  // Segundos entre marcadores, incluidos los extremos de la pista; sobre un marcador solo se
  // muestra el tooltip del marcador. Se apunta a la mitad del segundo para no depender del redondeo.
  for (const seconds of [1, 25, 75, 98]) {
    const x = trackBox.x + trackBox.width * ((seconds + 0.5) / VIDEO_DURATION_SECONDS);
    await page.mouse.move(x, trackBox.y + trackBox.height / 2);
    const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const geometry = await measureTooltip(page, text, page.locator('[data-tooltip-anchor="playback-time"]'));
    assertTooltipGeometry(geometry, `${label} · tiempo ${seconds} s`, "Top");
    assert.ok(Math.abs(geometry.tailCenterX - x) <= ARROW_TOLERANCE_PX + 1, `${label} · tiempo ${seconds} s: la flecha no sigue al puntero`);
  }

  const marker = page.getByRole("button", { name: "Ir a la observación en 0:50" });
  await hoverAndMeasure(page, marker, "Ir a la observación en 0:50");
  assert.deepEqual(await page.locator('[role="tooltip"]').allTextContents(), ["Ir a la observación en 0:50"]);
}

test("Tooltip aligns every preferred position and its arrow to the anchor", async (context) => {
  const page = await openFixture(context, { fixture: "tooltip-placement.html", height: 720, width: 1024 });
  const positions = ["Top center", "Top left", "Top right", "Bottom center", "Bottom left", "Bottom right", "Left", "Right"];
  const anchor = page.getByTestId("anchor");

  for (const position of positions) {
    for (const [width, text] of [[44, "Pantalla completa"], [4, "Ir a la observación en 0:50"]]) {
      await page.evaluate((scenario) => window.renderTooltipScenario(scenario), { position, text, width, x: 480, y: 340 });
      const geometry = await measureTooltip(page, text, anchor);
      assertTooltipGeometry(geometry, `${position} con ancla de ${width}px`, position.split(" ")[0]);

      if (position.endsWith("center")) {
        const bubbleCenter = geometry.bubble.left + geometry.bubble.width / 2;
        assert.ok(Math.abs(bubbleCenter - (480 + width / 2)) <= 1, `${position}: la burbuja no conserva el centrado`);
      }
      if (position.endsWith("right")) {
        assert.ok(geometry.bubble.right >= 480 + width - 0.5 && geometry.bubble.left < 480, `${position}: la burbuja debe crecer hacia la izquierda`);
      }
      if (position.endsWith("left")) {
        assert.ok(geometry.bubble.left <= 480 + 0.5 && geometry.bubble.right > 480 + width, `${position}: la burbuja debe crecer hacia la derecha`);
      }
    }
  }
});

test("Tooltip stays inside the four viewport edges, shifts its arrow and flips its side", async (context) => {
  const page = await openFixture(context, { fixture: "tooltip-placement.html", height: 640, width: 375 });
  const anchor = page.getByTestId("anchor");
  const cases = [
    { expectedSide: "Top", label: "borde izquierdo", position: "Top center", width: 4, x: 30, y: 300 },
    { expectedSide: "Top", label: "borde derecho", position: "Top right", width: 4, x: 340, y: 300 },
    { expectedSide: "Top", label: "Top center en el borde derecho", position: "Top center", width: 4, x: 330, y: 300 },
    { expectedSide: "Top", label: "Top left en el borde derecho", position: "Top left", x: 320, y: 300 },
    { expectedSide: "Bottom", label: "borde superior", position: "Top center", x: 10, y: 6 },
    { expectedSide: "Top", label: "borde inferior", position: "Bottom right", x: 320, y: 590 },
    { expectedSide: "Right", label: "Left en el borde izquierdo", position: "Left", x: 4, y: 300 },
    { expectedSide: "Left", label: "Right en el borde derecho", position: "Right", x: 327, y: 300 },
    { expectedSide: "Top", label: "texto largo", position: "Top center", text: LONG_TEXT, width: 4, x: 30, y: 300 },
    { expectedSide: "Bottom", label: "texto largo en esquina", position: "Top right", text: LONG_TEXT, x: 327, y: 4 },
  ];

  for (const scenario of cases) {
    const text = scenario.text ?? "Pantalla completa";
    await page.evaluate((current) => window.renderTooltipScenario(current), { ...scenario, text });
    const geometry = await measureTooltip(page, text, anchor);
    assertTooltipGeometry(geometry, scenario.label, scenario.expectedSide);
  }

  // Un ancla pegada al borde no puede recibir la flecha exacta sin que esta invada la esquina:
  // la burbuja queda en el margen y la flecha en su inset mínimo, siempre dentro de la burbuja.
  await page.evaluate(() => window.renderTooltipScenario({ position: "Top center", width: 4, x: 2, y: 300 }));
  const extreme = await measureTooltip(page, "Pantalla completa", anchor);
  assert.ok(Math.abs(extreme.bubble.left - VIEWPORT_MARGIN_PX) <= 0.5, "La burbuja se apoya en el margen izquierdo");
  assert.ok(extreme.tail.left >= extreme.bubble.left && extreme.tailCenterX <= extreme.bubble.left + 16 + ARROW_TOLERANCE_PX, "La flecha queda en el inset mínimo dentro de la burbuja");

  await page.evaluate((text) => window.renderTooltipScenario({ position: "Top center", text, width: 4, x: 30, y: 300 }), LONG_TEXT);
  const longText = await measureTooltip(page, LONG_TEXT, anchor);
  assert.ok(longText.bubble.height > 40, "El texto largo debe ajustarse en varias líneas");
  assert.ok(longText.bubble.width <= 375 - 2 * VIEWPORT_MARGIN_PX + 0.5, "El texto largo respeta el ancho disponible");
});

test("Tooltip opens on hover and keyboard focus and renders in both themes", async (context) => {
  const page = await openFixture(context, { fixture: "tooltip-placement.html", height: 720, width: 1024 });
  const anchor = page.getByTestId("anchor");
  const backgrounds = {};

  for (const dark of [false, true]) {
    await page.evaluate((scenario) => window.renderTooltipScenario(scenario), { dark, interactive: true, position: "Top right", x: 960, y: 340 });
    assert.equal(await page.locator('[role="tooltip"]').count(), 0);
    // Registra cada estilo que recibe la capa del portal para detectar posiciones intermedias visibles.
    await page.evaluate(() => {
      window.portalStyles = [];
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of [record.target, ...record.addedNodes]) {
            if (node instanceof HTMLElement && node.firstElementChild?.getAttribute("role") === "tooltip") window.portalStyles.push(node.getAttribute("style"));
          }
        }
      }).observe(document.body, { attributeFilter: ["style"], attributes: true, childList: true, subtree: true });
    });
    await anchor.hover();
    assertTooltipGeometry(await measureTooltip(page, "Pantalla completa", anchor), `hover ${dark ? "oscuro" : "claro"}`, "Top");
    const visibleStyles = new Set((await page.evaluate(() => window.portalStyles)).filter((style) => !style.includes("hidden")));
    assert.equal(visibleStyles.size, 1, `Solo debe pintarse la posición final: ${[...visibleStyles].join(" | ")}`);
    backgrounds[dark ? "dark" : "light"] = await page.locator('[role="tooltip"]').evaluate((node) => getComputedStyle(node).backgroundColor);
    await page.mouse.move(10, 10);
    await page.locator('[role="tooltip"]').waitFor({ state: "detached" });
  }
  assert.notEqual(backgrounds.light, backgrounds.dark, "El Tooltip debe usar los tokens del tema activo");

  await page.keyboard.press("Tab");
  assert.equal(await anchor.evaluate((node) => node === document.activeElement), true);
  assertTooltipGeometry(await measureTooltip(page, "Pantalla completa", anchor), "foco por teclado", "Top");
  assert.equal(await anchor.getAttribute("aria-describedby"), await page.locator('[role="tooltip"]').getAttribute("id"));
  await page.keyboard.press("Shift+Tab");
  await page.locator('[role="tooltip"]').waitFor({ state: "detached" });
});

for (const width of RESPONSIVE_WIDTHS) {
  test(`video player tooltips point at their controls and markers at ${width}px`, async (context) => {
    const page = await openVideoViewer(context, { width });
    await assertVideoControlTooltips(page, `${width}px`);

    await page.getByRole("button", { name: "Comentar video", exact: true }).click();
    const pending = page.getByRole("button", { name: "Referencia pendiente en 0:04" });
    assertTooltipGeometry(await hoverAndMeasure(page, pending, "Referencia pendiente en 0:04"), `${width}px · referencia pendiente`, "Top");

    await page.getByRole("button", { name: "Silenciar video", exact: true }).click();
    const unmute = page.getByRole("button", { name: "Activar sonido", exact: true });
    assertTooltipGeometry(await hoverAndMeasure(page, unmute, "Activar sonido"), `${width}px · activar sonido`, "Top");
  });
}

test("video player tooltips render inside the fullscreen player and recover after leaving it", async (context) => {
  const page = await openVideoViewer(context, { theme: "dark", width: 1024 });
  const fullscreen = page.getByRole("button", { name: "Pantalla completa", exact: true });

  await fullscreen.click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  const insideGeometry = await hoverAndMeasure(page, fullscreen, "Pantalla completa");
  assert.equal(insideGeometry.insideFullscreen, true, "El portal debe montarse dentro del elemento en pantalla completa");
  await assertVideoControlTooltips(page, "pantalla completa");

  const focusTarget = page.getByRole("button", { name: "Comentar video", exact: true });
  await page.mouse.move(2, 2);
  await focusTarget.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const focusGeometry = await measureTooltip(page, "Comentar video", focusTarget);
  assert.equal(focusGeometry.insideFullscreen, true);
  assertTooltipGeometry(focusGeometry, "pantalla completa · foco", "Top");

  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  const afterGeometry = await hoverAndMeasure(page, fullscreen, "Pantalla completa");
  assert.equal(afterGeometry.insideFullscreen, null);
  assertTooltipGeometry(afterGeometry, "después de pantalla completa", "Top");
});
