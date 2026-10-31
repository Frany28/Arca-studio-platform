import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";

// P1-1: peticiones reales que generan los hooks de observaciones en un navegador, con la red
// interceptada (nunca sale a un servidor). Simula un backend con COMMENTS_PER_PROJECT comentarios por
// proyecto, paginado por cursor como el real, y un EventSource sano. Mide 5 minutos con la pestaña
// visible y 5 oculta con el reloj de Playwright. ARCA_TRAFFIC_BASELINE=1 solo imprime las cifras
// (para medir la versión anterior sin exigir los nuevos límites).
const COMMENTS_PER_PROJECT = 250;
const BASELINE = process.env.ARCA_TRAFFIC_BASELINE === "1";
const STEP_MS = 5000;
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), cacheDir: getBrowserTestCacheDir(import.meta.url), configFile: false, envDir: false,
    plugins: [react(), tailwindcss()], server: { host: "127.0.0.1", port: 0 },
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
 * Codifica un cursor con el mismo formato opaco que el backend.
 *
 * @param {Array<string>} values - Valores del cursor.
 * @returns {string} Cursor base64url.
 */
function encodeCursor(values) {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

/**
 * Backend simulado de observaciones con contadores de peticiones y comentarios transferidos.
 *
 * @returns {Object} Estado y manejador de rutas.
 */
function createBackend() {
  const projects = new Map();
  const stats = { commentRequests: 0, commentsTransferred: 0, otherRequests: 0 };
  const commentsOf = (projectId) => {
    if (!projects.has(projectId)) {
      projects.set(projectId, Array.from({ length: COMMENTS_PER_PROJECT }, (_, index) => ({
        commentType: index % 2 ? "image" : "general",
        content: `Observación ${index}`,
        createdAt: new Date(Date.UTC(2026, 0, 1) + index * 60000).toISOString(),
        id: projectId * 10000 + index,
        projectId,
        targetId: "render-1",
        user: { id: 2, name: "Ana Pérez" },
      })));
    }
    return projects.get(projectId);
  };
  return {
    addComment(projectId, comment) { commentsOf(projectId).push(comment); },
    async handle(route) {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/auth/me") {
        await route.fulfill({ json: { user: { firstName: "Ana", id: 1, lastName: "Pérez", name: "Ana Pérez", role: { code: "architect" } } } });
        return;
      }
      const match = url.pathname.match(/^\/api\/projects\/(\d+)\/comments$/);
      if (!match) {
        stats.otherRequests += 1;
        await route.fulfill({ json: {}, status: 404 });
        return;
      }
      stats.commentRequests += 1;
      const limit = Number(url.searchParams.get("limit") || 25);
      const cursor = url.searchParams.get("cursor");
      const after = cursor ? JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) : null;
      const all = commentsOf(Number(match[1]));
      const visible = (after ? all.filter((comment) => comment.createdAt > after[0] || (comment.createdAt === after[0] && comment.id > Number(after[1]))) : all);
      const page = visible.slice(0, limit);
      const last = page.at(-1);
      stats.commentsTransferred += page.length;
      await route.fulfill({
        json: {
          comments: page,
          nextCursor: visible.length > limit && last ? encodeCursor([last.createdAt, String(last.id)]) : null,
          syncCursor: last ? encodeCursor([new Date(new Date(last.createdAt).getTime() - 60000).toISOString(), "0"]) : null,
        },
      });
    },
    stats,
  };
}

/**
 * Abre el escenario con reloj controlado, red interceptada y un EventSource sano simulado.
 *
 * @param {string} scenario - detail o dashboard.
 * @returns {Promise<{ page: Object, backend: Object, close: Function }>} Página y backend.
 */
async function openScenario(scenario) {
  const session = await browser.newContext();
  const page = await session.newPage();
  const backend = createBackend();
  await page.route((url) => url.pathname.startsWith("/api/"), (route) => backend.handle(route));
  await page.addInitScript(() => {
    window.sseStats = { maxOpen: 0, open: 0, opened: 0 };
    class FakeEventSource {
      static CLOSED = 2;
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        window.sseStats.opened += 1;
        window.sseStats.open += 1;
        window.sseStats.maxOpen = Math.max(window.sseStats.maxOpen, window.sseStats.open);
        setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
      }
      addEventListener() {}
      close() {
        if (this.readyState !== FakeEventSource.CLOSED) window.sseStats.open -= 1;
        this.readyState = FakeEventSource.CLOSED;
      }
    }
    window.EventSource = FakeEventSource;
  });
  await page.clock.install({ time: new Date("2026-10-30T12:00:00Z") });
  await page.goto(`${origin}/tests/browser/fixtures/comment-traffic.html?scenario=${scenario}`);
  await page.getByTestId("observed").waitFor();
  return { backend, close: () => session.close(), page };
}

/**
 * Avanza el reloj de la página por pasos, dejando completar las respuestas de red entre ellos.
 *
 * @param {Object} page - Página de Playwright.
 * @param {number} totalMs - Tiempo simulado.
 * @returns {Promise<void>}
 */
async function advance(page, totalMs) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += STEP_MS) {
    await page.clock.runFor(STEP_MS);
    await page.waitForTimeout(25);
  }
}

/**
 * Cambia la visibilidad simulada de la pestaña y avisa a la página.
 *
 * @param {Object} page - Página de Playwright.
 * @param {boolean} hidden - true para ocultarla.
 * @returns {Promise<void>}
 */
async function setHidden(page, hidden) {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (isHidden ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await page.waitForTimeout(50);
}

/**
 * Mide un escenario: carga inicial, 5 minutos visible, 5 oculta y la vuelta a la pestaña.
 *
 * @param {string} scenario - detail o dashboard.
 * @param {number} projects - Proyectos del escenario.
 * @returns {Promise<Object>} Cifras medidas.
 */
async function measure(scenario, projects) {
  const { backend, close, page } = await openScenario(scenario);
  try {
    await page.waitForFunction((expected) => window.trafficHarness.observed >= expected, projects * COMMENTS_PER_PROJECT, { timeout: 20000 });
    const initial = { ...backend.stats };
    await advance(page, 5 * 60 * 1000);
    const visible = { ...backend.stats };
    await setHidden(page, true);
    await advance(page, 5 * 60 * 1000);
    const hidden = { ...backend.stats };
    backend.addComment(7, { commentType: "general", content: "Nueva mientras estaba oculta", createdAt: "2026-10-30T12:09:00.000Z", id: 99999, projectId: 7, user: { id: 2, name: "Ana Pérez" } });
    await setHidden(page, false);
    await advance(page, 15000);
    const sse = await page.evaluate(() => window.sseStats);
    const observed = await page.evaluate(() => window.trafficHarness.observed);
    const result = {
      scenario,
      initialRequests: initial.commentRequests,
      requestsVisible5min: visible.commentRequests - initial.commentRequests,
      commentsTransferredVisible5min: visible.commentsTransferred - initial.commentsTransferred,
      requestsHidden5min: hidden.commentRequests - visible.commentRequests,
      sseConnectionsOpen: sse.maxOpen,
      observedAfterReturn: observed,
    };
    console.log(`COMMENT_TRAFFIC ${JSON.stringify(result)}`);
    return result;
  } finally {
    await close();
  }
}

test("detalle de proyecto con visor abierto: una carga, sin descargas completas repetidas ni sondeo oculto", async () => {
  const result = await measure("detail", 1);
  if (BASELINE) return;
  assert.equal(result.initialRequests, 3, "250 comentarios = 3 páginas, una sola vez para los tres hooks");
  assert.equal(result.requestsHidden5min, 0);
  assert.ok(result.commentsTransferredVisible5min <= 50, `solo la ventana reciente (${result.commentsTransferredVisible5min})`);
  assert.equal(result.sseConnectionsOpen, 1);
  assert.equal(result.observedAfterReturn, COMMENTS_PER_PROJECT + 1, "el comentario creado con la pestaña oculta aparece al volver");
});

test("panel del arquitecto con 8 proyectos: carga compartida, SSE acotado y sin sondeo oculto", async () => {
  const result = await measure("dashboard", 8);
  if (BASELINE) return;
  assert.equal(result.initialRequests, 8 * 3);
  assert.equal(result.requestsHidden5min, 0);
  assert.ok(result.sseConnectionsOpen <= 3);
});
