import { forwardRef } from "react";
import clsx from "clsx";
import Tooltip from "../../../../components/ui/Tooltip/Tooltip.jsx";

const MIN_ZOOM = 75;
const MAX_ZOOM = 200;
const ZOOM_STEP = 25;

const ViewerButton = forwardRef(function ViewerButton(
  {
    children,
    className,
    disabled,
    label,
    onClick,
    showTooltip = true,
    tooltipPosition = "Top center",
  },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      className={clsx(
        "flex size-[22px] items-center justify-center rounded-[var(--radius-1)] text-[12px] text-[var(--color-neutral-100-uniform)] transition-colors hover:bg-black/25 disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );

  return showTooltip ? (
    <Tooltip
      asChild
      portal
      showTip
      text={label}
      tipPosition={tooltipPosition}
    >
      {button}
    </Tooltip>
  ) : (
    button
  );
});

function ExpandIcon({ contracted = false }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="size-[14px]" aria-hidden="true">
      {contracted ? (
        <>
          <path d="M8 3V8H3M12 17V12H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3.5 7.5L8 3M16.5 12.5L12 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M7 3H3V7M13 17H17V13M17 7V3H13M3 13V17H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3.5 6.5L7 3M13 17L16.5 13.5M13 3L16.5 6.5M3.5 13.5L7 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="size-[14px]" aria-hidden="true">
      <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PdfToolbar({
  expandButtonRef,
  fullscreen = false,
  onClose,
  onExpand,
  page,
  pageCount,
  updatePage,
  updateZoom,
  zoom,
}) {
  return (
    <div className="flex h-[34px] shrink-0 items-center justify-center overflow-x-auto bg-[#333] px-[12px] text-[10px] text-[var(--color-neutral-100-uniform)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-[8px]">
        <input
          type="number"
          min="1"
          max={pageCount}
          value={page}
          aria-label="Página actual"
          onChange={(event) => updatePage(event.target.value)}
          className="h-[18px] w-[30px] rounded-[2px] bg-[#111] px-[4px] text-center outline-none"
        />
        <span>/</span>
        <span>{pageCount}</span>
        <span className="mx-[4px] text-[var(--color-neutral-300)]">|</span>
        <ViewerButton label="Alejar" disabled={zoom <= MIN_ZOOM} onClick={() => updateZoom(zoom - ZOOM_STEP)}>−</ViewerButton>
        <span className="min-w-[42px] rounded-[2px] bg-[#111] px-[4px] py-[2px] text-center">{zoom}%</span>
        <ViewerButton label="Acercar" disabled={zoom >= MAX_ZOOM} onClick={() => updateZoom(zoom + ZOOM_STEP)}>+</ViewerButton>
        <span className="mx-[4px] text-[var(--color-neutral-300)]">|</span>

        {fullscreen ? (
          <ViewerButton
            label="Contraer visor"
            onClick={onClose}
            tooltipPosition="Bottom center"
          >
            <ExpandIcon contracted />
          </ViewerButton>
        ) : (
          <ViewerButton
            ref={expandButtonRef}
            label="Ver en pantalla completa"
            onClick={onExpand}
          >
            <ExpandIcon />
          </ViewerButton>
        )}

        {fullscreen ? (
          <ViewerButton
            label="Cerrar visor"
            onClick={onClose}
            showTooltip={false}
            tooltipPosition="Bottom center"
          >
            <CloseIcon />
          </ViewerButton>
        ) : null}
      </div>
    </div>
  );
}

export { PdfToolbar, ViewerButton, ExpandIcon, CloseIcon, MIN_ZOOM, MAX_ZOOM };
