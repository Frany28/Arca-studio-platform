import clsx from "clsx";

import useMobileLayout from "../hooks/useMobileLayout.js";

/**
 * Título principal de las vistas administrativas con la escala de Figma: Headings/h4
 * (24 px) en móvil y Headings/h3 (48 px) desde tablet. La escala se elige por clase
 * porque las clases de typography.css ganan a cualquier utilidad responsive de Tailwind.
 *
 * @param {Object} props Contenido e identificador del título.
 * @param {string} props.id Identificador usado por `aria-labelledby` de la sección.
 * @param {import("react").ReactNode} props.children Texto del título.
 * @returns {import("react").ReactElement} Encabezado h1 de la vista.
 */
function AdminPageTitle({ id, children }) {
  const isMobileLayout = useMobileLayout();

  return (
    <h1
      id={id}
      className={clsx(
        isMobileLayout ? "text-heading-4" : "text-heading-3",
        "m-0 text-[var(--color-text-50)]",
      )}
    >
      {children}
    </h1>
  );
}

export default AdminPageTitle;
