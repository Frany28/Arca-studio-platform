import assert from "node:assert/strict";
import test from "node:test";

import { getLatestActivityTime, sortByLatestActivity } from "../src/pages/admin-projects/utils/adminProjectRowOrder.js";
import { toProjectRequestRow } from "../src/pages/admin-projects/utils/projectRequestRows.js";

test("Gestión de proyectos mezcla solicitudes y proyectos por última actividad, de la más reciente a la más antigua", () => {
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

  assert.deepEqual(sortByLatestActivity(rows).map((row) => row.name), [
    "Solicitud nueva", "Draft", "Finalizado", "En progreso", "Solicitud vieja", "Sin fechas",
  ]);
  assert.deepEqual(rows, original, "no muta la colección recibida");
});

test("la última actividad usa updatedAt, con createdAt como respaldo; los empates conservan el orden recibido", () => {
  assert.equal(getLatestActivityTime({ createdAt: "2026-11-01T00:00:00Z", updatedAt: "fecha inválida" }), Date.parse("2026-11-01T00:00:00Z"));
  assert.equal(getLatestActivityTime({}), Number.NEGATIVE_INFINITY);
  const sameTime = "2026-11-01T00:00:00Z";
  assert.deepEqual(
    sortByLatestActivity([{ id: 9, updatedAt: sameTime }, { id: "request-3", updatedAt: sameTime }, { id: 10, updatedAt: sameTime }]).map((row) => row.id),
    [9, "request-3", 10],
  );
  assert.deepEqual(sortByLatestActivity([{ id: 1 }, { id: 2 }, { id: 3 }]).map((row) => row.id), [1, 2, 3]);
});
