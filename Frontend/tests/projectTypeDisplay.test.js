import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShowcasePages,
  getProjectTypeDisplay,
  getProjectTypeLabel,
  getShowcaseCardHeight,
  getShowcaseLayout,
} from "../src/utils/projectTypeDisplay.js";

test("project types use their database-backed display labels", () => {
  assert.equal(getProjectTypeDisplay("commercial"), "Proyecto Comercial");
  assert.equal(getProjectTypeDisplay("corporate"), "Proyecto Corporativo");
  assert.equal(getProjectTypeDisplay("residential"), "Proyecto Residencial");
  // El identificador histórico se muestra con el nombre vigente del mismo servicio.
  assert.equal(getProjectTypeDisplay("stands_exhibitions"), "Proyecto Stand publicitario");
  assert.equal(getProjectTypeDisplay("advertising_stand"), "Proyecto Stand publicitario");
});

test("project type display handles unknown and missing values", () => {
  assert.equal(getProjectTypeLabel("custom"), "custom");
  assert.equal(getProjectTypeDisplay("custom"), "Proyecto custom");
  assert.equal(getProjectTypeLabel(null), "-");
  assert.equal(getProjectTypeDisplay(null), "Tipo de proyecto no disponible");
});

test("showcase pages adapt to the requested visible card count", () => {
  const items = [1, 2, 3, 4];
  assert.deepEqual(buildShowcasePages(items, 3), [[1, 2, 3], [4]]);
  assert.deepEqual(buildShowcasePages(items, 2), [[1, 2], [3, 4]]);
  assert.deepEqual(buildShowcasePages(items, 1), [[1], [2], [3], [4]]);
});

test("showcase layouts follow mobile, tablet, desktop and single-card designs", () => {
  assert.deepEqual(getShowcaseLayout(375, 4), {
    columns: 1,
    itemsPerPage: 2,
    mode: "mobile",
  });
  assert.deepEqual(getShowcaseLayout(768, 4), {
    columns: 2,
    itemsPerPage: 2,
    mode: "tablet",
  });
  assert.deepEqual(getShowcaseLayout(1023, 4), {
    columns: 2,
    itemsPerPage: 2,
    mode: "tablet",
  });
  assert.deepEqual(getShowcaseLayout(1024, 4), {
    columns: 3,
    itemsPerPage: 3,
    mode: "desktop",
  });
  assert.deepEqual(getShowcaseLayout(1280, 4), {
    columns: 3,
    itemsPerPage: 3,
    mode: "desktop",
  });
  assert.deepEqual(getShowcaseLayout(1440, 1), {
    columns: 1,
    itemsPerPage: 1,
    mode: "single",
  });
});

test("showcase card heights match responsive designs and global mobile order", () => {
  assert.equal(getShowcaseCardHeight("desktop", 0), 273);
  assert.equal(getShowcaseCardHeight("tablet", 0), 465);
  assert.equal(getShowcaseCardHeight("single", 0), 465);
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => getShowcaseCardHeight("mobile", index)),
    [465, 273, 465, 273],
  );
});
