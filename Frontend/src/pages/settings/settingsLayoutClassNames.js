/**
 * Clases responsive compartidas por los paneles de Configuraciones. Desde 768 px se
 * conserva la composición de escritorio (filas de 664 px y campos de 320 px); en móvil
 * cada fila pasa a una columna y los campos ocupan el ancho disponible para evitar
 * desplazamiento horizontal, según las reglas responsive de DESIGN_SYSTEM.md.
 * Los `!` superan los anchos fijos que los componentes compartidos aplican por defecto.
 */
export const SETTINGS_MOBILE_ROW_CLASS_NAME =
  "max-[767px]:flex-col max-[767px]:gap-[16px]";

export const SETTINGS_MOBILE_FIELD_CLASS_NAME =
  "max-[767px]:!w-full max-[767px]:!min-w-0 max-[767px]:!max-w-full";

/** Columnas vacías que solo alinean la rejilla de escritorio. */
export const SETTINGS_MOBILE_SPACER_CLASS_NAME = "max-[767px]:hidden";
