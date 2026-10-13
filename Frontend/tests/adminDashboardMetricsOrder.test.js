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
  // Dos columnas en móvil; desde tablet las columnas dependen del ancho real del contenido
  // (riel lateral incluido) para que las métricas no se superpongan.
  assert.match(source, /grid w-full grid-cols-2 /);
  assert.match(source, /min-\[768px\]:grid-cols-\[repeat\(auto-fill,minmax\(176px,1fr\)\)\]/);
  assert.doesNotMatch(source, /min-\[900px\]:grid-cols-5/, "Una rejilla fija de 5 columnas superpone las métricas a 1024 px");
  assert.doesNotMatch(source, /sm:grid-cols-2/);
});
