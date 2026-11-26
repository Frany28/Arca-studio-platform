import assert from "node:assert/strict";
import test from "node:test";

import { assignUniqueFileNames, buildNumberedFileName, FILE_TITLE_MAX_LENGTH, fileNameKey } from "../src/domain/projectFileNames.js";
import { normalizeError } from "../src/errors/appError.js";

// Nombre lógico único por carpeta (domain/projectFileNames.js) y traducción del índice a 409.

test("sufijo numerado: conserva la extensión, admite nombres sin ella y respeta la longitud de files.title", () => {
  assert.equal(buildNumberedFileName("plano.pdf", 2), "plano (2).pdf");
  assert.equal(buildNumberedFileName("plano.final.PDF", 3), "plano.final (3).PDF");
  assert.equal(buildNumberedFileName("plano", 2), "plano (2)");
  assert.equal(buildNumberedFileName(".env", 2), ".env (2)", "un nombre que empieza por punto no tiene extensión");
  assert.equal(buildNumberedFileName("  plano.pdf  ", 2), "plano (2).pdf");
  const long = `${"a".repeat(300)}.pdf`;
  const numbered = buildNumberedFileName(long, 12);
  assert.equal(numbered.length, FILE_TITLE_MAX_LENGTH);
  assert.ok(numbered.endsWith(" (12).pdf"), "se recorta la base, nunca el sufijo ni la extensión");
});

test("asignación determinista: el de menor id conserva el nombre; los demás, el menor sufijo libre", () => {
  const names = assignUniqueFileNames([
    { id: 31, title: "PLANO.pdf" },
    { id: 12, title: "plano.pdf" },
    { id: 20, title: "Plano.PDF" },
    { id: 40, title: "fachada.jpg" },
  ]);
  assert.deepEqual([...names].sort(([left], [right]) => left - right), [
    [12, "plano.pdf"], [20, "Plano (2).PDF"], [31, "PLANO (3).pdf"], [40, "fachada.jpg"],
  ]);
  assert.equal(new Set([...names.values()].map(fileNameKey)).size, 4, "todos únicos sin distinguir mayúsculas");
});

test("un sufijo nunca pisa un nombre real del lote ni uno ya ocupado en la carpeta", () => {
  const names = assignUniqueFileNames([
    { id: 1, title: "plano.pdf" },
    { id: 2, title: "plano.pdf" },
    { id: 3, title: "plano (2).pdf" },
  ], { taken: ["PLANO (3).pdf"] });
  assert.deepEqual([names.get(1), names.get(2), names.get(3)], ["plano.pdf", "plano (4).pdf", "plano (2).pdf"]);
  const occupied = assignUniqueFileNames([{ id: 7, title: "Acta.pdf" }], { taken: ["acta.pdf"] });
  assert.equal(occupied.get(7), "Acta (2).pdf", "con la carpeta ocupada, incluso el primero recibe sufijo");
});

test("idempotencia: recalcular con los nombres ya asignados no cambia ninguno; el orden de entrada no importa", () => {
  const files = [{ id: 5, title: "a.pdf" }, { id: 6, title: "A.pdf" }, { id: 7, title: "a.pdf" }, { id: 8, title: "b.pdf" }];
  const first = assignUniqueFileNames(files);
  const again = assignUniqueFileNames([...first].map(([id, title]) => ({ id, title })));
  assert.deepEqual([...again].sort(), [...first].sort());
  assert.deepEqual([...assignUniqueFileNames([...files].reverse())].sort(), [...first].sort());
});

test("la violación de uq_files_project_folder_title se traduce a 409 DUPLICATE_PROJECT_FILE", () => {
  const normalized = normalizeError(Object.assign(new Error("duplicate key"), { code: "23505", constraint: "uq_files_project_folder_title", detail: "Key (...)=(1, 0, plano.pdf) already exists." }));
  assert.deepEqual([normalized.status, normalized.code], [409, "DUPLICATE_PROJECT_FILE"]);
  assert.equal(normalized.publicMessage.includes("plano"), false, "no expone el valor de la clave");
  assert.equal(normalizeError(Object.assign(new Error("x"), { code: "23505", constraint: "otra" })).code, "RESOURCE_CONFLICT");
});
