import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Recuperación ante un módulo de ruta no disponible (p. ej. un chunk eliminado tras una nueva
// publicación en Netlify) con la aplicación real: rutas, data router y React.lazy.
const ROUTE_MODULE = "/src/pages/auth/RecoverAccount.jsx";
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), cacheDir: getBrowserTestCacheDir(import.meta.url), configFile: false, envDir: false,
    plugins: [react(), tailwindcss()], define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
});
after(async () => { await browser?.close(); await server?.close(); });

/**
 * Abre la ruta pública con el módulo de la página bloqueado y cuenta las cargas del documento.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria.
 * @returns {Promise<{documentLoads: () => number, page: import("playwright").Page, unblock: Function}>} Página y controles.
 */
async function openWithMissingModule(context) {
  const session = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await session.newPage();
  context.after(() => session.close());
  let loads = 0;
  page.on("load", () => { loads += 1; });
  await page.route((url) => url.pathname.startsWith("/api/"), (route) => route.fulfill({ status: 401, json: { code: "UNAUTHENTICATED", message: "Sin sesión" } }));
  // Como en producción: el chunk ya no existe en el servidor.
  const missing = (url) => url.pathname === ROUTE_MODULE;
  await page.route(missing, (route) => route.fulfill({ status: 404, body: "Not Found" }));
  await page.goto(`${origin}/recuperar-cuenta`);
  return { documentLoads: () => loads, page, unblock: () => page.unroute(missing) };
}

test("un módulo de ruta no disponible recarga una sola vez y después muestra una pantalla clara con «Reintentar»", async (context) => {
  const { documentLoads, page, unblock } = await openWithMissingModule(context);

  await page.getByText("No se pudo cargar esta sección", { exact: true }).waitFor();
  assert.equal(documentLoads(), 2, "una carga inicial y una única recarga automática");
  assert.equal(await page.getByText("Unexpected Application Error").count(), 0, "sin el mensaje técnico de React Router");
  await page.getByText("Es posible que se haya publicado una nueva versión de ARCA Studio. Vuelve a intentarlo para cargarla.", { exact: true }).waitFor();

  // Sin bucles: la pantalla permanece estable aunque el módulo siga faltando.
  await page.waitForTimeout(1500);
  assert.equal(documentLoads(), 2);

  // Con la versión vigente disponible, «Reintentar» recupera la página.
  await unblock();
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await page.getByRole("heading", { level: 1 }).waitFor();
  assert.equal(await page.getByText("No se pudo cargar esta sección", { exact: true }).count(), 0);
});
