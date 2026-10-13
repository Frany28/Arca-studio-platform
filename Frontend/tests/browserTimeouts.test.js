import assert from "node:assert/strict";
import test from "node:test";

import {
  INTERACTION_TIMEOUT_MS,
  NAVIGATION_TIMEOUT_MS,
  applyBrowserTimeouts,
} from "./helpers/browserTimeouts.js";

/**
 * Crea una página falsa que registra los timeouts recibidos.
 *
 * @returns {{page: Object, calls: Object}} Página y registro de llamadas.
 */
function createRecordingPage() {
  const calls = {};
  const page = {
    setDefaultTimeout: (value) => { calls.interaction = value; },
    setDefaultNavigationTimeout: (value) => { calls.navigation = value; },
  };
  return { page, calls };
}

test("la política separa el límite de interacción del de navegación", () => {
  const { page, calls } = createRecordingPage();

  assert.equal(applyBrowserTimeouts(page), page);
  assert.deepEqual(calls, { interaction: 5000, navigation: 30000 });
  assert.equal(INTERACTION_TIMEOUT_MS, 5000);
  assert.ok(NAVIGATION_TIMEOUT_MS > INTERACTION_TIMEOUT_MS, "La navegación tolera la compilación en frío de Vite");
});

test("una prueba puede ajustar la interacción sin alterar la navegación", () => {
  const { page, calls } = createRecordingPage();

  applyBrowserTimeouts(page, { interactionTimeout: 2000 });
  assert.deepEqual(calls, { interaction: 2000, navigation: NAVIGATION_TIMEOUT_MS });
});
