import { z } from "zod";

import { DENOMINATION_MAX_LENGTH, normalizeUnitText } from "../domain/measurementUnitLabel.js";
import { QUOTE_DECIMAL_FORMATS } from "../domain/quoteTotals.js";
import { SERVICE_KINDS } from "../domain/serviceCatalog.js";
import { PRESENTATION_LABEL_MAX_LENGTH, normalizePresentationLabel } from "../domain/serviceUnitOptions.js";
import { scaledDecimalText } from "./decimalSchemas.js";

/*
 * Archivo del catálogo oficial que carga el comando de mantenimiento
 * (scripts/load-official-service-catalog.mjs). Describe denominaciones y servicios con códigos
 * estables de unidad (`square_meter`), nunca con ids de una base concreta. Las reglas de cada alta
 * las vuelve a aplicar el backend (serviceCreateSchema, denominationCreateSchema y los servicios);
 * aquí solo se exige un archivo completo y sin ambigüedades:
 * - `order` 1..N contiguo y en el orden del documento: el servicio N recibirá `SERV-00N`;
 * - totales declarados (`expectedTotals`) que coinciden con el contenido, para detectar archivos
 *   truncados o con servicios de más;
 * - cada denominación usada está declarada una sola vez;
 * - cada servicio tiene una sola unidad (`unit`, `denomination` y `presentationLabel` opcionales)
 *   con la tarifa del servicio: un servicio que se cobra de dos formas son dos servicios;
 * - `sortOrder` (opcional, por defecto `order`) coloca juntos en el tabulador servicios cuyo
 *   código es posterior, sin renumerar los demás.
 */

const MAX_CATALOG_SERVICES = 100;
// La nota de versión lleva además « · carga <runId>» y debe caber en change_note (VARCHAR(255)).
const CHANGE_NOTE_MAX_LENGTH = 200;

const unitCode = z.string().regex(/^[a-z][a-z0-9_]{0,49}$/, "Usa el código estable de la unidad base (p. ej. square_meter).");
const rate = scaledDecimalText(QUOTE_DECIMAL_FORMATS.unitRate);
const denominationText = z.string().transform(normalizeUnitText).pipe(z.string().min(1).max(DENOMINATION_MAX_LENGTH));

/**
 * Clave de equivalencia de una denominación, con el criterio del índice único de PostgreSQL
 * (NFKC y minúsculas): «De Construcción» y «de construcción» son la misma.
 *
 * @param {string} unit - Código de la unidad base.
 * @param {string|null} denomination - Texto normalizado o null (unidad base sola).
 * @returns {string} Clave.
 */
export function catalogDenominationKey(unit, denomination) {
  return `${unit}:${denomination === null ? "" : denomination.normalize("NFKC").toLowerCase()}`;
}

const catalogService = z.object({
  denomination: z.union([denominationText, z.null()]).optional().transform((value) => value ?? null),
  description: z.union([z.string().trim().max(2000), z.null()]).transform((value) => value || null),
  kind: z.enum([SERVICE_KINDS.INDIVIDUAL, SERVICE_KINDS.TURNKEY]),
  name: z.string().trim().min(1).max(150),
  order: z.number().int().min(1),
  presentationLabel: z.union([z.string(), z.null()]).optional()
    .transform((value) => normalizePresentationLabel(value))
    .refine((value) => !value || value.length <= PRESENTATION_LABEL_MAX_LENGTH, `Admite como máximo ${PRESENTATION_LABEL_MAX_LENGTH} caracteres.`),
  referenceRate: rate,
  sortOrder: z.number().int().min(0).max(2147483647).optional(),
  unit: unitCode,
}).strict().transform((service) => ({ ...service, sortOrder: service.sortOrder ?? service.order }));

const catalogDenomination = z.object({ denomination: denominationText, unit: unitCode }).strict();

const expectedTotals = z.object({
  denominations: z.number().int().min(0),
  services: z.number().int().min(1),
  [SERVICE_KINDS.INDIVIDUAL]: z.number().int().min(0),
  [SERVICE_KINDS.TURNKEY]: z.number().int().min(0),
}).strict();

/**
 * Comprueba la coherencia global del catálogo: orden contiguo, nombres únicos, denominaciones
 * sin duplicados y declaradas, y totales declarados.
 *
 * @param {object} catalog - Catálogo validado campo a campo.
 * @param {import("zod").RefinementCtx} context - Contexto de Zod para añadir errores.
 * @returns {void}
 */
function checkCatalogConsistency(catalog, context) {
  const declared = new Set();
  catalog.denominations.forEach((item, index) => {
    const key = catalogDenominationKey(item.unit, item.denomination);
    if (declared.has(key)) context.addIssue({ code: "custom", message: "La denominación está repetida.", path: ["denominations", index] });
    declared.add(key);
  });
  const names = new Set();
  catalog.services.forEach((service, index) => {
    if (service.order !== index + 1) {
      context.addIssue({ code: "custom", message: `El orden debe ser ${index + 1}: los servicios van 1..N en el orden del documento.`, path: ["services", index, "order"] });
    }
    if (names.has(service.name)) context.addIssue({ code: "custom", message: "El nombre del servicio está repetido.", path: ["services", index, "name"] });
    names.add(service.name);
    if (service.denomination !== null && !declared.has(catalogDenominationKey(service.unit, service.denomination))) {
      context.addIssue({ code: "custom", message: "La denominación no está declarada en `denominations`.", path: ["services", index, "denomination"] });
    }
  });
  const actual = {
    denominations: catalog.denominations.length,
    services: catalog.services.length,
    [SERVICE_KINDS.INDIVIDUAL]: catalog.services.filter((service) => service.kind === SERVICE_KINDS.INDIVIDUAL).length,
    [SERVICE_KINDS.TURNKEY]: catalog.services.filter((service) => service.kind === SERVICE_KINDS.TURNKEY).length,
  };
  for (const [field, value] of Object.entries(actual)) {
    if (catalog.expectedTotals[field] !== value) {
      context.addIssue({ code: "custom", message: `Se declararon ${catalog.expectedTotals[field]} y el archivo contiene ${value}.`, path: ["expectedTotals", field] });
    }
  }
}

export const officialServiceCatalogSchema = z.object({
  catalogId: z.string().trim().min(1).max(100),
  changeNote: z.string().trim().min(1).max(CHANGE_NOTE_MAX_LENGTH),
  denominations: z.array(catalogDenomination),
  expectedTotals,
  services: z.array(catalogService).min(1).max(MAX_CATALOG_SERVICES),
  source: z.string().trim().min(1).max(255),
}).strict().superRefine(checkCatalogConsistency);
