import assert from "node:assert/strict";
import test from "node:test";

import { formatServicePickerCount } from "../src/pages/admin-services-quotes/quote-editor/utils/servicePickerCount.js";

test("contador del selector: sin servicios incluidos conserva el texto de Figma", () => {
  assert.equal(formatServicePickerCount({ available: 3, included: 0, selected: 0 }), "0 de 3 seleccionados");
  assert.equal(formatServicePickerCount({ available: 3, included: 0, selected: 2 }), "2 de 3 seleccionados");
});

test("contador del selector: separa las selecciones nuevas de los servicios ya incluidos", () => {
  assert.equal(formatServicePickerCount({ available: 1, included: 2, selected: 0 }), "0 de 1 seleccionados · 2 ya incluidos");
  assert.equal(formatServicePickerCount({ available: 2, included: 1, selected: 1 }), "1 de 2 seleccionados · 1 ya incluido");
  assert.equal(formatServicePickerCount({ available: 0, included: 2, selected: 0 }), "0 de 0 seleccionados · 2 ya incluidos");
});
