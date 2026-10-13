/**
 * Breakpoints de layout documentados en DESIGN_SYSTEM.md (móvil base, tablet 768 px,
 * web 1280 px). Las clases de Tailwind deben repetirlos como literales
 * (`max-[767px]:`, `min-[768px]:`), porque Tailwind no interpreta valores dinámicos.
 */
export const TABLET_MIN_WIDTH_PX = 768;

/** Ancho desde el que se aplica el layout web; por debajo el riel lateral inicia contraído. */
export const WEB_MIN_WIDTH_PX = 1280;

/** Media query del layout móvil, el rango en el que se aplican los diseños MOBILE de Figma. */
export const MOBILE_LAYOUT_MEDIA_QUERY = `(max-width: ${TABLET_MIN_WIDTH_PX - 1}px)`;

/** Media query del layout web, usada para la expansión inicial del riel lateral. */
export const WEB_LAYOUT_MEDIA_QUERY = `(min-width: ${WEB_MIN_WIDTH_PX}px)`;
