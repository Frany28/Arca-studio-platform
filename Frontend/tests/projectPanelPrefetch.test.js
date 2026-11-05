import assert from "node:assert/strict";
import test from "node:test";

import {
  allowsAnticipatoryDownloads,
  HEAVY_PANEL_INTENT_DELAY_MS,
  PANEL_INTENT_DELAY_MS,
} from "../src/pages/projects/hooks/useProjectPanelPrefetch.js";

test("la precarga respeta el ahorro de datos y las redes 2G", () => {
  assert.equal(allowsAnticipatoryDownloads(undefined), true, "sin Network Information API se permite");
  assert.equal(allowsAnticipatoryDownloads({ effectiveType: "4g" }), true);
  assert.equal(allowsAnticipatoryDownloads({ effectiveType: "3g" }), true);
  assert.equal(allowsAnticipatoryDownloads({ effectiveType: "4g", saveData: true }), false);
  assert.equal(allowsAnticipatoryDownloads({ effectiveType: "2g" }), false);
  assert.equal(allowsAnticipatoryDownloads({ effectiveType: "slow-2g" }), false);
});

test("el panel con three.js exige una intención más sostenida que los ligeros", () => {
  assert.ok(HEAVY_PANEL_INTENT_DELAY_MS > PANEL_INTENT_DELAY_MS);
});
