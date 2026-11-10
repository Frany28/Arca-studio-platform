/**
 * Convierte una hoja de SheetJS en filas y celdas de datos para renderizarlas con React, sin generar
 * HTML. Sustituye a `XLSX.utils.sheet_to_html` + `dangerouslySetInnerHTML`: en xlsx 0.18.5 esa
 * función escribe sin escapar valores de celda en atributos (`data-v`, `data-z`) y destinos de
 * hipervínculos, lo que permitía inyectar HTML desde un archivo subido por otro usuario.
 *
 * Reproduce la misma estructura que `sheet_to_html` (todas las filas del rango, celdas cubiertas por
 * una combinación omitidas, `colSpan`/`rowSpan` en la celda origen). Así la posición de cada `<td>`
 * —con la que el visor calcula la dirección de celda de los comentarios— no cambia y las anotaciones
 * existentes siguen apuntando a la misma celda.
 *
 * @param {object} XLSX - Módulo SheetJS (se inyecta para reutilizar la instancia ya cargada).
 * @param {object|undefined} sheet - Hoja de cálculo de SheetJS.
 * @returns {Array<{ key: string, cells: Array<{ key: string, text: string, href: string|null, colSpan?: number, rowSpan?: number }> }>}
 *   Filas listas para renderizar; vacío si la hoja no tiene rango.
 */
export function buildSheetRows(XLSX, sheet) {
  if (!sheet?.["!ref"]) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const merges = sheet["!merges"] || [];
  const rows = [];

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const cells = [];
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const span = resolveMergeSpan(merges, rowIndex, columnIndex);
      if (span === null) continue;
      const address = XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex });
      const cell = sheet[address];
      cells.push({
        key: address,
        text: formatCellText(XLSX, cell),
        href: resolveSafeHref(cell),
        ...span,
      });
    }
    rows.push({ cells, key: String(rowIndex) });
  }
  return rows;
}

/**
 * Indica cómo se renderiza una posición según las combinaciones de la hoja: `null` si está cubierta
 * por una combinación (no se emite `<td>`), un objeto con `colSpan`/`rowSpan` si es su celda origen,
 * o un objeto vacío para una celda normal. Mismo criterio que `sheet_to_html`.
 *
 * @param {Array<{ s: { r: number, c: number }, e: { r: number, c: number } }>} merges - Combinaciones.
 * @param {number} rowIndex - Fila.
 * @param {number} columnIndex - Columna.
 * @returns {null|{ colSpan?: number, rowSpan?: number }} Tratamiento de la posición.
 */
function resolveMergeSpan(merges, rowIndex, columnIndex) {
  for (const merge of merges) {
    if (rowIndex < merge.s.r || rowIndex > merge.e.r || columnIndex < merge.s.c || columnIndex > merge.e.c) continue;
    if (rowIndex !== merge.s.r || columnIndex !== merge.s.c) return null;
    const rowSpan = merge.e.r - merge.s.r + 1;
    const colSpan = merge.e.c - merge.s.c + 1;
    return { ...(colSpan > 1 ? { colSpan } : {}), ...(rowSpan > 1 ? { rowSpan } : {}) };
  }
  return {};
}

/**
 * Texto visible de una celda: el formateado por SheetJS (fechas, números, porcentajes) o su valor.
 * Se devuelve como texto plano; React lo escapa al renderizarlo.
 *
 * @param {object} XLSX - Módulo SheetJS.
 * @param {object|undefined} cell - Celda de SheetJS.
 * @returns {string} Texto a mostrar.
 */
function formatCellText(XLSX, cell) {
  if (!cell) return "";
  if (typeof cell.w === "string") return cell.w;
  try {
    return XLSX.utils.format_cell(cell);
  } catch {
    return cell.v == null ? "" : String(cell.v);
  }
}

/**
 * Destino de un hipervínculo de celda solo si es http(s) absoluto; descarta `javascript:`, `data:`,
 * rutas relativas y referencias internas del libro (`#Hoja!A1`).
 *
 * @param {object|undefined} cell - Celda de SheetJS.
 * @returns {string|null} URL segura o null.
 */
function resolveSafeHref(cell) {
  const target = cell?.l?.Target;
  if (typeof target !== "string") return null;
  try {
    const url = new URL(target);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
