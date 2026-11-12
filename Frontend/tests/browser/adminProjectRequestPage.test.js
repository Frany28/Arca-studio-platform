import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { applyBrowserTimeouts, NAVIGATION_TIMEOUT_MS } from "../helpers/browserTimeouts.js";

const WIDTHS = [375, 768, 1024, 1440];
const DETAIL_PATH = "/api/admin/project-requests/9";
const SHELL_READS = new Set(["/api/auth/me", "/api/projects"]);
// Vista previa de la imagen adjunta (fachada.png): se lee del endpoint autenticado al acercarse al
// viewport. PNG real de 1 × 1 para que el navegador la decodifique.
const IMAGE_PREVIEW_PATTERN = /^\/api\/project-requests\/\d+\/files\/32\/content$/;
const PDF_CONTENT_PATH = "/api/project-requests/9/files/31/content";
const PNG_PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
/**
 * Lecturas ajenas a la consulta (shell y vistas previas de imagen), fuera de los contratos de
 * lectura de cada prueba.
 *
 * @param {string} path - Ruta leída.
 * @returns {boolean} true si es una lectura de fondo.
 */
const isBackgroundRead = (path) => SHELL_READS.has(path) || IMAGE_PREVIEW_PATTERN.test(path);
// Detalle ficticio con la forma de GET /admin/project-requests/:id (datos aislados).
const REQUEST = Object.freeze({
  assignees: [{ hasProfilePhoto: false, id: 5, name: "Ana Pérez", roleCode: "architect" }],
  capitalAvailability: "available_now",
  clientId: 3,
  compatibility: { level: "excellent", score: 92 },
  completeness: { answered: 12, applicable: 13, missingFields: ["experience"], score: 92.3 },
  convertedProject: null,
  createdAt: "2026-10-01T12:00:00.000Z",
  decisionMaker: "self",
  description: "Remodelación integral de una vivienda con áreas abiertas y materiales sostenibles.",
  developmentMode: "full",
  files: [
    { createdAt: "2026-10-01T12:05:00.000Z", fileType: "application/pdf", id: 31, name: "plano.pdf", size: 2048 },
    { createdAt: "2026-10-01T12:06:00.000Z", fileType: "image/png", id: 32, name: "fachada.png", size: 5242880 },
  ],
  financialViability: {
    findings: [{ code: "CAPITAL_TIMING_MISMATCH", explanation: "El capital no coincide con el inicio previsto.", outcome: "REVIEW_REQUIRED" }],
    score: 85,
    status: "REVIEW_REQUIRED",
  },
  formattedAddress: "Maracaibo, Zulia, Venezuela",
  hasPlans: true,
  id: 9,
  investmentRange: "10k_50k",
  landStatus: "available",
  legalDocumentationStatus: "available",
  legalDocumentTypes: ["property_deed"],
  location: "Maracaibo, Zulia",
  projectName: "Casa Prueba",
  projectSize: "medium_80_200",
  projectType: "residential",
  quality: "standard",
  referenceLink: "https://example.com/referencia",
  requestedBy: 11,
  reviewObservations: [],
  reviews: [{ meetingRecommendation: "SCHEDULE_MEETING", note: "Viable.", recommendation: "approve", reviewer: { id: 5, name: "Ana Pérez" }, updatedAt: "2026-10-02T12:00:00.000Z" }],
  standRequirements: null,
  startTime: "immediate",
  status: "pending_review",
});
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({ root: fileURLToPath(new URL("../../", import.meta.url)), cacheDir: getBrowserTestCacheDir(import.meta.url), configFile: false, envDir: false,
    plugins: [react(), tailwindcss()], define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
    server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.ARCA_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
});
after(async () => { await browser?.close(); await server?.close(); });

/**
 * Abre la consulta real aislando HTTP: cualquier mutación o lectura no prevista falla la prueba.
 *
 * @param {Object} context - Contexto de node:test.
 * @param {Object} [options] - Ruta, tema, viewport, respuesta del detalle, otros detalles por ruta,
 *   rol de la sesión, reloj simulado, si una lectura no prevista debe fallar la prueba y el
 *   manejador de mutaciones autorizadas (`mutation(route, call)`; sin él, toda mutación falla).
 * @returns {Promise<{page: import("playwright").Page, reads: Array<string>, mutations: Array<Object>}>}
 *   Página, lecturas y mutaciones registradas (método, ruta y cuerpo).
 */
async function openPage(context, { clock = false, detail = { json: { projectRequest: REQUEST } }, extraDetails = {}, mutation = null, path = "/solicitudes-proyecto/9", role = "admin", state = null, strictReads = true, theme = "light", viewport = { height: 1000, width: 1440 }, waitFor = "Casa Prueba" } = {}) {
  const session = await browser.newContext({ viewport });
  const page = applyBrowserTimeouts(await session.newPage());
  const errors = [];
  const reads = [];
  const mutations = [];
  await page.addInitScript(({ theme, state }) => {
    localStorage.setItem("arca-theme", theme);
    if (state) history.replaceState({ usr: state, key: "test", idx: 0 }, "");
  }, { state, theme });
  page.on("pageerror", (error) => errors.push(error.message));
  if (clock) await page.clock.install();
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      const call = { body: route.request().postDataJSON(), method: route.request().method(), path: pathname };
      mutations.push(call);
      if (mutation) return mutation(route, call);
      errors.push(`Mutación no autorizada: ${pathname}`);
      return route.abort();
    }
    reads.push(pathname);
    if (IMAGE_PREVIEW_PATTERN.test(pathname)) return route.fulfill({ body: PNG_PIXEL, contentType: "image/png" });
    if (pathname === DETAIL_PATH) {
      const response = typeof detail === "function" ? await detail(reads.filter((read) => read === DETAIL_PATH).length) : detail;
      return response === "abort" ? route.abort() : route.fulfill(response);
    }
    if (extraDetails[pathname]) {
      // Respuesta fija o función por intento ("abort" simula un fallo de red).
      const response = typeof extraDetails[pathname] === "function" ? await extraDetails[pathname]() : extraDetails[pathname];
      return response === "abort" ? route.abort() : route.fulfill(response);
    }
    const payload = {
      "/api/auth/me": { user: { email: "admin@example.test", firstName: "Admin", id: 1, lastName: "Prueba", role, status: "active" } },
      "/api/admin/users/11": { user: { companyName: "Empresa Prueba", id: 11, name: "Cliente Prueba" } },
      // Lo solicita el proveedor compartido de proyectos recientes del shell, no la vista.
      "/api/projects": { nextCursor: null, projects: [] },
    }[pathname];
    if (!payload && strictReads) errors.push(`Lectura no prevista: ${pathname}`);
    return route.fulfill({ json: payload || {}, status: payload ? 200 : 404 });
  });
  context.after(async () => { await session.close(); assert.deepEqual(errors, []); });
  await page.goto(`${origin}${path}`);
  await page.getByText(waitFor, { exact: true }).first().waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
  await page.evaluate(() => document.fonts.ready);
  return { mutations, page, reads };
}

test("muestra la solicitud real con una única lectura, la vista previa de la imagen y sin descargar documentos", async (context) => {
  const { page, reads } = await openPage(context);

  await page.getByRole("heading", { level: 1, name: "Casa Prueba" }).waitFor();
  await page.getByText("Proyecto Residencial", { exact: true }).waitFor();
  assert.equal(await page.getByRole("progressbar", { name: /^Compatibilidad: 92 de 100/ }).count(), 1);
  assert.equal(await page.locator("[aria-current='step']").innerText().then((text) => text.includes("Revisión")), true);
  const financial = page.locator("[data-metric='financial-viability']");
  assert.equal(await financial.getByRole("progressbar").getAttribute("aria-valuenow"), "85");
  assert.match(await financial.innerText(), /85%/);
  assert.doesNotMatch(await financial.innerText(), /Requiere revisión financiera/);
  await page.getByText("92%", { exact: true }).last().waitFor();
  for (const text of ["$10,000 - $50,000 USD", "Disponible ahora", "plano.pdf", "fachada.png", "Responsables asignados", "Recomienda aprobar"]) {
    await page.getByText(text, { exact: true }).first().waitFor();
  }
  await page.getByRole("link", { name: "Dashboard" }).waitFor();
  assert.deepEqual(reads.filter((read) => !isBackgroundRead(read)), [DETAIL_PATH]);
  // La imagen adjunta se ve como vista previa; el PDF conserva su icono y no se descarga.
  await page.locator("[data-preview='image']").waitFor();
  assert.equal(reads.includes(PDF_CONTENT_PATH), false);
});

test("el resumen reutiliza el drawer y solo entonces consulta al cliente", async (context) => {
  const { page, reads } = await openPage(context);

  await page.getByRole("button", { name: "Ver resumen & recomendación" }).click();
  const drawer = page.getByRole("dialog", { name: "Detalles de solicitud" });
  await drawer.getByText("Cliente Prueba", { exact: true }).waitFor();
  await drawer.getByText("Agendar reunión", { exact: true }).waitFor();
  assert.equal(await drawer.getByRole("button", { name: "Ver solicitud" }).count(), 0);
  assert.deepEqual(reads.filter((read) => !isBackgroundRead(read)), [DETAIL_PATH, "/api/admin/users/11"]);
});

test("la viabilidad porcentual coincide en detalle y resumen, sin datos de prototipo", async (context) => {
  for (const score of [95, 0, null]) {
    const { page } = await openPage(context, { detail: { json: { projectRequest: {
      ...REQUEST, financialViability: { findings: [], score, status: "NO_OBVIOUS_CONFLICT" },
    } } } });
    const metric = page.locator("[data-metric='financial-viability']");
    if (score == null) {
      assert.equal(await metric.getByRole("progressbar").count(), 0);
      await metric.getByText("Información no disponible", { exact: true }).waitFor();
    } else {
      assert.equal(await metric.getByRole("progressbar", { name: `Viabilidad financiera: ${score}%` }).getAttribute("aria-valuenow"), String(score));
      assert.match(await metric.innerText(), new RegExp(`${score}%`));
    }
    await page.getByRole("button", { name: "Ver resumen & recomendación" }).click();
    const drawer = page.getByRole("dialog", { name: "Detalles de solicitud" });
    const drawerMetric = drawer.locator("[data-metric='financial-viability']");
    if (score == null) {
      assert.equal(await drawerMetric.getByRole("progressbar").count(), 0);
    } else {
      assert.equal(await drawerMetric.getByRole("progressbar").getAttribute("aria-valuenow"), String(score));
      assert.match(await drawerMetric.innerText(), new RegExp(`${score}%`));
      assert.equal(await drawerMetric.locator(".progress-fill-reveal").count(), 1);
    }
    assert.doesNotMatch(await drawerMetric.innerText(), /Subtítulo aquí|Sin incoherencias financieras detectadas/);
  }
});

test("responsive sin desbordamiento horizontal en claro y oscuro", async (context) => {
  for (const theme of ["light", "dark"]) {
    for (const width of WIDTHS) {
      const { page } = await openPage(context, { theme, viewport: { height: 900, width } });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${theme} ${width}px desborda ${overflow}px`);
      const visibleStages = await page.locator("section[aria-label='Solicitud de proyecto'] p:text-is('Revisión')").evaluateAll((nodes) => nodes.filter((node) => node.offsetParent).length);
      assert.equal(visibleStages, 1, `${theme} ${width}px etapa en curso visible`);
      await page.getByRole("group", { name: "Acciones de la solicitud" }).waitFor();
    }
  }
});

test("una solicitud convertida ofrece su proyecto y conserva el contexto de origen", async (context) => {
  const converted = { ...REQUEST, convertedProject: { id: 40, name: "Casa Prueba", publicSlug: "solicitud-9", status: "pending" }, status: "converted" };
  const { page } = await openPage(context, {
    detail: { json: { projectRequest: converted } },
    state: { from: { label: "Gestión", to: "/gestion-proyectos" } },
  });

  await page.getByText("Proyecto creado", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Ver proyecto" }).count(), 1);
  assert.equal(await page.getByRole("link", { name: "Gestión" }).getAttribute("href"), "/gestion-proyectos");
});

test("estados de inexistencia, permisos, conexión y reintento", async (context) => {
  const notFound = await openPage(context, { detail: { json: { code: "PROJECT_REQUEST_NOT_FOUND", message: "No encontrada" }, status: 404 }, waitFor: "La solicitud no existe" });
  assert.equal(await notFound.page.getByRole("button", { name: "Reintentar" }).count(), 0);

  await openPage(context, { detail: { json: { code: "FORBIDDEN", message: "Sin permiso" }, status: 403 }, waitFor: "No tienes permisos para ver esta solicitud" });

  const invalid = await openPage(context, { path: "/solicitudes-proyecto/abc", waitFor: "La solicitud no existe" });
  assert.deepEqual(invalid.reads.filter((read) => !isBackgroundRead(read)), []);

  const retry = await openPage(context, {
    detail: (attempt) => (attempt === 1 ? "abort" : { json: { projectRequest: REQUEST } }),
    waitFor: "No se pudo conectar con el servidor",
  });
  await retry.page.getByRole("button", { name: "Reintentar" }).click();
  await retry.page.getByRole("heading", { level: 1, name: "Casa Prueba" }).waitFor();
});

// --- Fase 2: revalidación sin tiempo real ---

/** Promesa resoluble desde la prueba para retener una respuesta del detalle. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
/** Cuenta las lecturas del detalle registradas hasta el momento. */
function detailReads(reads, path = DETAIL_PATH) {
  return reads.filter((read) => read === path).length;
}
/** Espera a que el detalle se haya leído `count` veces. */
async function waitDetailReads(page, reads, count, path = DETAIL_PATH) {
  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  while (detailReads(reads, path) < count) {
    if (Date.now() > deadline) throw new Error(`Se esperaban ${count} lecturas de ${path}`);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
}

test("al volver a la pestaña revalida en segundo plano y avisa de cambios hechos por otra persona", async (context) => {
  const held = deferred();
  const converted = { ...REQUEST, convertedProject: { id: 40, name: "Casa Prueba", publicSlug: "solicitud-9", status: "pending" }, status: "converted" };
  const { page, reads } = await openPage(context, {
    clock: true,
    detail: (attempt) => (attempt === 1 ? { json: { projectRequest: REQUEST } } : held.promise),
  });
  const showTab = () => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  // Volver enseguida no repite la lectura (intervalo mínimo desde la carga).
  await showTab();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(detailReads(reads), 1);

  await page.clock.fastForward("00:31");
  await showTab();
  await waitDetailReads(page, reads, 2);
  // Mientras revalida se conserva lo mostrado, sin skeleton.
  await page.getByRole("heading", { level: 1, name: "Casa Prueba" }).waitFor();
  assert.equal(await page.getByLabel("Cargando solicitud").count(), 0);
  assert.equal(await page.getByText("Solicitud actualizada", { exact: true }).count(), 0);

  held.resolve({ json: { projectRequest: converted } });
  await page.getByText("Solicitud actualizada", { exact: true }).waitFor();
  await page.getByText(/Ahora está en estado «Proyecto creado»/).waitFor();
  await page.getByRole("button", { name: "Ver proyecto" }).waitFor();
  assert.equal(await page.getByText("Solicitud aprobada", { exact: true }).count(), 0);
});

test("sin cambios no avisa; un fallo conserva la solicitud y permite reintentar", async (context) => {
  const withNewReview = {
    ...REQUEST,
    reviews: [...REQUEST.reviews, { meetingRecommendation: "DO_NOT_SCHEDULE_MEETING", note: "Revisar costos.", recommendation: "request_changes", reviewer: { id: 6, name: "Luis Mora" }, updatedAt: "2026-10-03T12:00:00.000Z" }],
  };
  const responses = [{ json: { projectRequest: REQUEST } }, { json: { projectRequest: { ...REQUEST } } }, "abort", { json: { projectRequest: withNewReview } }];
  const { page, reads } = await openPage(context, { detail: (attempt) => responses[attempt - 1] });
  const reconnect = () => page.evaluate(() => window.dispatchEvent(new Event("online")));

  await reconnect();
  await waitDetailReads(page, reads, 2);
  await page.waitForLoadState("networkidle");
  assert.equal(await page.getByText("Solicitud actualizada", { exact: true }).count(), 0);

  await reconnect();
  await page.getByText("No se pudo actualizar la solicitud", { exact: true }).waitFor();
  await page.getByRole("heading", { level: 1, name: "Casa Prueba" }).waitFor();

  await page.getByRole("button", { name: "Reintentar" }).click();
  await page.getByText("Solicitud actualizada", { exact: true }).waitFor();
  await page.getByText(/responsables o revisiones/).waitFor();
  // La revisión nueva se muestra sin recargar la vista.
  await page.getByText("Revisar costos.", { exact: true }).waitFor();
  assert.equal(detailReads(reads), 4);
});

test("si la solicitud deja de existir, la revalidación sustituye el contenido por su estado", async (context) => {
  const { page } = await openPage(context, {
    detail: (attempt) => (attempt === 1 ? { json: { projectRequest: REQUEST } } : { json: { code: "PROJECT_REQUEST_NOT_FOUND", message: "No encontrada" }, status: 404 }),
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByText("La solicitud no existe", { exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { level: 1, name: "Casa Prueba" }).count(), 0);
  assert.equal(await page.getByText("No se pudo actualizar la solicitud", { exact: true }).count(), 0);
});

test("una revalidación tardía no sobrescribe otra solicitud tras navegar", async (context) => {
  const held = deferred();
  const otherPath = "/api/admin/project-requests/10";
  const { page, reads } = await openPage(context, {
    detail: (attempt) => (attempt === 1 ? { json: { projectRequest: REQUEST } } : held.promise),
    extraDetails: { [otherPath]: { json: { projectRequest: { ...REQUEST, id: 10, projectName: "Casa Diez" } } } },
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitDetailReads(page, reads, 2);

  await page.evaluate(() => {
    history.pushState(history.state, "", "/solicitudes-proyecto/10");
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  });
  await page.getByRole("heading", { level: 1, name: "Casa Diez" }).waitFor();
  held.resolve({ json: { projectRequest: { ...REQUEST, projectName: "Respuesta obsoleta", status: "rejected" } } });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.getByRole("heading", { level: 1, name: "Casa Diez" }).count(), 1);
  assert.equal(await page.getByText("Respuesta obsoleta").count(), 0);
  assert.equal(await page.getByText("Solicitud actualizada", { exact: true }).count(), 0);
});

test("solo administradores: otro rol se redirige sin leer el detalle", async (context) => {
  const { page, reads } = await openPage(context, { role: "architect", strictReads: false, waitFor: "Solicitudes asignadas" });
  assert.notEqual(new URL(page.url()).pathname, "/solicitudes-proyecto/9");
  assert.equal(detailReads(reads), 0);
});

// --- Fase 3: acciones administrativas ---

const DECISION_PATH = "/api/admin/project-requests/9/decision";
const CONVERTED = Object.freeze({ ...REQUEST, convertedProject: { id: 40, name: "Casa Prueba", publicSlug: "solicitud-9", status: "pending" }, status: "converted" });

/** Nombres visibles de los botones de la barra inferior, en orden. */
async function actionBarButtons(page) {
  return page.getByRole("group", { name: "Acciones de la solicitud" }).getByRole("button").allInnerTexts();
}

/** Escribe el motivo, confirma la decisión y espera a que la API la reciba. */
async function confirmDecision(page, mutations, note, actionLabel = "Confirmar decisión") {
  // La aprobación es una alerta modal (alertdialog); el resto de decisiones, un dialog.
  const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog"));
  if (note !== undefined) await dialog.getByRole("textbox").fill(note);
  const before = mutations.length;
  await dialog.getByRole("button", { name: actionLabel, exact: true }).click();
  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  while (mutations.length === before) {
    if (Date.now() > deadline) throw new Error("La decisión no llegó a la API");
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
}

test("la barra sigue el orden de Figma y cada estado ofrece solo sus acciones válidas", async (context) => {
  const cases = [
    ["pending_review", { ...REQUEST }, ["Ver resumen & recomendación", "Rechazar", "Solicitar más información", "Aprobar"], false],
    ["pending_verification", { ...REQUEST, assignees: [], reviews: [], status: "pending_verification" }, ["Ver resumen & recomendación", "Rechazar", "Solicitar más información", "Aprobar"], false],
    ["changes_requested", { ...REQUEST, status: "changes_requested" }, ["Ver resumen & recomendación"], null],
    ["rejected", { ...REQUEST, status: "rejected" }, ["Ver resumen & recomendación"], null],
    ["converted", CONVERTED, ["Ver resumen & recomendación", "Ver proyecto", "Crear cotización"], null],
    // Convertida cuyo proyecto ya no existe: sin destino ni cotización posibles.
    ["converted sin proyecto", { ...REQUEST, convertedProject: null, status: "converted" }, ["Ver resumen & recomendación"], null],
  ];
  for (const [label, projectRequest, expected, disabled] of cases) {
    const { page, mutations } = await openPage(context, { detail: { json: { projectRequest } } });
    assert.deepEqual(await actionBarButtons(page), expected, label);
    if (disabled !== null) {
      const approve = page.getByRole("button", { name: "Aprobar", exact: true });
      assert.equal(await approve.isDisabled(), disabled, `${label}: Aprobar`);
    }
    assert.deepEqual(mutations, [], label);
  }
});

test("rechazar exige motivo, confirma contra la API y solo entonces avisa y actualiza el estado", async (context) => {
  const held = deferred();
  const rejected = { ...REQUEST, rejectionReason: "El presupuesto no cubre el alcance.", status: "rejected", updatedAt: "2026-10-05T12:00:00.000Z" };
  const { page, mutations, reads } = await openPage(context, {
    detail: (attempt) => ({ json: { projectRequest: attempt === 1 ? REQUEST : rejected } }),
    mutation: async (route) => route.fulfill(await held.promise),
  });

  await page.getByRole("button", { name: "Rechazar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  // Modal propio de rechazo (estilo Figma 3727:618488, motivo obligatorio), sin releer el detalle.
  await dialog.getByRole("heading", { name: "¿Deseas rechazar la solicitud?" }).waitFor();
  // El administrador decide: su modal nunca ofrece las recomendaciones del arquitecto.
  assert.equal(await dialog.getByRole("button", { name: /Recomendar/ }).count(), 0);
  assert.equal(await dialog.getByText(/recomendaci/i).count(), 0);
  // Mismo ancho de 400 px que el modal de rechazo de Figma.
  assert.equal(Math.round((await dialog.boundingBox()).width), 400);
  // Captura opcional para la revisión visual manual (no se guarda en el repositorio).
  if (process.env.ARCA_REVIEW_CAPTURE_DIR) {
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${process.env.ARCA_REVIEW_CAPTURE_DIR}/admin-reject.png` });
  }
  await dialog.getByRole("button", { name: "Rechazar", exact: true }).click();
  await dialog.getByText("Explica el motivo de tu decisión con al menos 10 caracteres.", { exact: true }).waitFor();
  assert.deepEqual(mutations, []);
  assert.equal(detailReads(reads), 1);

  await confirmDecision(page, mutations, "El presupuesto no cubre el alcance.", "Rechazar");
  assert.deepEqual(mutations, [{ body: { action: "reject", reason: "El presupuesto no cubre el alcance." }, method: "PATCH", path: DECISION_PATH }]);
  // Nunca hay éxito antes de la confirmación del servidor.
  assert.equal(await page.getByText("Solicitud rechazada", { exact: true }).count(), 0);
  await dialog.getByRole("button", { name: "Rechazando..." }).waitFor();

  held.resolve({ json: { project: null, projectRequest: { id: 9, rejectionReason: "El presupuesto no cubre el alcance.", reviewedAt: "2026-10-05T12:00:00.000Z", status: "rejected" } } });
  await page.getByText("Solicitud rechazada", { exact: true }).waitFor();
  await page.getByText("El cliente recibirá el motivo del rechazo.", { exact: true }).waitFor();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(await actionBarButtons(page), ["Ver resumen & recomendación"]);
  await page.getByText("Rechazada", { exact: true }).first().waitFor();
  // Relectura en segundo plano del estado vigente, sin skeleton ni aviso de cambios externos.
  await waitDetailReads(page, reads, 2);
  await page.waitForLoadState("networkidle");
  assert.equal(await page.getByLabel("Cargando solicitud").count(), 0);
  assert.equal(await page.getByText("Solicitud actualizada", { exact: true }).count(), 0);
  assert.equal(detailReads(reads), 2);
});

test("solicitar más información muestra el modal de Figma, el contacto real y conserva el flujo de correcciones", async (context) => {
  const { page, mutations } = await openPage(context, {
    detail: (attempt) => ({ json: { projectRequest: attempt === 1 ? REQUEST : { ...REQUEST, correctionReason: "Adjunta el plano del terreno.", status: "changes_requested" } } }),
    extraDetails: {
      "/api/admin/users/11": { json: { user: { id: 11, name: "Cliente Prueba", email: "cliente@example.com", phone: "+58 414 1234567" } } },
    },
    mutation: (route) => route.fulfill({ json: { project: null, projectRequest: { correctionReason: "Adjunta el plano del terreno.", id: 9, reviewedAt: "2026-10-05T12:00:00.000Z", status: "changes_requested" } } }),
  });

  await page.getByRole("button", { name: "Solicitar más información", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Solicitar información adicional" });
  await dialog.getByText("cliente@example.com", { exact: true }).waitFor();
  await dialog.getByText("+58 414 1234567", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Enviar correo" }).isDisabled(), false);
  assert.equal(await dialog.getByRole("button", { name: "Abrir WhatsApp" }).isDisabled(), false);
  await dialog.getByRole("button", { name: "Finalizar", exact: true }).click();
  await dialog.getByText("Explica el motivo de tu decisión con al menos 10 caracteres.").waitFor();
  assert.deepEqual(mutations, [], "no se guarda sin especificar información faltante");

  await page.evaluate(() => {
    window.__contactsCopied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => window.__contactsCopied.push(value) },
    });
  });
  await dialog.getByRole("button", { name: "Copiar correo" }).click();
  await dialog.getByRole("button", { name: "Copiar teléfono" }).click();
  assert.deepEqual(await page.evaluate(() => window.__contactsCopied), ["cliente@example.com", "+58 414 1234567"]);

  await confirmDecision(page, mutations, "Adjunta el plano del terreno.", "Finalizar");
  assert.deepEqual(mutations[0].body, { action: "request_changes", reason: "Adjunta el plano del terreno." });
  await page.getByText("Correcciones solicitadas", { exact: true }).first().waitFor();
  await page.getByText("El cliente podrá editar la solicitud y volver a enviarla.", { exact: true }).waitFor();
  assert.deepEqual(await actionBarButtons(page), ["Ver resumen & recomendación"]);
  // Los datos de la solicitud se conservan.
  for (const text of ["Casa Prueba", "plano.pdf", "Recomienda aprobar"]) await page.getByText(text, { exact: true }).first().waitFor();
});

test("el contacto faltante no se inventa y Cancelar no envía la solicitud", async (context) => {
  const { page, mutations } = await openPage(context);
  await page.getByRole("button", { name: "Solicitar más información", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Solicitar información adicional" });
  await dialog.getByText("No registrado", { exact: true }).first().waitFor();
  assert.equal(await dialog.getByText("No registrado", { exact: true }).count(), 2);
  assert.equal(await dialog.getByRole("button", { name: "Enviar correo" }).isDisabled(), true);
  assert.equal(await dialog.getByRole("button", { name: "Abrir WhatsApp" }).isDisabled(), true);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(mutations, []);
});

test("aprobar crea el proyecto una sola vez, lo muestra y permite iniciar su cotización", async (context) => {
  const held = deferred();
  const { page, mutations, reads } = await openPage(context, {
    detail: (attempt) => ({ json: { projectRequest: attempt === 1 ? REQUEST : CONVERTED } }),
    mutation: async (route) => route.fulfill(await held.promise),
  });

  await page.getByRole("button", { name: "Aprobar", exact: true }).click();
  // Confirmación con estilo de alerta: sin campos, solo «Cancelar» / «Aprobar».
  const dialog = page.getByRole("alertdialog", { name: "¿Deseas aprobar la solicitud?" });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("textbox").count(), 0);
  assert.equal(await dialog.getByText(/recomendaci/i).count(), 0);
  await confirmDecision(page, mutations, undefined, "Aprobar");
  // Un segundo clic durante el envío no repite la decisión.
  await dialog.getByRole("button", { name: "Aprobando..." }).click({ force: true });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].body, { action: "approve" });

  held.resolve({ json: { project: { id: 40, name: "Casa Prueba", status: "pending" }, projectRequest: { convertedProjectId: 40, id: 9, reviewedAt: "2026-10-05T12:00:00.000Z", status: "converted" } } });
  await page.getByText("Solicitud aprobada", { exact: true }).waitFor();
  await page.getByText("Proyecto creado correctamente.", { exact: true }).waitFor();
  // La relectura incorpora el proyecto creado (con su slug real) y el historial se conserva.
  await page.getByRole("button", { name: "Crear cotización", exact: true }).waitFor();
  assert.deepEqual(await actionBarButtons(page), ["Ver resumen & recomendación", "Ver proyecto", "Crear cotización"]);
  await page.getByText("Recomienda aprobar", { exact: true }).waitFor();
  assert.equal(detailReads(reads), 2);
  assert.equal(await page.getByRole("button", { name: "Aprobar", exact: true }).count(), 0);
  assert.equal(mutations.length, 1);
});

test("el administrador aprueba directamente una solicitud sin arquitectos ni revisiones", async (context) => {
  const pending = { ...REQUEST, assignees: [], reviews: [], status: "pending_verification" };
  const converted = { ...CONVERTED, assignees: [], reviews: [] };
  const { page, mutations } = await openPage(context, {
    detail: (attempt) => ({ json: { projectRequest: attempt === 1 ? pending : converted } }),
    mutation: (route) => route.fulfill({
      json: {
        project: { id: 40, name: pending.projectName, status: "pending" },
        projectRequest: { convertedProjectId: 40, id: pending.id, status: "converted" },
      },
    }),
  });

  await page.getByRole("button", { name: "Aprobar", exact: true }).click();
  await confirmDecision(page, mutations, undefined, "Aprobar");
  assert.deepEqual(mutations[0].body, { action: "approve" });
  assert.equal(mutations.length, 1);
  await page.getByText("Solicitud aprobada", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Crear cotización", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Aprobar", exact: true }).count(), 0);
});

test("un conflicto por otro administrador conserva el modal, relee y avisa del cambio externo", async (context) => {
  const { page, mutations, reads } = await openPage(context, {
    detail: (attempt) => ({ json: { projectRequest: attempt === 1 ? REQUEST : { ...CONVERTED, updatedAt: "2026-10-05T12:00:00.000Z" } } }),
    mutation: (route) => route.fulfill({ json: { code: "PROJECT_REQUEST_INVALID_STATE", message: "Solo se pueden decidir solicitudes pendientes de evaluación o revisión." }, status: 409 }),
  });

  await page.getByRole("button", { name: "Rechazar", exact: true }).click();
  await confirmDecision(page, mutations, "Motivo escrito antes del conflicto.", "Rechazar");
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Solo se pueden decidir solicitudes pendientes de evaluación o revisión.", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("textbox").inputValue(), "Motivo escrito antes del conflicto.");
  await page.getByText("Solicitud actualizada", { exact: true }).waitFor();
  assert.equal(await page.getByText("Solicitud rechazada", { exact: true }).count(), 0);
  assert.equal(detailReads(reads), 2);

  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(await actionBarButtons(page), ["Ver resumen & recomendación", "Ver proyecto", "Crear cotización"]);
});

test("un fallo de red y un conflicto de nombre se muestran en el modal sin éxito ni relectura", async (context) => {
  const responses = [
    { json: { code: "PROJECT_NAME_ALREADY_EXISTS", message: "El cliente ya tiene un proyecto con el nombre de esta solicitud." }, status: 409 },
    "abort",
  ];
  const { page, mutations, reads } = await openPage(context, {
    mutation: (route, call) => {
      const response = responses[mutations.indexOf(call)];
      return response === "abort" ? route.abort() : route.fulfill(response);
    },
  });

  await page.getByRole("button", { name: "Aprobar", exact: true }).click();
  await confirmDecision(page, mutations, undefined, "Aprobar");
  const dialog = page.getByRole("alertdialog");
  await dialog.getByText("El cliente ya tiene un proyecto con el nombre de esta solicitud.", { exact: true }).waitFor();
  await confirmDecision(page, mutations, undefined, "Aprobar");
  await dialog.getByText(/conexión/i).first().waitFor();
  assert.equal(await page.getByText("Solicitud aprobada", { exact: true }).count(), 0);
  assert.equal(detailReads(reads), 1);
  assert.deepEqual(await actionBarButtons(page), ["Ver resumen & recomendación", "Rechazar", "Solicitar más información", "Aprobar"]);
});

test("una solicitud convertida abre su proyecto y la cotización precargada sin guardar nada", async (context) => {
  const project = { client: { id: 3, name: "Cliente Comercial" }, files: [], id: 40, name: "Casa Prueba", publicSlug: "solicitud-9", status: "pending" };
  const { page, mutations, reads } = await openPage(context, {
    detail: { json: { projectRequest: CONVERTED } },
    extraDetails: { "/api/projects/40": { json: { project } } },
    strictReads: false,
  });

  // «Ver proyecto» abre el proyecto creado por su slug real.
  await page.getByRole("button", { name: "Ver proyecto", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/proyectos/solicitud-9");
  await page.goBack();
  await page.getByRole("heading", { level: 1, name: "Casa Prueba" }).waitFor();

  await page.getByRole("button", { name: "Crear cotización", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/servicios-cotizaciones/cotizaciones/nueva" && url.searchParams.get("proyecto") === "40");
  await page.getByRole("button", { name: "Quitar Cliente Comercial" }).waitFor();
  await page.getByRole("button", { name: "Quitar Casa Prueba" }).waitFor();
  // Solo se lee el proyecto (StrictMode de desarrollo puede abortar y repetir la primera lectura);
  // no se crea la cotización ni se decide nada.
  assert.ok([1, 2].includes(reads.filter((read) => read === "/api/projects/40").length));
  assert.deepEqual(mutations, []);

  // Un enlace directo sin el parámetro abre el formulario vacío.
  await page.goto(`${origin}/servicios-cotizaciones/cotizaciones/nueva`);
  await page.getByText("Nombre del cliente", { exact: true }).first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Quitar Cliente Comercial" }).count(), 0);
});

test("la cotización ofrece reintentar o continuar vacía si el proyecto no se puede leer", async (context) => {
  const project = { client: { id: 3, name: "Cliente Comercial" }, files: [], id: 40, name: "Casa Prueba", status: "pending" };
  // Falla hasta pulsar «Reintentar», sin depender del número de montajes (StrictMode).
  let available = false;
  const retry = await openPage(context, {
    extraDetails: { "/api/projects/40": () => (available ? { json: { project } } : "abort") },
    path: "/servicios-cotizaciones/cotizaciones/nueva?proyecto=40",
    strictReads: false,
    waitFor: "No se pudo cargar el proyecto",
  });
  available = true;
  await retry.page.getByRole("button", { name: "Reintentar" }).click();
  await retry.page.getByRole("button", { name: "Quitar Cliente Comercial" }).waitFor();

  const missing = await openPage(context, {
    extraDetails: { "/api/projects/41": { json: { code: "PROJECT_NOT_FOUND", message: "Proyecto no encontrado." }, status: 404 } },
    path: "/servicios-cotizaciones/cotizaciones/nueva?proyecto=41",
    strictReads: false,
    waitFor: "El proyecto no está disponible",
  });
  await missing.page.getByRole("button", { name: "Crear sin proyecto" }).click();
  await missing.page.waitForURL((url) => url.pathname === "/servicios-cotizaciones/cotizaciones/nueva" && !url.searchParams.has("proyecto"));
  await missing.page.getByText("Nombre del cliente", { exact: true }).first().waitFor();
  assert.deepEqual([...retry.mutations, ...missing.mutations], []);
});

test("la barra es accesible por teclado y no desborda en tablet ni móvil, en claro y oscuro", async (context) => {
  for (const theme of ["light", "dark"]) {
    for (const width of [375, 768, 1024, 1440]) {
      const { page } = await openPage(context, { theme, viewport: { height: 900, width } });
      const bar = page.getByRole("group", { name: "Acciones de la solicitud" });
      const boxes = await bar.getByRole("button").evaluateAll((buttons) => buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { bottom: rect.bottom, left: rect.left, right: rect.right, text: button.innerText, top: rect.top };
      }));
      const groupBox = await bar.boundingBox();
      for (const box of boxes) {
        assert.ok(box.left >= groupBox.x - 0.5 && box.right <= groupBox.x + groupBox.width + 0.5, `${theme} ${width}px: ${box.text} dentro de la barra`);
      }
      const [summary, reject, info, approve] = boxes;
      if (width >= 1024) {
        // Escritorio: una fila con el resumen a la izquierda y Aprobar al final.
        assert.ok(Math.abs(summary.top - approve.top) < 1 && reject.left < info.left && info.left < approve.left, `${width}px en una fila`);
      } else if (width >= 768) {
        // Tablet: resumen en su fila y las tres decisiones juntas debajo.
        assert.ok(reject.top > summary.bottom && Math.abs(reject.top - approve.top) < 1, `${width}px en dos filas`);
      } else {
        // Móvil: Rechazar y Solicitar juntas; Aprobar en su propia fila a ancho completo.
        assert.ok(Math.abs(reject.top - info.top) < 1 && approve.top > info.bottom, `${width}px Aprobar en su fila`);
        assert.ok(Math.abs((approve.right - approve.left) - (info.right - reject.left)) < 1, `${width}px Aprobar a ancho completo`);
      }
    }
  }

  // Teclado: Tab llega a las acciones en orden y Enter abre la confirmación con el foco en
  // «Cancelar» (la opción segura); Escape la cierra y devuelve el foco a la acción.
  const { page } = await openPage(context);
  const focusedText = () => page.evaluate(() => document.activeElement?.innerText);
  await page.getByRole("button", { name: "Ver resumen & recomendación" }).focus();
  for (const label of ["Rechazar", "Solicitar más información", "Aprobar"]) {
    await page.keyboard.press("Tab");
    assert.equal(await focusedText(), label);
  }
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Aprobar", exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.innerText === "Cancelar");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.innerText === "Aprobar");
});

test("Project Info coincide con Figma: 900 × 73 en 1024 px, botones de 41 y Outline transparente", async (context) => {
  for (const theme of ["light", "dark"]) {
    const { page } = await openPage(context, { theme, viewport: { height: 900, width: 1024 } });
    const bar = page.getByRole("group", { name: "Acciones de la solicitud" });
    const geometry = await bar.evaluate((node) => {
      const style = getComputedStyle(node);
      const buttons = [...node.querySelectorAll("button")];
      return {
        width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
        radius: style.borderRadius, padding: style.padding,
        buttons: buttons.map((button) => ({ height: button.getBoundingClientRect().height, top: button.getBoundingClientRect().top, width: button.getBoundingClientRect().width })),
        gaps: buttons.slice(2).map((button, index) => button.getBoundingClientRect().left - buttons[index + 1].getBoundingClientRect().right),
      };
    });
    assert.equal(geometry.width, 900);
    assert.equal(geometry.height, 73);
    assert.equal(geometry.radius, "12px");
    assert.equal(geometry.padding, "16px");
    assert.ok(geometry.buttons.every((button) => button.height === 41 && button.top === geometry.buttons[0].top));
    assert.ok(geometry.buttons.every((button, index) => Math.abs(button.width - [216, 84, 181, 76][index]) < 1));
    assert.deepEqual(geometry.gaps, [16, 16]);

    for (const label of ["Ver resumen & recomendación", "Rechazar", "Solicitar más información"]) {
      const button = bar.getByRole("button", { name: label, exact: true });
      assert.equal(await button.evaluate((node) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
      await button.hover();
      assert.equal(await button.evaluate((node) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)", `${theme}: ${label} transparente también en hover`);
      await button.focus();
      assert.equal(await button.evaluate((node) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
    }
    assert.notEqual(await bar.getByRole("button", { name: "Aprobar", exact: true }).evaluate((node) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
  }
});

/**
 * Geometría de la barra inferior, su contenedor de scroll y la sección de gestión, tras desplazar
 * el contenido hasta el final.
 *
 * @param {import("playwright").Page} page - Página abierta.
 * @returns {Promise<Object>} Rectángulos redondeados.
 */
async function measureBottomLayout(page) {
  return page.evaluate(async () => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), width: Math.round(box.width) };
    };
    const surface = document.querySelector("[aria-label='Acciones de la solicitud']");
    const bar = surface.parentElement;
    const scroller = bar.parentElement;
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      bar: rect(bar),
      management: rect(document.querySelector("[aria-label='Gestión de la solicitud']")),
      scroller: rect(scroller),
      surface: rect(surface),
      viewportHeight: innerHeight,
    };
  });
}

test("la barra ocupa todo el contenedor de scroll, queda al pie y no tapa el último contenido", async (context) => {
  // Figma: 3727:687292 (1364 px), 1024 px (948), tablet vertical 3727:687677 (638) y móvil 3727:687788 (375).
  for (const [width, inset] of [[1440, 24], [1024, 24], [768, 24], [375, 16]]) {
    const { page } = await openPage(context, { viewport: { height: 800, width } });
    const layout = await measureBottomLayout(page);
    assert.equal(layout.bar.left, layout.scroller.left, `${width}px: la barra empieza en el borde del contenedor`);
    assert.equal(layout.bar.width, layout.scroller.width, `${width}px: la barra ocupa todo el contenedor`);
    assert.equal(layout.surface.left - layout.bar.left, inset, `${width}px: superficie a ${inset} px del borde`);
    assert.equal(layout.bar.bottom, layout.viewportHeight, `${width}px: la barra queda al pie del viewport`);
    assert.ok(layout.management.bottom <= layout.bar.top, `${width}px: el último contenido queda por encima de la barra`);
  }
});

test("la tarjeta sigue la composición de Figma y la gestión conserva estado, responsables y revisiones", async (context) => {
  const { page } = await openPage(context);
  const information = page.getByRole("region", { name: "Información de la solicitud" });
  // La tarjeta del diseño no incluye el estado; sus valores usan text-100 como en Figma.
  assert.equal(await information.getByText("Estado", { exact: true }).count(), 0);
  const dateValue = information.locator("dd").first();
  assert.equal(await dateValue.evaluate((node) => node.className.includes("--color-text-100")), true);

  const management = page.getByRole("region", { name: "Gestión de la solicitud" });
  await management.getByText("Estado de la solicitud", { exact: true }).waitFor();
  await management.getByText("En revisión", { exact: true }).waitFor();
  await management.getByText("Ana Pérez", { exact: true }).first().waitFor();
  await management.getByText("Recomienda aprobar", { exact: true }).waitFor();
  // La gestión se presenta después del bloque diseñado, no dentro de su segunda columna.
  const order = await page.evaluate(() => {
    const info = document.querySelector("[aria-label='Información de la solicitud']");
    const team = document.querySelector("[aria-label='Gestión de la solicitud']");
    return { nested: info.contains(team), after: Boolean(info.compareDocumentPosition(team) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  assert.deepEqual(order, { after: true, nested: false });
});

test("cabecera por rango: móvil 24 px e indicador de 64; tablet cuatro etapas con la vigente; escritorio cinco", async (context) => {
  const expectations = [
    [375, { indicator: 64, stages: ["Revisión", "Primer contacto"], title: "24px" }],
    [768, { indicator: 96, stages: ["Solicitud enviada", "Evaluación preliminar", "Revisión", "Primer contacto"], title: "48px" }],
    [1440, { indicator: 96, stages: ["Solicitud enviada", "Evaluación preliminar", "Revisión", "Primer contacto", "Propuesta inicial"], title: "48px" }],
  ];
  for (const [width, expected] of expectations) {
    const { page } = await openPage(context, { viewport: { height: 900, width } });
    const header = await page.evaluate(() => {
      const heading = document.querySelector("h1");
      const indicator = document.querySelector("[role='progressbar'][aria-label^='Compatibilidad']");
      const steps = [...heading.closest("section").querySelectorAll(":scope > div:last-child > div")]
        .filter((step) => step.offsetParent)
        .map((step) => step.querySelector("p").textContent);
      return { indicator: Math.round(indicator.getBoundingClientRect().width), stages: steps, title: getComputedStyle(heading).fontSize };
    });
    assert.deepEqual(header, expected, `${width}px`);
  }
});

test("un vídeo adjunto muestra un fotograma real solo al acercarse; los documentos no se leen", async (context) => {
  const video = { createdAt: "2026-10-01T12:07:00.000Z", fileType: "video/mp4", id: 33, name: "recorrido.mp4", size: 1024 };
  const contentPath = "/api/project-requests/9/files/33/content";
  let videoReads = 0;
  const { page, reads } = await openPage(context, {
    detail: { json: { projectRequest: { ...REQUEST, files: [...REQUEST.files, video] } } },
    // Contenido no decodificable: la miniatura no se obtiene y se usa la presentación por tipo.
    extraDetails: { [contentPath]: () => { videoReads += 1; return { body: Buffer.from("no-video"), contentType: "video/mp4", status: 200 }; } },
    viewport: { height: 700, width: 1440 },
  });
  assert.equal(videoReads, 0, "fuera del viewport no se lee el vídeo");
  const videoRequested = page.waitForRequest((request) => request.url().endsWith(contentPath));
  await page.getByText("recorrido.mp4", { exact: true }).scrollIntoViewIfNeeded();
  await videoRequested;
  // PDF y vídeo no decodificable con presentación por tipo; la imagen, con su vista previa.
  await page.waitForFunction(() => document.querySelectorAll("[data-preview='type']").length === 2
    && document.querySelectorAll("[data-preview='image']").length === 1);
  assert.ok(videoReads >= 1, "al acercarse se intenta leer el fotograma");
  assert.equal(reads.includes(PDF_CONTENT_PATH), false, "el PDF no se descarga");
});
