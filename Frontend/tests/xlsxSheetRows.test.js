import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as XLSX from "xlsx";

import { buildSheetRows } from "../src/pages/projects/components/document-preview/xlsxSheetRows.js";

/**
 * Crea un libro, lo serializa como .xlsx y lo vuelve a leer, igual que el visor con un archivo subido.
 *
 * @param {Array<Array<string>>} rows - Celdas de la primera hoja.
 * @param {(sheet: object) => void} [customize] - Ajustes de la hoja (combinaciones, enlaces).
 * @returns {object} Hoja leída desde los bytes.
 */
function roundTripSheet(rows, customize = () => {}) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  customize(sheet);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Hoja1");
  const parsed = XLSX.read(XLSX.write(book, { bookType: "xlsx", type: "array" }), { type: "array" });
  return parsed.Sheets.Hoja1;
}

test("XLSX: el contenido de una celda se entrega como texto, no como marcado (regresión de inyección HTML)", () => {
  // Con sheet_to_html (xlsx 0.18.5) este valor rompía el atributo data-v e insertaba un <div> real.
  const payload = "\"><div id=\"injected\" style=\"position:fixed;inset:0\">Sesión expirada</div>";
  const [row] = buildSheetRows(XLSX, roundTripSheet([[payload]]));
  assert.equal(row.cells[0].text, payload, "se conserva literal para que React lo escape");
  assert.equal(Object.keys(row.cells[0]).includes("html"), false);
});

test("XLSX: misma estructura de celdas que sheet_to_html, incluidas combinaciones (direcciones de comentarios estables)", () => {
  const sheet = roundTripSheet(
    [["Título", "", "C1"], ["A2", "B2", "C2"], ["A3", "B3", "C3"]],
    (target) => { target["!merges"] = [{ e: { c: 1, r: 0 }, s: { c: 0, r: 0 } }, { e: { c: 2, r: 2 }, s: { c: 2, r: 1 } }]; },
  );
  const html = XLSX.utils.sheet_to_html(sheet);
  const htmlCellsPerRow = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) => (row.match(/<td/g) || []).length);
  const rows = buildSheetRows(XLSX, sheet);
  assert.deepEqual(rows.map((row) => row.cells.length), htmlCellsPerRow);
  assert.deepEqual(rows.map((row) => row.cells.map((cell) => cell.key)), [["A1", "C1"], ["A2", "B2", "C2"], ["A3", "B3"]]);
  assert.equal(rows[0].cells[0].colSpan, 2);
  assert.equal(rows[1].cells[2].rowSpan, 2);
});

test("XLSX: solo se enlazan destinos http(s); javascript: y referencias internas se descartan", () => {
  const sheet = roundTripSheet([["seguro", "malicioso", "interno"]], (target) => {
    target.A1.l = { Target: "https://arcastudio.com/catalogo" };
    target.B1.l = { Target: "javascript:alert(1)" };
    target.C1.l = { Target: "#Hoja1!A1" };
  });
  const [row] = buildSheetRows(XLSX, sheet);
  assert.deepEqual(row.cells.map((cell) => cell.href), ["https://arcastudio.com/catalogo", null, null]);
});

test("XLSX: el visor ya no inserta HTML generado por SheetJS", async () => {
  const source = await readFile(new URL("../src/pages/projects/components/document-preview/XlsxViewerSurface.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|sheet_to_html/);
});
