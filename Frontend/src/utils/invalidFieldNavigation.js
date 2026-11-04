// Navegación hacia el primer campo inválido de un formulario tras un intento de envío.
//
// Contrato: un campo es inválido cuando él o su contenedor exponen `aria-invalid="true"`, el mismo
// atributo que leen los lectores de pantalla. Así la navegación no depende de cómo cada formulario
// guarda sus errores (estado local, errores del backend o validación de un paso) ni del tipo de
// control: input, textarea, combobox, DropdownMenu o grupo de botones.

/** Marca de invalidez compartida por todos los formularios. */
export const INVALID_FIELD_SELECTOR = '[aria-invalid="true"]';

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
 * Resuelve el control interactivo real de un campo marcado como inválido: el propio elemento si es
 * enfocable o, si la marca está en un contenedor, su primer control disponible (el disparador de
 * un DropdownMenu, la primera opción de un grupo).
 *
 * @param {Element} invalidElement - Elemento con `aria-invalid="true"`.
 * @returns {HTMLElement|null} Control a enfocar o null si ninguno está disponible.
 */
export function resolveInvalidFieldFocusTarget(invalidElement) {
  if (invalidElement.matches(FOCUSABLE_SELECTOR) && isAvailableFocusTarget(invalidElement)) return invalidElement;
  return [...invalidElement.querySelectorAll(FOCUSABLE_SELECTOR)].find(isAvailableFocusTarget) ?? null;
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
 * Calcula la caja que debe quedar visible: el control, su marcador, sus etiquetas y sus mensajes
 * asociados (el error bajo el campo), siempre que estén renderizados y cerca del control.
 *
 * @param {{element: Element, target: HTMLElement}} field - Campo inválido.
 * @returns {{top: number, bottom: number, left: number, right: number}} Caja en coordenadas del viewport.
 */
export function getInvalidFieldRevealRect({ element, target }) {
  const targetRect = target.getBoundingClientRect();
  const associated = [
    element,
    ...(target.labels ?? []),
    ...referencedElements(target, "aria-labelledby"),
    ...referencedElements(target, "aria-describedby"),
    ...referencedElements(element, "aria-describedby"),
  ];
  const rect = { bottom: targetRect.bottom, left: targetRect.left, right: targetRect.right, top: targetRect.top };
  for (const part of associated) {
    if (part.getClientRects().length === 0) continue;
    const partRect = part.getBoundingClientRect();
    const gap = Math.max(partRect.top - targetRect.bottom, targetRect.top - partRect.bottom, 0);
    if (gap > ASSOCIATED_CONTENT_MAX_GAP_PX) continue;
    rect.top = Math.min(rect.top, partRect.top);
    rect.bottom = Math.max(rect.bottom, partRect.bottom);
    rect.left = Math.min(rect.left, partRect.left);
    rect.right = Math.max(rect.right, partRect.right);
  }
  return rect;
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
 * desplazamiento de cada contenedor interno se descuenta de la caja antes de calcular el siguiente,
 * porque con `behavior: "smooth"` las posiciones aún no han cambiado al medir.
 *
 * @param {Element} element - Elemento de referencia (define la cadena de contenedores).
 * @param {{top: number, bottom: number, left: number, right: number}} rect - Caja a mostrar.
 * @param {ScrollBehavior} behavior - `smooth` o `auto`.
 * @returns {boolean} true si se desplazó algún contenedor.
 */
export function scrollRectIntoView(element, rect, behavior) {
  const box = { ...rect };
  let scrolled = false;
  for (const container of getScrollContainers(element)) {
    const area = getVisibleArea(container);
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
    box.top -= deltaY;
    box.bottom -= deltaY;
    box.left -= deltaX;
    box.right -= deltaX;
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
  scrollRectIntoView(field.target, getInvalidFieldRevealRect(field), behavior ?? resolveScrollBehavior(view));
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
