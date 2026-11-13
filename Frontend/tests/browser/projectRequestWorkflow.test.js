import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { getBrowserTestCacheDir } from "../helpers/browserViteCache.js";
import { PROJECT_REQUEST_CHANGES_REQUESTED_REASON } from "../../src/utils/projectRequestContactLinks.js";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const REQUEST = { id: 7, projectName: "Casa Norte", status: "pending_review", description: "Detalle técnico de la cola", assignees: [{ id: 9, name: "Ana" }] };
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
 * Intercepta HTTP del hook real y permite resolver lecturas y mutaciones de forma controlada.
 * Registra peticiones y errores; cada prueba dispone de sesión y transportes aislados.
 */
async function openPage(context, { role = "architect", queue = [REQUEST], queuePages = {}, overviewRequests, assignees = [], holdQueue = false, realDashboard = false, clientResponse, requestDetail } = {}) {
  const session = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await session.newPage();
  const calls = [];
  const mutations = [];
  const reads = [];
  const errors = [];
  const clientReads = [];
  await page.addInitScript(() => {
    window.__clientSignals = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      if (String(url).includes("/admin/users/")) window.__clientSignals.push(options?.signal);
      return originalFetch(url, options);
    };
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    // La query solo se registra si existe, para no alterar el registro que comparan otras pruebas.
    const search = new URL(request.url()).search;
    calls.push({ method: request.method(), path, body: request.postDataJSON(), ...(search ? { search } : {}) });
    if (request.method() !== "GET") { mutations.push(route); return; }
    if (path === "/api/admin/users/41" && clientResponse) {
      clientReads.push(route);
      await clientResponse(route, clientReads.length);
      return;
    }
    if (path === "/api/project-requests/review-queue") {
      if (holdQueue) { reads.push(route); return; }
      // Paginación por cursor: sin cursor, la primera página; queuePages define las siguientes.
      const cursor = new URL(request.url()).searchParams.get("cursor");
      const page = cursor ? queuePages[cursor] : { projectRequests: queue, nextCursor: queuePages.first ?? null };
      if (!page) { errors.push(`Cursor inesperado: ${cursor}`); await route.fulfill({ status: 400, json: { message: "Cursor" } }); return; }
      if (page.status) { await route.fulfill({ status: page.status, json: { message: page.message } }); return; }
      await route.fulfill({ json: { projectRequests: page.projectRequests, nextCursor: page.nextCursor ?? null } });
      return;
    }
    const fixtures = {
      "/api/auth/me": { user: { id: 1, firstName: "Workflow", email: "workflow@example.test", role, status: "active" } },
      "/api/projects": { projects: [], nextCursor: null },
      "/api/admin/dashboard-metrics": { metrics: {} },
      // overviewRequests puede ser una función para simular el estado vigente tras una mutación.
      "/api/admin/dashboard-overview": { overview: { recentActivity: [], newRequests: (typeof overviewRequests === "function" ? overviewRequests() : overviewRequests) || queue } },
      "/api/admin/assignees": { assignees },
      "/api/admin/users/41": { user: { id: 41, name: "Esteban Ruiz", companyName: "Nextj" } },
      // requestDetail puede ser una función para simular el detalle vigente tras una decisión.
      "/api/admin/project-requests/7": { projectRequest: (typeof requestDetail === "function" ? requestDetail() : requestDetail) || { ...REQUEST, files: [], reviews: [] } },
    };
    if (realDashboard && fixtures[path]) { await route.fulfill({ json: fixtures[path] }); return; }
    errors.push(`HTTP inesperado: ${path}`);
    await route.fulfill({ status: 404, json: { message: "Fixture no definida" } });
  });
  context.after(async () => { await session.close(); assert.deepEqual(errors, []); });
  await page.goto(realDashboard
    ? `${origin}/dashboard-arquitecto`
    : `${origin}/tests/browser/fixtures/project-request-workflow.html?role=${role}`);
  if (!realDashboard) {
    await page.waitForFunction(() => Boolean(window.workflowHarness?.result));
    if (!holdQueue) await waitState(page, (state) => !state.reviewQueue.loading);
  }
  return { page, calls, mutations, reads, clientReads };
}

/** Espera una condición sobre la salida pública del hook, sin inspeccionar internals de React. */
async function waitState(page, predicate) {
  await page.waitForFunction(`(${predicate.toString()})(window.workflowHarness.result)`);
}
/** Lee únicamente datos serializables del contrato público. */
async function state(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.workflowHarness.result)));
}
/** Invoca apertura pública; la selección y el borrador se presentan en el modal real. */
async function openRequest(page, request = { id: "7", projectName: "Resumen del overview" }) {
  await page.evaluate((request) => window.workflowHarness.result.workflow.open(request), request);
  await page.getByRole("dialog").waitFor();
}
/** Cuenta consultas a la cola para comprobar que admin y architect no la duplican. */
function queueCalls(calls) {
  return calls.filter((call) => call.path === "/api/project-requests/review-queue").length;
}
/** Espera una mutación registrada antes de resolverla, sin retardos fijos. */
async function waitMutation(page, mutations, count = 1) {
  await page.waitForFunction(() => window.workflowHarness.result.workflow.submitting || window.workflowHarness.result.assignment.submitting);
  assert.equal(mutations.length, count);
}

/**
 * Recorre el modal de recomendación del arquitecto (Figma Dashboard ARQ): elige la recomendación
 * en el detalle, escribe la justificación y pasa con «Siguiente» al paso de reunión.
 *
 * @param {import("playwright").Locator} dialog - Diálogo de la revisión.
 * @param {string} note - Justificación.
 * @param {string} [recommendation="Recomendar aprobación"] - Botón de la recomendación.
 * @returns {Promise<void>}
 */
async function writeRecommendation(dialog, note, recommendation = "Recomendar aprobación") {
  await dialog.getByRole("button", { name: recommendation, exact: true }).click();
  await dialog.getByRole("textbox").fill(note);
  await dialog.getByRole("button", { name: "Siguiente", exact: true }).click();
}

for (const role of ["admin", "architect"]) {
  test(`Cola ${role}: una lectura, detalle por ID numérico y fallback sin HTTP adicional`, async (context) => {
    const { page, calls } = await openPage(context, { role });
    await openRequest(page);
    assert.equal((await state(page)).workflow.selectedRequest.description, REQUEST.description);
    assert.equal(queueCalls(calls), 1);
    await page.evaluate(() => window.workflowHarness.result.workflow.close());
    await openRequest(page, { id: 80, projectName: "Solicitud fuera de la primera página" });
    assert.equal((await state(page)).workflow.selectedRequest.id, 80);
    assert.equal(queueCalls(calls), 1);
  });
}

test("Architect: recomendación, pending, cierre bloqueado y refresco de la cola", async (context) => {
  const { page, calls, mutations } = await openPage(context);
  await openRequest(page);
  const dialog = page.getByRole("dialog");
  await writeRecommendation(dialog, "  Recomiendo aprobar el proyecto  ");
  await dialog.getByRole("button", { name: "Agendar reunión", exact: true }).click();
  await dialog.getByRole("button", { name: "Enviar", exact: true }).click();
  await waitMutation(page, mutations);
  assert.equal(await dialog.getByRole("button", { name: "Enviar", exact: true }).count(), 0);
  assert.equal(await dialog.getByRole("button", { name: "Enviando...", exact: true }).isDisabled(), true);
  await page.evaluate(() => window.workflowHarness.result.workflow.close());
  assert.equal((await state(page)).workflow.selectedRequest.id, 7);
  assert.deepEqual(calls.find((call) => call.method === "PUT"), {
    method: "PUT", path: "/api/project-requests/7/review", body: { note: "Recomiendo aprobar el proyecto", recommendation: "approve", meetingRecommendation: "SCHEDULE_MEETING" },
  });
  await mutations[0].fulfill({ json: {} });
  await waitState(page, (result) => !result.workflow.selectedRequest && !result.workflow.submitting && !result.reviewQueue.loading);
  await page.waitForLoadState("networkidle");
  assert.equal(queueCalls(calls), 2);
  assert.deepEqual(await page.evaluate(() => window.workflowHarness.events), []);
});

for (const role of ["architect", "admin"]) {
  test(`${role}: error conserva selección y nota; reintento cierra solo tras éxito`, async (context) => {
    const { page, calls, mutations } = await openPage(context, { role });
    await openRequest(page);
    const dialog = page.getByRole("dialog");
    const submitLabel = role === "admin" ? "Rechazar" : "Enviar";
    if (role === "architect") {
      await writeRecommendation(dialog, "Nota conservada para reintentar");
      await dialog.getByRole("button", { name: "No agendar reunión", exact: true }).click();
    } else {
      // El selector abre el modal de rechazo, que conserva el motivo escrito.
      await dialog.getByRole("button", { name: "Rechazar", exact: true }).click();
      await dialog.getByRole("textbox").fill("Nota conservada para reintentar");
    }
    await dialog.getByRole("button", { name: submitLabel, exact: true }).click();
    await waitMutation(page, mutations);
    await mutations[0].fulfill({ status: 409, json: { code: "REVIEW_CONFLICT", message: "La revisión debe reintentarse." } });
    await waitState(page, (result) => !result.workflow.submitting && Boolean(result.workflow.error));
    if (role === "architect") {
      // El error real se muestra en el paso de reunión, que conserva la elección y la justificación.
      await dialog.getByRole("alert").getByText("La revisión debe reintentarse.").waitFor();
      assert.equal(await dialog.getByRole("button", { name: "No agendar reunión", exact: true }).getAttribute("aria-pressed"), "true");
      await dialog.getByRole("button", { name: "Volver", exact: true }).click();
      assert.equal(await dialog.getByRole("textbox").inputValue(), "Nota conservada para reintentar");
      await dialog.getByRole("button", { name: "Siguiente", exact: true }).click();
      assert.equal(await dialog.getByRole("button", { name: "No agendar reunión", exact: true }).getAttribute("aria-pressed"), "true");
    } else {
      assert.equal(await dialog.getByRole("textbox").inputValue(), "Nota conservada para reintentar");
    }
    assert.equal((await state(page)).workflow.selectedRequest.id, 7);
    assert.equal(queueCalls(calls), 1);
    await dialog.getByRole("button", { name: submitLabel, exact: true }).click();
    await waitMutation(page, mutations, 2);
    await mutations[1].fulfill({ json: {} });
    await waitState(page, (result) => !result.workflow.selectedRequest && !result.reviewQueue.loading);
    await page.waitForLoadState("networkidle");
    assert.equal(queueCalls(calls), 2);
    assert.equal((await page.evaluate(() => window.workflowHarness.events)).length, role === "admin" ? 1 : 0);
  });
}

for (const [action, label, expected] of [
  ["approve", "Aprobar", { action: "approve" }],
  ["reject", "Rechazar", { action: "reject", reason: "Nota de decisión" }],
  ["changes_requested", "Solicitar más información", { action: "request_changes", reason: PROJECT_REQUEST_CHANGES_REQUESTED_REASON }],
]) {
  test(`Admin: payload ${action} y notificación de invalidación tras confirmación`, async (context) => {
    const { page, calls, mutations } = await openPage(context, { role: "admin" });
    await openRequest(page);
    const dialog = page.getByRole("dialog");
    assert.equal(await dialog.getByRole("group", { name: "Recomendación de reunión" }).count(), 0);
    await dialog.getByRole("button", { name: label, exact: true }).click();
    // Cada acción del selector abre su modal propio (Figma): contacto para aprobar o pedir más
    // información, sin campos; motivo obligatorio para rechazar.
    const heading = { approve: "¿Deseas aprobar la solicitud?", changes_requested: "Solicitar información adicional", reject: "¿Deseas rechazar la solicitud?" }[action];
    // El diálogo estándar de Modal titula con un párrafo; el nombre accesible lo da aria-labelledby.
    await dialog.getByText(heading, { exact: true }).first().waitFor();
    if (action === "reject") await dialog.getByRole("textbox").fill("Nota de decisión");
    else assert.equal(await dialog.getByRole("textbox").count(), 0);
    const confirmLabel = { approve: "Aprobar", changes_requested: "Finalizar", reject: "Rechazar" }[action];
    await dialog.getByRole("button", { name: confirmLabel, exact: true }).click();
    await waitMutation(page, mutations);
    assert.deepEqual(calls.find((call) => call.method === "PATCH"), { method: "PATCH", path: "/api/admin/project-requests/7/decision", body: expected });
    assert.deepEqual(await page.evaluate(() => window.workflowHarness.events), []);
    await mutations[0].fulfill({ json: {} });
    await waitState(page, (result) => !result.workflow.selectedRequest && !result.reviewQueue.loading);
    assert.deepEqual(await page.evaluate(() => window.workflowHarness.events), [{ type: "decision" }]);
    assert.equal(queueCalls(calls), 2);
  });
}

test("Login admin: overview prioritario, detalle de cola y fallback al primer registro", async (context) => {
  const { page, calls } = await openPage(context, { role: "admin" });
  await page.evaluate(() => window.workflowHarness.setProps({ firstAdminRequest: { id: "7", projectName: "Resumen" } }));
  await page.evaluate(() => window.workflowHarness.result.loginActions.view());
  await waitState(page, (result) => Boolean(result.workflow.selectedRequest));
  assert.equal((await state(page)).workflow.selectedRequest.description, REQUEST.description);
  await page.evaluate(() => window.workflowHarness.setProps({ firstAdminRequest: { id: 80, projectName: "Prioritaria" } }));
  await page.evaluate(() => window.workflowHarness.result.loginActions.view());
  await waitState(page, (result) => result.workflow.selectedRequest?.id === 80);
  await page.evaluate(() => window.workflowHarness.setProps({ firstAdminRequest: null }));
  await page.evaluate(() => window.workflowHarness.result.loginActions.view());
  await waitState(page, (result) => result.workflow.selectedRequest?.id === 7);
  assert.equal(queueCalls(calls), 1);
});

test("Asignación admin: apertura diferida, borrador local, guards, confirmación y feedback", async (context) => {
  const { page, calls, mutations, reads } = await openPage(context, { role: "admin", holdQueue: true });
  await page.evaluate(() => { window.workflowHarness.result.loginActions.view(); window.workflowHarness.result.loginActions.assign(); });
  assert.equal((await state(page)).assignment.request, null);
  await page.waitForFunction(() => window.workflowHarness.result.reviewQueue.loading);
  await reads[0].fulfill({ json: { projectRequests: [REQUEST] } });
  await waitState(page, (result) => result.assignment.request?.id === 7);
  assert.deepEqual((await state(page)).assignment.draft, REQUEST.assignees);
  assert.equal(mutations.length, 0);
  await page.evaluate(() => window.workflowHarness.result.assignment.setDraft([]));
  await page.evaluate(() => window.workflowHarness.result.assignment.confirm());
  assert.equal(mutations.length, 0);
  await page.evaluate(() => window.workflowHarness.result.assignment.setDraft([{ id: "11", name: "Luis" }]));
  await page.evaluate(() => { void window.workflowHarness.result.assignment.confirm(); });
  await waitMutation(page, mutations);
  await page.evaluate(() => { window.workflowHarness.result.assignment.close(); void window.workflowHarness.result.assignment.confirm(); });
  assert.equal(mutations.length, 1);
  assert.equal((await state(page)).assignment.request.id, 7);
  assert.deepEqual(calls.find((call) => call.method === "PUT").body, { assigneeIds: [11] });
  await mutations[0].fulfill({ json: { assignees: [{ id: 11, name: "Luis" }] } });
  await waitState(page, (result) => !result.assignment.submitting && Boolean(result.assignment.feedback));
  const result = await state(page);
  assert.equal(result.assignment.request, null);
  assert.deepEqual(result.assignment.draft, []);
  assert.equal(result.assignment.feedback.type, "success");
  assert.equal(result.assignment.feedback.message, "Luis revisará Casa Norte.");
  await page.waitForFunction(() => window.workflowHarness.result.reviewQueue.loading);
  assert.equal(queueCalls(calls), 2);
  await reads[1].fulfill({ json: { projectRequests: [REQUEST] } });
  assert.deepEqual(await page.evaluate(() => window.workflowHarness.events), [{ type: "assignees", id: 7, assignees: [{ id: 11, name: "Luis", profilePhotoUrl: "" }] }]);
  await page.evaluate(() => window.workflowHarness.result.assignment.dismissFeedback());
  assert.equal((await state(page)).assignment.feedback, null);
});

test("Asignación fallida: conserva el contrato de cierre/limpieza y permite volver a intentar", async (context) => {
  const { page, calls, mutations } = await openPage(context, { role: "admin" });
  await page.evaluate(() => window.workflowHarness.result.loginActions.assign());
  await waitState(page, (result) => Boolean(result.assignment.request));
  await page.evaluate(() => { void window.workflowHarness.result.assignment.confirm(); });
  await waitMutation(page, mutations);
  await mutations[0].fulfill({ status: 409, json: { code: "ASSIGNMENT_CONFLICT", message: "No se pudo asignar." } });
  await waitState(page, (result) => !result.assignment.submitting && result.assignment.feedback?.type === "error");
  assert.equal((await state(page)).assignment.request, null);
  assert.deepEqual((await state(page)).assignment.draft, []);
  assert.equal(queueCalls(calls), 1);
  await page.evaluate(() => window.workflowHarness.result.loginActions.assign());
  await waitState(page, (result) => Boolean(result.assignment.request));
  await page.evaluate(() => { void window.workflowHarness.result.assignment.confirm(); });
  await waitMutation(page, mutations, 2);
  await mutations[1].fulfill({ json: { assignees: REQUEST.assignees } });
  await waitState(page, (result) => !result.assignment.submitting && result.assignment.feedback?.type === "success");
});

test("Cola: error, reintento y respuesta anterior descartada al cambiar de rol", async (context) => {
  const { page, reads } = await openPage(context, { holdQueue: true });
  await reads[0].fulfill({ status: 503, json: { code: "QUEUE_UNAVAILABLE", message: "Cola no disponible." } });
  await waitState(page, (result) => !result.reviewQueue.loading && Boolean(result.reviewQueue.error));
  await page.evaluate(() => window.workflowHarness.result.reviewQueue.retry());
  await waitState(page, (result) => result.reviewQueue.loading && !result.reviewQueue.error);
  await page.evaluate(() => window.workflowHarness.setProps({ roleCode: "admin" }));
  await page.waitForFunction(() => window.workflowHarness.result.reviewQueue.loading);
  // La respuesta vigente llega primero; la lectura pendiente del rol anterior se ignora.
  await reads[2].fulfill({ json: { projectRequests: [{ ...REQUEST, projectName: "Respuesta vigente" }] } });
  await waitState(page, (result) => result.reviewQueue.requests[0]?.projectName === "Respuesta vigente");
  await reads[1].fulfill({ json: { projectRequests: [{ ...REQUEST, projectName: "Respuesta obsoleta" }] } });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal((await state(page)).reviewQueue.requests[0].projectName, "Respuesta vigente");
});

test("Cola: empty y rol no habilitado no inician lecturas nuevas", async (context) => {
  const { page, calls } = await openPage(context);
  await page.evaluate(() => window.workflowHarness.setProps({ empty: true }));
  await waitState(page, (result) => !result.reviewQueue.loading && result.reviewQueue.requests.length === 0);
  await page.evaluate(() => window.workflowHarness.setProps({ empty: false, roleCode: "other" }));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(queueCalls(calls), 1);
});

test("Dashboard admin real: decidir refresca overview, métricas, proyectos y cola", async (context) => {
  const { page, calls, mutations } = await openPage(context, { role: "admin", realDashboard: true });
  await page.waitForLoadState("networkidle");
  // El ojo abre el drawer de detalle; la decisión se abre desde su menú de acciones.
  await openDrawerDecision(page, "Aprobar");
  const paths =["/api/admin/dashboard-overview", "/api/admin/dashboard-metrics", "/api/projects", "/api/project-requests/review-queue"];
  const before = paths.map((path) => calls.filter((call) => call.path === path).length);
  const decisionRequest = page.waitForRequest((request) => request.url().includes("/decision"));
  await page.getByRole("dialog", { name: "¿Deseas aprobar la solicitud?" }).getByRole("button", { name: "Aprobar", exact: true }).click();
  await decisionRequest;
  assert.equal(mutations.length, 1);
  const refreshed = paths.map((path) => page.waitForRequest((request) => new URL(request.url()).pathname === path));
  await mutations[0].fulfill({ json: {} });
  await Promise.all(refreshed);
  const approved = page.getByRole("dialog", { name: "Solicitud Aprobada" });
  await approved.getByRole("button", { name: "Finalizar", exact: true }).click();
  await approved.waitFor({ state: "hidden" });
  await page.waitForLoadState("networkidle");
  for (const [index, path] of paths.entries()) {
    assert.equal(calls.filter((call) => call.path === path).length, before[index] + 1, `${path}: ${JSON.stringify(calls)}`);
  }
});

test("Dashboard admin real: «Ver solicitud» abre la consulta completa y conserva el regreso", async (context) => {
  const { page, mutations } = await openPage(context, { role: "admin", realDashboard: true });
  await page.waitForLoadState("networkidle");
  await page.locator('[data-admin-new-requests="true"]').getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Detalles de solicitud" });
  await drawer.getByRole("button", { name: "Ver solicitud", exact: true }).click();

  // Navega a la página (sin modal de decisión) y el drawer se cierra.
  await page.waitForURL("**/solicitudes-proyecto/7");
  assert.equal(await page.getByRole("button", { name: "Confirmar decisión" }).count(), 0);
  await page.getByRole("heading", { level: 1, name: "Casa Norte" }).waitFor();
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.waitForURL("**/dashboard-arquitecto");
  assert.equal(mutations.length, 0);
});

test("Dashboard admin real: el drawer de detalle muestra datos reales y preselecciona la decisión", async (context) => {
  const detailedRequest = {
    ...REQUEST,
    clientId: 2,
    requestedBy: 41,
    compatibility: { level: "excellent", score: 92 },
    completeness: { answered: 12, applicable: 13, missingFields: ["decisionMaker"], score: 92 },
    financialViability: { findings: [], score: 100, status: "NO_OBVIOUS_CONFLICT" },
    createdAt: "2026-03-22T12:00:00.000Z",
    location: "Maracaibo, Zulia",
    projectType: "residential",
    reviews: [{ note: "El cliente posee terreno y presupuesto adecuado.", recommendation: "approve", meetingRecommendation: "SCHEDULE_MEETING", reviewer: { id: 9, name: "Ana" }, updatedAt: "2026-03-23T10:00:00.000Z" }],
  };
  const { page, calls, mutations } = await openPage(context, { role: "admin", realDashboard: true, queue: [detailedRequest] });
  await page.waitForLoadState("networkidle");
  const queueReadsBeforeDrawer = queueCalls(calls);
  await page.locator('[data-admin-new-requests="true"]').getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).click();

  const drawer = page.getByRole("dialog", { name: "Detalles de solicitud" });
  for (const text of ["Excelente compatibilidad", "Score general: 92/100", "Maracaibo, Zulia", "Residencial", "Agendar reunión", "El cliente posee terreno y presupuesto adecuado.", "Esteban Ruiz", "Nextj"]) {
    await drawer.getByText(text, { exact: true }).first().waitFor();
  }
  // Ambas métricas porcentuales proceden de la API y mantienen valores independientes.
  assert.equal(await drawer.locator('[data-prototype="true"]').count(), 0);
  await drawer.getByText("12 de 13 preguntas aplicables respondidas", { exact: true }).waitFor();
  assert.equal(await drawer.locator('[data-metric="completeness"] [role="progressbar"]').getAttribute("aria-valuenow"), "92");
  const viability = drawer.locator('[data-metric="financial-viability"]');
  assert.equal(await viability.getByRole("progressbar").getAttribute("aria-valuenow"), "100");
  assert.equal(await viability.getByText("100%", { exact: true }).count(), 1);
  assert.equal(await viability.locator('[role="progressbar"]').count(), 1);
  assert.equal(calls.filter((call) => call.path === "/api/admin/users/41").length, 1);
  assert.equal(calls.filter((call) => ["/api/admin/users/2", "/api/admin/users/7"].includes(call.path)).length, 0);
  // El drawer reutiliza la cola ya cargada por el dashboard: abrirlo no la vuelve a leer.
  assert.equal(queueCalls(calls), queueReadsBeforeDrawer);

  // Escape cierra solo el menú y conserva el drawer abierto.
  const actionsTrigger = drawer.getByRole("button", { name: "Acciones para Casa Norte", exact: true });
  await actionsTrigger.click();
  await page.getByRole("menu", { name: "Acciones para Casa Norte" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached" });
  assert.equal(await drawer.isVisible(), true);

  await actionsTrigger.click();
  await page.getByRole("menuitem", { name: "Rechazar", exact: true }).click();
  await drawer.waitFor({ state: "detached" });
  const decisionDialog = page.getByRole("dialog");
  await decisionDialog.getByRole("heading", { name: "¿Deseas rechazar la solicitud?" }).waitFor();
  assert.equal(await decisionDialog.getByRole("textbox", { name: "Motivo del rechazo" }).count(), 1);
  // Abrir una acción no ejecuta la decisión: solo el modal confirma contra la API.
  assert.equal(mutations.length, 0);
});

/**
 * Abre el drawer de «Casa Norte» y elige una decisión de su menú de acciones; espera a que el
 * drawer se cierre y quede el modal de decisión.
 */
async function openDrawerDecision(page, label) {
  await page.locator('[data-admin-new-requests="true"]').getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Detalles de solicitud" });
  await drawer.getByRole("button", { name: "Acciones para Casa Norte", exact: true }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
  await drawer.waitFor({ state: "detached" });
}

/** Abre el drawer desde el resumen real, conservando las cargas iniciales del dashboard. */
async function openClientDetails(page) {
  await page.waitForLoadState("networkidle");
  await page.locator('[data-admin-new-requests="true"]').getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Detalles de solicitud" });
  await drawer.waitFor();
  return drawer;
}

test("Drawer admin: conserva los requisitos declarados del stand y distingue otros tipos", async (context) => {
  const { page, mutations } = await openPage(context, { role: "admin", realDashboard: true, queue: [{
    ...REQUEST, clientId: 2, requestedBy: 41, projectType: "advertising_stand",
    standRequirements: { requirementsStatus: "in_process", documentTypes: [], spaceStatus: "unassigned", hasSpacePlans: false },
  }] });
  const drawer = await openClientDetails(page);
  await drawer.getByText("Stand publicitario", { exact: true }).waitFor();
  const section = drawer.getByRole("region", { name: "Requisitos del stand" });
  await section.getByText("Estoy gestionando los requisitos", { exact: true }).waitFor();
  await section.getByText("Sin documentos declarados", { exact: true }).waitFor();
  await section.getByText("Aún no está asignado", { exact: true }).waitFor();
  await section.getByText("No", { exact: true }).waitFor();
  await section.getByText("Información declarada por el cliente, pendiente de revisión durante la reunión.", { exact: true }).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await drawer.locator('[data-admin-request-details="true"]').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  assert.equal(mutations.length, 0);
});

test("Drawer admin: muestra las observaciones sin puntos para la revisión inicial solo si aplican", async (context) => {
  const explanation = "El cliente no dispone de planos del inmueble. Durante la revisión inicial se deberá determinar si se requiere un levantamiento arquitectónico o la elaboración de planos.";
  const { page, mutations } = await openPage(context, { role: "admin", realDashboard: true, queue: [{
    ...REQUEST, clientId: 2, requestedBy: 41, projectType: "residential", compatibility: { score: 100, level: "excellent" },
    reviewObservations: [{ code: "propertyBlueprintsUnavailable", explanation }],
  }] });
  const drawer = await openClientDetails(page);
  const list = drawer.getByRole("list", { name: "Observaciones para la revisión inicial" });
  await list.getByText(explanation, { exact: true }).waitFor();
  // La observación no altera la compatibilidad mostrada.
  await drawer.getByText("Score general: 100/100", { exact: true }).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await drawer.locator('[data-admin-request-details="true"]').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  assert.equal(mutations.length, 0);
});

test("Drawer admin: sin observaciones aplicables no muestra la sección", async (context) => {
  const { page } = await openPage(context, { role: "admin", realDashboard: true, queue: [{
    ...REQUEST, clientId: 2, requestedBy: 41, projectType: "advertising_stand", reviewObservations: [],
    standRequirements: { requirementsStatus: null, documentTypes: [], spaceStatus: "assigned", hasSpacePlans: null },
  }] });
  const drawer = await openClientDetails(page);
  await drawer.getByText("Stand publicitario", { exact: true }).waitFor();
  assert.equal(await drawer.getByRole("list", { name: "Observaciones para la revisión inicial" }).count(), 0);
});

test("Drawer admin: muestra el tipo histórico como Stand publicitario sin modificar el registro", async (context) => {
  const { page, mutations } = await openPage(context, { role: "admin", realDashboard: true, queue: [{
    ...REQUEST, clientId: 2, requestedBy: 41, projectType: "stands_exhibitions", standRequirements: null,
    compatibility: { score: 73, level: "high" },
  }] });
  const drawer = await openClientDetails(page);
  await drawer.getByText("Stand publicitario", { exact: true }).first().waitFor();
  assert.equal(await drawer.getByText("Stands y exhibiciones", { exact: true }).count(), 0);
  // Registro anterior a la sección del stand: se informa la ausencia, sin respuestas inventadas.
  await drawer.getByText("Sin información registrada", { exact: true }).waitFor();
  assert.equal(mutations.length, 0);
});

for (const requestedBy of [undefined, null, "undefined", "null", "NaN", -1, 0, 1.5, true]) {
  test(`Drawer cliente: ID ausente/inválido ${String(requestedBy)} omite HTTP`, async (context) => {
    const { page, calls } = await openPage(context, { role: "admin", realDashboard: true, queue: [{ ...REQUEST, clientId: 2, requestedBy }] });
    const drawer = await openClientDetails(page);
    await drawer.getByText("Información del cliente no disponible", { exact: true }).waitFor();
    assert.equal(calls.filter((call) => call.path.startsWith("/api/admin/users/")).length, 0);
    assert.equal(await drawer.getByRole("button", { name: "Reintentar", exact: true }).count(), 0);
    await drawer.getByText("Casa Norte", { exact: true }).waitFor();
  });
}

for (const [status, code, message, expected, retryable] of [
  [404, "USER_NOT_FOUND", "El usuario seleccionado no existe.", "Información del cliente no disponible", false],
  [403, "FORBIDDEN", "No tienes permiso para consultar este usuario.", "No tienes permiso para consultar este usuario.", false],
  [401, "UNAUTHENTICATED", "Debes iniciar sesión.", "Debes iniciar sesión.", false],
  [500, "42703", "Ocurrió un error inesperado.", "No fue posible cargar los datos del cliente.", true],
  [null, "NETWORK_ERROR", "", "No pudimos conectarnos con el servidor. Revisa tu conexión e inténtalo nuevamente.", true],
]) {
  test(`Drawer cliente: ${code}, aislamiento y reintento independiente`, async (context) => {
    const { page, calls } = await openPage(context, {
      role: "admin", realDashboard: true,
      queue: [{ ...REQUEST, clientId: 2, requestedBy: 41, location: "Ubicación real", compatibility: { level: "excellent", score: 92 } }],
      clientResponse: async (route, attempt) => {
        if (attempt > 1) { await route.fulfill({ json: { user: { id: 41, name: "Esteban Ruiz", companyName: "Nextj" } } }); return; }
        if (status === null) await route.abort("failed");
        else await route.fulfill({ status, json: { code, message } });
      },
    });
    const drawer = await openClientDetails(page);
    await drawer.getByText(expected, { exact: true }).waitFor();
    await drawer.getByText("Excelente compatibilidad", { exact: true }).waitFor();
    await drawer.getByText("Ubicación real", { exact: true }).waitFor();
    assert.equal(await drawer.getByRole("button", { name: "Ver solicitud", exact: true }).isEnabled(), true);
    const retry = drawer.getByRole("button", { name: "Reintentar", exact: true });
    assert.equal(await retry.count(), retryable ? 1 : 0);
    if (retryable) {
      const previousCalls = calls.length;
      await retry.click();
      await drawer.getByText("Esteban Ruiz", { exact: true }).waitFor();
      await drawer.getByText("Nextj", { exact: true }).waitFor();
      assert.deepEqual(calls.slice(previousCalls).map((call) => call.path), ["/api/admin/users/41"]);
      assert.equal(await retry.count(), 0);
    }
  });
}

test("Drawer cliente: cerrar cancela la lectura y reabrir carga sin mostrar AbortError", async (context) => {
  const { page, clientReads } = await openPage(context, {
    role: "admin", realDashboard: true, queue: [{ ...REQUEST, clientId: 2, requestedBy: 41 }],
    clientResponse: async (route, attempt) => {
      if (attempt > 1) await route.fulfill({ json: { user: { id: 41, name: "Esteban Ruiz", companyName: "Nextj" } } });
    },
  });
  const drawer = await openClientDetails(page);
  await page.waitForFunction(() => window.__clientSignals.length > 0);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__clientSignals.every((signal) => signal.aborted));
  await drawer.waitFor({ state: "detached" });
  // Completar el transporte viejo después del cierre no debe introducir un error visible.
  await clientReads[0].fulfill({ status: 500, json: { message: "Error de lectura obsoleta" } });
  const reopened = await openClientDetails(page);
  await reopened.getByText("Esteban Ruiz", { exact: true }).waitFor();
  assert.equal(await reopened.getByText("Error de lectura obsoleta", { exact: true }).count(), 0);
  assert.equal(await reopened.getByRole("button", { name: "Reintentar", exact: true }).count(), 0);
});

test("Architect (Figma Dashboard ARQ): tres recomendaciones con su modal; cerrar, X y Escape no guardan", async (context) => {
  const { page, mutations } = await openPage(context);
  await openRequest(page);
  const dialog = page.getByRole("dialog");
  const actions = dialog.getByRole("group", { name: "Recomendación técnica" });
  assert.deepEqual(await actions.getByRole("button").allInnerTexts(), [
    "Recomendar rechazo", "Recomendar solicitar más información", "Recomendar aprobación",
  ]);
  for (const [button, title] of [
    ["Recomendar rechazo", "¿Deseas recomendar rechazo?"],
    ["Recomendar solicitar más información", "¿Deseas solicitar más información?"],
    ["Recomendar aprobación", "¿Deseas recomendar aprobación?"],
  ]) {
    await dialog.getByRole("button", { name: button, exact: true }).click();
    await page.getByRole("dialog", { name: title }).waitFor();
    // El campo recibe el foco y muestra la ayuda de Figma.
    await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA");
    await dialog.getByRole("textbox").fill("Borrador que no debe guardarse");
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    await actions.waitFor();
  }
  // X y Escape también vuelven al detalle sin guardar; al reabrir, el campo está vacío.
  await dialog.getByRole("button", { name: "Recomendar aprobación", exact: true }).click();
  assert.equal(await dialog.getByRole("textbox").inputValue(), "");
  await dialog.getByRole("textbox").fill("Otro borrador sin guardar");
  await dialog.getByRole("button", { name: "Cerrar recomendación", exact: true }).click();
  await actions.waitFor();
  await dialog.getByRole("button", { name: "Recomendar rechazo", exact: true }).click();
  await page.keyboard.press("Escape");
  await actions.waitFor();
  assert.equal((await state(page)).workflow.selectedRequest.id, 7, "la revisión sigue abierta en el detalle");
  assert.equal(mutations.length, 0);
});

test("Architect: la justificación se valida antes de avanzar y cada recomendación envía su valor", async (context) => {
  const { page, calls, mutations } = await openPage(context);
  await openRequest(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Recomendar solicitar más información", exact: true }).click();
  await dialog.getByRole("textbox").fill("  corta ");
  await dialog.getByRole("button", { name: "Siguiente", exact: true }).click();
  await dialog.getByText("Escribe al menos 10 caracteres para justificar tu recomendación.", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("textbox").getAttribute("aria-invalid"), "true");
  await dialog.getByRole("textbox").fill("La visión del proyecto es inconclusa y faltan planos.");
  await dialog.getByRole("button", { name: "Siguiente", exact: true }).click();
  await page.getByRole("dialog", { name: "¿Recomiendas agendar una reunión?" }).waitFor();
  await dialog.getByRole("button", { name: "Agendar reunión", exact: true }).click();
  // Doble clic: un único PUT; la solicitud no cambia de estado desde el arquitecto.
  await dialog.getByRole("button", { name: "Enviar", exact: true }).dblclick();
  await waitMutation(page, mutations);
  assert.equal(mutations.length, 1);
  assert.deepEqual(calls.filter((call) => call.method !== "GET"), [{
    method: "PUT", path: "/api/project-requests/7/review",
    body: { meetingRecommendation: "SCHEDULE_MEETING", note: "La visión del proyecto es inconclusa y faltan planos.", recommendation: "changes_requested" },
  }]);
  await mutations[0].fulfill({ json: {} });
});

test("Architect: recomendar rechazo envía reject y respeta Figma en escritorio, oscuro y móvil", async (context) => {
  const { page, calls, mutations } = await openPage(context);
  await openRequest(page);
  const dialog = page.getByRole("dialog");
  if (process.env.ARCA_REVIEW_CAPTURE_DIR) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${process.env.ARCA_REVIEW_CAPTURE_DIR}/review-detail.png` });
  }
  await dialog.getByRole("button", { name: "Recomendar rechazo", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "¿Deseas recomendar rechazo?" });
  await modal.waitFor();
  const box = await modal.boundingBox();
  assert.equal(Math.round(box.width), 400, "ancho de Figma");
  const capture = async (name) => {
    if (!process.env.ARCA_REVIEW_CAPTURE_DIR) return;
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${process.env.ARCA_REVIEW_CAPTURE_DIR}/${name}.png` });
  };
  await capture("reject-light");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await capture("reject-dark");
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.setViewportSize({ width: 375, height: 812 });
  const mobile = await modal.boundingBox();
  assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 375, "cabe en móvil");
  await capture("reject-mobile");
  await dialog.getByRole("textbox").fill("El cliente no posee terreno ni presupuesto adecuado.");
  await dialog.getByRole("button", { name: "Siguiente", exact: true }).click();
  await dialog.getByRole("button", { name: "No agendar reunión", exact: true }).click();
  await capture("reject-meeting-mobile");
  await dialog.getByRole("button", { name: "Enviar", exact: true }).click();
  await waitMutation(page, mutations);
  assert.equal(calls.find((call) => call.method === "PUT").body.recommendation, "reject");
  await mutations[0].fulfill({ json: {} });
});

test("Architect: la reunión exige elección explícita y es independiente de aprobar", async (context) => {
  const { page, calls, mutations } = await openPage(context);
  await openRequest(page);
  const dialog = page.getByRole("dialog");
  await writeRecommendation(dialog, "La propuesta permite revisión pero no reunión todavía.");
  await dialog.getByRole("button", { name: "Enviar", exact: true }).click();
  await dialog.getByRole("alert").getByText("Selecciona una recomendación de reunión.").waitFor();
  assert.equal(mutations.length, 0);
  // La navegación a errores enfoca la primera opción del grupo inválido, asociado a su mensaje.
  const meetingGroup = dialog.getByRole("group", { name: "Recomendación de reunión" }).last();
  assert.equal(await meetingGroup.getAttribute("aria-invalid"), "true");
  assert.equal(await page.locator(`[id="${await meetingGroup.getAttribute("aria-describedby")}"]`).innerText(), "Selecciona una recomendación de reunión.");
  await page.waitForFunction(() => document.activeElement?.closest("[role='group'][aria-invalid='true']") !== null);
  const selection = dialog.getByRole("button", { name: "No agendar reunión", exact: true });
  await selection.focus();
  await page.keyboard.press("Enter");
  assert.equal(await selection.getAttribute("aria-pressed"), "true");
  await dialog.getByRole("button", { name: "Enviar", exact: true }).click();
  await waitMutation(page, mutations);
  assert.deepEqual(calls.find((call) => call.method === "PUT").body, {
    note: "La propuesta permite revisión pero no reunión todavía.", recommendation: "approve", meetingRecommendation: "DO_NOT_SCHEDULE_MEETING",
  });
  await mutations[0].fulfill({ json: {} });
});

for (const [meetingRecommendation, label, colorToken] of [
  ["SCHEDULE_MEETING", "Agendar reunión", "--color-info-100"],
  ["DO_NOT_SCHEDULE_MEETING", "No agendar reunión", "--color-danger-100"],
  [null, "Sin recomendación técnica registrada", null],
]) {
  test(`Drawer: baja compatibilidad y reunión ${String(meetingRecommendation)}, con historial y temas`, async (context) => {
    const queue = [{ ...REQUEST, clientId: 2, requestedBy: 41, location: "Maracaibo, Zulia", projectType: "residential",
      compatibility: { level: "low", score: 28 },
      completeness: { answered: 11, applicable: 17, missingFields: [], score: 65 },
      financialViability: {
        findings: [{ category: "TEMPORAL", code: "CAPITAL_TIMING_MISMATCH", evidence: [{ code: "capitalUndefinedImmediate", explanation: "La disponibilidad de capital necesita aclararse para un inicio inmediato." }], explanation: "La disponibilidad de capital necesita aclararse para un inicio inmediato.", outcome: "HIGH_RISK", severity: "HIGH" }],
        score: 80,
        status: "HIGH_RISK",
      },
      reviews: [
        { meetingRecommendation, recommendation: "approve", note: "Justificación de la revisión más reciente.", updatedAt: "2026-10-06T12:00:00Z" },
        { meetingRecommendation: "SCHEDULE_MEETING", recommendation: "reject", note: "Justificación anterior.", updatedAt: "2026-10-05T12:00:00Z" },
      ],
    }];
    const { page } = await openPage(context, { role: "admin", realDashboard: true, queue });
    await page.waitForLoadState("networkidle");
    await page.locator('[data-admin-new-requests="true"]').getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Detalles de solicitud" });
    await drawer.getByText("Baja compatibilidad", { exact: true }).waitFor();
    await drawer.getByText("Score general: 28/100", { exact: true }).waitFor();
    await drawer.getByText(label, { exact: true }).waitFor();
    await drawer.getByText("Justificación de la revisión más reciente.", { exact: true }).waitFor();
    assert.equal(await drawer.getByText("Justificación anterior.", { exact: true }).count(), 0);
    assert.equal(await drawer.getByText("Aprobar", { exact: true }).count(), 0);

    // Compara colores calculados con los tokens semánticos sin acoplarse a Tailwind.
    const tokenColor = (token) => page.evaluate((token) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`; document.body.append(probe);
      const color = getComputedStyle(probe).color; probe.remove(); return color;
    }, token);
    for (const dark of [false, true]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), dark);
      if (colorToken) {
        const badge = drawer.getByText(label, { exact: true });
        assert.equal(await badge.evaluate((element) => getComputedStyle(element).color), await tokenColor(colorToken));
        const mask = badge.locator("..").locator('[aria-hidden="true"] span');
        const geometry = await mask.boundingBox();
        assert.equal(geometry.width, 16); assert.equal(geometry.height, 16);
        const asset = await mask.evaluate((element) => getComputedStyle(element).maskImage.match(/url\(["']?(.+?)["']?\)/)?.[1]);
        assert.ok(asset, await mask.evaluate((element) => `${element.outerHTML}: ${getComputedStyle(element).maskImage}`));
        const assetSize = await page.evaluate(async (url) => {
          const response = await fetch(url); return response.ok ? (await response.text()).length : 0;
        }, asset);
        assert.ok(assetSize > 0);
      }
      // La completitud no se deriva de la compatibilidad baja: llega de la API (65 %, incompleta).
      const completenessBar = drawer.locator('[data-metric="completeness"] [role="progressbar"]');
      assert.equal(await completenessBar.getAttribute("aria-valuenow"), "65");
      assert.equal(await completenessBar.locator(":scope > div").evaluate((element) => getComputedStyle(element).backgroundColor), await tokenColor("--color-warning-200"));
      // Riesgo elevado: porcentaje con tono Danger y motivo visible, independiente del 28 general.
      const viability = drawer.locator('[data-metric="financial-viability"]');
      const financialBar = viability.getByRole("progressbar");
      assert.equal(await financialBar.getAttribute("aria-valuenow"), "80");
      assert.equal(await financialBar.locator(":scope > div").evaluate((element) => getComputedStyle(element).backgroundColor), await tokenColor("--color-danger-200"));
      await viability.getByRole("list", { name: "Motivos de la evaluación financiera" })
        .getByText("La disponibilidad de capital necesita aclararse para un inicio inmediato.", { exact: true }).waitFor();
      const circle = drawer.getByRole("progressbar", { name: "Compatibilidad: 28 de 100" });
      assert.equal(await circle.getAttribute("aria-valuenow"), "28");
      assert.equal(await circle.locator("svg circle").nth(1).evaluate((element) => getComputedStyle(element).stroke), await tokenColor("--color-danger-100"));
      if (process.env.ARCA_TEST_ARTIFACT_DIR && meetingRecommendation) {
        await mkdir(process.env.ARCA_TEST_ARTIFACT_DIR, { recursive: true });
        await page.waitForTimeout(800); // Solo para capturar el final de las animaciones existentes.
        await drawer.screenshot({ path: path.join(process.env.ARCA_TEST_ARTIFACT_DIR, `${meetingRecommendation}-${dark ? "dark" : "light"}.png`) });
      }
    }
    await page.setViewportSize({ width: 375, height: 812 });
    const bounds = await drawer.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 375);
    assert.equal(await drawer.locator('[data-admin-request-details="true"]').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  });
}

test("Dashboard admin real: menú de acciones del drawer — orden, teclado y preselección", async (context) => {
  const { page, calls, mutations } = await openPage(context, { role: "admin", realDashboard: true });
  await page.waitForLoadState("networkidle");
  await page.locator('[data-admin-new-requests="true"]').getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Detalles de solicitud" });
  const trigger = drawer.getByRole("button", { name: "Acciones para Casa Norte", exact: true });

  // Apertura con teclado: el foco entra en la primera acción.
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Acciones para Casa Norte" });
  await menu.waitFor();
  // Figma: solo las tres decisiones; la consulta completa se abre con «Ver solicitud».
  assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), ["Aprobar", "Solicitar más información", "Rechazar"]);
  // Divisor interactivo antes de la acción destructiva (el del encabezado es decorativo).
  assert.equal(await menu.getByRole("separator").count(), 1);
  const focused = () => page.evaluate(() => document.activeElement?.textContent);
  await page.waitForFunction(() => document.activeElement?.textContent === "Aprobar");
  await page.keyboard.press("ArrowUp");
  assert.equal(await focused(), "Rechazar");
  await page.keyboard.press("Home");
  assert.equal(await focused(), "Aprobar");
  await page.keyboard.press("End");
  assert.equal(await focused(), "Rechazar");
  await page.keyboard.press("ArrowDown");
  assert.equal(await focused(), "Aprobar");
  await page.keyboard.press("ArrowDown");
  assert.equal(await focused(), "Solicitar más información");

  // Escape cierra solo el menú y devuelve el foco al disparador.
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  assert.equal(await drawer.isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Acciones para Casa Norte");

  // El menú abre por encima del botón, alineado a su borde derecho y dentro del viewport.
  await trigger.click();
  await menu.waitFor();
  const [menuBox, triggerBox] = [await menu.boundingBox(), await trigger.boundingBox()];
  assert.equal(Math.round(menuBox.x + menuBox.width), Math.round(triggerBox.x + triggerBox.width));
  assert.ok(menuBox.y + menuBox.height <= triggerBox.y);
  assert.ok(menuBox.y >= 0);

  // Space selecciona; la decisión real sigue saliendo solo del modal confirmado.
  await menu.getByRole("menuitem", { name: "Solicitar más información" }).focus();
  await page.keyboard.press("Space");
  await drawer.waitFor({ state: "detached" });
  const decisionDialog = page.getByRole("dialog");
  await decisionDialog.getByRole("heading", { name: "Solicitar información adicional" }).waitFor();
  // Como en Figma: solo contacto, sin campos de texto.
  assert.equal(await decisionDialog.getByRole("textbox").count(), 0);
  assert.equal(mutations.length, 0);
  const decisionRequest = page.waitForRequest((request) => request.url().includes("/decision"));
  await decisionDialog.getByRole("button", { name: "Finalizar", exact: true }).click();
  await decisionRequest;
  assert.deepEqual(calls.find((call) => call.method === "PATCH").body, {
    action: "request_changes",
    reason: PROJECT_REQUEST_CHANGES_REQUESTED_REASON,
  });
  await mutations[0].fulfill({ json: {} });
});

const SECOND_PAGE_REQUEST = { ...REQUEST, id: 8, projectName: "Casa Sur", location: "Cabimas, Zulia", projectType: "commercial", clientId: 2, requestedBy: 41, compatibility: { level: "high", score: 81 } };

test("Cola paginada: «Cargar más» pide la página siguiente por cursor, combina sin duplicar y conserva lo cargado si falla", async (context) => {
  const { page, calls } = await openPage(context, {
    queuePages: {
      first: "c2",
      c2: { projectRequests: [REQUEST, SECOND_PAGE_REQUEST], nextCursor: "c3" },
      c3: { status: 500, message: "Error temporal de la cola." },
    },
  });
  assert.equal((await state(page)).reviewQueue.hasMore, true);
  await page.evaluate(() => window.workflowHarness.result.reviewQueue.loadMore());
  await waitState(page, (result) => result.reviewQueue.requests.length === 2 && !result.reviewQueue.loadingMore);
  const afterSecond = await state(page);
  assert.deepEqual(afterSecond.reviewQueue.requests.map((request) => request.id), [7, 8], "sin duplicados");
  assert.ok(calls.some((call) => call.path.endsWith("/review-queue") && (call.search || "").includes("cursor=c2")));

  await page.evaluate(() => window.workflowHarness.result.reviewQueue.loadMore());
  await waitState(page, (result) => result.reviewQueue.loadMoreError === "Error temporal de la cola.");
  const afterError = await state(page);
  assert.equal(afterError.reviewQueue.requests.length, 2, "conserva lo cargado");
  assert.equal(afterError.reviewQueue.hasMore, true, "permite reintentar la página");
});

test("Cola paginada: releer la primera página descarta una página adicional en curso", async (context) => {
  const { page } = await openPage(context, {
    queuePages: { first: "c2", c2: { projectRequests: [SECOND_PAGE_REQUEST], nextCursor: null } },
  });
  // La página 2 llega después del reintento: no debe mezclarse con la nueva lectura.
  await page.route((url) => url.searchParams.get("cursor") === "c2", async (route) => {
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    await route.fallback();
  });
  await page.evaluate(() => { window.workflowHarness.result.reviewQueue.loadMore(); window.workflowHarness.result.reviewQueue.retry(); });
  await waitState(page, (result) => !result.reviewQueue.loading && !result.reviewQueue.loadingMore);
  await page.waitForTimeout(600);
  assert.deepEqual((await state(page)).reviewQueue.requests.map((request) => request.id), [7]);
});

test("Dashboard admin real: el drawer localiza en páginas siguientes una solicitud que no está en la primera", async (context) => {
  const { page, calls } = await openPage(context, {
    role: "admin",
    realDashboard: true,
    queue: [REQUEST],
    overviewRequests: [SECOND_PAGE_REQUEST],
    queuePages: { first: "c2", c2: { projectRequests: [SECOND_PAGE_REQUEST], nextCursor: null } },
  });
  await page.waitForLoadState("networkidle");
  await page.locator('[data-admin-new-requests="true"]').getByRole("button", { name: "Ver solicitud Casa Sur", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Detalles de solicitud" });
  await drawer.getByText("Cabimas, Zulia", { exact: true }).first().waitFor();
  assert.equal(calls.filter((call) => call.path.endsWith("/review-queue") && (call.search || "").includes("cursor=c2")).length, 1);
});

// --- Fase 2: sincronización tras operaciones confirmadas ---

/** Rutas que el dashboard admin relee tras una mutación o al reanudar la vista. */
const SYNC_PATHS = ["/api/admin/dashboard-overview", "/api/admin/dashboard-metrics", "/api/project-requests/review-queue"];
/** Cuenta lecturas por ruta para comparar antes y después de una operación. */
function countReads(calls, paths) {
  return paths.map((path) => calls.filter((call) => call.method === "GET" && call.path === path).length);
}

for (const [role, label, response, expected] of [
  ["architect", "Enviar", { review: {} }, { title: "Revisión guardada", content: "Casa Norte", theme: "Success" }],
  ["admin", "Aprobar", { project: { id: 40, name: "Casa Norte" }, projectRequest: { id: 7, status: "converted" } }, { title: "Solicitud aprobada", content: "Casa Norte", description: "El proyecto interno quedó en borrador para configurarlo. El cliente verá su solicitud aprobada.", theme: "Success" }],
]) {
  test(`${role}: el aviso de éxito se publica solo tras la confirmación de la API`, async (context) => {
    const { page, mutations } = await openPage(context, { role });
    await openRequest(page);
    const dialog = page.getByRole("dialog");
    if (role === "admin") {
      await dialog.getByRole("button", { name: "Aprobar", exact: true }).click();
      await page.getByRole("dialog", { name: "¿Deseas aprobar la solicitud?" }).waitFor();
    } else {
      await writeRecommendation(dialog, "Nota de la operación");
      await dialog.getByRole("button", { name: "Agendar reunión", exact: true }).click();
    }
    await dialog.getByRole("button", { name: label, exact: true }).click();
    await waitMutation(page, mutations);
    assert.equal((await state(page)).workflow.feedback, null);
    await mutations[0].fulfill({ json: response });
    await waitState(page, (result) => Boolean(result.workflow.feedback));
    const { feedback } = (await state(page)).workflow;
    for (const [key, value] of Object.entries(expected)) assert.equal(feedback[key], value, key);
    // El cierre solo descarta el aviso indicado.
    await page.evaluate(() => window.workflowHarness.result.workflow.dismissFeedback("otro-aviso"));
    assert.notEqual((await state(page)).workflow.feedback, null);
    await page.evaluate((id) => window.workflowHarness.result.workflow.dismissFeedback(id), feedback.id);
    await waitState(page, (result) => result.workflow.feedback === null);
  });
}

for (const [role, code] of [["admin", "PROJECT_REQUEST_INVALID_STATE"], ["architect", "PROJECT_REQUEST_CLOSED"], ["admin", "PROJECT_REQUEST_NOT_FOUND"]]) {
  test(`${role}: ${code} relee la cola y conserva el modal sin aviso de éxito`, async (context) => {
    const { page, calls, mutations } = await openPage(context, { role });
    await openRequest(page);
    const dialog = page.getByRole("dialog");
    if (role === "architect") {
      await writeRecommendation(dialog, "Nota conservada");
      await dialog.getByRole("button", { name: "No agendar reunión", exact: true }).click();
    } else {
      await dialog.getByRole("button", { name: "Rechazar", exact: true }).click();
      await dialog.getByRole("textbox").fill("Nota conservada");
    }
    await dialog.getByRole("button", { name: role === "admin" ? "Rechazar" : "Enviar", exact: true }).click();
    await waitMutation(page, mutations);
    const queueReread = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/project-requests/review-queue");
    await mutations[0].fulfill({ status: code.endsWith("NOT_FOUND") ? 404 : 409, json: { code, message: "La solicitud ya cambió de estado." } });
    await queueReread;
    await waitState(page, (result) => !result.workflow.submitting && Boolean(result.workflow.error) && !result.reviewQueue.loading);
    assert.equal(queueCalls(calls), 2);
    const result = await state(page);
    assert.equal(result.workflow.selectedRequest.id, 7);
    assert.equal(result.workflow.feedback, null);
    if (role === "architect") await dialog.getByRole("button", { name: "Volver", exact: true }).click();
    assert.equal(await dialog.getByRole("textbox").inputValue(), "Nota conservada");
    assert.deepEqual(await page.evaluate(() => window.workflowHarness.events), []);
  });
}

test("Dashboard admin real: aprobar avisa del proyecto creado y retira la solicitud del overview", async (context) => {
  let decided = false;
  const { page, mutations } = await openPage(context, { role: "admin", realDashboard: true, overviewRequests: () => (decided ? [] : [REQUEST]) });
  await page.waitForLoadState("networkidle");
  const newRequests = page.locator('[data-admin-new-requests="true"]');
  await newRequests.getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).click();
  await page.getByRole("dialog", { name: "Detalles de solicitud" }).getByRole("button", { name: "Acciones para Casa Norte" }).click();
  await page.getByRole("menuitem", { name: "Aprobar" }).click();
  const decisionRequest = page.waitForRequest((request) => request.url().includes("/decision"));
  await page.getByRole("dialog", { name: "¿Deseas aprobar la solicitud?" }).getByRole("button", { name: "Aprobar", exact: true }).click();
  await decisionRequest;
  assert.equal(mutations.length, 1);
  decided = true;
  await mutations[0].fulfill({ json: { project: { id: 40, name: "Casa Norte", status: "pending" }, projectRequest: { id: 7, status: "converted" } } });
  await page.getByText("Solicitud aprobada", { exact: true }).waitFor();
  await page.getByText("El proyecto interno quedó en borrador para configurarlo. El cliente verá su solicitud aprobada.", { exact: true }).waitFor();
  // Ya aprobada, el modal muestra «Solicitud Aprobada» con el contacto del cliente hasta cerrarlo.
  const approved = page.getByRole("dialog", { name: "Solicitud Aprobada" });
  await approved.getByText("El siguiente paso es coordinar la reunión inicial con el cliente.", { exact: true }).waitFor();
  assert.equal(mutations.length, 1);
  await approved.getByRole("button", { name: "Finalizar", exact: true }).click();
  await approved.waitFor({ state: "detached" });
  assert.equal(mutations.length, 1);
  await newRequests.getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).waitFor({ state: "detached" });
  await page.waitForLoadState("networkidle");
  assert.equal(await newRequests.getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).count(), 0);
});

test("Dashboard admin real: un conflicto de estado relee overview, métricas y cola sin cerrar el modal", async (context) => {
  const { page, calls, mutations } = await openPage(context, { role: "admin", realDashboard: true });
  await page.waitForLoadState("networkidle");
  await openDrawerDecision(page, "Aprobar");
  const before = countReads(calls, SYNC_PATHS);
  const decisionRequest = page.waitForRequest((request) => request.url().includes("/decision"));
  await page.getByRole("dialog", { name: "¿Deseas aprobar la solicitud?" }).getByRole("button", { name: "Aprobar", exact: true }).click();
  await decisionRequest;
  const reread = SYNC_PATHS.map((path) => page.waitForResponse((response) => new URL(response.url()).pathname === path));
  await mutations[0].fulfill({ status: 409, json: { code: "PROJECT_REQUEST_INVALID_STATE", message: "Solo se pueden decidir solicitudes que están en revisión." } });
  await Promise.all(reread);
  await page.waitForLoadState("networkidle");
  assert.deepEqual(countReads(calls, SYNC_PATHS), before.map((count) => count + 1));
  await page.getByRole("dialog", { name: "¿Deseas aprobar la solicitud?" }).getByText("Solo se pueden decidir solicitudes que están en revisión.").waitFor();
  assert.equal(await page.getByText("Solicitud aprobada", { exact: true }).count(), 0);
});

test("Dashboard admin real: una asignación confirmada relee overview y métricas además de la cola", async (context) => {
  const { page, calls, mutations } = await openPage(context, {
    role: "admin",
    realDashboard: true,
    assignees: [{ id: 11, name: "Luis Mora", roleCode: "architect" }],
  });
  await page.waitForLoadState("networkidle");
  const before = countReads(calls, SYNC_PATHS);
  const field = page.getByLabel("Responsables de Casa Norte").locator("visible=true").first();
  await field.click();
  await field.fill("Luis");
  const assignmentRequest = page.waitForRequest((request) => request.method() === "PUT");
  await field.press("Enter");
  await assignmentRequest;
  assert.equal(mutations.length, 1);
  const assignment = calls.find((call) => call.method === "PUT");
  assert.equal(assignment.path, "/api/admin/project-requests/7/assignees");
  assert.deepEqual([...assignment.body.assigneeIds].sort((a, b) => a - b), [9, 11]);
  const reread = SYNC_PATHS.map((path) => page.waitForResponse((response) => new URL(response.url()).pathname === path));
  await mutations[0].fulfill({ json: { assignees: [{ id: 9, name: "Ana" }, { id: 11, name: "Luis Mora" }] } });
  await Promise.all(reread);
  await page.waitForLoadState("networkidle");
  assert.deepEqual(countReads(calls, SYNC_PATHS), before.map((count) => count + 1));
});

test("Dashboard admin real: recuperar la conexión revalida overview, métricas y cola sin releer proyectos", async (context) => {
  const { page, calls } = await openPage(context, { role: "admin", realDashboard: true });
  await page.waitForLoadState("networkidle");
  const paths = [...SYNC_PATHS, "/api/projects"];
  const before = countReads(calls, paths);
  const reread = SYNC_PATHS.map((path) => page.waitForResponse((response) => new URL(response.url()).pathname === path));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await Promise.all(reread);
  await page.waitForLoadState("networkidle");
  assert.deepEqual(countReads(calls, paths), [...before.slice(0, 3).map((count) => count + 1), before[3]]);
  // El contenido sigue visible durante y después de la revalidación.
  await page.locator('[data-admin-new-requests="true"]').getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).waitFor();
});

// --- Fase 3: navegación definitiva y acciones desde la consulta completa ---

test("Dashboard admin real: sin revisión técnica ni arquitectos, el menú permite decidir directamente", async (context) => {
  const pending = { ...REQUEST, assignees: [], status: "pending_verification" };
  const { page, mutations } = await openPage(context, { role: "admin", realDashboard: true, queue: [pending] });
  await page.waitForLoadState("networkidle");
  await page.locator('[data-admin-new-requests="true"]').getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Detalles de solicitud" });
  // La revisión técnica es opcional (PR #54): el administrador decide sin asignar arquitectos.
  assert.equal(await drawer.getByRole("button", { name: "Ver solicitud", exact: true }).isEnabled(), true);
  await drawer.getByRole("button", { name: "Acciones para Casa Norte", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Acciones para Casa Norte" });
  for (const label of ["Aprobar", "Solicitar más información", "Rechazar"]) {
    assert.equal(await menu.getByRole("menuitem", { name: label, exact: true }).isDisabled(), false, label);
  }
  assert.equal(mutations.length, 0, "abrir el menú no decide nada");
});

test("Dashboard admin real: decidir en la consulta completa sincroniza el dashboard al volver", async (context) => {
  let decided = false;
  const { page, calls, mutations } = await openPage(context, {
    role: "admin",
    realDashboard: true,
    overviewRequests: () => (decided ? [] : [REQUEST]),
    requestDetail: () => ({ ...REQUEST, files: [], reviews: [], status: decided ? "rejected" : "pending_review" }),
  });
  await page.waitForLoadState("networkidle");
  const overviewReads = () => countReads(calls, ["/api/admin/dashboard-overview"])[0];
  const initialOverviewReads = overviewReads();
  const newRequests = page.locator('[data-admin-new-requests="true"]');
  await newRequests.getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).click();
  await page.getByRole("dialog", { name: "Detalles de solicitud" }).getByRole("button", { name: "Ver solicitud", exact: true }).click();
  await page.waitForURL("**/solicitudes-proyecto/7");

  await page.getByRole("button", { name: "Rechazar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("Fuera del alcance del estudio.");
  const decisionRequest = page.waitForRequest((request) => request.url().includes("/decision"));
  await dialog.getByRole("button", { name: "Rechazar", exact: true }).click();
  await decisionRequest;
  assert.deepEqual(calls.find((call) => call.method === "PATCH"), {
    body: { action: "reject", reason: "Fuera del alcance del estudio." },
    method: "PATCH",
    path: "/api/admin/project-requests/7/decision",
  });
  decided = true;
  await mutations[0].fulfill({ json: { project: null, projectRequest: { id: 7, reviewedAt: "2026-11-05T12:00:00.000Z", status: "rejected" } } });
  await page.getByText("Solicitud rechazada", { exact: true }).waitFor();

  // Volver por el breadcrumb: el overview no reutiliza su caché anterior a la decisión, y la cola
  // y las métricas se leen de nuevo, de modo que la solicitud decidida ya no aparece.
  const reread = ["/api/admin/dashboard-overview", "/api/project-requests/review-queue", "/api/admin/dashboard-metrics"]
    .map((path) => page.waitForResponse((response) => new URL(response.url()).pathname === path));
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.waitForURL("**/dashboard-arquitecto");
  await Promise.all(reread);
  await page.waitForLoadState("networkidle");
  assert.ok(overviewReads() > initialOverviewReads);
  assert.equal(await newRequests.getByRole("button", { name: "Ver solicitud Casa Norte", exact: true }).count(), 0);
  assert.equal(mutations.length, 1);
});
