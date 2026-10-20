import { z } from "zod";

import { DENOMINATION_MAX_LENGTH, normalizeUnitText } from "../domain/measurementUnitLabel.js";
import { decodeCursor } from "../utils/pagination.js";

const positiveId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// Texto normalizado (NFC, sin espacios sobrantes ni dobles) que cumple el CHECK de PostgreSQL.
// Se rechazan caracteres de control y saltos de línea: es un texto de una sola línea.
const denominationText = z.string({ error: "Es obligatorio." })
  .transform(normalizeUnitText)
  .pipe(z.string()
    .min(1, "Es obligatorio.")
    .max(DENOMINATION_MAX_LENGTH, `Admite como máximo ${DENOMINATION_MAX_LENGTH} caracteres.`)
    .refine((value) => !/\p{Cc}/u.test(value), "No admite caracteres de control."));

/**
 * Comprueba que un cursor de denominaciones contenga el orden de la unidad base (entero no
 * negativo), el texto de la denominación y el id del último elemento de la página anterior.
 *
 * @param {string|undefined} value - Cursor opaco recibido.
 * @returns {boolean} true si el cursor está ausente o es válido.
 */
function isValidDenominationCursor(value) {
  if (!value) return true;
  const decoded = decodeCursor(value, 3);
  return Boolean(decoded
    && Number.isInteger(decoded[0]) && decoded[0] >= 0
    && typeof decoded[1] === "string" && decoded[1].length <= DENOMINATION_MAX_LENGTH
    && /^\d+$/.test(String(decoded[2])));
}

const denominationIdParams = z.object({ denominationId: positiveId });

export const measurementUnitListSchema = z.object({
  query: z.object({
    includeInactive: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
  }).passthrough(),
});

export const denominationListSchema = z.object({
  query: z.object({
    cursor: z.string().optional().refine(isValidDenominationCursor, "Cursor inválido."),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    measurementUnitId: positiveId.optional(),
    search: z.string().trim().max(100).optional().transform((value) => value || undefined),
    status: z.enum(["active", "inactive"]).optional(),
  }).passthrough(),
});

export const denominationDetailSchema = z.object({ params: denominationIdParams });

export const denominationCreateSchema = z.object({
  body: z.object({
    denomination: denominationText,
    measurementUnitId: positiveId,
  }).strict(),
});

// La unidad base no es editable: `.strict()` rechaza measurementUnitId en la edición.
export const denominationUpdateSchema = z.object({
  params: denominationIdParams,
  body: z.object({ denomination: denominationText }).strict(),
});

export const denominationStatusSchema = z.object({
  params: denominationIdParams,
  body: z.object({ isActive: z.boolean() }).strict(),
});
