import { z } from "zod";

import {
  QUOTE_MAX_ITEMS,
  QUOTE_NOTES_MAX_LENGTH,
  QUOTE_SORT_DIRECTIONS,
  QUOTE_SORT_FIELDS,
} from "../domain/quote.js";
import { QUOTE_DECIMAL_FORMATS } from "../domain/quoteTotals.js";
import { decodeCursor } from "../utils/pagination.js";
import { scaledDecimalText } from "./decimalSchemas.js";

const positiveId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const bodyId = z.number({ error: "Es obligatorio." }).int().positive().max(Number.MAX_SAFE_INTEGER);
const pageLimit = z.coerce.number().int().min(1).max(100).optional();
const searchText = z.string().trim().max(100).optional().transform((value) => value || undefined);
// Instantes con zona horaria: el navegador traduce el día local elegido a un intervalo exacto.
const instant = z.iso.datetime({ offset: true, error: "Debe ser una fecha y hora ISO 8601 con zona horaria." });

// Cadena vacía o null eliminan las observaciones.
const quoteNotes = z.union([z.string(), z.null()]).optional()
  .transform((value) => value?.trim() || null)
  .refine((value) => !value || value.length <= QUOTE_NOTES_MAX_LENGTH, `Admite como máximo ${QUOTE_NOTES_MAX_LENGTH} caracteres.`);

// La unidad es la del servicio: el concepto solo indica servicio, cantidad y tarifa aplicada.
const quoteItem = z.object({
  quantity: scaledDecimalText(QUOTE_DECIMAL_FORMATS.quantity),
  serviceId: bodyId,
  unitRate: scaledDecimalText(QUOTE_DECIMAL_FORMATS.unitRate),
}).strict();

// El cuerpo describe la cotización completa: cada guardado sustituye el contenido y crea una versión.
const quoteContent = {
  clientId: bodyId,
  items: z.array(quoteItem)
    .min(1, "Añade al menos un servicio a la cotización.")
    .max(QUOTE_MAX_ITEMS, `Una cotización admite como máximo ${QUOTE_MAX_ITEMS} servicios.`),
  notes: quoteNotes,
  projectId: bodyId,
};

/**
 * Comprueba que el cursor del listado corresponda al orden solicitado: por código lleva
 * `[id, id]` (el código deriva del id) y por total `["123.45", id]`, ambos con el id del
 * último registro de la página anterior.
 *
 * @param {{ cursor?: string, sort?: string }} query - Consulta recibida.
 * @param {import("zod").RefinementCtx} context - Contexto de Zod para registrar el error.
 * @returns {void}
 */
function assertQuoteCursorMatchesSort(query, context) {
  if (!query.cursor) return;
  const decoded = decodeCursor(query.cursor);
  const id = decoded?.[1];
  const key = decoded?.[0];
  const validId = typeof id === "string" && /^\d+$/.test(id);
  const validKey = query.sort === QUOTE_SORT_FIELDS.TOTAL
    ? typeof key === "string" && /^\d+(\.\d+)?$/.test(key)
    : key === id;
  if (!decoded || !validId || !validKey) context.addIssue({ code: "custom", message: "Cursor inválido.", path: ["cursor"] });
}

/**
 * Exige que el intervalo de fechas sea coherente: `createdFrom` (incluido) debe ser anterior a
 * `createdBefore` (excluido).
 *
 * @param {{ createdFrom?: string, createdBefore?: string }} query - Consulta recibida.
 * @param {import("zod").RefinementCtx} context - Contexto de Zod para registrar el error.
 * @returns {void}
 */
function assertCreatedRange(query, context) {
  if (query.createdFrom && query.createdBefore && Date.parse(query.createdFrom) >= Date.parse(query.createdBefore)) {
    context.addIssue({ code: "custom", message: "La fecha inicial debe ser anterior a la final.", path: ["createdFrom"] });
  }
}

export const quoteListSchema = z.object({
  query: z.object({
    createdBefore: instant.optional(),
    createdFrom: instant.optional(),
    cursor: z.string().optional(),
    direction: z.enum([QUOTE_SORT_DIRECTIONS.ASC, QUOTE_SORT_DIRECTIONS.DESC]).optional().default(QUOTE_SORT_DIRECTIONS.ASC),
    limit: pageLimit,
    search: searchText,
    sort: z.enum([QUOTE_SORT_FIELDS.CODE, QUOTE_SORT_FIELDS.TOTAL]).optional().default(QUOTE_SORT_FIELDS.CODE),
  }).passthrough().superRefine((query, context) => {
    assertCreatedRange(query, context);
    assertQuoteCursorMatchesSort(query, context);
  }),
});

const quoteIdParams = z.object({ quoteId: positiveId });

export const quoteDetailSchema = z.object({ params: quoteIdParams });

// La zona horaria solo decide la fecha impresa; una zona desconocida se sustituye por UTC.
export const quotePdfSchema = z.object({
  params: quoteIdParams,
  query: z.object({ timeZone: z.string().trim().max(64).optional() }).passthrough(),
});

export const quoteCreateSchema = z.object({
  body: z.object(quoteContent).strict(),
});

export const quoteUpdateSchema = z.object({
  params: quoteIdParams,
  body: z.object({
    ...quoteContent,
    expectedVersion: z.number({ error: "Indica la versión vigente que estás editando." }).int().min(1),
  }).strict(),
});

/**
 * Comprueba que un cursor de opciones (clientes o proyectos) contenga el nombre y el id del
 * último registro de la página anterior.
 *
 * @param {string|undefined} value - Cursor opaco recibido.
 * @returns {boolean} true si está ausente o es válido.
 */
function isValidNameCursor(value) {
  if (!value) return true;
  const decoded = decodeCursor(value);
  return Boolean(decoded && typeof decoded[0] === "string" && /^\d+$/.test(String(decoded[1])));
}

const optionsQuery = z.object({
  cursor: z.string().optional().refine(isValidNameCursor, "Cursor inválido."),
  limit: pageLimit,
  search: searchText,
}).passthrough();

export const quoteClientOptionsSchema = z.object({ query: optionsQuery });

export const quoteProjectOptionsSchema = z.object({
  params: z.object({ clientId: positiveId }),
  query: optionsQuery,
});
