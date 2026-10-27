import assert from "node:assert/strict";
import test from "node:test";

import {
  addMonths,
  buildMonthGrid,
  formatAccessibleDay,
  formatMonthTitle,
  formatShortDay,
  fromDayKey,
  getRangePosition,
  selectRangeDay,
} from "../src/components/ui/DateRangePicker/dateRangeCalendar.js";
import { formatDecimalMoney } from "../src/pages/admin-services-quotes/utils/moneyFormat.js";
import {
  formatQuoteDate,
  getColumnSortDirection,
  toCreatedRange,
  toggleQuoteSort,
} from "../src/pages/admin-services-quotes/quotes/utils/quoteListPresentation.js";
import { getQuoteCreatePath, getQuoteEditorPath, getQuotesListPath } from "../src/pages/admin-services-quotes/utils/servicesQuotesTabs.js";

test("calendario: semanas de lunes a domingo, seis filas y días de otros meses marcados", () => {
  const grid = buildMonthGrid(new Date(2026, 2, 15));
  assert.equal(grid.length, 6);
  assert.ok(grid.every((week) => week.length === 7));
  // Marzo de 2026 empieza en domingo: la primera semana trae seis días de febrero.
  assert.deepEqual(grid[0].map((day) => [day.key, day.inMonth]).slice(5), [["2026-02-28", false], ["2026-03-01", true]]);
  assert.equal(formatMonthTitle(new Date(2026, 6, 1)), "Julio-2026");
  assert.equal(formatShortDay("2026-03-20"), "20 Mar 2026");
  assert.equal(formatAccessibleDay(new Date(2026, 2, 20)), "viernes, 20 de marzo de 2026");
  assert.equal(fromDayKey("2026-02-30"), null);
  assert.equal(addMonths(new Date(2026, 11, 31), 1).getMonth(), 0);
});

test("intervalo: inicio, fin intercambiado si es anterior y reinicio con un intervalo completo", () => {
  let range = selectRangeDay({ from: null, to: null }, "2026-03-20");
  assert.deepEqual(range, { from: "2026-03-20", to: null });
  range = selectRangeDay(range, "2026-03-12");
  assert.deepEqual(range, { from: "2026-03-12", to: "2026-03-20" });
  assert.deepEqual(selectRangeDay(range, "2026-04-01"), { from: "2026-04-01", to: null });
  assert.equal(getRangePosition("2026-03-12", range), "start");
  assert.equal(getRangePosition("2026-03-15", range), "inside");
  assert.equal(getRangePosition("2026-03-20", range), "end");
  assert.equal(getRangePosition("2026-03-21", range), "outside");
  assert.equal(getRangePosition("2026-03-20", { from: "2026-03-20", to: null }), "single");
});

test("filtro por fecha: días locales a instantes, con el último día incluido completo", () => {
  const range = toCreatedRange({ dateFrom: "2026-03-20", dateTo: "2026-03-26" });
  assert.equal(range.createdFrom, new Date(2026, 2, 20).toISOString());
  assert.equal(range.createdBefore, new Date(2026, 2, 27).toISOString());
  assert.deepEqual(toCreatedRange({ dateFrom: "2026-03-20" }), { createdBefore: new Date(2026, 2, 21).toISOString(), createdFrom: new Date(2026, 2, 20).toISOString() });
  assert.deepEqual(toCreatedRange({}), {});
  assert.equal(formatQuoteDate(new Date(2026, 2, 23, 18).toISOString()), "23/03/2026");
  assert.equal(formatQuoteDate("no-es-fecha"), "Sin fecha");
});

test("orden: otra columna empieza en ascendente y la misma alterna; aria-sort coherente", () => {
  assert.deepEqual(toggleQuoteSort({ direction: "asc", sort: "code" }, "code"), { direction: "desc", sort: "code" });
  assert.deepEqual(toggleQuoteSort({ direction: "desc", sort: "code" }, "total"), { direction: "asc", sort: "total" });
  assert.equal(getColumnSortDirection({ direction: "desc", sort: "total" }, "total"), "descending");
  assert.equal(getColumnSortDirection({ direction: "desc", sort: "total" }, "code"), "none");
});

test("importes: céntimos siempre en totales y solo si no son cero en tarifas", () => {
  assert.equal(formatDecimalMoney("2400.00", { alwaysShowCents: true }), "$2,400.00");
  assert.equal(formatDecimalMoney("2400", { alwaysShowCents: true }), "$2,400.00");
  assert.equal(formatDecimalMoney("12.00"), "$12");
  assert.equal(formatDecimalMoney("999999999999.99", { alwaysShowCents: true }), "$999,999,999,999.99");
  assert.equal(formatDecimalMoney(null), "—");
});

test("rutas del formulario de cotización bajo la pestaña Cotizaciones", () => {
  assert.equal(getQuotesListPath(), "/servicios-cotizaciones/cotizaciones");
  assert.equal(getQuoteCreatePath(), "/servicios-cotizaciones/cotizaciones/nueva");
  assert.equal(getQuoteEditorPath(12), "/servicios-cotizaciones/cotizaciones/12/editar");
});
