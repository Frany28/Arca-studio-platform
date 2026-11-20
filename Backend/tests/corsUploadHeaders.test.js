import assert from "node:assert/strict";
import test from "node:test";

import { corsOptions } from "../src/config/cors.js";

// El frontend publicado y la API están en orígenes distintos: las cabeceras que envían las subidas
// deben pasar el preflight. El reemplazo de versiones (B4, U3) envía su motivo en X-Change-Note.
test("CORS admite las cabeceras de subida, incluido el motivo del reemplazo de versiones", () => {
  const { allowedHeaders } = corsOptions();
  for (const header of ["Content-Type", "X-File-Name", "X-Original-File-Name", "X-Change-Note"]) {
    assert.ok(allowedHeaders.includes(header), header);
  }
});
