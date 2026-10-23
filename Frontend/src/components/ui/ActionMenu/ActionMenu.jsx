import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { More } from "iconsax-react";

import Button from "../Button/Button.jsx";
import { getActionMenuPosition, getNextActionMenuIndex } from "./actionMenuPosition.js";

// Divisor de ancho completo; role="separator" lo expone dentro del menú sin hacerlo enfocable.
// Como en Figma, la línea se dibuja 1 px hacia arriba y no ocupa altura en el flujo (-mt-px).
function MenuDivider() {
  return <div role="separator" className="-mt-px h-px w-full shrink-0 bg-[var(--color-neutral-200)]" />;
}

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
 * (flechas, Home/End, Tab, Escape), cierre por clic exterior y devolución del foco. Mientras el
 * menú está abierto, el tooltip del disparador no se muestra para no superponerse a él.
 *
 * @param {Object} props - Acciones, textos accesibles y apariencia del disparador.
 * @param {ActionMenuItem[]} props.items - Acciones disponibles.
 * @param {(item: ActionMenuItem) => void} props.onSelect - Recibe la acción elegida tras cerrar el menú.
 * @param {string} props.triggerLabel - Nombre accesible del disparador.
 * @param {string} [props.title] - Encabezado opcional no interactivo del menú.
 * @param {string} [props.menuLabel] - Nombre accesible del menú; usa `title` o `triggerLabel` por defecto.
 * @param {string} [props.tooltip] - Tooltip del disparador.
 * @param {boolean} [props.tooltipOpen] - Apertura controlada del tooltip dentro de una tabla.
 * @param {(open: boolean) => void} [props.onTooltipOpenChange] - Coordina el tooltip con otras capas.
 * @param {(open: boolean) => void} [props.onOpenChange] - Notifica la apertura y el cierre del menú.
 * @param {boolean} [props.disabled=false] - Desactiva el disparador.
 * @param {string} [props.size="S"] - Tamaño del botón disparador.
 * @param {string} [props.type="Ghost"] - Tipo del botón disparador.
 * @param {string} [props.className] - Clases del contenedor del disparador.
 * @param {string} [props.menuWidthClassName="w-[230px]"] - Ancho del menú según su referencia de Figma.
 * @returns {import("react").ReactElement} Disparador y, al abrirse, el menú en portal.
 */
function ActionMenu({
  className,
  disabled = false,
  items,
  menuLabel,
  menuWidthClassName = "w-[230px]",
  onOpenChange,
  onTooltipOpenChange,
  onSelect,
  size = "S",
  title,
  tooltip,
  tooltipOpen,
  triggerLabel,
  type = "Ghost",
}) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const outsideFocusFrameRef = useRef(null);
  const restoringFocusRef = useRef(false);
  // Solo se enfoca la primera acción al abrir con teclado (event.detail === 0);
  // con puntero se evita un foco visible inesperado sobre la primera opción.
  const focusFirstItemOnOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const [internalTooltipOpen, setInternalTooltipOpen] = useState(false);

  /** Cambia la capa activa y descarta el tooltip antes de mover el foco al menú o al disparador. */
  const changeOpen = (nextOpen) => {
    window.cancelAnimationFrame(outsideFocusFrameRef.current);
    setInternalTooltipOpen(false);
    onTooltipOpenChange?.(false);
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  // Los listeners conservan su suscripción mientras el menú está abierto; leen los callbacks
  // actuales para no capturar la selección o el estado de otra capa de un render anterior.
  const changeOpenRef = useRef(changeOpen);
  useLayoutEffect(() => {
    changeOpenRef.current = changeOpen;
  });

  useEffect(() => () => window.cancelAnimationFrame(outsideFocusFrameRef.current), []);

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
      changeOpenRef.current(false);
      // El comportamiento nativo del pointerdown puede quitar el foco devuelto sincrónicamente.
      // Tras pulsar contenido no interactivo se restaura en el siguiente frame; pulsar otro
      // control conserva el foco de ese control. El frame se cancela al desmontar el componente.
      const target = event.target;
      const focusableTarget = target.closest?.('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]');
      if (!focusableTarget) {
        window.cancelAnimationFrame(outsideFocusFrameRef.current);
        outsideFocusFrameRef.current = window.requestAnimationFrame(() => {
          // No roba el foco si otra acción abrió una capa que ya lo capturó.
          if (document.activeElement === document.body || document.activeElement?.contains(target)) {
            restoringFocusRef.current = true;
            triggerRef.current?.querySelector("button")?.focus({ preventScroll: true });
            restoringFocusRef.current = false;
          }
        });
      }
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      // Evita que el Escape también cierre la capa contenedora (drawer o modal),
      // cuyos listeners están en window y reciben el evento después de document.
      event.stopPropagation();
      changeOpenRef.current(false);
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
    changeOpen(!open);
  };

  // Devuelve el foco al disparador antes de notificar, como el patrón WAI-ARIA de menu button;
  // así un diálogo abierto por la acción lo captura y lo restaura al cerrarse.
  const selectItem = (item) => {
    changeOpen(false);
    triggerRef.current?.querySelector("button")?.focus();
    onSelect(item);
  };

  const handleMenuKeyDown = (event) => {
    if (event.key === "Tab") {
      changeOpen(false);
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
          tooltipOpen={!open && (tooltipOpen ?? internalTooltipOpen)}
          onTooltipOpenChange={(nextOpen) => {
            if (nextOpen && (open || restoringFocusRef.current)) return;
            setInternalTooltipOpen(nextOpen);
            onTooltipOpenChange?.(nextOpen);
          }}
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
            className={clsx("fixed z-[var(--z-tooltip)] flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[var(--radius-3)] bg-[var(--color-neutral-bg)] shadow-[inset_0_0_0_var(--stroke-0)_var(--color-neutral-200)]", menuWidthClassName)}
            style={position || { left: 0, top: 0, visibility: "hidden" }}
            onKeyDown={handleMenuKeyDown}
          >
            {/* Geometría del "Dropdown button" de Figma (3470:110120): cada fila es dueña de
                su padding vertical y el divisor cuelga del final de la fila anterior con gap 4.
                El contorno es un ring inset porque Figma dibuja el stroke por dentro (230×167);
                un border CSS sumaría 2 px a cada eje. */}
            {title ? (
              <div className="flex flex-col gap-[4px] py-[2px]" aria-hidden="true">
                <p className="text-heading-8 m-0 flex h-[35px] items-center px-[16px] text-[var(--color-text-200)]">
                  {title}
                </p>
                <MenuDivider />
              </div>
            ) : null}
            <div className="flex flex-col">
              {items.map((item, index) => {
                const ItemIcon = item.icon;
                const isDanger = item.tone === "danger";
                const dividerAfter = Boolean(items[index + 1]?.separated);
                return (
                  <div
                    key={item.id}
                    className={clsx(
                      "flex flex-col gap-[4px]",
                      index === 0 ? "pt-[4px]" : "py-[2px]",
                      index === items.length - 1 && "pb-[2px]",
                    )}
                  >
                    <div className="px-[8px]">
                      <button
                        type="button"
                        role="menuitem"
                        disabled={item.disabled}
                        className={clsx(
                          "text-heading-8 flex h-[36px] w-full items-center gap-[12px] rounded-[var(--radius-2)] px-[8px] text-left transition-colors duration-150 focus:outline-none motion-reduce:transition-none",
                          isDanger ? "text-[var(--color-danger-100)]" : "text-[var(--color-text-200)]",
                          // Figma usa la misma superficie neutral-200 para hover, foco y selección.
                          item.disabled
                            ? "cursor-not-allowed opacity-50"
                            : "hover:bg-[var(--color-neutral-200)] focus-visible:bg-[var(--color-neutral-200)] active:bg-[var(--color-neutral-200)]",
                        )}
                        onClick={() => selectItem(item)}
                      >
                        {ItemIcon ? <ItemIcon size="20" color="currentColor" aria-hidden="true" /> : null}
                        <span className="min-w-0 truncate">{item.label}</span>
                      </button>
                    </div>
                    {dividerAfter ? <MenuDivider /> : null}
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
