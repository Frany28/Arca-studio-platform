import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { applyBrowserTimeouts } from "../helpers/browserTimeouts.js";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { enforceProductionCsp } from "../helpers/productionCsp.js";

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
  browser = await chromium.launch({ channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
});
after(async () => { await browser?.close(); await server?.close(); });

/**
 * Abre el visor XLSX real bajo la CSP de producción; falla si hay errores, violaciones de CSP o llamadas HTTP a la API.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra la sesión y valida los errores.
 * @returns {Promise<import("playwright").Page>} Página con el visor montado.
 */
async function openViewer(context) {
  const session = await browser.newContext({ viewport: { height: 760, width: 1000 } });
  const page = await session.newPage();
  applyBrowserTimeouts(page);
  const errors = [];
  const violations = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await enforceProductionCsp(page, violations);
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    errors.push(`API inesperada: ${route.request().url()}`);
    await route.abort();
  });
  context.after(async () => {
    await session.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(violations, [], "el visor no debe necesitar excepciones de la CSP de producción");
  });
  await page.goto(`${origin}/tests/browser/fixtures/xlsx-viewer.html`);
  await page.getByRole("region", { name: "Hoja Resumen" }).waitFor();
  return page;
}

test("XLSX: muestra hojas, combinaciones, formato y saltos de línea del archivo", async (context) => {
  const page = await openViewer(context);
  const sheet = page.getByRole("region", { name: "Hoja Resumen" });
  assert.deepEqual(await page.getByRole("tab").allTextContents(), ["Resumen", "Detalle"]);
  const title = sheet.locator("td", { hasText: "Presupuesto de obra" });
  assert.equal(await title.getAttribute("colspan"), "3", "la celda combinada A1:C1 ocupa tres columnas");
  assert.equal(await sheet.locator("tr").first().locator("td").count(), 1, "las celdas cubiertas por la combinación no se repiten");
  await sheet.locator("td", { hasText: "1250.5" }).waitFor();
  const multiline = sheet.locator("td", { hasText: "Línea 1" });
  assert.equal(await multiline.evaluate((cell) => getComputedStyle(cell).whiteSpace), "pre-line");
  assert.ok((await multiline.boundingBox()).height > (await sheet.locator("td", { hasText: "Estructura" }).boundingBox()).height / 2);
  if (process.env.ARCA_XLSX_CAPTURE_DIR) await page.screenshot({ path: join(process.env.ARCA_XLSX_CAPTURE_DIR, "xlsx-resumen.png") });

  await page.getByRole("tab", { name: "Detalle" }).click();
  await page.getByRole("region", { name: "Hoja Detalle" }).locator("td", { hasText: "Segunda hoja" }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "Detalle" }).getAttribute("aria-selected"), "true");
});

test("XLSX: el contenido hostil de las celdas se muestra como texto y no ejecuta código (regresión de inyección)", async (context) => {
  const page = await openViewer(context);
  const sheet = page.getByRole("region", { name: "Hoja Resumen" });
  await sheet.locator("td", { hasText: "onerror=" }).waitFor();
  assert.equal(await page.locator("#xlsx-injected").count(), 0, "el <img> del archivo no se crea como elemento");
  assert.equal(await sheet.locator("script, img").count(), 0);
  assert.match(await sheet.locator("td", { hasText: "</td><script>" }).textContent(), /<script>window\.__xlsxInjected=2<\/script>/);
  assert.equal(await sheet.locator("a").count(), 1, "solo el enlace https se convierte en enlace");
  const link = sheet.getByRole("link", { name: "Enlace seguro" });
  assert.equal(await link.getAttribute("href"), "https://example.com/plano");
  assert.equal(await link.getAttribute("target"), "_blank");
  assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
  await sheet.locator("td", { hasText: "Enlace peligroso" }).click();
  assert.equal(await page.evaluate(() => window.__xlsxInjected), undefined);
});

test("XLSX: los comentarios conservan su celda y un clic crea un punto con la dirección de la celda", async (context) => {
  const page = await openViewer(context);
  const sheet = page.getByRole("region", { name: "Hoja Resumen" });
  const marker = sheet.locator("[data-document-marker][data-comment-id=\"41\"]");
  await marker.waitFor();
  const cell = await sheet.locator("td[data-cell=\"B3\"]").boundingBox();
  const markerBox = await marker.boundingBox();
  const centerX = markerBox.x + markerBox.width / 2;
  const centerY = markerBox.y + markerBox.height / 2;
  assert.ok(Math.abs(centerX - (cell.x + cell.width / 2)) < cell.width / 2 + markerBox.width, "el marcador queda sobre B3");
  assert.ok(Math.abs(centerY - (cell.y + cell.height / 2)) < cell.height / 2 + markerBox.height, "el marcador queda sobre B3");
  assert.equal(await sheet.locator("td[data-cell=\"B3\"]").textContent(), "1250.5");

  await sheet.locator("td", { hasText: "Partida" }).click();
  const [point] = await page.evaluate(() => window.xlsxHarness.points);
  assert.equal(point.kind, "document-cell-point");
  assert.equal(point.sheetName, "Resumen");
  assert.equal(point.cell, "A2");
  assert.ok(point.normalizedX >= 0 && point.normalizedX <= 1 && point.normalizedY >= 0 && point.normalizedY <= 1);
  if (process.env.ARCA_XLSX_CAPTURE_DIR) await page.screenshot({ path: join(process.env.ARCA_XLSX_CAPTURE_DIR, "xlsx-puntos.png") });
});
