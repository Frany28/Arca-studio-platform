/* Muestra notificaciones temporales relacionadas con autenticación y actualiza su tiempo transcurrido. */
import { useEffect, useRef, useState } from "react";

import Notification from "../Notification/Notification.jsx";

// Convierte una marca de tiempo en una etiqueta legible de tiempo transcurrido.
function buildElapsedLabel(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (seconds < 5) {
    return "Ahora";
  }

  if (seconds < 60) {
    return `Hace ${seconds} s`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `Hace ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  return `Hace ${hours} h`;
}

// Coordina montaje, animación, autoocultado y contador temporal del toast.
function AuthToast({
  trigger = null,
  title,
  description,
  leading,
  autoHideMs = 4200,
  startDelayMs = 20,
  onDismiss,
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [timestamp, setTimestamp] = useState(null);
  const [elapsedLabel, setElapsedLabel] = useState("Ahora");
  const lastTriggerRef = useRef(null);
  const mountTimerRef = useRef(null);
  const showTimerRef = useRef(null);
  const hideTimerRef = useRef(null);
  const unmountTimerRef = useRef(null);
  const elapsedIntervalRef = useRef(null);

  useEffect(() => {
    return () => {
      window.clearTimeout(mountTimerRef.current);
      window.clearTimeout(showTimerRef.current);
      window.clearTimeout(hideTimerRef.current);
      window.clearTimeout(unmountTimerRef.current);
      window.clearInterval(elapsedIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (trigger == null || trigger === lastTriggerRef.current) {
      return;
    }

    lastTriggerRef.current = trigger;

    window.clearTimeout(mountTimerRef.current);
    window.clearTimeout(showTimerRef.current);
    window.clearTimeout(hideTimerRef.current);
    window.clearTimeout(unmountTimerRef.current);

    const nextTimestamp = Date.now();
    setTimestamp(nextTimestamp);
    setElapsedLabel("Ahora");
    setMounted(false);
    setVisible(false);

    mountTimerRef.current = window.setTimeout(() => {
      setMounted(true);

      showTimerRef.current = window.setTimeout(() => {
        setVisible(true);
      }, 20);
    }, startDelayMs);

    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false);
      unmountTimerRef.current = window.setTimeout(() => {
        setMounted(false);
        setTimestamp(null);
        onDismiss?.();
      }, 320);
    }, startDelayMs + autoHideMs);
  }, [autoHideMs, onDismiss, startDelayMs, trigger]);

  useEffect(() => {
    if (!timestamp || !mounted) {
      setElapsedLabel("Ahora");
      window.clearInterval(elapsedIntervalRef.current);
      return undefined;
    }

    const updateElapsedLabel = () => {
      setElapsedLabel(buildElapsedLabel(timestamp));
    };

    updateElapsedLabel();
    elapsedIntervalRef.current = window.setInterval(updateElapsedLabel, 1000);

    return () => {
      window.clearInterval(elapsedIntervalRef.current);
    };
  }, [mounted, timestamp]);

  if (!mounted) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-0 top-0 z-20 flex w-full justify-center p-[24px] sm:w-[375px]">
      <Notification
        title={title}
        timestamp={elapsedLabel}
        description={description}
        leading={leading}
        showCloseButton={false}
        showActions={false}
        visible
        className={`pointer-events-auto w-full ${
          visible ? "auth-toast auth-toast--visible" : "auth-toast"
        }`}
      />
    </div>
  );
}

// Icono reutilizable para notificaciones relacionadas con correo.
export function AuthToastMailIcon() {
  return (
    <span className="inline-flex items-center justify-center rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[8px] shadow-[var(--shadow-e1)]">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="19"
        height="16"
        viewBox="0 0 19 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M13.25 14.9167H4.91667C2.41667 14.9167 0.75 13.6667 0.75 10.75V4.91667C0.75 2 2.41667 0.75 4.91667 0.75H13.25C15.75 0.75 17.4167 2 17.4167 4.91667V10.75C17.4167 13.6667 15.75 14.9167 13.25 14.9167Z"
          stroke="#818181"
          strokeWidth="1.5"
          strokeMiterlimit="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M13.25 5.33337L10.6417 7.41671C9.78333 8.10004 8.375 8.10004 7.51667 7.41671L4.91667 5.33337"
          stroke="#818181"
          strokeWidth="1.5"
          strokeMiterlimit="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

// Icono reutilizable para notificaciones relacionadas con seguridad o contraseña.
export function AuthToastLockIcon() {
  return (
    <span className="inline-flex items-center justify-center rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[8px] shadow-[var(--shadow-e1)]">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M5 8.33329V6.66663C5 3.90829 5.83333 1.66663 10 1.66663C14.1667 1.66663 15 3.90829 15 6.66663V8.33329"
          stroke="#818181"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M10.0001 15.4167C11.1507 15.4167 12.0834 14.4839 12.0834 13.3333C12.0834 12.1827 11.1507 11.25 10.0001 11.25C8.84949 11.25 7.91675 12.1827 7.91675 13.3333C7.91675 14.4839 8.84949 15.4167 10.0001 15.4167Z"
          stroke="#818181"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14.1667 18.3334H5.83341C2.50008 18.3334 1.66675 17.5 1.66675 14.1667V12.5C1.66675 9.16671 2.50008 8.33337 5.83341 8.33337H14.1667C17.5001 8.33337 18.3334 9.16671 18.3334 12.5V14.1667C18.3334 17.5 17.5001 18.3334 14.1667 18.3334Z"
          stroke="#818181"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export default AuthToast;
