import { readSources } from "./helpers/readSources.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin request alert follows Figma and appears after every explicit login", async () => {
  const [alertSource, authSource, dashboardSource, overviewSource] =
    await Promise.all([
      readFile(
        new URL(
          "../src/pages/architect-dashboard/components/AdminRequestLoginAlert.jsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../src/auth/AuthContext.jsx", import.meta.url), "utf8"),
      readSources(new URL(
          "../src/pages/architect-dashboard/ArchitectDashboard.jsx",
          import.meta.url,
        ), new URL("../src/pages/architect-dashboard/hooks/useProjectRequestWorkflow.js", import.meta.url)),
      readFile(
        new URL(
          "../src/pages/architect-dashboard/components/AdminDashboardOverview.jsx",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  assert.match(authSource, /setLoginEventId\(\(current\) => current \+ 1\)/);
  assert.match(dashboardSource, /currentUser\.roleCode === "admin"[\s\S]*<AdminRequestLoginAlert/);
  assert.match(dashboardSource, /trigger=\{loginEventId \|\| null\}/);
  assert.match(alertSource, /theme="Warning"/);
  assert.match(alertSource, /title="Nueva solicitud recibida\."/);
  assert.match(alertSource, /autoHideMs=\{0\}/);
  assert.match(alertSource, /secondaryActionLabel="Asignar responsable"/);
  assert.match(alertSource, /primaryActionLabel="Ver solicitud"/);
  assert.match(overviewSource, /data-admin-new-requests="true"/);
  assert.match(dashboardSource, /openRequestWorkflow\(loginNotificationRequest\)/);
});

test("assigning from the login alert uses a confirm-only modal flow", async () => {
  const [dashboardSource, modalSource] = await Promise.all([
    readSources(new URL(
        "../src/pages/architect-dashboard/ArchitectDashboard.jsx",
        import.meta.url,
      ), new URL("../src/pages/architect-dashboard/hooks/useProjectRequestWorkflow.js", import.meta.url)),
    readFile(
      new URL(
        "../src/pages/architect-dashboard/components/AdminRequestAssignmentModal.jsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(modalSource, /title|Asignar revisión de solicitud/);
  assert.match(modalSource, /<AssigneeMultiSelect/);
  assert.match(modalSource, /onChange=\{onSelectionChange\}/);
  assert.match(modalSource, />\s*Cancelar\s*<\/Button>/);
  assert.match(modalSource, /onClick=\{onConfirm\}/);
  assert.match(modalSource, /\{submitting \? "Confirmando\.\.\." : "Confirmar"\}/);
  assert.match(dashboardSource, /setAssignmentModalRequested\(true\)/);
  assert.match(
    dashboardSource,
    /const confirmRequestAssignment = async \(\) => \{[\s\S]*await handleRequestAssigneesChange\(request, assignmentDraft\)/,
  );
  assert.match(
    dashboardSource,
    /await handleRequestAssigneesChange[\s\S]*type: "success"[\s\S]*catch \(error\)[\s\S]*type: "error"/,
  );
  assert.doesNotMatch(
    dashboardSource,
    /const handleLoginNotificationAssign = \(\) => \{[\s\S]{0,180}setAssignmentFeedback/,
  );
  assert.doesNotMatch(
    dashboardSource,
    /const closeAssignmentModal = \(\) => \{[\s\S]{0,220}setAssignmentFeedback/,
  );
});
