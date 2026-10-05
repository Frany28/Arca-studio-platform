import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin dashboard metrics preserve their approved visual order", async () => {
  const source = await readFile(
    new URL(
      "../src/pages/admin-dashboard/components/AdminDashboardMetrics.jsx",
      import.meta.url,
    ),
    "utf8",
  );
  const labels = [
    "Usuarios activos",
    "Proyectos activos",
    "Archivos registrados",
    "Solicitudes",
    "Eventos críticos",
  ];
  const positions = labels.map((label) => source.indexOf(`label="${label}"`));

  assert.equal(positions.every((position) => position >= 0), true);
  assert.deepEqual(positions, [...positions].sort((first, second) => first - second));
  assert.match(source, /min-\[640px\]:max-\[900px\]:grid-cols-2/);
  assert.match(source, /min-\[900px\]:grid-cols-5/);
  assert.doesNotMatch(source, /sm:grid-cols-2/);
});
