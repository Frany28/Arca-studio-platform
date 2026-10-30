import PDFDocument from "pdfkit";

/*
 * Maquetación del PDF de una cotización según Figma 5831:356993 (variantes de una y dos
 * páginas). El frame de Figma mide 816 × 1054 px, una carta a 96 ppp: cada medida en píxeles
 * se multiplica por 0,75 para obtener puntos PDF. La paginación es manual (sin saltos
 * automáticos de pdfkit): cada página repite la cabecera, la tabla continúa con su título y su
 * fila de encabezado, y todas llevan la franja inferior y su número.
 */

const PX_TO_PT = 0.75;
const PAGE = Object.freeze({ width: 816.378, height: 1054.488, padding: 48, sectionGap: 48, blockGap: 16 });
const CONTENT_WIDTH = PAGE.width - PAGE.padding * 2;
// Límite inferior del contenido: deja 24 px sobre el número de página (Figma 5831:359383).
const CONTENT_BOTTOM = PAGE.height - 37.49 - 24 - 14 - 24;

const COLORS = Object.freeze({
  accent: "#FF4431",
  border: "#E8E8E8",
  headerFill: "#E8E8E8",
  text50: "#0F0F0F",
  text100: "#818181",
  text200: "#4E4E4E",
  text300: "#2A2929",
  white: "#FFFFFF",
});

// Estilos tipográficos de Figma (tamaño e interlineado en px).
const TEXT = Object.freeze({
  badge: { color: COLORS.text300, font: "regular", lineHeight: 14, size: 12 },
  cell: { color: COLORS.text300, font: "regular", lineHeight: 14, size: 12 },
  clientLabel: { color: COLORS.text200, font: "regular", lineHeight: 14, size: 12 },
  code: { color: COLORS.text200, font: "bold", lineHeight: 22, size: 18 },
  date: { color: COLORS.text100, font: "regular", lineHeight: 14, size: 12 },
  fieldValue: { color: COLORS.text300, font: "bold", lineHeight: 19, size: 16 },
  notes: { color: COLORS.text200, font: "medium", lineHeight: 17, size: 14 },
  pageNumber: { color: COLORS.text100, font: "regular", lineHeight: 14, size: 12 },
  projectLabel: { color: COLORS.text200, font: "regular", lineHeight: 17, size: 14 },
  sectionTitle: { color: COLORS.text200, font: "bold", lineHeight: 19, size: 16 },
  totalLabel: { color: COLORS.text200, font: "regular", lineHeight: 19, size: 16 },
  totalValue: { color: COLORS.text50, font: "bold", lineHeight: 24, size: 20 },
  vatNotice: { color: COLORS.text100, font: "regular", lineHeight: 14, size: 12 },
});

// Columnas de «Detalle de servicios»: Servicio 210, Unidad 170 y tres columnas flexibles.
const FLEX_COLUMN_WIDTH = (CONTENT_WIDTH - 210 - 170) / 3;
const COLUMNS = Object.freeze([
  { key: "serviceName", label: "Servicio", width: 210 },
  { badge: true, key: "unitLabel", label: "Unidad", width: 170 },
  { key: "quantity", label: "Cantidad", width: FLEX_COLUMN_WIDTH },
  { key: "unitRate", label: "Tarifa base", width: FLEX_COLUMN_WIDTH },
  { align: "right", key: "subtotal", label: "Subtotal", width: FLEX_COLUMN_WIDTH },
]);
const CELL_PADDING = Object.freeze({ x: 24, y: 16 });
const HEADER_ROW_HEIGHT = CELL_PADDING.y * 2 + TEXT.cell.lineHeight;
const BADGE = Object.freeze({ height: 20, paddingX: 8, radius: 10 });
const TABLE_RADIUS = 12;

// Logo principal de 228 × 48 px y posición de cada grupo (insets del componente MainLogo).
const LOGO_PARTS = Object.freeze([
  { height: 48, name: "logoBox", width: 50.63, x: 0.62, y: -0.47 },
  { height: 24.41, name: "logoWordmark", width: 168.11, x: 60.05, y: 11.41 },
  { height: 4.09, name: "logoRif", width: 39.25, x: 60.05, y: 40 },
  { height: 4.09, name: "logoYear", width: 25.69, x: 202.31, y: 39.96 },
]);
const LOGO_HEIGHT = 48;

/**
 * Convierte una medida de Figma en píxeles a puntos PDF.
 * Todas las coordenadas del documento se expresan en píxeles de Figma para poder compararlas.
 *
 * @param {number} value - Medida en px.
 * @returns {number} Medida en pt.
 */
function pt(value) {
  return value * PX_TO_PT;
}

/**
 * Aplica fuente, tamaño y color de un estilo tipográfico al documento.
 * Debe llamarse antes de medir un texto para que la medida use la fuente correcta.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {{ font: string, size: number, color: string }} style - Estilo de TEXT.
 * @returns {void}
 */
function useStyle(doc, style) {
  doc.font(style.font).fontSize(pt(style.size)).fillColor(style.color);
}

/**
 * Mide el ancho de un texto en px con el estilo indicado.
 * Es la medida que usan el ajuste de líneas y la alineación a la derecha.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {string} text - Texto.
 * @param {object} style - Estilo de TEXT.
 * @returns {number} Ancho en px.
 */
function textWidth(doc, text, style) {
  useStyle(doc, style);
  return doc.widthOfString(text) / PX_TO_PT;
}

/**
 * Corta una palabra más ancha que la línea en fragmentos que caben, para que códigos o textos
 * sin espacios no desborden la celda.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {string} word - Palabra.
 * @param {number} width - Ancho disponible en px.
 * @param {object} style - Estilo de TEXT.
 * @returns {Array<string>} Fragmentos en orden.
 */
function splitLongWord(doc, word, width, style) {
  const pieces = [];
  let piece = "";
  for (const character of word) {
    if (piece && textWidth(doc, piece + character, style) > width) {
      pieces.push(piece);
      piece = "";
    }
    piece += character;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/**
 * Divide un texto en líneas que caben en el ancho indicado, respetando los saltos de línea
 * escritos. El ajuste es propio (no el de pdfkit) para poder paginar línea a línea.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {string} text - Texto completo.
 * @param {number} width - Ancho disponible en px.
 * @param {object} style - Estilo de TEXT.
 * @returns {Array<string>} Líneas en orden (al menos una).
 */
export function wrapTextLines(doc, text, width, style) {
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(doc, candidate, style) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      const pieces = textWidth(doc, word, style) > width ? splitLongWord(doc, word, width, style) : [word];
      line = pieces.pop();
      lines.push(...pieces);
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

/**
 * Recorta un texto de una sola línea con «…» hasta que quepa en el ancho indicado.
 * Se usa en la etiqueta de unidad, que en Figma es una píldora de una línea.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {string} text - Texto.
 * @param {number} width - Ancho disponible en px.
 * @param {object} style - Estilo de TEXT.
 * @returns {string} Texto que cabe.
 */
function fitSingleLine(doc, text, width, style) {
  if (textWidth(doc, text, style) <= width) return text;
  let fitted = text;
  while (fitted && textWidth(doc, `${fitted}…`, style) > width) fitted = fitted.slice(0, -1);
  return `${fitted.trimEnd()}…`;
}

/**
 * Escribe una línea de texto con su caja de interlineado de Figma: el texto se centra en la
 * caja como en CSS (medio interlineado arriba y abajo). Nunca se ajusta en varias líneas.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {string} text - Texto de una línea.
 * @param {number} x - Borde izquierdo de la caja en px.
 * @param {number} y - Borde superior de la caja de línea en px.
 * @param {object} style - Estilo de TEXT.
 * @param {{ width?: number, align?: "left"|"right" }} [options] - Alineación dentro de `width`;
 *   un texto alineado a la derecha más ancho que la caja crece hacia la izquierda.
 * @returns {void}
 */
function drawLine(doc, text, x, y, style, { align = "left", width = 0 } = {}) {
  const left = align === "right" ? x + width - textWidth(doc, text, style) : x;
  useStyle(doc, style);
  const naturalHeight = doc.currentLineHeight() / PX_TO_PT;
  const offset = (style.lineHeight - naturalHeight) / 2;
  // Sin `width`: pdfkit ajustaría el texto aunque lineBreak sea false.
  doc.text(text, pt(left), pt(y + offset), { lineBreak: false });
}

/**
 * Dibuja un vector exportado de Figma escalado a la caja indicada.
 * Conserva el color y la regla de relleno de cada trazado.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {{ width: number, height: number, paths: Array<object> }} vector - Vector parseado.
 * @param {{ x: number, y: number, width: number, height: number }} box - Caja en px.
 * @returns {void}
 */
function drawVector(doc, vector, box) {
  doc.save();
  doc.translate(pt(box.x), pt(box.y));
  doc.scale(pt(box.width) / vector.width, pt(box.height) / vector.height);
  for (const path of vector.paths) doc.path(path.d).fill(path.fill, path.fillRule);
  doc.restore();
}

/**
 * Dibuja la cabecera de cada página: logo a la izquierda y, a la derecha, el número de la
 * cotización y su fecha, centrados verticalmente con el logo (Figma 5812:285046).
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {object} model - Modelo del documento.
 * @param {object} vectors - Vectores del logo.
 * @returns {number} Posición vertical en px donde comienza el contenido siguiente.
 */
function drawHeading(doc, model, vectors) {
  const top = PAGE.padding;
  for (const part of LOGO_PARTS) {
    drawVector(doc, vectors[part.name], { height: part.height, width: part.width, x: PAGE.padding + part.x, y: top + part.y });
  }
  const blockHeight = TEXT.code.lineHeight + 8 + TEXT.date.lineHeight;
  const blockTop = top + (LOGO_HEIGHT - blockHeight) / 2;
  const right = { align: "right", width: CONTENT_WIDTH };
  drawLine(doc, `N.° ${model.code}`, PAGE.padding, blockTop, TEXT.code, right);
  drawLine(doc, model.date, PAGE.padding, blockTop + TEXT.code.lineHeight + 8, TEXT.date, right);
  return top + LOGO_HEIGHT + PAGE.sectionGap;
}

/**
 * Dibuja el título de una sección y, si corresponde, su línea divisoria de 1 px.
 * Devuelve la posición donde empieza el contenido de la sección.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {string} title - Título.
 * @param {number} y - Posición superior en px.
 * @param {boolean} divider - Dibuja la línea bajo el título.
 * @returns {number} Posición vertical siguiente en px.
 */
function drawSectionTitle(doc, title, y, divider) {
  drawLine(doc, title, PAGE.padding, y, TEXT.sectionTitle);
  let next = y + TEXT.sectionTitle.lineHeight + PAGE.blockGap;
  if (divider) {
    doc.save().lineWidth(pt(1)).strokeColor(COLORS.border)
      .moveTo(pt(PAGE.padding), pt(next)).lineTo(pt(PAGE.padding + CONTENT_WIDTH), pt(next)).stroke().restore();
    next += PAGE.blockGap;
  }
  return next;
}

/**
 * Calcula la disposición de una pareja «ETIQUETA: valor» de Datos generales, con el valor
 * ajustado en líneas cuando no cabe en el ancho disponible.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {string} label - Etiqueta en mayúsculas.
 * @param {object} labelStyle - Estilo de la etiqueta.
 * @param {string} value - Valor.
 * @returns {{ label: string, labelStyle: object, labelWidth: number, lines: Array<string>, width: number, height: number }} Medidas.
 */
function measureField(doc, label, labelStyle, value) {
  const labelWidth = textWidth(doc, label, labelStyle);
  const valueWidth = CONTENT_WIDTH - labelWidth - PAGE.blockGap;
  const lines = wrapTextLines(doc, value, valueWidth, TEXT.fieldValue);
  const widest = Math.max(...lines.map((line) => textWidth(doc, line, TEXT.fieldValue)));
  return {
    height: Math.max(labelStyle.lineHeight, lines.length * TEXT.fieldValue.lineHeight),
    label,
    labelStyle,
    labelWidth,
    lines,
    width: labelWidth + PAGE.blockGap + widest,
  };
}

/**
 * Dibuja una pareja «ETIQUETA: valor» con ambos elementos centrados verticalmente en la fila,
 * como `items-center` en Figma.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {object} field - Medidas de measureField.
 * @param {number} x - Borde izquierdo en px.
 * @param {number} y - Borde superior en px.
 * @param {number} rowHeight - Alto de la fila en px.
 * @returns {void}
 */
function drawField(doc, field, x, y, rowHeight) {
  drawLine(doc, field.label, x, y + (rowHeight - field.labelStyle.lineHeight) / 2, field.labelStyle);
  const valueTop = y + (rowHeight - field.lines.length * TEXT.fieldValue.lineHeight) / 2;
  field.lines.forEach((line, index) => {
    drawLine(doc, line, x + field.labelWidth + PAGE.blockGap, valueTop + index * TEXT.fieldValue.lineHeight, TEXT.fieldValue);
  });
}

/**
 * Dibuja «Datos generales» (Figma 5812:285049): cliente y proyecto en una fila separados por
 * 56 px, o en dos filas si no caben juntos.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {object} model - Modelo del documento.
 * @param {number} y - Posición superior en px.
 * @returns {number} Posición vertical siguiente en px.
 */
function drawGeneralData(doc, model, y) {
  const top = drawSectionTitle(doc, "Datos generales", y, true);
  const fieldGap = 56;
  const client = measureField(doc, "CLIENTE:", TEXT.clientLabel, model.clientName);
  const project = measureField(doc, "PROYECTO:", TEXT.projectLabel, model.projectName);
  if (client.width + fieldGap + project.width <= CONTENT_WIDTH) {
    const rowHeight = Math.max(client.height, project.height);
    drawField(doc, client, PAGE.padding, top, rowHeight);
    drawField(doc, project, PAGE.padding + client.width + fieldGap, top, rowHeight);
    return top + rowHeight + PAGE.sectionGap;
  }
  drawField(doc, client, PAGE.padding, top, client.height);
  const projectTop = top + client.height + fieldGap;
  drawField(doc, project, PAGE.padding, projectTop, project.height);
  return projectTop + project.height + PAGE.sectionGap;
}

/**
 * Dibuja la fila de encabezado de la tabla con fondo neutral y esquinas superiores de 12 px.
 * Se repite al comienzo de cada página por la que continúa la tabla.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {number} y - Posición superior en px.
 * @returns {number} Posición vertical siguiente en px.
 */
function drawTableHeader(doc, y) {
  const x = PAGE.padding;
  const width = CONTENT_WIDTH;
  const radius = TABLE_RADIUS;
  doc.save()
    .moveTo(pt(x), pt(y + HEADER_ROW_HEIGHT))
    .lineTo(pt(x), pt(y + radius))
    .quadraticCurveTo(pt(x), pt(y), pt(x + radius), pt(y))
    .lineTo(pt(x + width - radius), pt(y))
    .quadraticCurveTo(pt(x + width), pt(y), pt(x + width), pt(y + radius))
    .lineTo(pt(x + width), pt(y + HEADER_ROW_HEIGHT))
    .closePath()
    .fill(COLORS.headerFill)
    .restore();
  let cellX = x;
  for (const column of COLUMNS) {
    drawLine(doc, column.label, cellX + CELL_PADDING.x, y + CELL_PADDING.y, TEXT.cell, { align: column.align, width: column.width - CELL_PADDING.x * 2 });
    cellX += column.width;
  }
  return y + HEADER_ROW_HEIGHT;
}

/**
 * Prepara una fila de conceptos: ajusta el nombre del servicio en líneas, recorta la etiqueta
 * de unidad a una línea y calcula el alto de la fila.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {object} item - Concepto del modelo.
 * @returns {{ item: object, serviceLines: Array<string>, unitLabel: string, height: number }} Fila medida.
 */
function measureItemRow(doc, item) {
  const serviceLines = wrapTextLines(doc, item.serviceName, COLUMNS[0].width - CELL_PADDING.x * 2, TEXT.cell);
  // Como en Figma, la píldora puede ocupar el padding derecho de su celda (no se envuelve).
  const unitLabel = fitSingleLine(doc, item.unitLabel, COLUMNS[1].width - CELL_PADDING.x - BADGE.paddingX * 2 - 2, TEXT.badge);
  const contentHeight = Math.max(serviceLines.length * TEXT.cell.lineHeight, BADGE.height);
  return { height: contentHeight + CELL_PADDING.y * 2, item, serviceLines, unitLabel };
}

/**
 * Dibuja la etiqueta de unidad como la píldora de Figma: fondo primary-10 (10 % de opacidad),
 * radio completo y texto Body/b4.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {string} label - Texto ya recortado.
 * @param {number} x - Borde izquierdo en px.
 * @param {number} y - Borde superior en px.
 * @returns {void}
 */
function drawBadge(doc, label, x, y) {
  const width = textWidth(doc, label, TEXT.badge) + BADGE.paddingX * 2 + 2;
  doc.save().fillOpacity(0.1).roundedRect(pt(x), pt(y), pt(width), pt(BADGE.height), pt(BADGE.radius)).fill(COLORS.text300).restore();
  drawLine(doc, label, x + BADGE.paddingX + 1, y + (BADGE.height - TEXT.badge.lineHeight) / 2, TEXT.badge);
}

/**
 * Dibuja una fila de conceptos con cada celda centrada verticalmente y, salvo en la última fila
 * de la tabla, el borde inferior de 1 px.
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {object} row - Fila de measureItemRow.
 * @param {number} y - Posición superior en px.
 * @param {boolean} withBorder - Dibuja el borde inferior.
 * @returns {number} Posición vertical siguiente en px.
 */
function drawItemRow(doc, row, y, withBorder) {
  let cellX = PAGE.padding;
  for (const column of COLUMNS) {
    const innerX = cellX + CELL_PADDING.x;
    const innerWidth = column.width - CELL_PADDING.x * 2;
    if (column.key === "serviceName") {
      const linesTop = y + (row.height - row.serviceLines.length * TEXT.cell.lineHeight) / 2;
      row.serviceLines.forEach((line, index) => drawLine(doc, line, innerX, linesTop + index * TEXT.cell.lineHeight, TEXT.cell));
    } else if (column.badge) {
      drawBadge(doc, row.unitLabel, innerX, y + (row.height - BADGE.height) / 2);
    } else {
      drawLine(doc, row.item[column.key], innerX, y + (row.height - TEXT.cell.lineHeight) / 2, TEXT.cell, { align: column.align, width: innerWidth });
    }
    cellX += column.width;
  }
  if (withBorder) {
    doc.save().lineWidth(pt(1)).strokeColor(COLORS.border)
      .moveTo(pt(PAGE.padding), pt(y + row.height - 0.5)).lineTo(pt(PAGE.padding + CONTENT_WIDTH), pt(y + row.height - 0.5)).stroke().restore();
  }
  return y + row.height;
}

/**
 * Dibuja la franja de acento inferior con el isotipo y el número de página
 * (Figma 5814:247797, 5814:247798 y 5831:359383).
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {object} vectors - Vectores del documento.
 * @param {number} pageNumber - Número de la página actual.
 * @returns {void}
 */
function drawPageFooter(doc, vectors, pageNumber) {
  const barHeight = 38;
  doc.save().rect(0, pt(PAGE.height - barHeight + 0.51), pt(PAGE.width), pt(barHeight)).fill(COLORS.accent).restore();
  drawVector(doc, vectors.footerMark, { height: 32, width: 33.7451, x: 6.36, y: PAGE.height - 2.49 - 32 });
  drawLine(doc, String(pageNumber), 0, PAGE.height - 37.49 - 24 - TEXT.pageNumber.lineHeight, TEXT.pageNumber, {
    align: "right",
    width: PAGE.width - 0.38 - 48,
  });
}

/**
 * Dibuja una fila del resumen de importes alineada a la derecha: el importe y, a su izquierda,
 * la etiqueta, ambos alineados por su borde inferior (Figma: items-end).
 *
 * @param {PDFKit.PDFDocument} doc - Documento.
 * @param {{ label: string, value: string, labelStyle: object, valueStyle: object }} row - Fila.
 * @param {number} top - Borde superior de la fila.
 * @returns {number} Borde inferior de la fila.
 */
function drawTotalRow(doc, { label, labelStyle, value, valueStyle }, top) {
  const valueWidth = textWidth(doc, value, valueStyle);
  drawLine(doc, value, PAGE.padding, top, valueStyle, { align: "right", width: CONTENT_WIDTH });
  drawLine(doc, label, PAGE.padding, top + valueStyle.lineHeight - labelStyle.lineHeight, labelStyle, {
    align: "right",
    width: CONTENT_WIDTH - valueWidth - PAGE.blockGap,
  });
  return top + valueStyle.lineHeight;
}

/**
 * Filas del resumen de importes. Sin IVA referencial, el total único de siempre; con él, encima,
 * el IVA con su tasa como referencia, que no se suma al total.
 *
 * @param {object} model - Resultado de buildQuoteDocument.
 * @returns {Array<{ label: string, value: string, labelStyle: object, valueStyle: object }>} Filas.
 */
function totalRows(model) {
  if (!model.referenceVat) {
    return [{ label: `TOTAL ${model.currency}`, labelStyle: TEXT.totalLabel, value: model.total, valueStyle: TEXT.totalValue }];
  }
  return [
    { label: model.referenceVat.label.toUpperCase(), labelStyle: TEXT.totalLabel, value: model.referenceVat.amount, valueStyle: TEXT.fieldValue },
    { label: `TOTAL ${model.currency}`, labelStyle: TEXT.totalLabel, value: model.total, valueStyle: TEXT.totalValue },
  ];
}

/**
 * Crea el PDF de una cotización a partir de su modelo de presentación y lo finaliza. El
 * documento es un stream legible: el contenido queda en memoria hasta que se consume.
 *
 * @param {object} model - Resultado de buildQuoteDocument.
 * @param {{ fonts: Record<string, Buffer>, vectors: Record<string, object> }} assets - Recursos cargados.
 * @returns {PDFKit.PDFDocument} Documento terminado, listo para enviarse por streaming.
 */
export function renderQuotePdf(model, { fonts, vectors }) {
  const doc = new PDFDocument({
    autoFirstPage: false,
    info: { Author: "ARCA Studio", Title: `Cotización ${model.code}` },
    margin: 0,
    size: "LETTER",
  });
  for (const [name, font] of Object.entries(fonts)) doc.registerFont(name, font);

  let pageNumber = 0;
  /**
   * Cierra la página actual (si existe) y abre otra con su cabecera.
   * Devuelve la posición donde empieza el contenido de la nueva página.
   *
   * @returns {number} Posición vertical en px.
   */
  const startPage = () => {
    if (pageNumber > 0) drawPageFooter(doc, vectors, pageNumber);
    doc.addPage({ margin: 0, size: "LETTER" });
    pageNumber += 1;
    return drawHeading(doc, model, vectors);
  };

  let y = drawGeneralData(doc, model, startPage());

  const tableStart = TEXT.sectionTitle.lineHeight + PAGE.blockGap + HEADER_ROW_HEIGHT;
  const rows = model.items.map((item) => measureItemRow(doc, item));
  if (y + tableStart + (rows[0]?.height ?? 0) > CONTENT_BOTTOM) y = startPage();
  y = drawTableHeader(doc, drawSectionTitle(doc, "Detalle de servicios", y, false));
  rows.forEach((row, index) => {
    if (y + row.height > CONTENT_BOTTOM) y = drawTableHeader(doc, drawSectionTitle(doc, "Detalle de servicios", startPage(), false));
    y = drawItemRow(doc, row, y, index < rows.length - 1);
  });

  // El resumen no se parte entre páginas: filas separadas 8 px y, con IVA, el aviso debajo.
  const summaryRows = totalRows(model);
  const noticeHeight = model.referenceVat ? 8 + TEXT.vatNotice.lineHeight : 0;
  const totalHeight = PAGE.blockGap + summaryRows.reduce((sum, row) => sum + row.valueStyle.lineHeight, 0) + (summaryRows.length - 1) * 8 + noticeHeight;
  if (y + totalHeight > CONTENT_BOTTOM) y = startPage() - PAGE.blockGap;
  y += PAGE.blockGap;
  summaryRows.forEach((row, index) => {
    y = drawTotalRow(doc, row, y + (index ? 8 : 0));
  });
  if (model.referenceVat) {
    drawLine(doc, model.referenceVat.notice, PAGE.padding, y + 8, TEXT.vatNotice, { align: "right", width: CONTENT_WIDTH });
    y += noticeHeight;
  }
  y += PAGE.sectionGap;

  if (model.notes) {
    const lines = wrapTextLines(doc, model.notes, CONTENT_WIDTH, TEXT.notes);
    const titleHeight = TEXT.sectionTitle.lineHeight + PAGE.blockGap * 2;
    if (y + titleHeight + TEXT.notes.lineHeight > CONTENT_BOTTOM) y = startPage();
    y = drawSectionTitle(doc, "Observaciones", y, true);
    for (const line of lines) {
      if (y + TEXT.notes.lineHeight > CONTENT_BOTTOM) y = startPage();
      drawLine(doc, line, PAGE.padding, y, TEXT.notes);
      y += TEXT.notes.lineHeight;
    }
  }

  drawPageFooter(doc, vectors, pageNumber);
  doc.end();
  return doc;
}
