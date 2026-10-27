import { buildQuoteDocument, isSupportedTimeZone } from "../domain/quoteDocument.js";
import { loadQuotePdfAssets } from "./quotePdfAssets.js";
import { renderQuotePdf } from "./quotePdfRenderer.js";
import { getQuote } from "./quoteService.js";

// Aumentar al cambiar la maquetación: invalida los ETag de los PDF ya descargados.
const QUOTE_PDF_LAYOUT_REVISION = 1;
const FALLBACK_TIME_ZONE = "UTC";

/**
 * Construye la etiqueta de caché del PDF de la versión vigente. Cambia con la versión de la
 * cotización, la zona horaria de la fecha impresa y la revisión de la maquetación, porque esos
 * son los únicos datos que alteran el documento.
 *
 * @param {object} quote - Cotización con su versión vigente.
 * @param {string} timeZone - Zona horaria aplicada.
 * @returns {string} ETag fuerte entre comillas.
 */
function buildQuotePdfEtag(quote, timeZone) {
  return `"quote-${quote.id}-v${quote.currentVersion}-${encodeURIComponent(timeZone)}-r${QUOTE_PDF_LAYOUT_REVISION}"`;
}

/**
 * Prepara el PDF de la versión vigente de una cotización. Si el navegador ya tiene esa misma
 * versión (`If-None-Match`), no se genera el documento y se indica que no cambió; si no, se
 * maqueta a partir de los datos guardados en PostgreSQL.
 *
 * @param {object} options - Datos de la petición.
 * @param {number} options.quoteId - Cotización.
 * @param {string} [options.timeZone] - Zona horaria IANA del navegador para la fecha impresa.
 * @param {string} [options.ifNoneMatch] - Valor de la cabecera If-None-Match.
 * @returns {Promise<{ etag: string, fileName: string, notModified: boolean, stream: PDFKit.PDFDocument|null }>} Resultado.
 * @throws {import("../errors/appError.js").NotFoundError} QUOTE_NOT_FOUND si no existe.
 */
export async function getQuotePdf({ ifNoneMatch, quoteId, timeZone }) {
  const quote = await getQuote(quoteId);
  const zone = isSupportedTimeZone(timeZone) ? timeZone : FALLBACK_TIME_ZONE;
  const etag = buildQuotePdfEtag(quote, zone);
  const model = buildQuoteDocument(quote, { timeZone: zone });
  if (ifNoneMatch && ifNoneMatch.split(",").map((value) => value.trim()).includes(etag)) {
    return { etag, fileName: model.fileName, notModified: true, stream: null };
  }
  const stream = renderQuotePdf(model, await loadQuotePdfAssets());
  return { etag, fileName: model.fileName, notModified: false, stream };
}
