import assert from "node:assert/strict";
import test from "node:test";

import { readNetlifyCsp, readPublicHeadersCsp } from "./helpers/productionCsp.js";

/**
 * Devuelve las fuentes de una directiva de la política.
 *
 * @param {string} policy - Content-Security-Policy completa.
 * @param {string} name - Nombre de la directiva.
 * @returns {Array<string>} Fuentes declaradas.
 */
function directiveSources(policy, name) {
  const directive = policy.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name} `));
  return directive ? directive.split(/\s+/).slice(1) : [];
}

test("CSP: netlify.toml y public/_headers publican la misma política", () => {
  assert.equal(readPublicHeadersCsp(), readNetlifyCsp());
});

test("CSP: los scripts no admiten evaluación dinámica de JavaScript, solo compilación WebAssembly", () => {
  // pdfjs-dist 6 y xlsx 0.20.3 no usan eval ni new Function; las pruebas de navegador de los visores lo comprueban.
  const scripts = directiveSources(readNetlifyCsp(), "script-src");
  assert.equal(scripts.includes("'unsafe-eval'"), false);
  assert.equal(scripts.includes("'unsafe-inline'"), false);
  assert.deepEqual(scripts, ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepEqual(directiveSources(readNetlifyCsp(), "object-src"), ["'none'"]);
});
