import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

const MODAL_TRANSITION_MS = 320;
const MODAL_EASING = "ease-in-out";

function DocumentFullscreenModal({ children, documentName, onClose, triggerRef, visible }) {
  const [shouldRender, setShouldRender] = useState(visible);
  const [isActive, setIsActive] = useState(false);
  const closeTimeoutRef = useRef(null);
  const frameRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    window.clearTimeout(closeTimeoutRef.current);
    window.cancelAnimationFrame(frameRef.current);

    if (visible) {
      queueMicrotask(() => {
        if (cancelled) return;
        setShouldRender(true);
        setIsActive(false);
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = window.requestAnimationFrame(() => setIsActive(true));
        });
      });
    } else {
      queueMicrotask(() => {
        if (cancelled) return;
        setIsActive(false);
        closeTimeoutRef.current = window.setTimeout(() => {
          setShouldRender(false);
          triggerRef.current?.focus();
        }, MODAL_TRANSITION_MS);
      });
    }

    return () => {
      cancelled = true;
      window.clearTimeout(closeTimeoutRef.current);
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [triggerRef, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, visible]);

  if (!shouldRender || typeof document === "undefined") return null;

  const transitionStyle = {
    transitionDuration: `${MODAL_TRANSITION_MS}ms`,
    transitionTimingFunction: MODAL_EASING,
  };

  return createPortal(
    <div
      className={clsx(
        "fixed inset-0 z-[60] overflow-hidden bg-[rgba(0,0,0,0.42)] backdrop-blur-[10px] transition-opacity",
        isActive ? "opacity-100" : "opacity-0",
      )}
      style={transitionStyle}
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Vista completa de ${documentName}`}
        className={clsx(
          "flex h-dvh w-dvw p-[16px] transition-[opacity,transform] transform-gpu will-change-transform will-change-opacity max-[1024px]:p-[12px] max-[520px]:p-[8px] motion-reduce:transform-none motion-reduce:transition-none",
          isActive
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-[12px] scale-[0.985] opacity-0",
        )}
        style={transitionStyle}
      >
        <div
          className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-3)] shadow-[var(--shadow-e2)]"
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default DocumentFullscreenModal;
