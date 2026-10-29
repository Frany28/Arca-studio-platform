import assert from "node:assert/strict";
import { test } from "node:test";

import { SERVICE_PICKER_PAGE_SIZE, getServicePickerPage } from "../src/pages/admin-services-quotes/quote-editor/utils/servicePickerPagination.js";

const SERVICES = Array.from({ length: 19 }, (_, index) => ({ id: index + 1 }));
const ids = (page) => page.items.map((item) => item.id);

test("selector de servicios: diez por página, como las demás tablas del módulo", () => {
  assert.equal(SERVICE_PICKER_PAGE_SIZE, 10);
  const first = getServicePickerPage({ items: SERVICES, pageIndex: 0 });
  assert.deepEqual([ids(first), first.hasPrevious, first.hasNext], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], false, true]);
  const second = getServicePickerPage({ items: SERVICES, pageIndex: 1 });
  assert.deepEqual([ids(second), second.hasPrevious, second.hasNext], [[11, 12, 13, 14, 15, 16, 17, 18, 19], true, false]);
});

test("selector de servicios: una lista más corta ajusta la página en lugar de dejarla vacía", () => {
  // Tras buscar quedan 4 servicios: la página 2 pedida pasa a ser la única (0).
  const narrowed = getServicePickerPage({ items: SERVICES.slice(0, 4), pageIndex: 1 });
  assert.deepEqual([narrowed.pageIndex, ids(narrowed), narrowed.hasPrevious, narrowed.hasNext], [0, [1, 2, 3, 4], false, false]);
  const empty = getServicePickerPage({ items: [], pageIndex: 3 });
  assert.deepEqual([empty.pageIndex, empty.items, empty.hasNext], [0, [], false]);
  assert.equal(getServicePickerPage({ items: SERVICES, pageIndex: -2 }).pageIndex, 0);
});
