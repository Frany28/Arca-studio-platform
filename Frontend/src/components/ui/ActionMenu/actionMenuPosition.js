export const ACTION_MENU_VIEWPORT_MARGIN = 8;
export const ACTION_MENU_GAP = 4;

/**
 * Calcula la posición fija del menú alineando su borde derecho con el del disparador.
 * Abre hacia abajo cuando cabe; si no, hacia arriba (p. ej. disparadores al pie de un drawer).
 * Siempre conserva un margen respecto del viewport para evitar recortes.
 *
 * @param {{top: number, right: number, bottom: number}} anchorRect - Rectángulo del disparador.
 * @param {{width: number, height: number}} menuSize - Dimensiones medidas del menú.
 * @param {{width: number, height: number}} viewport - Dimensiones del viewport.
 * @returns {{top: number, left: number}} Coordenadas para `position: fixed`.
 */
export function getActionMenuPosition(anchorRect, menuSize, viewport) {
  const maxLeft = viewport.width - menuSize.width - ACTION_MENU_VIEWPORT_MARGIN;
  const left = Math.max(
    ACTION_MENU_VIEWPORT_MARGIN,
    Math.min(anchorRect.right - menuSize.width, maxLeft),
  );
  const fitsBelow = anchorRect.bottom + ACTION_MENU_GAP + menuSize.height
    <= viewport.height - ACTION_MENU_VIEWPORT_MARGIN;
  const top = fitsBelow
    ? anchorRect.bottom + ACTION_MENU_GAP
    : Math.max(ACTION_MENU_VIEWPORT_MARGIN, anchorRect.top - ACTION_MENU_GAP - menuSize.height);

  return { left, top };
}

/**
 * Devuelve el índice del siguiente elemento enfocable según la tecla de navegación.
 * Recorre la lista de forma circular con flechas y salta a los extremos con Home/End.
 *
 * @param {string} key - ArrowDown, ArrowUp, Home o End.
 * @param {number} currentIndex - Índice enfocado actualmente (-1 si ninguno).
 * @param {number} itemCount - Cantidad de elementos habilitados.
 * @returns {number} Índice destino, o -1 si la lista está vacía o la tecla no aplica.
 */
export function getNextActionMenuIndex(key, currentIndex, itemCount) {
  if (itemCount <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowDown") return (currentIndex + 1) % itemCount;
  if (key === "ArrowUp") return currentIndex <= 0 ? itemCount - 1 : currentIndex - 1;
  return -1;
}
