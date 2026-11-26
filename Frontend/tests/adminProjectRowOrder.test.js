import assert from "node:assert/strict";
import test from "node:test";

import { sortByNewestCreation } from "../src/pages/admin-projects/utils/adminProjectRowOrder.js";
import { toProjectRequestRow } from "../src/pages/admin-projects/utils/projectRequestRows.js";

test("Gestión de proyectos mezcla solicitudes y proyectos por fecha de creación, de la más reciente a la más antigua", () => {
  const request = toProjectRequestRow({ id: 5, projectName: "Solicitud vieja", status: "pending_review", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-02T10:00:00Z" });
  const newRequest = toProjectRequestRow({ id: 6, projectName: "Solicitud nueva", status: "pending_verification", createdAt: "2026-11-12T09:00:00Z", updatedAt: "2026-11-12T09:00:00Z" });
  const rows = [
    request,
    newRequest,
    { id: 1, name: "Finalizado", status: "finished", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z" },
    { id: 2, name: "Draft", status: "draft", createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z" },
    { id: 3, name: "En progreso", status: "in_process", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z" },
    { id: 4, name: "Sin fechas", status: "pending" },
  ];
  const original = [...rows];

  assert.deepEqual(sortByNewestCreation(rows).map((row) => row.name), [
    "Solicitud nueva", "Draft", "Solicitud vieja", "En progreso", "Finalizado", "Sin fechas",
  ]);
  assert.deepEqual(rows, original, "no muta la colección recibida");
});

test("los empates conservan el orden y los registros sin fecha van al final", () => {
  const createdAt = "2026-11-01T10:00:00Z";
  assert.deepEqual(sortByNewestCreation([{ id: 1 }, { id: 2, createdAt }, { id: 3, createdAt }]).map((row) => row.id), [2, 3, 1]);
});
