import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const compiled = buildSync({
  stdin: {
    contents: `
      export { useProjectRequestForm } from './src/pages/project-request/hooks/useProjectRequestForm.js';
      export { useProjectDetails } from './src/pages/projects/hooks/useProjectDetails.js';
      export { useProjectDocumentSelection } from './src/pages/projects/hooks/useProjectDocumentSelection.js';
      export { useClientProjects } from './src/pages/client-dashboard/hooks/useClientProjects.js';
      export { useClientRequests } from './src/pages/client-dashboard/hooks/useClientRequests.js';
      export { useArchitectProjects } from './src/pages/architect-dashboard/hooks/useArchitectProjects.js';
      export { useAdminDashboardMetrics } from './src/pages/architect-dashboard/hooks/useAdminDashboardMetrics.js';
      export { useProjectRequestWorkflow } from './src/pages/architect-dashboard/hooks/useProjectRequestWorkflow.js';
    `,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  define: { "import.meta.env": "{}" },
  bundle: true, write: false, format: "cjs", platform: "node", packages: "external", jsx: "automatic",
}).outputFiles[0].text;
const container = { exports: {} };
new Function("require", "exports", "module", compiled)(createRequire(import.meta.url), container.exports, container);
const hooks = container.exports;

function renderHook(hook, input) {
  let result;
  function Probe() {
    result = hook(input);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return result;
}

test("request form composition restores corrections and preserves initial submission state", () => {
  const state = renderHook(hooks.useProjectRequestForm, {
    initialRequest: { id: 45, status: "changes_requested", projectName: "Casa", hasMultipleOwners: false, hasPlans: true },
    viewRequest: null, setIsSidebarExpanded: () => {},
  });
  assert.equal(state.form.projectName, "Casa");
  assert.equal(state.form.multipleOwners, "no");
  assert.equal(state.form.hasBlueprints, "Yes");
  assert.deepEqual(state.files, []);
  assert.equal(state.isSubmitting, false);
  assert.equal(state.isRequestReceived, false);
  assert.equal(typeof state.handleValidationSubmit, "function");
  assert.equal(typeof state.resetForm, "function");
});

test("project hooks retain provided data, file synchronization and document selection defaults", () => {
  const project = { id: 4, name: "Casa" };
  const state = renderHook(hooks.useProjectDetails, { providedProject: project, routeProjectSlug: "casa", navigate: () => {}, searchParams: new URLSearchParams() });
  assert.equal(state.project, project);
  assert.equal(state.resolvedProjectId, 4);
  assert.equal(state.projectLoading, false);
  assert.ok(state.filesSynchronizedAt);
  const selection = renderHook(hooks.useProjectDocumentSelection);
  assert.equal(selection.recentDocumentModal, null);
  assert.equal(selection.recentDocumentTriggerRef.current, null);
});

test("dashboard hooks preserve empty admin and client collection defaults", () => {
  const currentUser = { roleCode: "admin" }, user = { id: 1, role: "admin" };
  const architect = renderHook(hooks.useArchitectProjects, { empty: true, currentUser, user });
  assert.equal(architect.projectsLoading, false);
  assert.deepEqual(architect.projectRows, []);
  const metrics = renderHook(hooks.useAdminDashboardMetrics, { empty: true, currentUser });
  assert.equal(metrics.adminMetricsLoading, false);
  const client = renderHook(hooks.useClientProjects, { user: { id: 2, clientId: 3 } });
  assert.deepEqual(client.ownedProjectRows, []);
  assert.equal(client.projectsLoading, true);
  const requests = renderHook(hooks.useClientRequests, { user: { id: 2 } });
  assert.deepEqual(requests.projectRequests, []);
  assert.equal(requests.projectRequestsNextCursor, null);
  const workflow = renderHook(hooks.useProjectRequestWorkflow, {
    currentUser, reviewRequests: [], adminOverview: null,
    setProjectsRequestKey: () => {}, setAdminMetricsRequestKey: () => {}, setAdminOverview: () => {},
    setAdminOverviewRequestKey: () => {}, setReviewRequestsRevision: () => {},
  });
  assert.equal(workflow.selectedRequest, null);
  assert.equal(workflow.assignmentModalRequest, null);
  assert.equal(workflow.workflowSubmitting, false);
});
