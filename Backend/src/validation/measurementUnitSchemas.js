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
 * Comprueba la fecha de creación y el id del último registro de la página anterior.
 *
 * @param {string|undefined} value - Cursor opaco recibido.
 * @returns {boolean} true si el cursor está ausente o es válido.
 */
function isValidDenominationCursor(value) {
  if (!value) return true;
  const decoded = decodeCursor(value);
  return Boolean(decoded && z.iso.datetime().safeParse(decoded[0]).success && /^\d+$/.test(String(decoded[1])));
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

// publicCode (UNID-001…) lo genera PostgreSQL: `.strict()` lo rechaza en el alta y la edición.
export const denominationCreateSchema = z.object({
  body: z.object({
    denomination: denominationText,
    measurementUnitId: positiveId,
  }).strict(),
});

// La unidad base es opcional en la edición: el servicio solo la cambia si la denominación no tiene
// servicios ni versiones que la referencien. publicCode sigue rechazado por `.strict()`.
export const denominationUpdateSchema = z.object({
  params: denominationIdParams,
  body: z.object({ denomination: denominationText, measurementUnitId: positiveId.optional() }).strict(),
});

export const denominationStatusSchema = z.object({
  params: denominationIdParams,
  body: z.object({ isActive: z.boolean() }).strict(),
});
