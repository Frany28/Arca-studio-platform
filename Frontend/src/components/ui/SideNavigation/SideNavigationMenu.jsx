import clsx from "clsx";

import TabItem from "../TabItem/TabItem.jsx";
import Tooltip from "../Tooltip/Tooltip.jsx";
import { SideNavigationItemIcon } from "./SideNavigationIcons.jsx";

/**
 * Presenta los items ya normalizados y filtrados sin reconstruirlos ni gestionar estado.
 * Delega la selección y la limpieza de foco de puntero al componente que lo compone.
 *
 * @param {Object} props Datos y callbacks de presentación del menú.
 * @param {Array<Object>} props.items Items visibles en su orden de navegación.
 * @param {boolean} props.isExpanded Muestra etiquetas o botones con tooltip.
 * @param {string|null} props.activeItemId Identificador de la selección resuelta.
 * @param {string} props.nodeId Identificador de diseño del menú en su modo actual.
 * @param {Function} props.onItemSelect Recibe el item completo seleccionado.
 * @param {Function} props.onPointerFocusClear Limpia el foco al terminar mouse o touch.
 * @returns {import("react").ReactElement} Navegación con la estructura de ambos modos.
 */
export default function SideNavigationMenu({
  items,
  isExpanded,
  activeItemId,
  nodeId,
  onItemSelect,
  onPointerFocusClear,
}) {
  return (
    <nav
      className={clsx(
        "flex flex-col gap-[8px]",
        isExpanded ? "w-full" : "items-start",
      )}
      data-node-id={nodeId}
      aria-label="Secciones"
    >
      {items.map((item) =>
        isExpanded ? (
          <div
            key={item.id}
            className="flex w-full items-center"
            style={{ minHeight: item.wrapperHeight ?? "44px" }}
          >
            <TabItem
              label={item.label}
              size="M"
              style="Brand"
              selected={item.id === activeItemId}
              interactive
              iconLeft={false}
              iconRight={false}
              leftIcon={<SideNavigationItemIcon icon={item.icon} />}
              rightIcon={null}
              className="w-full justify-start"
              aria-label={item.label}
              onClick={() => onItemSelect(item)}
            />
          </div>
        ) : (
          <Tooltip
            key={item.id}
            asChild
            portal
            showTip
            text={item.label}
            tipPosition="Right"
          >
            <button
              type="button"
              className={clsx(
                "inline-flex h-[44px] w-[44px] items-center justify-center rounded-[var(--radius-2)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]",
                item.id === activeItemId
                  ? "bg-[var(--color-neutral-200)] text-[var(--color-text-300)]"
                  : "bg-transparent text-[var(--color-text-100)] hover:bg-[var(--color-neutral-10)] hover:text-[var(--color-text-200)]",
              )}
              aria-label={item.label}
              onClick={() => onItemSelect(item)}
              onMouseUp={onPointerFocusClear}
              onTouchEnd={onPointerFocusClear}
            >
              <SideNavigationItemIcon icon={item.icon} />
            </button>
          </Tooltip>
        ),
      )}

      {items.length === 0 && isExpanded ? (
        <p className="px-[12px] py-[8px] text-body-4 text-[var(--color-text-100)]">
          No hay coincidencias.
        </p>
      ) : null}
    </nav>
  );
}
