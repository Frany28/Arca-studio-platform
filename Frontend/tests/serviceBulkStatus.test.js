import assert from "node:assert/strict";
import test from "node:test";

import {
  SERVICE_BULK_STATUS_CONCURRENCY,
  describeBulkStatusResult,
  getServiceBulkActionVisibility,
  getServiceStatusSelection,
  runWithConcurrency,
} from "../src/pages/admin-services-quotes/service-catalog/utils/serviceBulkStatus.js";

const ITEMS = [
  { id: 1, code: "TST-001", isActive: true },
  { id: 2, code: "TST-002", isActive: false },
  { id: 3, code: "TST-003", isActive: true },
];

test("selección vacía: ambas acciones sin destinos", () => {
  const state = getServiceStatusSelection(ITEMS, new Set());
  assert.equal(state.selectedCount, 0);
  assert.equal(state.isMixed, false);
  assert.deepEqual(state.targets, { activate: [], deactivate: [] });
});

test("selección homogénea: desactivar todos activos o activar todos inactivos", () => {
  const active = getServiceStatusSelection(ITEMS, new Set(["1", "3"]));
  assert.equal(active.selectedActiveCount, 2);
  assert.equal(active.selectedInactiveCount, 0);
  assert.deepEqual(active.targets.deactivate.map((item) => item.id), [1, 3]);
  assert.deepEqual(active.targets.activate, []);
  const inactive = getServiceStatusSelection(ITEMS, new Set(["2"]));
  assert.equal(inactive.selectedInactiveCount, 1);
  assert.deepEqual(inactive.targets.activate.map((item) => item.id), [2]);
  assert.deepEqual(inactive.targets.deactivate, []);
});

test("selección mixta: se cuentan TODOS los registros y se bloquean ambas acciones, incluso 9 inactivos y 1 activo", () => {
  for (const activeIndex of [0, 5, 9]) {
    const items = Array.from({ length: 10 }, (_, id) => ({ id, isActive: id === activeIndex }));
    for (const ordered of [items, items.toReversed()]) {
      const state = getServiceStatusSelection(ordered, new Set(items.map((item) => String(item.id))));
      assert.equal(state.selectedCount, 10);
      assert.equal(state.selectedActiveCount, 1);
      assert.equal(state.selectedInactiveCount, 9);
      assert.equal(state.isMixed, true);
      assert.deepEqual(state.targets, { activate: [], deactivate: [] });
    }
  }
});

test("selección incompleta o estado desconocido: no permite actuar sobre un subconjunto", () => {
  for (const state of [
    getServiceStatusSelection(ITEMS, new Set(["1", "99"])),
    getServiceStatusSelection(null, new Set(["1"])),
    getServiceStatusSelection([{ id: 1, isActive: null }], new Set(["1"])),
  ]) assert.deepEqual(state.targets, { activate: [], deactivate: [] });
});

test("footer: sin selección no hay acciones; con selección siempre se muestran ambas", () => {
  const cases = [
    { ids: [], expected: { activate: false, deactivate: false } },
    { ids: ["1"], expected: { activate: true, deactivate: true } },
    { ids: ["1", "3"], expected: { activate: true, deactivate: true } },
    { ids: ["2"], expected: { activate: true, deactivate: true } },
    { ids: ["1", "2"], expected: { activate: true, deactivate: true } },
    { ids: ["1", "99"], expected: { activate: true, deactivate: true } },
  ];
  for (const { ids, expected } of cases) {
    const selection = getServiceStatusSelection(ITEMS, new Set(ids));
    assert.deepEqual(getServiceBulkActionVisibility({ ...selection, mixed: selection.isMixed }), expected, JSON.stringify(ids));
  }
  assert.deepEqual(getServiceBulkActionVisibility({ selectedCount: 0, mixed: true, targets: { activate: [], deactivate: [] } }),
    { activate: false, deactivate: false }, "Sin selección tampoco se muestra una mezcla obsoleta");
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
  const stopped = describeBulkStatusResult({ failures: failures.slice(0, 1), isActive: true, succeeded: 2, cancelled: 4 });
  assert.match(stopped.title, /2 de 7/);
  assert.match(stopped.message, /Fallidos: 1\. Cancelados sin enviar: 4\./);
});
