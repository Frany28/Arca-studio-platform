import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { More } from "iconsax-react";

import Button from "../Button/Button.jsx";
import { getActionMenuPosition, getNextActionMenuIndex } from "./actionMenuPosition.js";

/**
 * @typedef {Object} ActionMenuItem
 * @property {string} id - Identificador estable devuelto en `onSelect`.
 * @property {string} label - Texto visible de la acción.
 * @property {import("react").ComponentType<{size: string, color: string}>} [icon] - Icono Iconsax.
 * @property {"default"|"danger"} [tone="default"] - `danger` para acciones destructivas.
 * @property {boolean} [separated=false] - Dibuja un divisor antes del elemento.
 * @property {boolean} [disabled=false] - Muestra la acción sin permitir seleccionarla.
 */

/**
 * Menú de acciones (patrón "Dropdown button" de Figma) abierto desde un botón de icono.
 * Se monta en un portal para no quedar recortado por drawers con overflow, alinea su borde
 * derecho con el disparador y se abre hacia arriba si no cabe debajo. Gestiona teclado
 * (flechas, Home/End, Tab, Escape), cierre por clic exterior y devolución del foco.
 *
 * @param {Object} props - Acciones, textos accesibles y apariencia del disparador.
 * @param {ActionMenuItem[]} props.items - Acciones disponibles.
 * @param {(item: ActionMenuItem) => void} props.onSelect - Recibe la acción elegida tras cerrar el menú.
 * @param {string} props.triggerLabel - Nombre accesible del disparador.
 * @param {string} [props.title] - Encabezado opcional no interactivo del menú.
 * @param {string} [props.menuLabel] - Nombre accesible del menú; usa `title` o `triggerLabel` por defecto.
 * @param {string} [props.tooltip] - Tooltip del disparador.
 * @param {boolean} [props.disabled=false] - Desactiva el disparador.
 * @param {string} [props.size="S"] - Tamaño del botón disparador.
 * @param {string} [props.type="Ghost"] - Tipo del botón disparador.
 * @param {string} [props.className] - Clases del contenedor del disparador.
 * @returns {import("react").ReactElement} Disparador y, al abrirse, el menú en portal.
 */
function ActionMenu({
  className,
  disabled = false,
  items,
  menuLabel,
  onSelect,
  size = "S",
  title,
  tooltip,
  triggerLabel,
  type = "Ghost",
}) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  // Solo se enfoca la primera acción al abrir con teclado (event.detail === 0);
  // con puntero se evita un foco visible inesperado sobre la primera opción.
  const focusFirstItemOnOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    if (!open) return undefined;

    // Mide el menú ya montado (encabezado y divisores incluidos) antes del paint para
    // decidir si abre arriba o abajo; en la primera apertura se monta oculto sin posición.
    const updatePosition = () => {
      if (!triggerRef.current || !menuRef.current) return;
      setPosition(getActionMenuPosition(
        triggerRef.current.getBoundingClientRect(),
        { height: menuRef.current.offsetHeight, width: menuRef.current.offsetWidth },
        { height: window.innerHeight, width: window.innerWidth },
      ));
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    let focusFrameId;
    const closeOnOutsidePress = (event) => {
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      // Evita que el Escape también cierre la capa contenedora (drawer o modal),
      // cuyos listeners están en window y reciben el evento después de document.
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.querySelector("button")?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    document.addEventListener("keydown", closeOnEscape);
    if (focusFirstItemOnOpenRef.current) {
      focusFrameId = window.requestAnimationFrame(() => {
        menuRef.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
      });
    }
    focusFirstItemOnOpenRef.current = false;

    return () => {
      window.cancelAnimationFrame(focusFrameId);
      document.removeEventListener("pointerdown", closeOnOutsidePress, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const toggleMenu = (event) => {
    focusFirstItemOnOpenRef.current = event.detail === 0;
    setOpen((current) => !current);
  };

  const selectItem = (item) => {
    setOpen(false);
    onSelect(item);
  };

  const handleMenuKeyDown = (event) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const enabledItems = [...menuRef.current.querySelectorAll('[role="menuitem"]:not([disabled])')];
    const nextIndex = getNextActionMenuIndex(
      event.key,
      enabledItems.indexOf(document.activeElement),
      enabledItems.length,
    );
    if (nextIndex < 0) return;

    event.preventDefault();
    enabledItems[nextIndex]?.focus();
  };

  return (
    <>
      <span ref={triggerRef} className={clsx("inline-flex", className)}>
        <Button
          theme="Primary"
          type={type}
          size={size}
          state={open ? "Focused" : "Default"}
          showText={false}
          showLeftIcon
          iconLeft={<More size="20" color="currentColor" />}
          showRightIcon={false}
          disabled={disabled}
          tooltip={tooltip}
          aria-label={triggerLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggleMenu}
        />
      </span>

      {open && typeof document !== "undefined"
        ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={menuLabel || title || triggerLabel}
            className="fixed z-[var(--z-tooltip)] flex w-[230px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-bg)] shadow-[0_8px_24px_rgba(0,0,0,0.24)]"
            style={position || { left: 0, top: 0, visibility: "hidden" }}
            onKeyDown={handleMenuKeyDown}
          >
            {title ? (
              <p className="text-body-3 m-0 border-b border-[var(--color-neutral-200)] px-[16px] py-[12px] text-[var(--color-text-100)]" aria-hidden="true">
                {title}
              </p>
            ) : null}
            <div className="flex flex-col pb-[2px] pt-[4px]">
              {items.map((item) => {
                const ItemIcon = item.icon;
                const isDanger = item.tone === "danger";
                return (
                  <div
                    key={item.id}
                    className={clsx(
                      "px-[8px] py-[2px]",
                      item.separated && "mt-[2px] border-t border-[var(--color-neutral-200)] pt-[4px]",
                    )}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      className={clsx(
                        "text-heading-8 flex h-[36px] w-full items-center gap-[12px] rounded-[var(--radius-2)] px-[8px] text-left transition-colors duration-150 focus:outline-none motion-reduce:transition-none",
                        isDanger ? "text-[var(--color-danger-100)]" : "text-[var(--color-text-200)]",
                        item.disabled
                          ? "cursor-not-allowed opacity-50"
                          : "hover:bg-[var(--color-neutral-200)] focus-visible:bg-[var(--color-neutral-200)]",
                      )}
                      onClick={() => selectItem(item)}
                    >
                      {ItemIcon ? <ItemIcon size="20" color="currentColor" aria-hidden="true" /> : null}
                      <span className="min-w-0 truncate">{item.label}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

export default ActionMenu;
