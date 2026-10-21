import assert from "node:assert/strict";
import test from "node:test";

import { SCROLL_BAR_DEFAULT_PROPS, getScrollBarSize } from "../src/components/ui/ScrollBar/scrollBarConfig.js";
import { getInputOptionsScrollbarReserve } from "../src/components/ui/Input/options/inputOptionsConfig.js";

test("ScrollBar: el tamaño por defecto conserva el track de 16 px y el thumb de 8 px", () => {
  assert.equal(SCROLL_BAR_DEFAULT_PROPS.size, "default");
  assert.deepEqual(getScrollBarSize(), { track: 16, thumb: 8, crossPadding: 4 });
  assert.deepEqual(getScrollBarSize("desconocido"), getScrollBarSize("default"));
});

test("ScrollBar fino: thumb de 4 px con todo el track de 12 px como zona de arrastre", () => {
  const thin = getScrollBarSize("thin");
  assert.equal(thin.thumb, 4);
  // Sin padding transversal, el área que recibe el puntero es el track completo, no el thumb.
  assert.equal(thin.track - thin.crossPadding * 2, 12);
});

test("listado de opciones: reserva solo el track y separa el thumb 4 px de las filas", () => {
  for (const size of ["default", "thin"]) {
    const { track, thumb } = getScrollBarSize(size);
    // Las filas terminan donde empieza el track (padding del panel de 4 px incluido).
    assert.equal(getInputOptionsScrollbarReserve(size) + 4, track);
    assert.equal((track - thumb) / 2, 4, `Separación fila-thumb en ${size}`);
  }
  assert.equal(getInputOptionsScrollbarReserve(), 12, "El selector telefónico conserva su reserva");
  assert.equal(getInputOptionsScrollbarReserve("thin"), 8);
});
