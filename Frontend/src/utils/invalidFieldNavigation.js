// Navegación hacia el primer campo inválido de un formulario tras un intento de envío.
//
// Contrato: un campo es inválido cuando él o su contenedor exponen `aria-invalid="true"`, el mismo
// atributo que leen los lectores de pantalla. Así la navegación no depende de cómo cada formulario
// guarda sus errores (estado local, errores del backend o validación de un paso) ni del tipo de
// control: input, textarea, combobox, DropdownMenu o grupo de botones.
//
// Errores de lista (p. ej. «Añade al menos un servicio»): el marcador es la sección que muestra el
// error y no contiene un control que lo resuelva. Con `data-invalid-field-control` nombra, por id y
// en orden de preferencia, dónde está ese control; se enfoca el primero disponible.

/** Marca de invalidez compartida por todos los formularios. */
export const INVALID_FIELD_SELECTOR = '[aria-invalid="true"]';

/** Atributo del marcador con los ids (separados por espacios) de los controles que resuelven el error. */
export const INVALID_FIELD_CONTROL_ATTRIBUTE = "data-invalid-field-control";

// Controles que pueden recibir el foco cuando `aria-invalid` está en un contenedor (DropdownMenu,
// grupo de opciones) en lugar de en el propio control.
const FOCUSABLE_SELECTOR = [
  'input:not([type="hidden"])',
  "textarea",
  "select",
  "button",
  "[href]",
  '[role="combobox"]',
  '[role="textbox"]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// Overflow que el usuario puede desplazar. `hidden` y `clip` quedan fuera a propósito: el bloqueo de
// scroll de los modales (useBodyScrollLock) usa `hidden`, y desplazar programáticamente un
// contenedor así movería contenido que el usuario no puede devolver a su sitio.
const USER_SCROLLABLE_OVERFLOW = new Set(["auto", "scroll", "overlay"]);

// Distancia máxima entre el control y una etiqueta o mensaje asociado para revelarlos juntos. Evita
// que un `aria-describedby` hacia un aviso general lejano (p. ej. la alerta superior de la
// solicitud) convierta el bloque a revelar en medio formulario.
const ASSOCIATED_CONTENT_MAX_GAP_PX = 120;

// Elemento que se está enfocando desde esta navegación. `focus()` dispara `focus` de forma síncrona,
// así que los campos pueden distinguir este origen en su onFocus (isInvalidFieldNavigationFocus).
let navigationFocusTarget = null;

/**
 * Indica si un elemento puede recibir el foco ahora: montado, visible, habilitado y fuera de
 * contenido inerte u oculto a la accesibilidad (por ejemplo, el fondo de un modal abierto).
 *
 * @param {Element|null|undefined} element - Elemento candidato.
 * @returns {boolean} true si enfocarlo es seguro y perceptible.
 */
export function isAvailableFocusTarget(element) {
  if (!element?.isConnected || typeof element.focus !== "function") return false;
  if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") return false;
  if (element.closest('[inert], [aria-hidden="true"]')) return false;
  // Sin cajas de layout: `display: none` propio o heredado.
  if (element.getClientRects().length === 0) return false;
  if (typeof element.checkVisibility === "function" && !element.checkVisibility({ visibilityProperty: true })) return false;
  return true;
}

/**
 * Primer control disponible de un elemento: él mismo si es enfocable o su primer descendiente
 * enfocable (el disparador de un DropdownMenu, la primera opción de un grupo).
 *
 * @param {Element} element - Elemento o contenedor.
 * @returns {HTMLElement|null} Control o null.
 */
function firstAvailableControl(element) {
  if (element.matches(FOCUSABLE_SELECTOR) && isAvailableFocusTarget(element)) return element;
  return [...element.querySelectorAll(FOCUSABLE_SELECTOR)].find(isAvailableFocusTarget) ?? null;
}

/**
 * Resuelve el control interactivo real de un campo marcado como inválido. Si el marcador nombra sus
 * controles (`data-invalid-field-control`), se usa el primero disponible en ese orden; si no, el
 * propio marcador o su primer control interno.
 *
 * @param {Element} invalidElement - Elemento con `aria-invalid="true"`.
 * @returns {HTMLElement|null} Control a enfocar o null si ninguno está disponible.
 */
export function resolveInvalidFieldFocusTarget(invalidElement) {
  for (const reference of referencedElements(invalidElement, INVALID_FIELD_CONTROL_ATTRIBUTE)) {
    const control = firstAvailableControl(reference);
    if (control) return control;
  }
  return firstAvailableControl(invalidElement);
}

/**
 * Compara dos cajas en orden de lectura visual: primero por filas (dos cajas que se solapan en
 * vertical más de la mitad de la menor comparten fila, como los campos de una rejilla de dos
 * columnas con etiquetas de distinta altura) y, dentro de la fila, según la dirección del texto.
 *
 * @param {{top: number, bottom: number, left: number, right: number}} first - Primera caja.
 * @param {{top: number, bottom: number, left: number, right: number}} second - Segunda caja.
 * @param {boolean} [rtl=false] - Dirección de derecha a izquierda.
 * @returns {number} Negativo si `first` va antes, positivo si va después y 0 si coinciden.
 */
export function compareVisualOrder(first, second, rtl = false) {
  const overlap = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  const minHeight = Math.min(first.bottom - first.top, second.bottom - second.top);
  const sameRow = overlap > minHeight / 2;
  if (!sameRow) return first.top - second.top;
  return rtl ? second.right - first.right : first.left - second.left;
}

/**
 * Localiza el primer campo inválido en orden visual que tenga un control enfocable. Los campos
 * ocultos, deshabilitados o desmontados se ignoran; varios marcadores que llevan al mismo control
 * (contenedor y control marcados a la vez) cuentan como uno.
 *
 * @param {ParentNode|null|undefined} container - Formulario o diálogo donde buscar.
 * @returns {{element: Element, target: HTMLElement}|null} Marcador y control, o null.
 */
export function findFirstInvalidField(container) {
  if (!container?.querySelectorAll) return null;
  // nodeType 1: un Element (un documento o fragmento no tiene dirección propia).
  const rtl = container.nodeType === 1 && container.ownerDocument.defaultView.getComputedStyle(container).direction === "rtl";
  let first = null;
  for (const element of container.querySelectorAll(INVALID_FIELD_SELECTOR)) {
    const target = resolveInvalidFieldFocusTarget(element);
    if (!target || target === first?.target) continue;
    const rect = element.getBoundingClientRect();
    // Recorre en orden del documento y solo sustituye ante un campo visualmente anterior: con cajas
    // equivalentes gana el orden del DOM, que es también el del tabulador.
    if (!first || compareVisualOrder(rect, first.rect, rtl) < 0) first = { element, rect, target };
  }
  return first ? { element: first.element, target: first.target } : null;
}

/**
 * Devuelve los elementos referenciados por un atributo de ids (`aria-labelledby`,
 * `aria-describedby`).
 *
 * @param {Element} element - Elemento que declara la relación.
 * @param {string} attribute - Atributo con ids separados por espacios.
 * @returns {Element[]} Elementos existentes.
 */
function referencedElements(element, attribute) {
  const ids = element.getAttribute(attribute)?.split(/\s+/).filter(Boolean) ?? [];
  return ids.map((id) => element.ownerDocument.getElementById(id)).filter(Boolean);
}

/**
 * Copia una caja del DOM como objeto plano y mutable.
 *
 * @param {DOMRect} rect - Caja medida.
 * @returns {{top: number, bottom: number, left: number, right: number}} Caja.
 */
function toBox(rect) {
  return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top };
}

/**
 * Amplía una caja con las partes asociadas que están renderizadas y forman parte del campo: las
 * contenidas en el marcador (su error, aunque quede lejos del control) o las cercanas al control.
 *
 * @param {{top: number, bottom: number, left: number, right: number}} box - Caja inicial.
 * @param {Element[]} parts - Partes candidatas.
 * @param {{element: Element, targetRect: DOMRect}} field - Marcador y caja del control.
 * @returns {{top: number, bottom: number, left: number, right: number}} Unión.
 */
function unionWithAssociated(box, parts, { element, targetRect }) {
  const union = { ...box };
  for (const part of parts) {
    if (part.getClientRects().length === 0) continue;
    const partRect = part.getBoundingClientRect();
    const gap = Math.max(partRect.top - targetRect.bottom, targetRect.top - partRect.bottom, 0);
    if (part !== element && !element.contains(part) && gap > ASSOCIATED_CONTENT_MAX_GAP_PX) continue;
    union.top = Math.min(union.top, partRect.top);
    union.bottom = Math.max(union.bottom, partRect.bottom);
    union.left = Math.min(union.left, partRect.left);
    union.right = Math.max(union.right, partRect.right);
  }
  return union;
}

/**
 * Calcula las cajas a revelar, de la más completa a la mínima: `full` (control, marcador,
 * etiquetas y mensajes), `essential` (control y todos los mensajes del campo), `own` (control y
 * su propio motivo, p. ej. el error bajo la tarjeta de un adjunto) y `target` (solo el control).
 * El desplazamiento usa la primera que cabe, para que un campo alto (muchos adjuntos) o un error
 * de lista lejos de su control sigan mostrando el control y, si es posible, el motivo.
 *
 * @param {{element: Element, target: HTMLElement}} field - Campo inválido.
 * @returns {{full: Object, essential: Object, own: Object, target: Object}} Cajas en coordenadas del viewport.
 */
export function getInvalidFieldRevealBoxes({ element, target }) {
  const targetRect = target.getBoundingClientRect();
  const ownMessages = referencedElements(target, "aria-describedby");
  const own = unionWithAssociated(toBox(targetRect), ownMessages, { element, targetRect });
  const essential = unionWithAssociated(own, referencedElements(element, "aria-describedby"), { element, targetRect });
  const full = unionWithAssociated(essential, [
    element,
    ...(target.labels ?? []),
    ...referencedElements(target, "aria-labelledby"),
    ...referencedElements(element, "aria-labelledby"),
  ], { element, targetRect });
  return { essential, full, own, target: toBox(targetRect) };
}

/**
 * Elige la caja a mostrar en un área visible: la primera candidata que cabe en altura (completa,
 * esencial, propia); si ninguna cabe, el inicio de la esencial con la altura del área cuando el
 * control queda dentro, o el control solo. El control nunca queda fuera de la vista.
 *
 * @param {{full: Object, essential: Object, own?: Object, target: Object}} boxes - Cajas candidatas.
 * @param {number} viewHeight - Alto del área visible.
 * @returns {{top: number, bottom: number, left: number, right: number}} Caja elegida.
 */
export function pickRevealBox({ essential, full, own, target }, viewHeight) {
  for (const box of [full, essential, own].filter(Boolean)) {
    if (box.bottom - box.top <= viewHeight) return box;
  }
  if (target.top >= essential.top && target.bottom <= essential.top + viewHeight) {
    return { ...essential, bottom: essential.top + viewHeight };
  }
  return target;
}

/**
 * Calcula cuánto desplazar un eje para mostrar un tramo: nada si ya se ve entero; centrarlo si
 * cabe (deja espacio para el mensaje de error y aleja el campo de cabeceras fijas); y, si es más
 * grande que el área visible, alinear su inicio. El resultado respeta los límites del scroll.
 *
 * @param {Object} params - Geometría del eje.
 * @param {number} params.start - Inicio del tramo a mostrar.
 * @param {number} params.end - Fin del tramo a mostrar.
 * @param {number} params.viewStart - Inicio del área visible (ya descontado scroll-padding).
 * @param {number} params.viewEnd - Fin del área visible.
 * @param {number} params.scrollPosition - Desplazamiento actual del contenedor.
 * @param {number} params.maxScroll - Desplazamiento máximo del contenedor.
 * @returns {number} Desplazamiento a aplicar (positivo hacia el final).
 */
export function computeScrollDelta({ end, maxScroll, scrollPosition, start, viewEnd, viewStart }) {
  if (start >= viewStart && end <= viewEnd) return 0;
  const fits = end - start <= viewEnd - viewStart;
  const desired = fits ? (start + end) / 2 - (viewStart + viewEnd) / 2 : start - viewStart;
  const next = Math.min(Math.max(scrollPosition + desired, 0), Math.max(maxScroll, 0));
  return next - scrollPosition;
}

/**
 * Indica si un contenedor tiene contenido desplazable por el usuario en algún eje.
 *
 * @param {Element} node - Contenedor.
 * @param {CSSStyleDeclaration} style - Estilo calculado del contenedor.
 * @returns {boolean} true si puede desplazarse.
 */
function isUserScrollable(node, style) {
  return (USER_SCROLLABLE_OVERFLOW.has(style.overflowY) && node.scrollHeight > node.clientHeight)
    || (USER_SCROLLABLE_OVERFLOW.has(style.overflowX) && node.scrollWidth > node.clientWidth);
}

/**
 * Lista, del más cercano al más lejano, los contenedores que deben desplazarse para mostrar un
 * elemento. Se detiene en un ancestro `position: fixed` (modales y paneles anclados al viewport):
 * desplazar la página no los mueve, así que no se fuerza el scroll del documento. La página solo se
 * incluye si no está bloqueada por un modal.
 *
 * @param {Element} element - Elemento a mostrar.
 * @returns {Element[]} Contenedores desplazables; el documento usa `document.scrollingElement`.
 */
function getScrollContainers(element) {
  const documentElement = element.ownerDocument.documentElement;
  const body = element.ownerDocument.body;
  const containers = [];
  for (let node = element.parentElement; node && node !== body && node !== documentElement; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (isUserScrollable(node, style)) containers.push(node);
    if (style.position === "fixed") return containers;
  }
  const rootLocked = [documentElement, body].some((node) => getComputedStyle(node).overflowY === "hidden");
  if (!rootLocked) containers.push(element.ownerDocument.scrollingElement ?? documentElement);
  return containers;
}

/**
 * Área visible de un contenedor en coordenadas del viewport, sin barras de scroll y descontando su
 * `scroll-padding` (el mecanismo estándar para reservar espacio a cabeceras fijas).
 *
 * @param {Element} container - Contenedor desplazable o `document.scrollingElement`.
 * @returns {{top: number, bottom: number, left: number, right: number}} Área visible.
 */
function getVisibleArea(container) {
  const style = getComputedStyle(container);
  const padding = (value) => Number.parseFloat(value) || 0;
  const isRoot = container === container.ownerDocument.scrollingElement || container === container.ownerDocument.documentElement;
  const box = isRoot
    ? { left: 0, top: 0 }
    : (() => {
      const rect = container.getBoundingClientRect();
      return { left: rect.left + container.clientLeft, top: rect.top + container.clientTop };
    })();
  const width = isRoot ? container.ownerDocument.documentElement.clientWidth : container.clientWidth;
  const height = isRoot ? container.ownerDocument.documentElement.clientHeight : container.clientHeight;
  return {
    bottom: box.top + height - padding(style.scrollPaddingBottom),
    left: box.left + padding(style.scrollPaddingLeft),
    right: box.left + width - padding(style.scrollPaddingRight),
    top: box.top + padding(style.scrollPaddingTop),
  };
}

/**
 * Desplaza solo los contenedores necesarios para mostrar una caja, del más interno al externo. El
 * desplazamiento de cada contenedor interno se descuenta de las cajas antes de calcular el
 * siguiente, porque con `behavior: "smooth"` las posiciones aún no han cambiado al medir. Con
 * varias cajas candidatas (getInvalidFieldRevealBoxes), cada contenedor muestra la mayor que cabe
 * en su área (pickRevealBox).
 *
 * @param {Element} element - Elemento de referencia (define la cadena de contenedores).
 * @param {{top: number, bottom: number, left: number, right: number}|{full: Object, essential: Object, target: Object}} reveal
 * Caja a mostrar o cajas candidatas.
 * @param {ScrollBehavior} behavior - `smooth` o `auto`.
 * @returns {boolean} true si se desplazó algún contenedor.
 */
export function scrollRectIntoView(element, reveal, behavior) {
  // Copias mutables: cada contenedor desplazado descuenta su delta de todas las candidatas.
  const boxes = "full" in reveal
    ? Object.fromEntries(Object.entries(reveal).map(([name, box]) => [name, { ...box }]))
    : { essential: { ...reveal }, full: { ...reveal }, target: { ...reveal } };
  let scrolled = false;
  for (const container of getScrollContainers(element)) {
    const area = getVisibleArea(container);
    const box = pickRevealBox(boxes, area.bottom - area.top);
    const deltaY = computeScrollDelta({
      end: box.bottom, maxScroll: container.scrollHeight - container.clientHeight, scrollPosition: container.scrollTop,
      start: box.top, viewEnd: area.bottom, viewStart: area.top,
    });
    const deltaX = computeScrollDelta({
      end: box.right, maxScroll: container.scrollWidth - container.clientWidth, scrollPosition: container.scrollLeft,
      start: box.left, viewEnd: area.right, viewStart: area.left,
    });
    if (deltaX === 0 && deltaY === 0) continue;
    container.scrollTo({ behavior, left: container.scrollLeft + deltaX, top: container.scrollTop + deltaY });
    for (const candidate of Object.values(boxes)) {
      candidate.top -= deltaY;
      candidate.bottom -= deltaY;
      candidate.left -= deltaX;
      candidate.right -= deltaX;
    }
    scrolled = true;
  }
  return scrolled;
}

/**
 * Comportamiento del desplazamiento según la preferencia del sistema: inmediato con movimiento
 * reducido y suave en el resto de casos.
 *
 * @param {Window} [view=window] - Ventana del documento.
 * @returns {ScrollBehavior} `auto` o `smooth`.
 */
export function resolveScrollBehavior(view = window) {
  return view.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/**
 * Indica si un elemento está recibiendo el foco desde esta navegación. Pensado para el `onFocus`
 * de campos que cambian su presentación al enfocarse (p. ej. sustituir el error por una ayuda en
 * vivo): así conservan visible el error hasta que el usuario interactúa.
 *
 * @param {EventTarget|null} element - Elemento que recibe el foco.
 * @returns {boolean} true durante el `focus()` de focusFirstInvalidField.
 */
export function isInvalidFieldNavigationFocus(element) {
  return element !== null && element === navigationFocusTarget;
}

/**
 * Lleva al usuario al primer campo inválido del contenedor: desplaza solo los contenedores
 * necesarios para ver el campo con su etiqueta y su error, y lo enfoca sin un segundo
 * desplazamiento (`preventScroll`). El foco se marca como visible aunque el envío se hiciera con el
 * ratón. Sin campos inválidos disponibles no hace nada: los errores generales conservan su
 * presentación.
 *
 * @param {ParentNode|null|undefined} container - Formulario o diálogo.
 * @param {Object} [options] - Ajustes.
 * @param {ScrollBehavior} [options.behavior] - Fuerza el comportamiento; por defecto, según
 * `prefers-reduced-motion`.
 * @returns {HTMLElement|null} Control enfocado o null.
 */
export function focusFirstInvalidField(container, { behavior } = {}) {
  const field = findFirstInvalidField(container);
  if (!field) return null;
  const view = field.target.ownerDocument.defaultView ?? window;
  scrollRectIntoView(field.target, getInvalidFieldRevealBoxes(field), behavior ?? resolveScrollBehavior(view));
  navigationFocusTarget = field.target;
  try {
    // `focusVisible` lo ignoran los navegadores que no lo admiten; los campos de texto ya muestran
    // su anillo de foco en cualquier caso.
    field.target.focus({ focusVisible: true, preventScroll: true });
  } finally {
    navigationFocusTarget = null;
  }
  return field.target;
}
