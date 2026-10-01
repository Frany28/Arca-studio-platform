// Detecta bajas comparando IDs como texto, aunque lleguen con tipos distintos.
export function getRemovedAssignees(currentAssignees = [], nextAssignees = []) {
  const nextIds = new Set(
    nextAssignees.map((assignee) => String(assignee.id)),
  );

  return currentAssignees.filter(
    (assignee) => !nextIds.has(String(assignee.id)),
  );
}

// Detecta altas comparando IDs como texto, aunque lleguen con tipos distintos.
export function getAddedAssignees(currentAssignees = [], nextAssignees = []) {
  const currentIds = new Set(
    currentAssignees.map((assignee) => String(assignee.id)),
  );

  return nextAssignees.filter(
    (assignee) => !currentIds.has(String(assignee.id)),
  );
}
