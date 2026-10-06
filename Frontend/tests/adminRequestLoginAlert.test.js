import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin request alert follows Figma and receives the explicit login trigger", async () => {
  const [alertSource, authSource, dashboardSource, overviewSource, workflowSource] =
    await Promise.all([
      readFile(
        new URL(
          "../src/pages/admin-dashboard/components/AdminRequestLoginAlert.jsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../src/auth/AuthContext.jsx", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../src/pages/admin-dashboard/AdminDashboard.jsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/pages/admin-dashboard/components/AdminDashboardOverview.jsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/pages/admin-dashboard/hooks/useAdminRequestAssignments.js",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  assert.match(authSource, /setLoginEventId\(\(current\) => current \+ 1\)/);
  assert.match(dashboardSource, /<AdminRequestLoginAlert/);
  assert.match(dashboardSource, /trigger=\{loginEventId \|\| null\}/);
  assert.match(alertSource, /theme="Warning"/);
  assert.match(alertSource, /title="Nueva solicitud recibida\."/);
  assert.match(alertSource, /autoHideMs=\{0\}/);
  assert.match(alertSource, /secondaryActionLabel="Asignar responsable"/);
  assert.match(alertSource, /primaryActionLabel="Ver solicitud"/);
  assert.match(overviewSource, /data-admin-new-requests="true"/);
  assert.match(workflowSource, /openRequestWorkflow\(loginNotificationRequest\)/);
});

test("assigning from the login alert uses a confirm-only modal flow", async () => {
  const [dashboardSource, modalSource, workflowSource] = await Promise.all([
    readFile(
      new URL(
        "../src/pages/admin-dashboard/AdminDashboard.jsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/pages/admin-dashboard/components/AdminRequestAssignmentModal.jsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/pages/admin-dashboard/hooks/useAdminRequestAssignments.js",
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
  assert.match(dashboardSource, /onAssign=\{loginActions\.assign\}/);
  assert.match(workflowSource, /setAssignmentModalRequested\(true\)/);
  assert.match(
    workflowSource,
    /const confirmRequestAssignment = async \(\) => \{[\s\S]*await handleRequestAssigneesChange\(request, assignmentDraft\)/,
  );
  assert.match(
    workflowSource,
    /await handleRequestAssigneesChange[\s\S]*type: "success"[\s\S]*catch \(error\)[\s\S]*type: "error"/,
  );
  assert.doesNotMatch(
    workflowSource,
    /const handleLoginNotificationAssign = \(\) => \{[\s\S]{0,180}setAssignmentFeedback/,
  );
  assert.doesNotMatch(
    workflowSource,
    /const closeAssignmentModal = \(\) => \{[\s\S]{0,220}setAssignmentFeedback/,
  );
});
