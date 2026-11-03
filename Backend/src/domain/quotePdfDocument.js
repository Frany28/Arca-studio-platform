import { createHash } from "node:crypto";

import { buildQuoteDocument } from "./quoteDocument.js";
import { formatGeneratedQuoteCode } from "./quote.js";

export const QUOTE_PDF_TIME_ZONE = "America/Caracas";
export const QUOTE_PDF_MAX_BYTES = 8 * 1024 * 1024;
export const QUOTE_PDF_LAYOUT_REVISION = 2;
// La revisión 1 se conserva para reproducir exactamente los documentos históricos recuperables.
export const QUOTE_PDF_LAYOUTS = Object.freeze({
  1: Object.freeze({ servicesPerPage: Infinity }),
  2: Object.freeze({ servicesPerPage: 10 }),
});

/**
 * Fija la identidad y la presentación del PDF desde una versión confirmada del negocio.
 * No incluye nombres de usuario en la clave ni depende de datos vivos del catálogo.
 *
 * @param {object} quote - Versión completa leída dentro de la transacción.
 * @returns {object} Reserva persistible con instantánea y huella de origen.
 */
export function buildQuotePdfReservation(quote) {
  const { id, currentVersion: versionNumber } = quote;
  if (![id, versionNumber, quote.version.id].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Identificadores de PDF inválidos.");
  }
  const fileName = `${formatGeneratedQuoteCode(id)}-v${versionNumber}.pdf`;
  const model = {
    ...buildQuoteDocument(quote, { timeZone: QUOTE_PDF_TIME_ZONE }),
    fileName,
    generatedAt: quote.version.createdAt,
  };
  return {
    fileName,
    model,
    objectKey: `quotes/${id}/versions/v${versionNumber}/${fileName}`,
    sourceHash: createHash("sha256").update(JSON.stringify(model)).digest("hex"),
    versionId: quote.version.id,
  };
}

/**
 * Expone exclusivamente el estado y los metadatos necesarios para el visor administrativo.
 * Omite bucket, clave interna, instantánea, reserva temporal y errores del proveedor.
 *
 * @param {object|null} row - Fila de quote_pdf_documents.
 * @returns {object} Estado público del documento.
 */
export function toQuotePdfStatus(row) {
  return {
    status: row?.status ?? "pending",
    fileName: row?.file_name ?? null,
    mimeType: "application/pdf",
    size: row?.status === "available" ? Number(row.size_bytes) : null,
    generatedAt: row?.generated_at ?? null,
    storedAt: row?.stored_at ?? null,
    errorCode: row?.error_code ?? null,
  };
}
