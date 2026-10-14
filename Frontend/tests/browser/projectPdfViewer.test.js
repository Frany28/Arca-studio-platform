import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Política real del backend (hallazgo B-1): los visores deben funcionar con las mismas cabeceras.
import { getFileResponseSecurity } from "../../../Backend/src/utils/fileResponseSecurity.js";

const PROJECT_PDF_PATH = "/api/projects/15/files/5/content";
const REQUEST_PDF_PATH = "/api/project-requests/7/files/31/content";
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
 * Cabeceras con las que el backend sirve un PDF visible solo en la aplicación.
 * Los proyectos admiten como incrustadores los orígenes CORS; los adjuntos de solicitudes, solo 'self'.
 *
 * @param {string} fileName - Nombre de descarga.
 * @param {Array<string>} frameAncestors - Orígenes que pueden incrustar el archivo.
 * @returns {Record<string, string>} Cabeceras HTTP de la respuesta.
 */
function backendPdfHeaders(fileName, frameAncestors) {
  const security = getFileResponseSecurity({ contentType: "application/pdf", frameAncestors });
  return {
    "Content-Disposition": `${security.disposition}; filename="${encodeURIComponent(fileName)}"`,
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
 * Abre una página de prueba con la API simulada; registra cabeceras PDF recibidas, pestañas nuevas y errores.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra la sesión.
 * @param {object} options - Escenario.
 * @param {string} options.fixture - HTML de la carpeta fixtures.
 * @param {number} [options.pdfStatus=200] - Estado HTTP del PDF.
 * @param {{ width: number, height: number }} [options.viewport] - Tamaño de la ventana.
 * @returns {Promise<{ page: import("playwright").Page, pdfResponses: Array<object>, popups: Array<string> }>} Estado observable.
 */
async function openFixture(context, { fixture, pdfStatus = 200, viewport = { height: 900, width: 1280 } }) {
  const session = await browser.newContext({ acceptDownloads: true, viewport });
  const page = await session.newPage();
  const errors = [];
  const pdfResponses = [];
  const popups = [];
  const pdf = createPdf(PAGE_COUNT);
  session.on("page", (popup) => popups.push(popup.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if ([PROJECT_PDF_PATH, REQUEST_PDF_PATH].includes(new URL(response.url()).pathname)) pdfResponses.push(response.headers());
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") {
      await route.fulfill({ json: { user: { email: "visor@example.test", firstName: "Visor", id: 1, role: "architect", status: "active" } } });
      return;
    }
    if (path === "/api/projects/15/files/5/comments") {
      await route.fulfill({ json: { comments: [], nextCursor: null } });
      return;
    }
    if (path === PROJECT_PDF_PATH || path === REQUEST_PDF_PATH) {
      if (pdfStatus !== 200) {
        await route.fulfill({ json: { code: "FILE_NOT_FOUND", message: "No se encontró el archivo." }, status: pdfStatus });
        return;
      }
      const headers = path === PROJECT_PDF_PATH
        ? backendPdfHeaders("Plano general.pdf", [origin])
        : backendPdfHeaders("Memoria descriptiva.pdf", []);
      await route.fulfill({ body: pdf, headers, status: 200 });
      return;
    }
    errors.push(`HTTP inesperado: ${path}`);
    await route.fulfill({ json: { message: "Fixture no definida" }, status: 404 });
  });
  context.after(async () => { await session.close(); assert.deepEqual(errors, []); });
  await page.goto(`${origin}/tests/browser/fixtures/${fixture}`);
  return { page, pdfResponses, popups };
}

/**
 * Lee el estado del lienzo de una página: si contiene el texto dibujado y su ancho CSS.
 *
 * @param {import("playwright").Page} page - Página del navegador.
 * @param {number} pageNumber - Página del PDF.
 * @returns {Promise<{ drawn: boolean, width: number }>} Estado del lienzo.
 */
async function canvasState(page, pageNumber) {
  const canvas = page.locator(`canvas[aria-label$="página ${pageNumber}"]`).first();
  await canvas.waitFor({ state: "attached", timeout: 10_000 });
  return canvas.evaluate((element) => {
    const { data } = element.getContext("2d").getImageData(0, 0, element.width, element.height);
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

/**
 * Comprueba en el visor abierto la navegación entre páginas (incluido el límite superior) y el zoom.
 *
 * @param {import("playwright").Page} page - Página con el visor PDF abierto.
 * @returns {Promise<void>} Finaliza si ambas funciones responden.
 */
async function assertPagingAndZoom(page) {
  const pageInput = page.getByLabel("Página actual");
  await pageInput.fill("2");
  await pageInput.press("Enter");
  await eventually(async () => (await pageInput.inputValue()) === "2", "el control no muestra la página 2");
  await eventually(async () => (await canvasState(page, 2)).drawn, "la página 2 no se dibujó");
  await pageInput.fill(String(PAGE_COUNT + 5));
  await pageInput.press("Enter");
  await eventually(async () => (await pageInput.inputValue()) === String(PAGE_COUNT), "la página no se limita al total");

  const initial = (await canvasState(page, 1)).width;
  await page.getByRole("button", { name: "Acercar" }).first().click();
  await eventually(async () => (await canvasState(page, 1)).width > initial * 1.15, "acercar no amplió la página");
  await page.getByRole("button", { name: "Alejar" }).first().click();
  await page.getByRole("button", { name: "Alejar" }).first().click();
  await eventually(async () => (await canvasState(page, 1)).width < initial, "alejar no redujo la página");
}

// --- PDF de proyectos ---------------------------------------------------------------------------

test("proyecto: el visor muestra el PDF servido como descarga con CSP estricta y sandbox", async (context) => {
  const { page, pdfResponses } = await openFixture(context, { fixture: "project-pdf-viewer.html" });
  await eventually(async () => (await canvasState(page, 1)).drawn, "la primera página no se dibujó");
  assert.equal(pdfResponses.length, 1);
  assert.match(pdfResponses[0]["content-disposition"], /^attachment;/);
  assert.match(pdfResponses[0]["content-security-policy"], /^default-src 'none';.*; sandbox$/);
  assert.equal(pdfResponses[0]["content-type"], "application/pdf");
  assert.equal(await page.getByLabel("Página actual").inputValue(), "1");
  // Control de la prueba de solicitudes: en proyectos el panel de observaciones sí existe.
  assert.ok(await page.getByRole("button", { name: "Enviar observación" }).count() > 0);
});

test("proyecto: el visor conserva cambio de páginas y zoom", async (context) => {
  const { page } = await openFixture(context, { fixture: "project-pdf-viewer.html" });
  await eventually(async () => (await canvasState(page, 1)).drawn, "la primera página no se dibujó");
  await assertPagingAndZoom(page);
});

test("proyecto: abrir la URL del PDF directamente descarga el archivo en lugar de mostrarlo", async (context) => {
  const { page } = await openFixture(context, { fixture: "project-pdf-viewer.html" });
  await eventually(async () => (await canvasState(page, 1)).drawn, "la primera página no se dibujó");
  const downloadPromise = page.waitForEvent("download");
  await page.evaluate((path) => { window.location.href = path; }, `${PROJECT_PDF_PATH}?versionId=9`);
  assert.equal((await downloadPromise).suggestedFilename(), "Plano general.pdf");
});

// --- PDF adjuntos a solicitudes -----------------------------------------------------------------

test("solicitud: el PDF adjunto se abre en el visor integrado, sin pestañas ni observaciones", async (context) => {
  const { page, pdfResponses, popups } = await openFixture(context, { fixture: "project-request-pdf.html" });
  const trigger = page.getByRole("button", { name: "Memoria descriptiva.pdf" });
  assert.equal(await trigger.getAttribute("aria-haspopup"), "dialog");
  await trigger.click();

  await eventually(async () => (await canvasState(page, 1)).drawn, "la primera página no se dibujó");
  assert.deepEqual(popups, [], "no debe abrirse ninguna pestaña");
  assert.equal(pdfResponses.length, 1);
  assert.match(pdfResponses[0]["content-disposition"], /^attachment;/);
  assert.equal(pdfResponses[0]["content-security-policy"], "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox");
  // Sin observaciones: no hay panel ni consultas de comentarios (cualquier HTTP inesperado falla la prueba).
  assert.equal(await page.getByRole("button", { name: "Enviar observación" }).count(), 0);
  await assertPagingAndZoom(page);
});

test("solicitud: Escape cierra solo el visor y devuelve el foco al adjunto", async (context) => {
  const { page } = await openFixture(context, { fixture: "project-request-pdf.html" });
  const trigger = page.getByRole("button", { name: "Memoria descriptiva.pdf" });
  await trigger.click();
  await eventually(async () => (await canvasState(page, 1)).drawn, "la primera página no se dibujó");

  await page.keyboard.press("Escape");
  await eventually(async () => (await page.locator("canvas").count()) === 0, "el visor no se cerró");
  assert.equal(await page.getByRole("dialog", { name: /Casa Norte|revisi/i }).first().isVisible(), true, "el modal de revisión sigue abierto");
  await eventually(async () => trigger.evaluate((element) => element === document.activeElement), "el foco no volvió al adjunto");
});

test("solicitud: el visor informa el error de carga sin abrir pestañas", async (context) => {
  const { page, popups } = await openFixture(context, { fixture: "project-request-pdf.html", pdfStatus: 404 });
  await page.getByRole("button", { name: "Memoria descriptiva.pdf" }).click();
  await page.getByText("No se pudo cargar el documento").waitFor({ timeout: 10_000 });
  assert.deepEqual(popups, []);
});

test("solicitud: los adjuntos que no son PDF conservan su enlace actual", async (context) => {
  const { page } = await openFixture(context, { fixture: "project-request-pdf.html" });
  const imageLink = page.getByRole("link", { name: "Fachada.png" });
  assert.equal(await imageLink.getAttribute("href"), "/api/project-requests/7/files/32/content");
  assert.equal(await imageLink.getAttribute("target"), "_blank");
  assert.equal(await page.getByRole("link", { name: "Memoria descriptiva.pdf" }).count(), 0, "el PDF ya no es un enlace externo");
});

test("solicitud: el visor funciona en móvil (375 px) sin panel de observaciones", async (context) => {
  const { page } = await openFixture(context, { fixture: "project-request-pdf.html", viewport: { height: 812, width: 375 } });
  await page.getByRole("button", { name: "Memoria descriptiva.pdf" }).click();
  await eventually(async () => (await canvasState(page, 1)).drawn, "la primera página no se dibujó en móvil");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `desbordamiento horizontal de ${overflow}px`);
  await page.getByRole("button", { name: "Cerrar visor" }).first().click();
  await eventually(async () => (await page.locator("canvas").count()) === 0, "el visor no se cerró desde el botón");
});
