/**
 * Rejilla de las secciones pareadas del dashboard (Eventos críticos/Próximas entregas y
 * Actividad reciente/Nuevas Solicitudes). Usa dos columnas solo cuando cada una dispone de
 * 440 px de contenido, como en escritorio (Figma 3727:677367); con el riel expandido o un
 * viewport más estrecho se apilan, como en Figma 3727:678726. Depender del ancho real y no
 * de un breakpoint de viewport evita que las filas partan sus acciones en tablet horizontal.
 * Tailwind necesita el literal completo, por eso se comparte la cadena y no se compone.
 */
export const ADMIN_DASHBOARD_PAIRED_SECTION_GRID_CLASS_NAME =
  "grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))]";
