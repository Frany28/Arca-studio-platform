import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getAddedAssignees, getRemovedAssignees } from
  "../src/components/ui/AssigneeMultiSelect/assigneeSelection.js";

test("assignee changes distinguish additions from removals", () => {
  const current = [
    { id: 1, name: "Laura Rivas" },
    { id: 2, name: "Arq. Armando" },
  ];

  assert.deepEqual(
    getRemovedAssignees(current, [...current, { id: 3, name: "Arq. Sofía" }]),
    [],
  );
  assert.deepEqual(getRemovedAssignees(current, [current[1]]), [current[0]]);
  assert.deepEqual(
    getAddedAssignees(current, [...current, { id: 3, name: "Arq. Sofía" }]),
    [{ id: 3, name: "Arq. Sofía" }],
  );
  assert.deepEqual(getAddedAssignees(current, [current[1]]), []);
});

test("assignee additions show shared success and error alerts after the API result", async () => {
  const source = await readFile(
    new URL(
      "../src/components/ui/AssigneeMultiSelect/AssigneeMultiSelect.jsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /const addedAssignees = getAddedAssignees\(value, nextValue\)/);
  assert.match(source, /await onChange\(nextValue\);[\s\S]*Responsable asignado exitosamente/);
  assert.match(source, /catch \(changeError\)[\s\S]*No se pudo asignar al responsable/);
  assert.match(source, /theme: "Success"/);
  assert.match(source, /theme: "Danger"/);
  assert.match(source, /<AlertToast/);
  assert.match(source, /onDismiss=\{\(\) => setAssignmentFeedback\(null\)\}/);
});

test("project assignee removals require confirmation and expose coherent success actions", async () => {
  const [selectorSource, modalSource, projectsSource, toastSource] =
    await Promise.all([
      readFile(
        new URL(
          "../src/components/ui/AssigneeMultiSelect/AssigneeMultiSelect.jsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/components/ui/AssigneeMultiSelect/AssigneeRemovalModal.jsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/pages/admin-dashboard/components/admin-active-projects/AdminActiveProjects.jsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../src/components/ui/AlertToast/AlertToast.jsx", import.meta.url),
        "utf8",
      ),
    ]);

  assert.match(projectsSource, /<AssigneeMultiSelect[\s\S]*confirmRemoval/);
  assert.match(projectsSource, /onRemovalSuccess=\{\(removedAssignees\) =>/);
  assert.match(selectorSource, /getRemovedAssignees\(value, nextValue\)/);
  assert.match(selectorSource, /function AssigneeIcon\(\)/);
  assert.match(selectorSource, /leftIcon=\{<AssigneeIcon \/>\}/);
  assert.match(selectorSource, /M17\.1585 18\.3333C17\.1585 15\.1083/);
  assert.match(selectorSource, /onRemovalSuccess\?\.\(removedAssignees\)/);
  assert.match(projectsSource, /title=\{assigneeRemovalFeedback\.names\.length/);
  assert.match(projectsSource, /secondaryActionLabel="Cerrar"/);
  assert.match(projectsSource, /primaryActionLabel="Deshacer"/);
  assert.doesNotMatch(projectsSource, /onSecondaryAction=/);
  assert.match(
    projectsSource,
    /onDismiss=\{\(\) => setAssigneeRemovalFeedback\(null\)\}/,
  );
  assert.doesNotMatch(projectsSource, /autoHideMs=\{0\}/);
  assert.match(projectsSource, /previousAssignees: assignees/);
  assert.match(projectsSource, /disabled=\{assignmentDisabled\}/);
  assert.match(projectsSource, /primaryActionDisabled=\{assigneeUndoUnavailable\}/);
  assert.match(
    projectsSource,
    /await onProjectAssigneesChange\?\.\([\s\S]*assigneeRemovalFeedback\.previousAssignees/,
  );
  assert.match(projectsSource, /No se pudo restaurar al encargado/);
  assert.match(modalSource, /¿Deseas retirar al usuario del proyecto\?/);
  assert.match(
    modalSource,
    /description="¿Estás seguro de que deseas retirar al usuario del proyecto\? Perderá acceso completo a toda la información y funciones relacionadas\."/,
  );
  assert.doesNotMatch(modalSource, /assigneeName|projectName|personReference|projectReference/);
  assert.match(modalSource, /secondaryActionLabel="Cancelar"/);
  assert.match(modalSource, /primaryActionLabel="Confirmar"/);
  assert.match(modalSource, /primaryActionTheme="Danger"/);
  assert.match(toastSource, /showActions=\{showActions\}/);
  assert.match(toastSource, /autoHideMs > 0/);
});
