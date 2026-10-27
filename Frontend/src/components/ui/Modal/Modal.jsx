import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import Button from "../Button/Button.jsx";
import Checkbox from "../Checkbox.jsx";
import IconContainer from "../IconContainer.jsx";
import ModalOverlay from "./ModalOverlay.jsx";
import {
  MODAL_ALIGNMENTS,
  MODAL_DEFAULT_PROPS,
  MODAL_MOUNTS,
  MODAL_OVERLAY_VARIANTS,
  MODAL_TRANSITION_PRESETS,
} from "./modalConfig.js";

const MODAL_TRANSITION_MS = 320;
const MODAL_EASING = "ease-in-out";

function CloseIcon({ className }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2 2L10 10"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M10 2L2 10"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ModalCloseButton({
  ariaLabel = "Cerrar modal",
  className,
  disabled = false,
  onClick,
}) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex size-9 items-center justify-center rounded-[var(--radius-2)] text-[var(--color-text-100)] transition-colors duration-150 hover:bg-[var(--color-neutral-200)]/40 hover:text-[var(--color-text-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-neutral-100)] disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <CloseIcon className="size-5" />
    </button>
  );
}

function Modal({
  className,
  contentClassName,
  dialogShellClassName: customDialogShellClassName,
  children,
  mount = MODAL_DEFAULT_PROPS.mount,
  visible = MODAL_DEFAULT_PROPS.visible,
  alignment = MODAL_DEFAULT_PROPS.alignment,
  overlayVariant = MODAL_DEFAULT_PROPS.overlayVariant,
  transitionPreset = MODAL_DEFAULT_PROPS.transitionPreset,
  showDialog = MODAL_DEFAULT_PROPS.showDialog,
  title = MODAL_DEFAULT_PROPS.title,
  description = MODAL_DEFAULT_PROPS.description,
  primaryActionLabel = MODAL_DEFAULT_PROPS.primaryActionLabel,
  secondaryActionLabel = MODAL_DEFAULT_PROPS.secondaryActionLabel,
  primaryActionTheme = "Primary",
  secondaryActionTheme = "Primary",
  // Bloquea las acciones del diálogo estándar mientras una confirmación está en curso.
  actionsDisabled = false,
  primaryActionBusy = false,
  // Diálogos informativos con una única acción (p. ej. «Aceptar» tras crear una cotización).
  showSecondaryAction = true,
  checkboxLabel = MODAL_DEFAULT_PROPS.checkboxLabel,
  icon = null,
  showCloseButton = MODAL_DEFAULT_PROPS.showCloseButton,
  onClose,
  onPrimaryAction,
  onSecondaryAction,
  style,
  ...props
}) {
  const [shouldRender, setShouldRender] = useState(visible);
  const [isActive, setIsActive] = useState(false);
  const closeTimeoutRef = useRef(null);
  const frameRef = useRef(null);

  useEffect(() => {
    window.clearTimeout(closeTimeoutRef.current);
    window.cancelAnimationFrame(frameRef.current);
    let cancelled = false;

    if (visible) {
      queueMicrotask(() => {
        if (cancelled) return;

        setIsActive(false);
        setShouldRender(true);
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = window.requestAnimationFrame(() => {
            setIsActive(true);
          });
        });
      });

      return () => {
        cancelled = true;
        window.cancelAnimationFrame(frameRef.current);
      };
    }

    queueMicrotask(() => {
      if (!cancelled) setIsActive(false);
    });
    closeTimeoutRef.current = window.setTimeout(() => {
      setShouldRender(false);
    }, MODAL_TRANSITION_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(closeTimeoutRef.current);
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [visible]);

  useEffect(
    () => () => {
      window.clearTimeout(closeTimeoutRef.current);
      window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  if (!shouldRender) {
    return null;
  }

  const resolvedMount = MODAL_MOUNTS.includes(mount)
    ? mount
    : MODAL_DEFAULT_PROPS.mount;
  const resolvedAlignment = MODAL_ALIGNMENTS.includes(alignment)
    ? alignment
    : MODAL_DEFAULT_PROPS.alignment;
  const resolvedOverlayVariant = MODAL_OVERLAY_VARIANTS.includes(overlayVariant)
    ? overlayVariant
    : MODAL_DEFAULT_PROPS.overlayVariant;
  const resolvedTransitionPreset = MODAL_TRANSITION_PRESETS.includes(
    transitionPreset,
  )
    ? transitionPreset
    : MODAL_DEFAULT_PROPS.transitionPreset;

  const positionClassName =
    resolvedMount === "contained"
      ? "absolute inset-0 size-full"
      : "fixed inset-0 h-dvh w-screen";
  const shouldRenderDialog = showDialog || Boolean(children);
  const isCenteredAlignment = resolvedAlignment === "Centered";
  const isHorizontalSplit = resolvedAlignment === "Horizontal split";
  const dialogAlignmentClassName = isCenteredAlignment
    ? "items-center text-center"
    : "items-start text-left";
  const dialogShellClassName =
    resolvedMount === "contained"
      ? "flex size-full flex-col items-center justify-center"
      : "flex size-full flex-col items-center justify-center pb-[24px]";
  const showDialogCloseButton = showCloseButton && !isHorizontalSplit;
  const contentLayoutClassName = isHorizontalSplit
    ? "flex-row items-start"
    : "flex-col";
  const buttonClassName = isHorizontalSplit
    ? "h-[40px] min-w-0 w-[90px]"
    : "h-[41px] min-w-0 w-auto flex-1";
  const overlayClassName =
    resolvedTransitionPreset === "fade-scale"
      ? clsx("transition-opacity", isActive ? "opacity-100" : "opacity-0")
      : undefined;
  const animatedContentClassName =
    resolvedTransitionPreset === "fade-scale"
      ? clsx(
          "transition-[opacity,transform] transform-gpu will-change-transform will-change-opacity",
          isActive
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-[12px] scale-[0.985] opacity-0",
        )
      : undefined;
  const transitionStyle =
    resolvedTransitionPreset === "fade-scale"
      ? {
          transitionDuration: `${MODAL_TRANSITION_MS}ms`,
          transitionTimingFunction: MODAL_EASING,
        }
      : undefined;

  const modalContent = (
    <div
      className={clsx(positionClassName, "z-50 overflow-hidden", className)}
      style={style}
      {...props}
    >
      <ModalOverlay
        variant={resolvedOverlayVariant}
        onClose={onClose}
        className={overlayClassName}
        style={transitionStyle}
      />

      {shouldRenderDialog ? (
        <div
          className={clsx(
            "relative z-[1]",
            dialogShellClassName,
            customDialogShellClassName,
          )}
        >
          <div
            className={clsx(
              "flex w-full flex-col items-center px-[16px] py-[24px]",
              animatedContentClassName,
              contentClassName,
            )}
            style={transitionStyle}
          >
            {children ?? (
              <div
                className="relative flex w-full max-w-[400px] flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
                onClick={(event) => event.stopPropagation()}
              >
                {showDialogCloseButton ? (
                  <ModalCloseButton
                    className="absolute right-0 top-0"
                    disabled={actionsDisabled}
                    onClick={onClose}
                  />
                ) : null}

                <div
                  className={clsx(
                    "flex w-[400px] max-w-full gap-[16px] px-[16px] pt-[16px] pb-[16px]",
                    contentLayoutClassName,
                    dialogAlignmentClassName,
                  )}
                >
                  <IconContainer size="M" type="Outline" icon={icon} />

                  <div className="flex w-full flex-col gap-[4px] tracking-[-0.5px]">
                    <p className="text-heading-6 text-[var(--color-text-300)]">
                      {title}
                    </p>
                    <p className="text-body-3 text-[var(--color-text-200)]">
                      {description}
                    </p>
                  </div>
                </div>

                <div className="flex w-full items-center gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
                  {isHorizontalSplit ? (
                    <div className="flex h-[17px] w-[168px] items-center gap-[12px]">
                      <Checkbox checked="No" size="S" interactive={false} />
                      <span className="text-body-3 text-[var(--color-text-300)]">
                        {checkboxLabel}
                      </span>
                    </div>
                  ) : null}

                  {showSecondaryAction ? (
                    <Button
                      theme={secondaryActionTheme}
                      type="Outline"
                      size="S"
                      showLeftIcon={false}
                      showRightIcon={false}
                      className={buttonClassName}
                      disabled={actionsDisabled}
                      onClick={onSecondaryAction}
                    >
                      {secondaryActionLabel}
                    </Button>
                  ) : null}

                  <Button
                    theme={primaryActionTheme}
                    type="Solid"
                    size="S"
                    showLeftIcon={false}
                    showRightIcon={false}
                    className={buttonClassName}
                    disabled={actionsDisabled}
                    aria-busy={primaryActionBusy || undefined}
                    onClick={onPrimaryAction}
                  >
                    {primaryActionLabel}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          className={clsx("relative z-[1]", animatedContentClassName)}
          style={transitionStyle}
        >
          {children}
        </div>
      )}
    </div>
  );

  if (resolvedMount === "viewport" && typeof document !== "undefined") {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
}

export { ModalCloseButton };
export default Modal;
