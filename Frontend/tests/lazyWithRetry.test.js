import assert from "node:assert/strict";
import test from "node:test";

import {
  CHUNK_RELOAD_STORAGE_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  claimChunkReload,
  createModulePreloader,
  fulfilledThenable,
  isChunkLoadError,
  loadWithChunkRecovery,
} from "../src/utils/lazyWithRetry.js";

/** Almacenamiento en memoria con la interfaz de sessionStorage. */
function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), values };
}

const chunkError = () => new TypeError("Failed to fetch dynamically imported module: https://arca.test/assets/ProjectDetailsPage-OLD.js");

test("reconoce los fallos de carga de módulos de Chromium, Firefox y Safari", () => {
  assert.equal(isChunkLoadError(chunkError()), true);
  assert.equal(isChunkLoadError(new TypeError("error loading dynamically imported module")), true);
  assert.equal(isChunkLoadError(new TypeError("Importing a module script failed.")), true);
  assert.equal(isChunkLoadError(new Error("Unable to preload CSS for /assets/a.css")), true);
  assert.equal(isChunkLoadError(new Error("Cannot read properties of undefined")), false);
  assert.equal(isChunkLoadError(null), false);
});

test("un módulo eliminado por una nueva publicación recarga la página una sola vez", async () => {
  const storage = memoryStorage();
  let reloads = 0;
  const options = { now: () => 1_000_000, reload: () => { reloads += 1; }, storage };
  let settled = false;
  loadWithChunkRecovery(() => Promise.reject(chunkError()), options).then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => { setTimeout(resolve, 10); });
  assert.equal(reloads, 1);
  assert.equal(settled, false, "queda pendiente mientras se recarga: no se muestra el error");
  assert.equal(storage.values.get(CHUNK_RELOAD_STORAGE_KEY), "1000000");
});

test("si vuelve a fallar tras recargar, no recarga de nuevo y propaga el error (sin bucles)", async () => {
  const storage = memoryStorage();
  storage.setItem(CHUNK_RELOAD_STORAGE_KEY, 1_000_000);
  let reloads = 0;
  await assert.rejects(
    loadWithChunkRecovery(() => Promise.reject(chunkError()), { now: () => 1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1, reload: () => { reloads += 1; }, storage }),
    /Failed to fetch dynamically imported module/,
  );
  assert.equal(reloads, 0);
  // Pasado el intervalo (otra publicación más tarde en la misma sesión) vuelve a permitirse.
  assert.equal(claimChunkReload(storage, 1_000_000 + CHUNK_RELOAD_WINDOW_MS), true);
});

test("otros errores y la falta de almacenamiento no provocan recargas", async () => {
  let reloads = 0;
  const reload = () => { reloads += 1; };
  await assert.rejects(loadWithChunkRecovery(() => Promise.reject(new Error("fallo del componente")), { reload, storage: memoryStorage() }), /fallo del componente/);
  await assert.rejects(loadWithChunkRecovery(() => Promise.reject(chunkError()), { reload, storage: null }), /dynamically imported module/);
  const throwing = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => {} };
  await assert.rejects(loadWithChunkRecovery(() => Promise.reject(chunkError()), { reload, storage: throwing }), /dynamically imported module/);
  assert.equal(reloads, 0);
});

test("un módulo disponible se carga sin efectos", async () => {
  const module = { default: () => null };
  assert.equal(await loadWithChunkRecovery(() => Promise.resolve(module), { reload: () => assert.fail("no debe recargar"), storage: memoryStorage() }), module);
});

test("la precarga comparte una sola descarga y queda disponible para la carga real", async () => {
  let calls = 0;
  const preload = createModulePreloader(() => { calls += 1; return Promise.resolve({ default: () => null }); });
  assert.deepEqual(await Promise.all([preload(), preload()]), [true, true]);
  assert.equal(await preload(), true);
  assert.equal(calls, 1);
  assert.equal(typeof preload.getLoaded().default, "function", "el módulo queda disponible para el primer render");
});

test("una precarga fallida no recarga la página ni bloquea un reintento posterior", async () => {
  let calls = 0;
  const preload = createModulePreloader(() => { calls += 1; return calls === 1 ? Promise.reject(chunkError()) : Promise.resolve({}); });
  assert.equal(await preload(), false);
  assert.equal(await preload(), true);
  assert.equal(calls, 2);
});

test("el thenable de un módulo precargado se cumple en el mismo turno (sin suspender)", () => {
  const module = { default: () => null };
  let received = null;
  fulfilledThenable(module).then((value) => { received = value; });
  assert.equal(received, module);
});
