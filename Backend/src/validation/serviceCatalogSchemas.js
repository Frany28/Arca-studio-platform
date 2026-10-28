import { z } from "zod";

import { QUOTE_DECIMAL_FORMATS } from "../domain/quoteTotals.js";
import { DEFAULT_SERVICE_KIND, SERVICE_KINDS } from "../domain/serviceCatalog.js";
import {
  PRESENTATION_LABEL_MAX_LENGTH,
  SERVICE_UNIT_OPTIONS_MAX,
  normalizePresentationLabel,
} from "../domain/serviceUnitOptions.js";
import { decodeCursor } from "../utils/pagination.js";
import { scaledDecimalText } from "./decimalSchemas.js";

const MAX_INTEGER = 2147483647;
const RATE_FORMAT = QUOTE_DECIMAL_FORMATS.unitRate;

const positiveId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
// Denominación opcional de la unidad base; null la retira (el servicio usa solo la base).
const unitDenominationId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional();
const expectedVersion = z.number({ error: "Indica la versión vigente que estás editando." }).int().min(1);
const serviceKind = z.enum([SERVICE_KINDS.INDIVIDUAL, SERVICE_KINDS.TURNKEY], {
  error: "Elige una modalidad de contratación válida: individual o llave en mano.",
});
const serviceName = z.string().trim().min(1, "Es obligatorio.").max(150);
const sortOrder = z.number().int().min(0).max(MAX_INTEGER);
const changeNote = z.string().trim().max(255).optional().transform((value) => value || null);

// Cadena vacía o null eliminan la descripción.
const serviceDescription = z.union([z.string(), z.null()]).optional()
  .transform((value) => (value === undefined ? undefined : value?.trim() || null))
  .refine((value) => !value || value.length <= 2000, "Admite como máximo 2000 caracteres.");

// Tarifa con la precisión de NUMERIC(14,2), normalizada a texto con dos decimales ("12.00").
const referenceRate = scaledDecimalText(RATE_FORMAT);

// Unidad de medida del servicio. Su tarifa es opcional: null u omitida = pendiente de validación
// comercial (con una sola unidad, la tarifa es la del servicio). El texto comercial vacío o null
// usa la etiqueta compuesta.
const unitOption = z.object({
  measurementUnitId: z.number({ error: "Elige la unidad de medida." }).int().positive().max(Number.MAX_SAFE_INTEGER),
  presentationLabel: z.union([z.string(), z.null()]).optional()
    .transform((value) => normalizePresentationLabel(value))
    .refine((value) => !value || value.length <= PRESENTATION_LABEL_MAX_LENGTH, `Admite como máximo ${PRESENTATION_LABEL_MAX_LENGTH} caracteres.`),
  referenceRate: z.union([referenceRate, z.null()]).optional().transform((value) => value ?? null),
  unitDenominationId,
}).strict();
const unitOptions = z.array(unitOption)
  .min(1, "Indica al menos una unidad de medida.")
  .max(SERVICE_UNIT_OPTIONS_MAX, `Un servicio admite como máximo ${SERVICE_UNIT_OPTIONS_MAX} unidades de medida.`);

/**
 * Exige una sola forma de indicar la unidad: `unitOptions` (lista completa) o el atajo
 * `measurementUnitId` / `unitDenominationId` (solo la principal). En el alta una es obligatoria.
 *
 * @param {{ required: boolean }} options - Si la unidad es obligatoria (alta).
 * @returns {(body: object, context: import("zod").RefinementCtx) => void} Refinamiento de Zod.
 */
function exclusiveUnitInput({ required }) {
  return (body, context) => {
    const usesShortcut = body.measurementUnitId !== undefined || body.unitDenominationId !== undefined;
    if (body.unitOptions !== undefined && usesShortcut) {
      context.addIssue({ code: "custom", message: "Indica las unidades en unitOptions o en measurementUnitId, no en ambos.", path: ["unitOptions"] });
    } else if (required && body.unitOptions === undefined && body.measurementUnitId === undefined) {
      context.addIssue({ code: "custom", message: "Elige la unidad de medida.", path: ["measurementUnitId"] });
    }
  };
}

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

// Alta del tabulador: el código (`SERV-001`) lo genera el sistema y se rechaza con un mensaje
// propio (400 en `body.code`); cualquier otro campo desconocido lo rechaza `.strict()`. La
// modalidad (`kind`) la elige el administrador; omitida es `individual`, como antes de admitirla,
// para no romper clientes existentes. La modalidad no restringe la unidad; su existencia y estado
// los comprueba el servicio, que necesita leer la unidad en la transacción.
/**
 * Campo que gestiona el sistema y que el cliente no puede enviar: ausente es válido y cualquier
 * valor responde 400 en su propia ruta (`body.code`) con un mensaje explicativo.
 *
 * @param {string} message - Mensaje del error de validación.
 * @returns {import("zod").ZodOptional<import("zod").ZodNever>} Esquema del campo.
 */
const systemManaged = (message) => z.never({ error: message }).optional();

export const serviceCreateSchema = z.object({
  body: z.object({
    changeNote,
    code: systemManaged("El código del servicio lo genera el sistema."),
    kind: serviceKind.optional().default(DEFAULT_SERVICE_KIND),
    description: serviceDescription,
    isActive: z.boolean().optional().default(true),
    measurementUnitId: positiveId.optional(),
    name: serviceName,
    referenceRate,
    sortOrder: sortOrder.optional().default(0),
    unitDenominationId,
    unitOptions: unitOptions.optional(),
  }).strict().superRefine(exclusiveUnitInput({ required: true })),
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
    unitOptions: unitOptions.optional(),
  }).strict().refine(
    (body) => ["description", "isActive", "kind", "measurementUnitId", "name", "referenceRate", "sortOrder", "unitDenominationId", "unitOptions"]
      .some((field) => body[field] !== undefined),
    { message: "Indica al menos un campo para modificar.", path: ["request"] },
  ).superRefine(exclusiveUnitInput({ required: false })),
});

export const serviceStatusSchema = z.object({
  params: serviceIdParams,
  body: z.object({ changeNote, expectedVersion, isActive: z.boolean() }).strict(),
});
