import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

import Modal from "./Modal/Modal.jsx";

const UNMOUNT_DELAY_MS = 360;
const DRAWER_TRANSITION_MS = 360;
const DRAWER_EASING = "ease-in-out";

function SideOverlayDrawer({
  open = false,
  onClose,
  className,
  panelClassName,
  children,
  side = "right",
  widthClassName = "w-[312px]",
  ariaLabel = "Panel lateral",
  ...props
}) {
  const [shouldRender, setShouldRender] = useState(open);
  const [isActive, setIsActive] = useState(false);
  const closeTimeoutRef = useRef(null);
  const frameRef = useRef(null);
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    window.clearTimeout(closeTimeoutRef.current);
    window.cancelAnimationFrame(frameRef.current);

    if (open) {
      queueMicrotask(() => {
        setIsActive(false);
        setShouldRender(true);
      });
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = window.requestAnimationFrame(() => {
          setIsActive(true);
        });
      });

      return undefined;
    }

    queueMicrotask(() => {
      setIsActive(false);
    });
    closeTimeoutRef.current = window.setTimeout(() => {
      setShouldRender(false);
    }, UNMOUNT_DELAY_MS);

    return () => {
      window.clearTimeout(closeTimeoutRef.current);
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !shouldRender) return undefined;

    if (!previousFocusRef.current) {
      previousFocusRef.current = document.activeElement;
    }
    const focusFrame = window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open, shouldRender]);

  useEffect(() => {
    if (open) return;
    previousFocusRef.current?.focus?.();
    previousFocusRef.current = null;
  }, [open]);

  useEffect(() => () => previousFocusRef.current?.focus?.(), []);

  if (!shouldRender) {
    return null;
  }

  return (
    <Modal
      visible={shouldRender}
      mount="viewport"
      overlayVariant="transparent"
      transitionPreset="none"
      showDialog={false}
      className={clsx("z-50", className)}
      onClick={onClose}
      {...props}
    >
      <div
        className={clsx(
          "absolute inset-0 bg-[rgba(42,41,41,0.10)] transition-opacity",
          isActive ? "opacity-100" : "opacity-0",
        )}
        style={{
          transitionDuration: `${DRAWER_TRANSITION_MS}ms`,
          transitionTimingFunction: DRAWER_EASING,
          backdropFilter: "var(--effect-blur-b1)",
          WebkitBackdropFilter: "var(--effect-blur-b1)",
        }}
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={clsx(
          "absolute bottom-0 top-0 max-w-full overflow-hidden bg-[var(--color-neutral-100)] shadow-[0_0_5px_0_rgba(0,0,0,0.1)] transition-[transform,opacity] transform-gpu will-change-transform will-change-opacity",
          side === "left"
            ? "left-0 rounded-br-[12px] rounded-tr-[12px]"
            : "right-0 rounded-bl-[12px] rounded-tl-[12px]",
          widthClassName,
          isActive
            ? "translate-x-0 opacity-100"
            : side === "left"
              ? "-translate-x-full opacity-0"
              : "translate-x-full opacity-0",
          panelClassName,
        )}
        style={{
          transitionDuration: `${DRAWER_TRANSITION_MS}ms`,
          transitionTimingFunction: DRAWER_EASING,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </aside>
    </Modal>
  );
}

export default SideOverlayDrawer;
