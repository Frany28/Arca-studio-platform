import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getProjectReadOnlyMessage,
  isProjectOperationallyReadOnly,
} from "../src/utils/projectReadOnly.js";

test("archived project details propagate one shared read-only policy", async () => {
  const [
    contextSource,
    readOnlySource,
    detailsSource,
    drawerSource,
    uploadSource,
    imageSource,
    videoSource,
    documentSource,
  ] = await Promise.all([
    readFile(new URL("../src/contexts/ProjectReadOnlyContext.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/utils/projectReadOnly.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/projects/ProjectDetailsPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/Gallery/GeneralCommentsDrawer.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/projects/panels/ProjectUploadFilesPanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/Gallery/ImageViewerModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/Gallery/VideoViewerModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/projects/components/ProjectDocumentPreview.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(contextSource, /message = ""/);
  assert.match(readOnlySource, /"completed", "finished"/);
  assert.match(detailsSource, /readOnly=\{projectIsReadOnly\}/);
  assert.match(detailsSource, /"Proyecto finalizado" : "Proyecto archivado"/);
  assert.match(drawerSource, /resolvedComposerDisabled = composerDisabled \|\| readOnly/);
  assert.match(uploadSource, /<FileUploadSection[\s\S]*disabled=\{readOnly\}/);
  assert.match(imageSource, /onSelectionChange=\{readOnly \? undefined : handleSelectionChange\}/);
  assert.match(videoSource, /onCommentClick=\{readOnly \? undefined : handleCommentClick\}/);
  assert.match(documentSource, /onPointCreate=\{readOnly \? undefined : handleSelectionChange\}/);
});

test("archived projects disable dashboard mutations but keep unarchive selection", async () => {
  const [dashboardSource, rowSource] = await Promise.all([
    readFile(new URL("../src/pages/admin-dashboard/components/admin-active-projects/AdminActiveProjects.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/architect-dashboard/components/ArchitectProjectRow.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(dashboardSource, /disabled=\{assignmentDisabled\}/);
  assert.match(dashboardSource, /primaryActionDisabled=\{assigneeUndoUnavailable\}/);
  assert.match(rowSource, /disabled=\{project\.status === "archived"\}/);
});

test("finalized and archived projects share operational read-only behavior", () => {
  assert.equal(isProjectOperationallyReadOnly("completed"), true);
  assert.equal(isProjectOperationallyReadOnly("finished"), true);
  assert.equal(isProjectOperationallyReadOnly("archived"), true);
  assert.equal(isProjectOperationallyReadOnly("in_process"), false);
  assert.equal(getProjectReadOnlyMessage("completed"), "El proyecto finalizado es de solo lectura.");
});
