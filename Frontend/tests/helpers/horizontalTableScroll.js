// Comprobaciones compartidas del ScrollBar horizontal de tablas (HorizontalScrollViewport).
import assert from "node:assert/strict";

// Un píxel cubre el redondeo de anchos fraccionarios sin ocultar desalineaciones visibles.
const TOLERANCE_PX = 1;

/**
 * Mide el viewport de la tabla, su contenedor, el ScrollBar y la última columna.
 *
 * @param {import("playwright").Page} page - Página con la tabla visible.
 * @param {string} label - Nombre accesible del ScrollBar.
 * @returns {Promise<Object>} Medidas en píxeles del documento.
 */
function measure(page, label) {
  return page.evaluate((scrollBarLabel) => {
    const viewport = document.querySelector("[data-horizontal-scroll-viewport]");
    const container = viewport.parentElement;
    const bar = document.querySelector(`[role="scrollbar"][aria-label="${scrollBarLabel}"]`);
    const rect = (element) => element?.getBoundingClientRect().toJSON() ?? null;
    const headerCells = viewport.querySelectorAll("thead th");
    const firstRowCells = viewport.querySelector("tbody tr")?.children ?? [];
    return {
      overflow: viewport.scrollWidth - viewport.clientWidth,
      scrollLeft: viewport.scrollLeft,
      clientWidth: viewport.clientWidth,
      viewport: rect(viewport),
      container: rect(container),
      bar: rect(bar?.closest(".inline-flex")),
      valueNow: bar ? Number(bar.getAttribute("aria-valuenow")) : null,
      lastHeader: rect(headerCells[headerCells.length - 1]),
      lastCell: rect(firstRowCells[firstRowCells.length - 1]),
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  }, label);
}

/**
 * Espera a que terminen las transiciones de layout y a que el ScrollBar refleje el overflow
 * actual del viewport (ResizeObserver).
 *
 * @param {import("playwright").Page} page - Página con la tabla visible.
 * @param {string} label - Nombre accesible del ScrollBar.
 * @returns {Promise<void>}
 */
export async function waitForScrollBarSync(page, label) {
  // Cruzar un breakpoint anima el riel lateral: medir durante la transición daba overflow intermedio.
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.allSettled(document.getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished));
  });
  await page.waitForFunction((scrollBarLabel) => {
    const viewport = document.querySelector("[data-horizontal-scroll-viewport]");
    if (!viewport) return false;
    const hasOverflow = viewport.scrollWidth - viewport.clientWidth > 1;
    return hasOverflow === Boolean(document.querySelector(`[role="scrollbar"][aria-label="${scrollBarLabel}"]`));
  }, label);
}

/**
 * Comprueba el patrón de la tabla de Proyectos: con overflow, el ScrollBar aparece bajo la tabla y
 * dentro de su contenedor, con el ancho del viewport; arrastrarlo alcanza la última columna con
 * encabezado y filas alineados, y la rueda/touchpad lo devuelve al inicio. Sin overflow no hay
 * barra. La página nunca desborda en horizontal.
 *
 * @param {import("playwright").Page} page - Página con la tabla visible.
 * @param {string} label - Nombre accesible del ScrollBar.
 * @param {string} context - Descripción para los mensajes (ancho, tema).
 * @returns {Promise<boolean>} true si la tabla desbordaba.
 */
export async function assertHorizontalTableScroll(page, label, context) {
  await waitForScrollBarSync(page, label);
  // La barra va al pie de la tabla: se lleva al viewport para que el puntero pueda alcanzarla.
  const scrollBar = page.getByRole("scrollbar", { name: label, exact: true });
  if (await scrollBar.count()) await scrollBar.scrollIntoViewIfNeeded();
  const initial = await measure(page, label);
  assert.ok(initial.pageOverflow <= 0, `${context}: la página no desborda (${initial.pageOverflow}px)`);
  if (initial.overflow <= TOLERANCE_PX) {
    assert.equal(initial.bar, null, `${context}: sin overflow no hay ScrollBar`);
    return false;
  }
  assert.ok(initial.bar, `${context}: ScrollBar visible con overflow`);
  assert.ok(Math.abs(initial.bar.width - initial.clientWidth) <= TOLERANCE_PX, `${context}: pista del ancho del viewport`);
  assert.ok(initial.bar.left >= initial.container.left - TOLERANCE_PX && initial.bar.right <= initial.container.right + TOLERANCE_PX
    && initial.bar.bottom <= initial.container.bottom + TOLERANCE_PX, `${context}: ScrollBar dentro del contenedor`);
  assert.ok(initial.bar.top >= initial.viewport.bottom - TOLERANCE_PX, `${context}: la barra no tapa la última fila`);

  // Arrastre con el ratón hasta el final: la última columna queda visible y alineada.
  const thumb = scrollBar.locator("div").first();
  const thumbBox = await thumb.boundingBox();
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(initial.bar.right + 40, thumbBox.y + thumbBox.height / 2, { steps: 6 });
  await page.mouse.up();
  const end = await measure(page, label);
  assert.ok(end.overflow - end.scrollLeft <= TOLERANCE_PX, `${context}: el arrastre alcanza el final (${end.scrollLeft}/${end.overflow})`);
  assert.equal(end.valueNow, 100);
  assert.ok(Math.abs(end.lastHeader.right - end.viewport.right) <= TOLERANCE_PX, `${context}: última columna completa`);
  if (end.lastCell) assert.ok(Math.abs(end.lastCell.left - end.lastHeader.left) <= TOLERANCE_PX, `${context}: encabezado y filas alineados`);

  // Rueda horizontal (touchpad) sobre la tabla: vuelve al inicio y el ScrollBar lo refleja.
  // Cerca del borde inferior: la barra se llevó al viewport, así que esa franja de la tabla es visible.
  await page.mouse.move(initial.viewport.left + 20, initial.viewport.bottom - 20);
  await page.mouse.wheel(-5000, 0);
  await page.waitForFunction((scrollBarLabel) => document.querySelector(`[role="scrollbar"][aria-label="${scrollBarLabel}"]`)?.getAttribute("aria-valuenow") === "0", label);
  assert.equal((await measure(page, label)).scrollLeft, 0);
  return true;
}

/**
 * Desplaza la tabla con un gesto táctil horizontal (CDP) sobre su viewport.
 *
 * @param {import("playwright").Page} page - Página creada con `hasTouch`.
 * @param {number} distance - Desplazamiento del dedo en píxeles (negativo hacia la izquierda).
 * @returns {Promise<void>}
 */
export async function touchSwipeTable(page, distance) {
  const box = await page.locator("[data-horizontal-scroll-viewport]").first().boundingBox();
  const point = { x: box.x + box.width * 0.7, y: box.y + Math.min(box.height / 2, 80) };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x + (distance * step) / 10, y: point.y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
