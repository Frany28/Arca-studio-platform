import assert from "node:assert/strict";
import test from "node:test";

import { encodeCursor } from "../src/utils/pagination.js";
import {
  quoteCreateSchema,
  quoteListSchema,
  quotePdfSchema,
  quoteUpdateSchema,
} from "../src/validation/quoteSchemas.js";

const VALID_BODY = {
  clientId: 3,
  items: [{ quantity: "200", serviceId: 1, unitRate: "12" }],
  projectId: 9,
};

/**
 * Valida un esquema y devuelve las rutas de los campos con error.
 *
 * @param {import("zod").ZodType} schema - Esquema de la ruta.
 * @param {object} input - `{ body, params, query }`.
 * @returns {Array<string>} Rutas con error (vacío si es válido).
 */
function errorPaths(schema, input) {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

test("alta: normaliza cantidades y tarifas a la escala de NUMERIC y vacía las observaciones en blanco", () => {
  const { body } = quoteCreateSchema.parse({ body: { ...VALID_BODY, notes: "   " } });
  assert.deepEqual(body.items, [{ quantity: "200.000", serviceId: 1, unitRate: "12.00" }]);
  assert.equal(body.notes, null);
  assert.equal(quoteCreateSchema.parse({ body: { ...VALID_BODY, notes: "  Visita incluida " } }).body.notes, "Visita incluida");
});

test("alta: rechaza conceptos vacíos, decimales sobrantes, negativos, campos extra y notas largas", () => {
  const cases = [
    [{ ...VALID_BODY, items: [] }, "body.items"],
    [{ ...VALID_BODY, items: [{ ...VALID_BODY.items[0], quantity: "1.2345" }] }, "body.items.0.quantity"],
    [{ ...VALID_BODY, items: [{ ...VALID_BODY.items[0], unitRate: "-1" }] }, "body.items.0.unitRate"],
    [{ ...VALID_BODY, items: [{ ...VALID_BODY.items[0], unitRate: 0.1 + 0.2 }] }, "body.items.0.unitRate"],
    [{ ...VALID_BODY, items: [{ ...VALID_BODY.items[0], subtotal: "2400" }] }, "body.items.0"],
    [{ ...VALID_BODY, items: Array.from({ length: 101 }, (_, index) => ({ quantity: "1", serviceId: index + 1, unitRate: "1" })) }, "body.items"],
    [{ ...VALID_BODY, notes: "x".repeat(2001) }, "body.notes"],
    [{ ...VALID_BODY, code: "COT-001" }, "body"],
    [{ ...VALID_BODY, clientId: "3" }, "body.clientId"],
    [{ ...VALID_BODY, projectId: undefined }, "body.projectId"],
  ];
  for (const [body, path] of cases) assert.ok(errorPaths(quoteCreateSchema, { body }).includes(path), `${path} en ${JSON.stringify(errorPaths(quoteCreateSchema, { body }))}`);
});

test("edición: exige expectedVersion y el id numérico de la cotización", () => {
  assert.deepEqual(errorPaths(quoteUpdateSchema, { body: { ...VALID_BODY, expectedVersion: 2 }, params: { quoteId: "5" } }), []);
  assert.ok(errorPaths(quoteUpdateSchema, { body: VALID_BODY, params: { quoteId: "5" } }).includes("body.expectedVersion"));
  assert.ok(errorPaths(quoteUpdateSchema, { body: { ...VALID_BODY, expectedVersion: 1 }, params: { quoteId: "abc" } }).includes("params.quoteId"));
});

test("listado: orden por defecto, intervalo coherente y cursor del mismo orden", () => {
  const parsed = quoteListSchema.parse({ query: {} }).query;
  assert.equal(parsed.sort, "code");
  assert.equal(parsed.direction, "asc");

  const range = { createdBefore: "2026-03-27T04:00:00.000Z", createdFrom: "2026-03-20T04:00:00.000Z" };
  assert.deepEqual(errorPaths(quoteListSchema, { query: range }), []);
  assert.ok(errorPaths(quoteListSchema, { query: { createdBefore: range.createdFrom, createdFrom: range.createdBefore } }).includes("query.createdFrom"));
  assert.ok(errorPaths(quoteListSchema, { query: { createdFrom: "2026-03-20" } }).includes("query.createdFrom"), "Exige zona horaria");

  assert.deepEqual(errorPaths(quoteListSchema, { query: { cursor: encodeCursor(["7", "7"]) } }), []);
  assert.deepEqual(errorPaths(quoteListSchema, { query: { cursor: encodeCursor(["2400.00", "7"]), sort: "total" } }), []);
  assert.ok(errorPaths(quoteListSchema, { query: { cursor: encodeCursor(["2400.00", "7"]) } }).includes("query.cursor"), "Cursor de total en orden por código");
  assert.ok(errorPaths(quoteListSchema, { query: { cursor: "no-es-un-cursor" } }).includes("query.cursor"));
  assert.ok(errorPaths(quoteListSchema, { query: { sort: "client" } }).includes("query.sort"));
});

test("PDF: la zona horaria es opcional y acotada", () => {
  assert.deepEqual(errorPaths(quotePdfSchema, { params: { quoteId: "1" }, query: { timeZone: "America/Caracas" } }), []);
  assert.ok(errorPaths(quotePdfSchema, { params: { quoteId: "1" }, query: { timeZone: "x".repeat(65) } }).includes("query.timeZone"));
});
