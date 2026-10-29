import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQuoteDocument,
  formatDocumentAmount,
  formatDocumentDate,
  formatDocumentQuantity,
  isSupportedTimeZone,
} from "../src/domain/quoteDocument.js";
import { parseSvgVector } from "../src/services/quotePdfAssets.js";
import { loadQuotePdfAssets } from "../src/services/quotePdfAssets.js";
import { renderQuotePdf } from "../src/services/quotePdfRenderer.js";

/**
 * Crea una cotización como la devuelve findQuoteById, con los conceptos indicados.
 *
 * @param {Array<object>} items - Conceptos.
 * @param {object} [overrides] - Campos que se sustituyen.
 * @returns {object} Cotización.
 */
function quoteWith(items, overrides = {}) {
  return {
    client: { id: 1, name: "Leonel Pérez" },
    code: "COT-001",
    createdAt: "2026-03-24T02:30:00.000Z",
    currency: "USD",
    items,
    notes: "  Incluye visitas de obra.  ",
    project: { id: 9, name: "Apto. 910" },
    servicesTotal: "4445.00",
    ...overrides,
  };
}

/**
 * Crea un concepto con la forma pública del repositorio.
 *
 * @param {string} name - Servicio.
 * @param {string} quantity - Cantidad NUMERIC(12,3).
 * @param {string} unitRate - Tarifa aplicada.
 * @param {string} subtotal - Subtotal.
 * @returns {object} Concepto.
 */
function item(name, quantity, unitRate, subtotal) {
  return { quantity, service: { name }, subtotal, unit: { label: "m² de construcción" }, unitRate };
}

/**
 * Lee por completo el stream del PDF generado.
 *
 * @param {import("node:stream").Readable} stream - Documento de pdfkit.
 * @returns {Promise<Buffer>} Bytes del PDF.
 */
async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test("importes y cantidades se formatean como texto, sin coma flotante", () => {
  assert.equal(formatDocumentAmount("2400.00"), "$2,400.00");
  assert.equal(formatDocumentAmount("0.00"), "$0.00");
  assert.equal(formatDocumentAmount("999999999999.99"), "$999,999,999,999.99");
  assert.equal(formatDocumentAmount("12"), "$12.00");
  assert.equal(formatDocumentQuantity("200.000"), "200");
  assert.equal(formatDocumentQuantity("12.500"), "12.5");
  assert.equal(formatDocumentQuantity("1250.125"), "1,250.125");
});

test("la fecha impresa usa la zona del navegador y UTC si es desconocida", () => {
  // 02:30 UTC del 24 de marzo es todavía 23 de marzo en Caracas (UTC−4).
  assert.equal(formatDocumentDate("2026-03-24T02:30:00.000Z", "America/Caracas"), "23/03/2026");
  assert.equal(formatDocumentDate("2026-03-24T02:30:00.000Z", "UTC"), "24/03/2026");
  assert.equal(isSupportedTimeZone("America/Caracas"), true);
  assert.equal(isSupportedTimeZone("Mars/Olympus"), false);
  assert.equal(isSupportedTimeZone(""), false);
  const document = buildQuoteDocument(quoteWith([]), { timeZone: "Mars/Olympus" });
  assert.equal(document.date, "24/03/2026");
});

test("el modelo del documento conserva los textos guardados y omite observaciones vacías", () => {
  const document = buildQuoteDocument(quoteWith([item("Anteproyecto arquitectónico", "200.000", "14.00", "2800.00")]), { timeZone: "UTC" });
  assert.deepEqual(document, {
    clientName: "Leonel Pérez",
    code: "COT-001",
    currency: "USD",
    date: "24/03/2026",
    fileName: "COT-001.pdf",
    items: [{ quantity: "200", serviceName: "Anteproyecto arquitectónico", subtotal: "$2,800.00", unitLabel: "m² de construcción", unitRate: "$14.00" }],
    notes: "Incluye visitas de obra.",
    projectName: "Apto. 910",
    total: "$4,445.00",
  });
  assert.equal(buildQuoteDocument(quoteWith([], { notes: "   " })).notes, null);
});

test("los vectores de Figma se leen con su caja y sus rellenos", () => {
  const vector = parseSvgVector('<svg width="10" height="5" viewBox="0 0 10 5" fill="none"><path d="M0 0H10V5Z" fill="#FF4431"/><path d="M1 1Z" fill="none"/></svg>');
  assert.deepEqual(vector, { height: 5, paths: [{ d: "M0 0H10V5Z", fill: "#FF4431", fillRule: "non-zero" }], width: 10 });
  assert.throws(() => parseSvgVector("<svg></svg>"), /sin viewBox/);
});

test("el PDF se genera con Inter y pagina conceptos y observaciones largas", async () => {
  const assets = await loadQuotePdfAssets();
  assert.deepEqual(Object.keys(assets.fonts).sort(), ["bold", "medium", "regular"]);
  assert.equal(await loadQuotePdfAssets(), assets, "Los recursos se leen una sola vez por proceso");

  const short = await readAll(renderQuotePdf(buildQuoteDocument(quoteWith([item("Anteproyecto", "200.000", "14.00", "2800.00")])), assets));
  assert.equal(short.subarray(0, 5).toString(), "%PDF-");
  assert.equal((short.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 1);
  assert.match(short.toString("latin1"), /Inter/);

  const many = Array.from({ length: 30 }, (_, index) => item(`Servicio ${index + 1}`, "1.000", "10.00", "10.00"));
  const long = await readAll(renderQuotePdf(buildQuoteDocument(quoteWith(many, { notes: "Observación ".repeat(900) })), assets));
  assert.ok((long.toString("latin1").match(/\/Type \/Page\b/g) || []).length >= 3, "La tabla y las observaciones continúan en otras páginas");
});
