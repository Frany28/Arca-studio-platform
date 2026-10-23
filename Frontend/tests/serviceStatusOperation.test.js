import assert from "node:assert/strict";
import test from "node:test";

import { executeServiceStatusChanges, verifyServiceStatusSelection } from "../src/pages/admin-services-quotes/service-catalog/utils/serviceStatusOperation.js";

const services = (count, isActive = false) => Array.from({ length: count }, (_, index) => ({
  id: index + 1, code: `TEST-${index + 1}`, isActive, currentVersion: index + 2,
  measurementUnit: { id: 1, isActive: true }, unitDenomination: { id: 1, isActive: true },
}));
const readFrom = (items) => async ({ serviceId }) => ({ service: structuredClone(items.find((item) => item.id === serviceId)) });

test("comprobación conjunta: ninguna escritura empieza antes de terminar TODAS las lecturas; conserva expectedVersion", async () => {
  const selected = services(7);
  let completed = 0;
  let reading = 0;
  let peak = 0;
  const writes = [];
  const results = await executeServiceStatusChanges({
    services: selected, isActive: true,
    readService: async ({ serviceId }) => {
      reading += 1;
      peak = Math.max(peak, reading);
      await new Promise((resolve) => setTimeout(resolve, 3));
      reading -= 1;
      completed += 1;
      return { service: selected.find((item) => item.id === serviceId) };
    },
    changeStatus: async (payload) => {
      assert.equal(completed, selected.length);
      writes.push(payload);
      return { changed: true };
    },
  });
  assert.equal(peak, 3);
  assert.equal(results.every((result) => result.ok), true);
  assert.deepEqual(writes, selected.map((item) => ({ serviceId: item.id, expectedVersion: item.currentVersion, isActive: true })));
});

for (const change of ["estado", "versión", "inexistente", "identidad"]) {
  test(`comprobación: ${change} cambió en otro registro; cancela TODO sin escrituras`, async () => {
    const selected = services(5);
    const current = structuredClone(selected);
    if (change === "estado") current[4].isActive = true;
    if (change === "versión") current[4].currentVersion += 2;
    if (change === "inexistente") current.pop();
    if (change === "identidad") current[4].id = 999;
    let writes = 0;
    await assert.rejects(executeServiceStatusChanges({
      services: selected, isActive: true, readService: readFrom(current), changeStatus: async () => { writes += 1; },
    }), { code: "SERVICE_SELECTION_CHANGED" });
    assert.equal(writes, 0);
  });
}

test("sin selección, mixta o acción sin efecto: ni siquiera relee para intentar filtrar destinos", async () => {
  let reads = 0;
  for (const selected of [[], [...services(1), { ...services(2)[1], isActive: true }], services(2, true)]) {
    await assert.rejects(verifyServiceStatusSelection(selected, true, async () => { reads += 1; }), { code: "SERVICE_SELECTION_CHANGED" });
  }
  assert.equal(reads, 0);
});

test("una lectura falla: conserva el error HTTP y no intenta ninguna escritura", async () => {
  const denied = Object.assign(new Error("Sin permisos"), { code: "FORBIDDEN", status: 403 });
  let writes = 0;
  await assert.rejects(executeServiceStatusChanges({
    services: services(3), isActive: true, readService: async () => { throw denied; }, changeStatus: async () => { writes += 1; },
  }), (error) => error === denied);
  assert.equal(writes, 0);
});

for (const field of ["measurementUnit", "unitDenomination"]) {
  test(`reactivación: ${field} inactiva cancela el conjunto antes de escribir`, async () => {
    const selected = services(4);
    const current = structuredClone(selected);
    current[3][field].isActive = false;
    let writes = 0;
    await assert.rejects(executeServiceStatusChanges({
      services: selected, isActive: true, readService: readFrom(current), changeStatus: async () => { writes += 1; },
    }), (error) => error.code === "VALIDATION_ERROR" && Boolean(error.fields[field === "measurementUnit" ? "measurementUnitId" : "unitDenominationId"]));
    assert.equal(writes, 0);
    // Desactivar no exige referencias activas.
    await verifyServiceStatusSelection(current.map((item) => ({ ...item, isActive: true })), false,
      readFrom(current.map((item) => ({ ...item, isActive: true }))));
  });
}

test("conflicto después de comprobar: detiene envíos pendientes, espera los iniciados y no reintenta éxitos", async () => {
  const selected = services(7);
  const sent = [];
  const conflict = Object.assign(new Error("Versión nueva"), { code: "SERVICE_VERSION_CONFLICT", status: 409 });
  const results = await executeServiceStatusChanges({
    services: selected, isActive: true, readService: readFrom(selected),
    changeStatus: async ({ serviceId }) => {
      sent.push(serviceId);
      if (serviceId === 1) throw conflict;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { changed: true };
    },
  });
  assert.deepEqual(sent, [1, 2, 3]);
  assert.equal(results[0].error, conflict);
  assert.equal(results.filter((result) => result.ok).length, 2);
  assert.deepEqual(results.filter((result) => result.skipped).map((result) => result.item.id), [4, 5, 6, 7]);
});

test("desmontaje durante las lecturas: abortar impide comenzar las escrituras", async () => {
  const controller = new AbortController();
  const selected = services(3);
  let writes = 0;
  await assert.rejects(executeServiceStatusChanges({
    services: selected, isActive: true, signal: controller.signal,
    readService: async ({ serviceId }) => {
      controller.abort();
      return { service: selected.find((item) => item.id === serviceId) };
    },
    changeStatus: async () => { writes += 1; },
  }), { name: "AbortError" });
  assert.equal(writes, 0);
});
