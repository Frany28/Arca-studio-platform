import assert from "node:assert/strict";
import test from "node:test";

import { getPortalMenuPosition } from "../src/components/ui/DropdownMenu/dropdownMenuPosition.js";

const rect = (top, bottom) => ({ bottom, left: 100, top, width: 250 });

test("menú en portal: se une al borde inferior del disparador con su mismo ancho", () => {
  assert.deepEqual(getPortalMenuPosition(rect(200, 241), 120, 900), { left: 100, placement: "bottom", top: 241, width: 250 });
});

test("menú en portal: sin espacio debajo y con espacio encima, se abre hacia arriba", () => {
  assert.deepEqual(getPortalMenuPosition(rect(800, 841), 120, 900), { left: 100, placement: "top", top: 680, width: 250 });
});

test("menú en portal: sin espacio en ningún lado conserva la apertura hacia abajo", () => {
  assert.equal(getPortalMenuPosition(rect(60, 101), 900, 900).placement, "bottom");
});
