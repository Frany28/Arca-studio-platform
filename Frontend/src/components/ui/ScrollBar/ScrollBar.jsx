/* Renderiza un scrollbar visual o interactivo y sincroniza su posición mediante callbacks. */
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { SCROLL_BAR_DEFAULT_PROPS } from "./scrollBarConfig.js";

// Limita valores numéricos al rango permitido del scrollbar.
function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

// Calcula tamaño y posición del thumb y gestiona el arrastre cuando es interactivo.
function ScrollBar({
  "aria-label": ariaLabel = "Control de desplazamiento",
  className,
  trackContainerClassName,
  length = SCROLL_BAR_DEFAULT_PROPS.length,
  position = SCROLL_BAR_DEFAULT_PROPS.position,
  height = SCROLL_BAR_DEFAULT_PROPS.height,
  width = SCROLL_BAR_DEFAULT_PROPS.width,
  orientation = SCROLL_BAR_DEFAULT_PROPS.orientation,
  interactive = SCROLL_BAR_DEFAULT_PROPS.interactive,
  minThumbSize = SCROLL_BAR_DEFAULT_PROPS.minThumbSize,
  onPositionChange,
  ...props
}) {
  const trackRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(null);
  const isHorizontal = orientation === "horizontal";
  const resolvedLength = clamp(length);
  const resolvedPosition = clamp(position);
  const trackLength = isHorizontal ? width : height;
  const innerLength = Math.max(trackLength - 8, 0);
  const thumbLength = Math.min(
    innerLength,
    Math.max(innerLength * resolvedLength, minThumbSize),
  );
  const thumbTravel = Math.max(innerLength - thumbLength, 0);
  const thumbPosition = thumbTravel * resolvedPosition;

  // Convierte la posición del puntero en un valor normalizado entre 0 y 1.
  const getNextPosition = useCallback(
    (pointerPosition, offset = thumbLength / 2) => {
      const rect = trackRef.current?.getBoundingClientRect();

      if (!rect) {
        return resolvedPosition;
      }

      const trackStart = isHorizontal ? rect.left : rect.top;
      const next =
        (pointerPosition - trackStart - offset) / Math.max(thumbTravel, 1);
      return clamp(next);
    },
    [isHorizontal, resolvedPosition, thumbLength, thumbTravel],
  );

  // Inicia el arrastre del thumb conservando el offset exacto del puntero.
  function beginDrag(event) {
    if (!interactive) {
      return;
    }

    event.preventDefault();
    const rect = trackRef.current?.getBoundingClientRect();
    const pointerPosition = isHorizontal ? event.clientX : event.clientY;
    const trackStart = rect ? (isHorizontal ? rect.left : rect.top) : 0;
    const currentThumbStart = trackStart + thumbPosition;
    const nextOffset = clamp(
      pointerPosition - currentThumbStart,
      0,
      Math.max(thumbLength, 0),
    );

    setDragOffset(nextOffset);
    onPositionChange?.(getNextPosition(pointerPosition, nextOffset));
  }

  useEffect(() => {
    if (dragOffset == null) {
      return undefined;
    }

    function handlePointerMove(event) {
      const pointerPosition = isHorizontal ? event.clientX : event.clientY;
      onPositionChange?.(getNextPosition(pointerPosition, dragOffset));
    }

    function handlePointerUp() {
      setDragOffset(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragOffset, getNextPosition, isHorizontal, onPositionChange]);

  return (
    <div
      className={clsx("inline-flex items-start", className)}
      {...props}
    >
      <div
        className={clsx(
          "flex items-start rounded-[var(--radius-2)] bg-[var(--color-neutral-100)] p-[4px]",
          trackContainerClassName,
        )}
        style={
          isHorizontal
            ? { height: "16px", width: `${width}px` }
            : { height: `${height}px`, width: "16px" }
        }
      >
        <div
          ref={trackRef}
          className={clsx(
            "relative min-h-px min-w-px flex-1 rounded-[var(--radius-2)] bg-transparent",
            isHorizontal ? "h-full w-full" : "h-full",
            interactive && "cursor-pointer",
          )}
          role={interactive ? "scrollbar" : undefined}
          aria-label={interactive ? ariaLabel : undefined}
          aria-orientation={interactive ? orientation : undefined}
          aria-valuemin={interactive ? 0 : undefined}
          aria-valuemax={interactive ? 100 : undefined}
          aria-valuenow={interactive ? Math.round(resolvedPosition * 100) : undefined}
          onPointerDown={beginDrag}
        >
          <div
            className={clsx(
              "absolute rounded-[999px] bg-[var(--color-neutral-300)] duration-150",
              isHorizontal
                ? "top-1/2 h-[8px] -translate-y-1/2 transition-[left,width]"
                : "left-1/2 w-[8px] -translate-x-1/2 transition-[top,height]",
              interactive && "cursor-grab active:cursor-grabbing",
            )}
            style={
              isHorizontal
                ? { left: `${thumbPosition}px`, width: `${thumbLength}px` }
                : { top: `${thumbPosition}px`, height: `${thumbLength}px` }
            }
          />
        </div>
      </div>
    </div>
  );
}

export default ScrollBar;
