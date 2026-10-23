import assert from "node:assert/strict";
import test from "node:test";

import {
  SERVICE_BULK_STATUS_CONCURRENCY,
  describeBulkStatusResult,
  getServiceStatusTargets,
  runWithConcurrency,
} from "../src/pages/admin-services-quotes/service-catalog/utils/serviceBulkStatus.js";

const ITEMS = [
  { id: 1, code: "TST-001", isActive: true },
  { id: 2, code: "TST-002", isActive: false },
  { id: 3, code: "TST-003", isActive: true },
];

test("destinos: solo los seleccionados que cambiarían; la selección mixta se reparte por acción", () => {
  const mixed = new Set(["1", "2"]);
  assert.deepEqual(getServiceStatusTargets(ITEMS, mixed, false).map((item) => item.id), [1], "Desactivar: solo activos");
  assert.deepEqual(getServiceStatusTargets(ITEMS, mixed, true).map((item) => item.id), [2], "Activar: solo inactivos");
  assert.deepEqual(getServiceStatusTargets(ITEMS, new Set(["1", "3"]), true), [], "Ya activos: nada que activar");
  // Ids seleccionados que no están en la página visible no cuentan.
  assert.deepEqual(getServiceStatusTargets(ITEMS, new Set(["99"]), false), []);
  assert.deepEqual(getServiceStatusTargets(null, mixed, false), []);
});

test("concurrencia: respeta el límite, conserva el orden y devuelve cada fallo sin rechazar", async () => {
  let running = 0;
  let peak = 0;
  const results = await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], SERVICE_BULK_STATUS_CONCURRENCY, async (value) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5 + (value % 3)));
    running -= 1;
    if (value === 4) throw new Error("fallo 4");
    return value * 10;
  });
  assert.equal(peak, SERVICE_BULK_STATUS_CONCURRENCY);
  assert.deepEqual(results.map((result) => (result.ok ? result.value : result.error.message)), [10, 20, 30, "fallo 4", 50, 60, 70]);
  assert.deepEqual(await runWithConcurrency([], 3, async () => 1), []);
});

test("resumen: éxito total, parcial y total fallido, sin presentarlo como atómico", () => {
  assert.deepEqual(describeBulkStatusResult({ failures: [], isActive: false, succeeded: 4 }), {
    tone: "success", title: "4 servicios desactivados", message: "Cambios correctos: 4. Fallidos: 0. Actualizando el tabulador.",
  });
  assert.equal(describeBulkStatusResult({ failures: [], isActive: true, succeeded: 1 }).title, "1 servicio activado");
  const failures = [
    { message: "Unidad inactiva.", service: { code: "TST-002" } },
    { message: "Versión desactualizada.", service: { code: "TST-003" } },
  ];
  assert.deepEqual(describeBulkStatusResult({ failures, isActive: true, succeeded: 1 }), {
    tone: "danger", title: "Se activaron 1 de 3 servicios", message: "Cambios correctos: 1. Fallidos: 2. TST-002: Unidad inactiva. TST-003: Versión desactualizada.",
  });
  assert.equal(describeBulkStatusResult({ failures: failures.slice(0, 1), isActive: false, succeeded: 0 }).title, "No se pudo desactivar el servicio");
  const many = Array.from({ length: 5 }, (_, index) => ({ message: "Error.", service: { code: `S-${index}` } }));
  assert.match(describeBulkStatusResult({ failures: many, isActive: true, succeeded: 0 }).message, /Y 2 más\.$/);
});
