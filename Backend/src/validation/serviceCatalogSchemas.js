import { z } from "zod";

import { QUOTE_DECIMAL_FORMATS } from "../domain/quoteTotals.js";
import { DEFAULT_SERVICE_KIND, SERVICE_KINDS } from "../domain/serviceCatalog.js";
import { decodeCursor } from "../utils/pagination.js";
import { describeDecimalParseError, formatScaledDecimal, parseScaledDecimal } from "../utils/scaledDecimal.js";

const MAX_INTEGER = 2147483647;
const RATE_FORMAT = QUOTE_DECIMAL_FORMATS.unitRate;

const positiveId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
// Denominación opcional de la unidad base; null la retira (el servicio usa solo la base).
const unitDenominationId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional();
const expectedVersion = z.number({ error: "Indica la versión vigente que estás editando." }).int().min(1);
const serviceKind = z.enum([SERVICE_KINDS.INDIVIDUAL, SERVICE_KINDS.TURNKEY]);
const serviceName = z.string().trim().min(1, "Es obligatorio.").max(150);
const sortOrder = z.number().int().min(0).max(MAX_INTEGER);
const changeNote = z.string().trim().max(255).optional().transform((value) => value || null);

// El código se normaliza a mayúsculas y debe cumplir el CHECK de PostgreSQL (chk_services_code).
// En el alta es opcional: si no se envía, el sistema genera `SERV-001` a partir del id.
const serviceCode = z.string().trim().toUpperCase().min(1, "Es obligatorio.").max(30)
  .regex(/^[A-Z0-9]+([_-][A-Z0-9]+)*$/, "Usa letras, números y guiones (por ejemplo, ANTEPROYECTO-M2).");

// Cadena vacía o null eliminan la descripción.
const serviceDescription = z.union([z.string(), z.null()]).optional()
  .transform((value) => (value === undefined ? undefined : value?.trim() || null))
  .refine((value) => !value || value.length <= 2000, "Admite como máximo 2000 caracteres.");

/**
 * Valida una tarifa de referencia con la misma precisión que NUMERIC(14,2) y la normaliza
 * a texto decimal con dos decimales ("12.00"). Reutiliza el analizador exacto del motor de
 * cotizaciones: no redondea, rechaza negativos y números inseguros de JavaScript.
 *
 * @param {unknown} value - Tarifa recibida como texto decimal o número exacto.
 * @param {import("zod").RefinementCtx} context - Contexto de Zod para registrar el error.
 * @returns {string} Tarifa normalizada.
 */
function normalizeReferenceRate(value, context) {
  const parsed = parseScaledDecimal(value, RATE_FORMAT);
  if (parsed.error) {
    context.addIssue({ code: "custom", message: describeDecimalParseError(parsed.error, RATE_FORMAT) });
    return z.NEVER;
  }
  return formatScaledDecimal(parsed.value, RATE_FORMAT.scale);
}

const referenceRate = z.unknown().transform(normalizeReferenceRate);

/**
 * Comprueba que un cursor del catálogo contenga el orden de visualización y el id del último
 * servicio de la página anterior, ambos enteros no negativos.
 *
 * @param {string|undefined} value - Cursor opaco recibido.
 * @returns {boolean} true si el cursor está ausente o es válido.
 */
function isValidCatalogCursor(value) {
  if (!value) return true;
  const decoded = decodeCursor(value);
  return Boolean(decoded && Number.isInteger(decoded[0]) && decoded[0] >= 0 && /^\d+$/.test(String(decoded[1])));
}

const serviceIdParams = z.object({ serviceId: positiveId });

export const serviceListSchema = z.object({
  query: z.object({
    cursor: z.string().optional().refine(isValidCatalogCursor, "Cursor inválido."),
    kind: serviceKind.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    measurementUnitId: positiveId.optional(),
    search: z.string().trim().max(100).optional().transform((value) => value || undefined),
    status: z.enum(["active", "inactive"]).optional(),
    unitDenominationId: positiveId.optional(),
  }).passthrough(),
});

export const serviceDetailSchema = z.object({ params: serviceIdParams });

export const serviceCreateSchema = z.object({
  body: z.object({
    changeNote,
    code: serviceCode.optional(),
    description: serviceDescription,
    isActive: z.boolean().optional().default(true),
    kind: serviceKind.optional().default(DEFAULT_SERVICE_KIND),
    measurementUnitId: positiveId,
    name: serviceName,
    referenceRate,
    sortOrder: sortOrder.optional().default(0),
    unitDenominationId,
  }).strict(),
});

// El código y la moneda no son editables: `.strict()` rechaza cualquier campo no listado.
export const serviceUpdateSchema = z.object({
  params: serviceIdParams,
  body: z.object({
    changeNote,
    description: serviceDescription,
    expectedVersion,
    isActive: z.boolean().optional(),
    kind: serviceKind.optional(),
    measurementUnitId: positiveId.optional(),
    name: serviceName.optional(),
    referenceRate: referenceRate.optional(),
    sortOrder: sortOrder.optional(),
    unitDenominationId,
  }).strict().refine(
    (body) => ["description", "isActive", "kind", "measurementUnitId", "name", "referenceRate", "sortOrder", "unitDenominationId"]
      .some((field) => body[field] !== undefined),
    { message: "Indica al menos un campo para modificar.", path: ["request"] },
  ),
});

export const serviceStatusSchema = z.object({
  params: serviceIdParams,
  body: z.object({ changeNote, expectedVersion, isActive: z.boolean() }).strict(),
});
