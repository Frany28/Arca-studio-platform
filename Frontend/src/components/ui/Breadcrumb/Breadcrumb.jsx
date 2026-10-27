import { ArrowRight2 } from "iconsax-react";
import { Link } from "react-router-dom";

/**
 * Ruta de navegación (Figma «Breadcrumb», 5790:341551): bloques Headings/h7 con 8 × 4 px de
 * padding y radio de 8 px separados por una flecha de 14 px. Los niveles anteriores son enlaces
 * (`text-200`); el actual va resaltado con `neutral-200`, `text-300` y `aria-current="page"`.
 *
 * @param {Object} props - Niveles de la ruta.
 * @param {Array<{label: string, to?: string}>} props.items - Niveles en orden; el último es el actual.
 * @param {string} [props.className] - Clases del contenedor.
 * @returns {import("react").ReactElement} Navegación de migas.
 */
function Breadcrumb({ className, items }) {
  return (
    <nav aria-label="Ruta de navegación" className={className}>
      <ol className="flex flex-wrap items-center gap-[8px]">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-[8px]">
              {index > 0 ? (
                <span className="flex w-[22px] items-center justify-center p-[4px] text-[var(--color-text-200)]" aria-hidden="true">
                  <ArrowRight2 size="14" color="currentColor" />
                </span>
              ) : null}
              {current || !item.to ? (
                <span
                  aria-current={current ? "page" : undefined}
                  className={current
                    ? "text-heading-7 rounded-[var(--radius-2)] bg-[var(--color-neutral-200)] px-[8px] py-[4px] text-[var(--color-text-300)]"
                    : "text-heading-7 px-[8px] py-[4px] text-[var(--color-text-200)]"}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.to}
                  className="text-heading-7 rounded-[var(--radius-2)] px-[8px] py-[4px] text-[var(--color-text-200)] transition-colors duration-150 hover:bg-[var(--color-neutral-200)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)] motion-reduce:transition-none"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default Breadcrumb;
