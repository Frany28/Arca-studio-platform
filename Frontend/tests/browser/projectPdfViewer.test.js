import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Política real del backend (hallazgo B-1): el visor debe funcionar con las mismas cabeceras.
import { getFileResponseSecurity } from "../../../Backend/src/utils/fileResponseSecurity.js";

const CONTENT_PATH = "/api/projects/15/files/5/content";
const PAGE_COUNT = 3;
let server;
let browser;
let origin;

/**
 * Genera un PDF válido de varias páginas, cada una con su número en texto negro.
 *
 * @param {number} pageCount - Número de páginas.
 * @returns {Buffer} Contenido del PDF.
 */
function createPdf(pageCount) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (let index = 0; index < pageCount; index += 1) {
    const stream = `BT /F1 48 Tf 40 300 Td (Pagina ${index + 1}) Tj ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const contentId = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`;
  let output = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = output.length;
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}

/**
 * Cabeceras con las que el backend sirve un PDF de proyecto (descarga con CSP estricta y sandbox).
 *
 * @returns {Record<string, string>} Cabeceras HTTP de la respuesta.
 */
function backendPdfHeaders() {
  const security = getFileResponseSecurity({ contentType: "application/pdf", frameAncestors: [origin], pdfViewing: "in-app" });
  return {
    "Content-Disposition": `${security.disposition}; filename="Plano%20general.pdf"`,
    "Content-Security-Policy": security.contentSecurityPolicy,
    "Content-Type": security.contentType,
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
  };
}

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), configFile: false, envDir: false,
    plugins: [react(), tailwindcss()], define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
});
after(async () => { await browser?.close(); await server?.close(); });

/**
 * Abre el visor real con la API simulada y registra peticiones, cabeceras recibidas y errores.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra la sesión.
 * @returns {Promise<{ page: import("playwright").Page, pdfResponses: Array<object>, errors: Array<string> }>} Estado observable.
 */
async function openViewer(context) {
  const session = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await session.newPage();
  const errors = [];
  const pdfResponses = [];
  const pdf = createPdf(PAGE_COUNT);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === CONTENT_PATH) pdfResponses.push(response.headers());
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") {
      await route.fulfill({ json: { user: { email: "visor@example.test", firstName: "Visor", id: 1, role: "client", status: "active" } } });
      return;
    }
    if (path === "/api/projects/15/files/5/comments") {
      await route.fulfill({ json: { comments: [], nextCursor: null } });
      return;
    }
    if (path === CONTENT_PATH) {
      await route.fulfill({ body: pdf, headers: backendPdfHeaders(), status: 200 });
      return;
    }
    errors.push(`HTTP inesperado: ${path}`);
    await route.fulfill({ json: { message: "Fixture no definida" }, status: 404 });
  });
  context.after(async () => { await session.close(); assert.deepEqual(errors, []); });
  await page.goto(`${origin}/tests/browser/fixtures/project-pdf-viewer.html`);
  return { errors, page, pdfResponses };
}

/**
 * Comprueba que el lienzo de una página está dibujado (contiene píxeles oscuros del texto).
 *
 * @param {import("playwright").Page} page - Página del navegador.
 * @param {number} pageNumber - Página del PDF.
 * @returns {Promise<{ drawn: boolean, width: number }>} Si tiene contenido y su ancho CSS.
 */
async function canvasState(page, pageNumber) {
  const canvas = page.locator(`canvas[aria-label$="página ${pageNumber}"]`).first();
  await canvas.waitFor({ state: "attached", timeout: 10_000 });
  return canvas.evaluate((element) => {
    const context = element.getContext("2d");
    const { data } = context.getImageData(0, 0, element.width, element.height);
    let dark = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index] < 100 && data[index + 1] < 100 && data[index + 2] < 100) dark += 1;
    return { drawn: dark > 50, width: element.getBoundingClientRect().width };
  });
}

/**
 * Espera a que una condición asíncrona sea verdadera.
 *
 * @param {() => Promise<boolean>} check - Condición a evaluar.
 * @param {string} message - Mensaje si no se cumple.
 * @returns {Promise<void>} Finaliza cuando se cumple.
 */
async function eventually(check, message) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
}

test("el visor integrado muestra el PDF servido como descarga con CSP estricta y sandbox", async (context) => {
  const { page, pdfResponses } = await openViewer(context);
  await eventually(async () => (await canvasState(page, 1)).drawn, "la primera página no se dibujó");

  assert.equal(pdfResponses.length, 1);
  assert.match(pdfResponses[0]["content-disposition"], /^attachment;/);
  assert.match(pdfResponses[0]["content-security-policy"], /^default-src 'none';.*; sandbox$/);
  assert.equal(pdfResponses[0]["content-type"], "application/pdf");
  assert.equal(await page.getByLabel("Página actual").inputValue(), "1");
});

test("el visor conserva el cambio de páginas", async (context) => {
  const { page } = await openViewer(context);
  await eventually(async () => (await canvasState(page, 1)).drawn, "la primera página no se dibujó");

  const pageInput = page.getByLabel("Página actual");
  await pageInput.fill("2");
  await pageInput.press("Enter");
  await eventually(async () => (await pageInput.inputValue()) === "2", "el control no muestra la página 2");
  await eventually(async () => (await canvasState(page, 2)).drawn, "la página 2 no se dibujó");

  await pageInput.fill(String(PAGE_COUNT + 5));
  await pageInput.press("Enter");
  await eventually(async () => (await pageInput.inputValue()) === String(PAGE_COUNT), "la página no se limita al total");
  await eventually(async () => (await canvasState(page, PAGE_COUNT)).drawn, "la última página no se dibujó");
});

test("el visor conserva el zoom", async (context) => {
  const { page } = await openViewer(context);
  await eventually(async () => (await canvasState(page, 1)).drawn, "la primera página no se dibujó");
  const initial = (await canvasState(page, 1)).width;

  await page.getByRole("button", { name: "Acercar" }).first().click();
  await eventually(async () => (await canvasState(page, 1)).width > initial * 1.15, "acercar no amplió la página");
  await eventually(async () => (await canvasState(page, 1)).drawn, "la página ampliada no se dibujó");

  await page.getByRole("button", { name: "Alejar" }).first().click();
  await page.getByRole("button", { name: "Alejar" }).first().click();
  await eventually(async () => (await canvasState(page, 1)).width < initial, "alejar no redujo la página");
});

test("abrir la URL del PDF directamente descarga el archivo en lugar de mostrarlo", async (context) => {
  const { page } = await openViewer(context);
  await eventually(async () => (await canvasState(page, 1)).drawn, "la primera página no se dibujó");
  const downloadPromise = page.waitForEvent("download");
  await page.evaluate((path) => { window.location.href = path; }, `${CONTENT_PATH}?versionId=9`);
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "Plano general.pdf");
});
