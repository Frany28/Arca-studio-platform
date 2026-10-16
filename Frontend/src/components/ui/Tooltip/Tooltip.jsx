/* Renderiza tooltips inline o en portal con posicionamiento adaptativo y soporte de mouse, teclado y táctil. */
import {
  cloneElement,
  isValidElement,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { TOOLTIP_DEFAULT_PROPS, TOOLTIP_POSITIONS } from "./tooltipConfig.js";
import { getTooltipPlacement, getTooltipSide } from "./tooltipPosition.js";

const TOUCH_LONG_PRESS_MS = 550;
const TOUCH_TOOLTIP_DISMISS_MS = 1200;
const TOUCH_MOUSE_SUPPRESSION_MS = 1000;
const TOUCH_MOVE_TOLERANCE_PX = 10;

const TOOLTIP_NODE_IDS = {
  base: "2061:19961",
  withSubtext: "2061:19975",
  withTip: "2061:19968",
  main: "2061:19982",
  positions: {
    Right: "2061:25049",
    Left: "2061:25055",
    "Top center": "2061:25061",
    "Top right": "2061:25067",
    "Top left": "2061:25073",
    "Bottom center": "2061:25079",
    "Bottom right": "2061:25085",
    "Bottom left": "2061:25091",
  },
};

const TOOLTIP_TAIL_CLASSNAMES = {
  Right: "left-[-10px] top-1/2 -translate-y-1/2",
  Left: "right-[-10px] top-1/2 -translate-y-1/2",
  "Top center": "left-1/2 bottom-[-8.512px] -translate-x-1/2",
  "Top right": "right-[6px] bottom-[-8.512px]",
  "Top left": "left-[6px] bottom-[-8.512px]",
  "Bottom center": "left-1/2 top-[-8.512px] -translate-x-1/2",
  "Bottom right": "right-[6px] top-[-8.512px]",
  "Bottom left": "left-[6px] top-[-8.512px]",
};

// Borde de la burbuja en el que se apoya la flecha cuando el portal calcula su desplazamiento;
// el eje restante se fija con `arrowOffset` para que la punta siga al centro del ancla.
const TOOLTIP_TAIL_SIDE_CLASSNAMES = {
  Right: "left-[-10px] -translate-y-1/2",
  Left: "right-[-10px] -translate-y-1/2",
  Top: "bottom-[-8.512px] -translate-x-1/2",
  Bottom: "top-[-8.512px] -translate-x-1/2",
};

const TOOLTIP_BUBBLE_CLASSNAMES = {
  Right: "left-full ml-[12px] top-1/2 -translate-y-1/2",
  Left: "right-full mr-[12px] top-1/2 -translate-y-1/2",
  "Top center": "bottom-full left-1/2 mb-[12px] -translate-x-1/2",
  "Top right": "bottom-full right-0 mb-[12px]",
  "Top left": "bottom-full left-0 mb-[12px]",
  "Bottom center": "left-1/2 top-full mt-[12px] -translate-x-1/2",
  "Bottom right": "right-0 top-full mt-[12px]",
  "Bottom left": "left-0 top-full mt-[12px]",
};

const TOOLTIP_TAIL_TRANSFORMS = {
  Right: "-rotate-90",
  Left: "rotate-90",
  "Top center": "-scale-y-100",
  "Top right": "-scale-y-100",
  "Top left": "-scale-y-100",
  "Bottom center": "",
  "Bottom right": "",
  "Bottom left": "",
};

// Renderiza la flecha visual del tooltip según su orientación.
function TooltipTail({ tipPosition }) {
  return (
    <span
      className={clsx(
        "inline-flex h-[16px] w-[20px] items-center justify-center",
        TOOLTIP_TAIL_TRANSFORMS[tipPosition],
      )}
    >
      <svg
        viewBox="0 0 20 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-[16px] w-[20px] drop-shadow-[0_0_5px_rgba(0,0,0,0.10)]"
        aria-hidden="true"
      >
        <path
          d="M10.7832 2.54004C10.1845 1.71045 8.94831 1.71045 8.34961 2.54004L3.59961 9.12207C2.88366 10.1141 3.59299 11.5 4.81641 11.5L14.3164 11.5C15.5398 11.5 16.2492 10.1141 15.5332 9.12207L10.7832 2.54004Z"
          fill="var(--color-neutral-100)"
          stroke="var(--color-neutral-200)"
        />
        <rect
          width="16.5612"
          height="4.91549"
          transform="matrix(1 0 0 -1 1.71875 13.4258)"
          fill="var(--color-neutral-100)"
        />
      </svg>
    </span>
  );
}

// Valida la posición solicitada y aplica la posición por defecto si es inválida.
function getResolvedPosition(tipPosition) {
  return TOOLTIP_POSITIONS.includes(tipPosition)
    ? tipPosition
    : TOOLTIP_DEFAULT_PROPS.tipPosition;
}

// Detecta si el dispositivo admite interacción real por hover con puntero preciso.
function supportsHoverTooltip() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }

  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

// Selecciona la referencia visual de Figma según contenido, flecha y posición.
function getResolvedNodeId({ tipPosition, showSubtext, showTip }) {
  if (showSubtext && showTip && tipPosition === "Bottom center") {
    return TOOLTIP_NODE_IDS.main;
  }

  if (showSubtext) {
    return TOOLTIP_NODE_IDS.withSubtext;
  }

  if (showTip) {
    return TOOLTIP_NODE_IDS.positions[tipPosition] ?? TOOLTIP_NODE_IDS.withTip;
  }

  return TOOLTIP_NODE_IDS.base;
}

/**
 * Elige el nodo donde se monta el portal del tooltip.
 * Con un elemento en pantalla completa solo se pinta su subárbol (top layer), así que el tooltip
 * de un ancla contenida en él debe montarse dentro; en otro caso usa la capa global del body.
 *
 * @param {Element} anchor Elemento que abrió el tooltip.
 * @returns {Element} Contenedor del portal.
 */
function getTooltipPortalContainer(anchor) {
  const fullscreenElement = document.fullscreenElement;

  return fullscreenElement?.contains(anchor) ? fullscreenElement : document.body;
}

/**
 * Compara dos colocaciones para descartar actualizaciones de estado que no cambian nada.
 * Evita re-renderizados en cadena al recalcular la posición en cada render abierto.
 *
 * @param {object|null} current Colocación vigente.
 * @param {object} next Colocación recién calculada.
 * @returns {boolean} true si ambas producen el mismo resultado visual.
 */
function isSamePortalPlacement(current, next) {
  return Boolean(current) &&
    current.container === next.container &&
    current.position === next.position &&
    current.left === next.left &&
    current.top === next.top &&
    current.arrowOffset === next.arrowOffset;
}

/**
 * Obtiene la clase y el estilo que colocan la flecha en la burbuja.
 * Con `arrowOffset` (portal posicionado) la flecha se apoya en el borde del lado y se desplaza
 * hasta el centro del ancla; sin él conserva las posiciones fijas del diseño (inline y showcase).
 *
 * @param {string} tipPosition Posición resuelta del tooltip.
 * @param {number} [arrowOffset] Centro de la flecha desde el borde izquierdo o superior de la burbuja.
 * @returns {{ className: string, style: object|undefined }} Colocación de la flecha.
 */
function getTailPlacement(tipPosition, arrowOffset) {
  if (typeof arrowOffset !== "number") {
    return { className: TOOLTIP_TAIL_CLASSNAMES[tipPosition], style: undefined };
  }

  const side = getTooltipSide(tipPosition);
  const isVerticalSide = side === "Top" || side === "Bottom";

  return {
    className: TOOLTIP_TAIL_SIDE_CLASSNAMES[side],
    style: isVerticalSide ? { left: arrowOffset } : { top: arrowOffset },
  };
}

// Renderiza el contenido visual del tooltip y su flecha opcional.
function TooltipBubble({
  arrowOffset,
  className,
  content,
  text,
  subtext,
  showSubtext,
  showTip,
  tipPosition,
  tooltipId,
  ...props
}) {
  const resolvedPosition = getResolvedPosition(tipPosition);
  const tailPlacement = getTailPlacement(resolvedPosition, arrowOffset);

  return (
    <div
      id={tooltipId}
      role="tooltip"
      className={clsx(
        "relative flex w-max max-w-[calc(100vw-16px)] flex-col items-start gap-[2px] rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[8px] shadow-[var(--shadow-e2)] transition-colors duration-200",
        className,
      )}
      data-node-id={getResolvedNodeId({
        tipPosition: resolvedPosition,
        showSubtext,
        showTip,
      })}
      {...props}
    >
      {content ? (
        content
      ) : (
        <>
          <p className="w-full max-w-full break-words text-heading-8 text-[var(--color-text-200)]">
            {text}
          </p>

          {showSubtext ? (
            <p className="w-full text-body-4 text-[var(--color-text-100)]">
              {subtext}
            </p>
          ) : null}
        </>
      )}

      {showTip ? (
        <span
          className={clsx(
            "absolute inline-flex h-[16px] w-[20px] items-center justify-center",
            tailPlacement.className,
          )}
          style={tailPlacement.style}
          aria-hidden="true"
        >
          <TooltipTail tipPosition={resolvedPosition} />
        </span>
      ) : null}
    </div>
  );
}

// Coordina apertura, portal, reposicionamiento, accesibilidad y eventos de interacción.
function Tooltip({
  asChild = false,
  className,
  content,
  text = TOOLTIP_DEFAULT_PROPS.text,
  subtext = TOOLTIP_DEFAULT_PROPS.subtext,
  showSubtext = TOOLTIP_DEFAULT_PROPS.showSubtext,
  showTip = TOOLTIP_DEFAULT_PROPS.showTip,
  tipPosition = TOOLTIP_DEFAULT_PROPS.tipPosition,
  open = TOOLTIP_DEFAULT_PROPS.open,
  defaultOpen = TOOLTIP_DEFAULT_PROPS.defaultOpen,
  children,
  onOpenChange,
  portal = TOOLTIP_DEFAULT_PROPS.portal,
  "aria-label": ariaLabel = TOOLTIP_DEFAULT_PROPS["aria-label"],
  ...props
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [portalPlacement, setPortalPlacement] = useState(null);
  const anchorRef = useRef(null);
  const portalRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const dismissTimerRef = useRef(null);
  const touchSuppressionTimerRef = useRef(null);
  const touchStartPointRef = useRef(null);
  const suppressMouseRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const longPressOpenedRef = useRef(false);
  const tooltipId = useId();
  const isOpenControlled = typeof open === "boolean";
  const resolvedOpen = isOpenControlled ? open : internalOpen;
  const resolvedPosition = getResolvedPosition(tipPosition);
  const childRef = asChild && isValidElement(children)
    ? children.props.ref
    : null;

  useImperativeHandle(childRef, () => anchorRef.current);

  useEffect(
    () => () => {
      window.clearTimeout(longPressTimerRef.current);
      window.clearTimeout(dismissTimerRef.current);
      window.clearTimeout(touchSuppressionTimerRef.current);
    },
    [],
  );

  /**
   * Mide el ancla y la burbuja montada en el portal y guarda la colocación final en un solo paso.
   * El tamaño de la burbuja no depende de su posición (`w-max` con ancho máximo del viewport),
   * por lo que una única medición basta y el lado se recalcula siempre desde la preferencia,
   * sin depender del lado anterior: no hay ciclos de reposicionamiento.
   */
  const syncPortalPlacement = useEffectEvent(() => {
    if (!portal || !resolvedOpen) {
      // Al cerrar se descarta la colocación para que la próxima apertura vuelva a medir.
      if (portalPlacement) setPortalPlacement(null);
      return;
    }

    const anchor = anchorRef.current;
    const portalNode = portalRef.current;

    if (!anchor?.isConnected || !portalNode) {
      return;
    }

    const bubbleRect = portalNode.getBoundingClientRect();
    const nextPlacement = {
      container: getTooltipPortalContainer(anchor),
      ...getTooltipPlacement({
        anchorRect: anchor.getBoundingClientRect(),
        preferredPosition: resolvedPosition,
        tooltipHeight: bubbleRect.height,
        tooltipWidth: bubbleRect.width,
        viewportHeight: window.innerHeight,
        viewportWidth: document.documentElement.clientWidth || window.innerWidth,
      }),
    };

    setPortalPlacement((current) =>
      isSamePortalPlacement(current, nextPlacement) ? current : nextPlacement,
    );
  });

  // Recalcula tras cada render (antes de pintar) para seguir anclas que se mueven, cambios de
  // texto y el primer montaje oculto; la comparación de colocaciones corta el ciclo.
  useLayoutEffect(() => {
    syncPortalPlacement();
  });

  useEffect(() => {
    if (!portal || !resolvedOpen) {
      return undefined;
    }

    const handleLayoutChange = () => syncPortalPlacement();

    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    document.addEventListener("fullscreenchange", handleLayoutChange);

    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
      document.removeEventListener("fullscreenchange", handleLayoutChange);
    };
  }, [portal, resolvedOpen]);

  // Actualiza el estado abierto respetando modo controlado o interno.
  const setTooltipOpen = (nextOpen) => {
    if (!isOpenControlled) {
      setInternalOpen(nextOpen);
    }

    onOpenChange?.(nextOpen);
  };

  // Cancela la detección pendiente de pulsación larga en dispositivos táctiles.
  const clearLongPressTimer = () => {
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  // Evita eventos de mouse sintéticos después de una interacción táctil.
  const suppressTouchGeneratedEvents = () => {
    suppressMouseRef.current = true;
    window.clearTimeout(touchSuppressionTimerRef.current);
    touchSuppressionTimerRef.current = window.setTimeout(() => {
      suppressMouseRef.current = false;
    }, TOUCH_MOUSE_SUPPRESSION_MS);
  };

  // Inicia la detección de long press para mostrar el tooltip en touch.
  const handleTouchPointerDown = (event) => {
    if (event.pointerType !== "touch") {
      return;
    }

    clearLongPressTimer();
    window.clearTimeout(dismissTimerRef.current);
    suppressTouchGeneratedEvents();
    suppressNextClickRef.current = false;
    longPressOpenedRef.current = false;
    touchStartPointRef.current = {
      x: event.clientX,
      y: event.clientY,
    };

    longPressTimerRef.current = window.setTimeout(() => {
      longPressOpenedRef.current = true;
      suppressNextClickRef.current = true;
      setTooltipOpen(true);
    }, TOUCH_LONG_PRESS_MS);
  };

  // Cancela el long press si el dedo se desplaza más allá de la tolerancia.
  const handleTouchPointerMove = (event) => {
    if (event.pointerType !== "touch" || !touchStartPointRef.current) {
      return;
    }

    const horizontalDistance = Math.abs(
      event.clientX - touchStartPointRef.current.x,
    );
    const verticalDistance = Math.abs(
      event.clientY - touchStartPointRef.current.y,
    );

    if (
      horizontalDistance > TOUCH_MOVE_TOLERANCE_PX ||
      verticalDistance > TOUCH_MOVE_TOLERANCE_PX
    ) {
      clearLongPressTimer();
      touchStartPointRef.current = null;
    }
  };

  // Cierra o programa el cierre del tooltip al finalizar la interacción táctil.
  const handleTouchPointerEnd = (event) => {
    if (event.pointerType !== "touch") {
      return;
    }

    clearLongPressTimer();
    touchStartPointRef.current = null;
    suppressTouchGeneratedEvents();

    if (!longPressOpenedRef.current) {
      setTooltipOpen(false);
      return;
    }

    window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(() => {
      setTooltipOpen(false);
      longPressOpenedRef.current = false;
    }, TOUCH_TOOLTIP_DISMISS_MS);
  };

  // Abre el tooltip por hover cuando el dispositivo lo soporta.
  const handleMouseEnter = (event) => {
    const originatedFromTouch =
      event.nativeEvent?.sourceCapabilities?.firesTouchEvents;

    if (
      originatedFromTouch ||
      suppressMouseRef.current ||
      !supportsHoverTooltip()
    ) {
      return;
    }

    setTooltipOpen(true);
  };

  // Abre el tooltip con foco visible para navegación por teclado.
  const handleFocus = (event) => {
    if (suppressMouseRef.current || !supportsHoverTooltip()) {
      return;
    }

    const focusTarget = event.target?.matches ? event.target : event.currentTarget;

    if (focusTarget.matches(":focus-visible")) {
      setTooltipOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (suppressMouseRef.current) {
      return;
    }

    setTooltipOpen(false);
  };

  const handleBlur = (event) => {
    if (
      suppressMouseRef.current ||
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }

    setTooltipOpen(false);
  };

  // Suprime el click generado por un long press para evitar acciones accidentales.
  const handleLongPressClick = (event, childClickHandler) => {
    if (suppressNextClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextClickRef.current = false;
      return;
    }

    childClickHandler?.(event);
  };

  // Evita el menú contextual nativo mientras se procesa una interacción táctil.
  const handleTouchContextMenu = (event, childContextMenuHandler) => {
    if (suppressMouseRef.current) {
      event.preventDefault();
      return;
    }

    childContextMenuHandler?.(event);
  };

  // El primer render abierto monta la burbuja oculta en el origen para medirla; la colocación
  // se aplica en el layout effect antes de pintar, por lo que no hay saltos visibles.
  const portalTooltip =
    resolvedOpen && portal && typeof document !== "undefined"
      ? createPortal(
          <span
            ref={portalRef}
            className="pointer-events-none fixed z-[var(--z-tooltip)]"
            style={
              portalPlacement
                ? { left: portalPlacement.left, top: portalPlacement.top }
                : { left: 0, top: 0, visibility: "hidden" }
            }
          >
            <TooltipBubble
              arrowOffset={portalPlacement?.arrowOffset}
              className={className}
              content={content}
              text={text}
              subtext={subtext}
              showSubtext={showSubtext}
              showTip={showTip}
              tipPosition={portalPlacement?.position ?? resolvedPosition}
              tooltipId={tooltipId}
              aria-label={ariaLabel}
              {...props}
            />
          </span>,
          portalPlacement?.container ?? document.body,
        )
      : null;

  const inlineTooltip =
    resolvedOpen && !portal ? (
      <span
        className={clsx(
          "pointer-events-none absolute z-20",
          TOOLTIP_BUBBLE_CLASSNAMES[resolvedPosition],
        )}
      >
        <TooltipBubble
          className={className}
          content={content}
          text={text}
          subtext={subtext}
          showSubtext={showSubtext}
          showTip={showTip}
          tipPosition={resolvedPosition}
          tooltipId={tooltipId}
          aria-label={ariaLabel}
          {...props}
        />
      </span>
    ) : null;

  if (!children) {
    return (
      <TooltipBubble
        className={className}
        content={content}
        text={text}
        subtext={subtext}
        showSubtext={showSubtext}
        showTip={showTip}
        tipPosition={resolvedPosition}
        tooltipId={tooltipId}
        aria-label={ariaLabel}
        {...props}
      />
    );
  }

  if (asChild && isValidElement(children)) {
    const childDescription = children.props["aria-describedby"];
    const mergeHandler = (childHandler, tooltipHandler) => (event) => {
      childHandler?.(event);
      tooltipHandler(event);
    };
    // cloneElement installs handlers that access refs only after user events.
    /* eslint-disable react-hooks/refs */
    const mergedChild = cloneElement(children, {
      ref: (node) => {
        anchorRef.current = node;
      },
      "aria-describedby": [
        childDescription,
        resolvedOpen ? tooltipId : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
      onBlur: mergeHandler(children.props.onBlur, handleBlur),
      onClick: (event) => handleLongPressClick(event, children.props.onClick),
      onContextMenu: (event) =>
        handleTouchContextMenu(event, children.props.onContextMenu),
      onFocus: mergeHandler(children.props.onFocus, handleFocus),
      onMouseEnter: mergeHandler(children.props.onMouseEnter, handleMouseEnter),
      onMouseLeave: mergeHandler(children.props.onMouseLeave, handleMouseLeave),
      onPointerCancel: mergeHandler(
        children.props.onPointerCancel,
        handleTouchPointerEnd,
      ),
      onPointerDown: mergeHandler(
        children.props.onPointerDown,
        handleTouchPointerDown,
      ),
      onPointerMove: mergeHandler(
        children.props.onPointerMove,
        handleTouchPointerMove,
      ),
      onPointerUp: mergeHandler(
        children.props.onPointerUp,
        handleTouchPointerEnd,
      ),
    });
    /* eslint-enable react-hooks/refs */

    return (
      <>
        {mergedChild}
        {portalTooltip}
        {inlineTooltip}
      </>
    );
  }

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex"
      onClickCapture={(event) => handleLongPressClick(event)}
      onContextMenu={(event) => handleTouchContextMenu(event)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={handleFocus}
      onBlurCapture={handleBlur}
      onPointerCancel={handleTouchPointerEnd}
      onPointerDown={handleTouchPointerDown}
      onPointerMove={handleTouchPointerMove}
      onPointerUp={handleTouchPointerEnd}
    >
      <span aria-describedby={resolvedOpen ? tooltipId : undefined}>
        {children}
      </span>

      {portalTooltip}
      {inlineTooltip}
    </span>
  );
}

export default Tooltip;
