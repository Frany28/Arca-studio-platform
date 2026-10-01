/* Muestra alertas temporales en un portal y controla su ciclo de entrada, salida y autoocultado. */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getUserFacingErrorMessage } from "../../../utils/userFacingError.js";
import Alert from "../Alert/Alert.jsx";

const EXIT_DURATION_MS = 320;

// Coordina timers, montaje, visibilidad y acciones de una alerta flotante.
function AlertToast({
  trigger = null,
  title,
  description,
  theme = "Success",
  autoHideMs = 5000,
  showActions = false,
  secondaryActionLabel,
  primaryActionLabel,
  primaryActionDisabled = false,
  onSecondaryAction,
  onPrimaryAction,
  onDismiss,
  "aria-label": ariaLabel,
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const lastTriggerRef = useRef(null);
  const mountTimerRef = useRef(null);
  const showTimerRef = useRef(null);
  const hideTimerRef = useRef(null);
  const unmountTimerRef = useRef(null);

  // Cancela timers activos para evitar transiciones o callbacks obsoletos.
  const clearTimers = useCallback(() => {
    window.clearTimeout(mountTimerRef.current);
    window.clearTimeout(showTimerRef.current);
    window.clearTimeout(hideTimerRef.current);
    window.clearTimeout(unmountTimerRef.current);
  }, []);

  // Inicia la animación de salida y desmonta el toast al terminar.
  const dismiss = useCallback(() => {
    clearTimers();
    setVisible(false);
    unmountTimerRef.current = window.setTimeout(() => {
      setMounted(false);
      onDismiss?.();
    }, EXIT_DURATION_MS);
  }, [clearTimers, onDismiss]);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (trigger == null || trigger === lastTriggerRef.current) return;

    lastTriggerRef.current = trigger;
    clearTimers();

    mountTimerRef.current = window.setTimeout(() => {
      setMounted(true);
      setVisible(false);
    }, 0);
    showTimerRef.current = window.setTimeout(() => setVisible(true), 20);
    if (autoHideMs > 0) {
      hideTimerRef.current = window.setTimeout(dismiss, autoHideMs);
    }
  }, [autoHideMs, clearTimers, dismiss, trigger]);

  if (!mounted || typeof document === "undefined") return null;

  const resolvedDescription = theme === "Danger"
    ? getUserFacingErrorMessage(description)
    : description;
  const handleSecondaryAction = () => {
    onSecondaryAction?.();
    dismiss();
  };
  const handlePrimaryAction = () => {
    onPrimaryAction?.();
    dismiss();
  };

  return createPortal(
    <div className={`pointer-events-none fixed inset-x-0 bottom-0 z-[var(--z-tooltip)] flex justify-center p-[16px] sm:left-auto sm:right-0 sm:justify-end sm:p-[24px] ${showActions ? "sm:w-[722px]" : "sm:w-[420px]"}`}>
      <Alert
        visible
        theme={theme}
        layout="Box"
        title={title}
        description={resolvedDescription}
        showIcon
        showText
        showActions={showActions}
        showCloseButton
        secondaryActionLabel={secondaryActionLabel}
        primaryActionLabel={primaryActionLabel}
        primaryActionDisabled={primaryActionDisabled}
        onSecondaryAction={handleSecondaryAction}
        onPrimaryAction={handlePrimaryAction}
        onDismiss={dismiss}
        aria-label={ariaLabel}
        className={`pointer-events-auto w-full ${showActions ? "max-w-[722px]" : "max-w-[372px]"} shadow-[var(--shadow-e3)] ${
          visible ? "auth-toast auth-toast--visible" : "auth-toast"
        }`}
      />
    </div>,
    document.body,
  );
}

export default AlertToast;
