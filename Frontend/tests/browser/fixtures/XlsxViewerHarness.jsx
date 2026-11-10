import { useState } from "react";
import { createRoot } from "react-dom/client";
import * as XLSX from "xlsx";

import XlsxViewerSurface from "../../../src/pages/projects/components/document-preview/XlsxViewerSurface.jsx";
import "../../../src/index.css";

// Valores que con sheet_to_html (xlsx 0.18.5) rompían el marcado e inyectaban elementos reales.
const INJECTION_PAYLOAD = "\"><img id=\"xlsx-injected\" src=\"x\" onerror=\"window.__xlsxInjected=1\">";
const SCRIPT_PAYLOAD = "</td><script>window.__xlsxInjected=2</script>";

/**
 * Construye en el navegador un libro .xlsx real (bytes) con combinaciones, enlaces y valores hostiles.
 *
 * @returns {ArrayBuffer} Contenido del archivo como lo recibe el visor.
 */
function createWorkbookBytes() {
  const summary = XLSX.utils.aoa_to_sheet([
    ["Presupuesto de obra", "", ""],
    ["Partida", "Importe", "Notas"],
    ["Estructura", 1250.5, "Línea 1\nLínea 2"],
    [INJECTION_PAYLOAD, SCRIPT_PAYLOAD, "Enlace seguro"],
    ["Enlace peligroso", "", ""],
  ]);
  summary["!merges"] = [{ s: { c: 0, r: 0 }, e: { c: 2, r: 0 } }];
  summary.C4.l = { Target: "https://example.com/plano" };
  summary.A5.l = { Target: "javascript:window.__xlsxInjected=3" };
  const detail = XLSX.utils.aoa_to_sheet([["Detalle"], ["Segunda hoja"]]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, summary, "Resumen");
  XLSX.utils.book_append_sheet(book, detail, "Detalle");
  return XLSX.write(book, { bookType: "xlsx", type: "array" });
}

const DATA = createWorkbookBytes();
const ANNOTATIONS = [{
  authorName: "Ana",
  id: 41,
  pointNumber: 1,
  selection: { cell: "B3", kind: "document-cell-point", normalizedX: 0.5, normalizedY: 0.5, sheetName: "Resumen" },
}];

window.xlsxHarness = { points: [] };

/** Monta el visor XLSX real con un comentario existente y registra los puntos creados. */
export default function XlsxViewerHarness() {
  const [pending, setPending] = useState(null);
  return (
    <div style={{ height: "640px", width: "900px" }}>
      <XlsxViewerSurface
        annotations={ANNOTATIONS}
        data={DATA}
        focusedId={null}
        pendingSelection={pending}
        title="Presupuesto.xlsx"
        onPointCreate={(selection) => { window.xlsxHarness.points.push(selection); setPending(selection); }}
        onPointSelect={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<XlsxViewerHarness />);
