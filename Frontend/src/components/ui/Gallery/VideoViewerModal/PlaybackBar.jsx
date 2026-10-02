import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

import Tooltip from "../../Tooltip/Tooltip.jsx";
import { formatVideoObservationTime } from "../../../../utils/videoObservation.js";
import {
  CommentIcon,
  SettingsIcon,
  VolumeIcon,
  VolumeMutedIcon,
} from "./VideoViewerIcons.jsx";

/**
 * Formatea el tiempo reproducido en minutos y segundos para controles del visor.
 * @param {number} value Segundos actuales.
 * @returns {string} Tiempo legible en formato m:ss.
 */
function formatPlaybackTime(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Convierte una posición horizontal del puntero en porcentaje y tiempo del video.
 * @param {PointerEvent|MouseEvent} event Evento sobre la barra de progreso.
 * @param {number} duration Duración conocida del video.
 * @returns {{left: number, time: number}} Posición porcentual y tiempo equivalente.
 */
function getPointerTime(event, duration) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const rect = event.currentTarget.getBoundingClientRect();
  const offset = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
  const percentage = rect.width > 0 ? offset / rect.width : 0;

  return {
    left: percentage * 100,
    time: safeDuration * percentage,
  };
}

/**
 * Presenta timeline, referencias temporales y acciones de reproducción auxiliares.
 * Mantiene localmente únicamente el tooltip temporal del puntero.
 * @param {Object} props Estado de reproducción y callbacks del visor.
 * @returns {import("react").ReactElement} Barra inferior del video.
 */
export default function PlaybackBar({
  currentTime,
  duration,
  isLoading,
  isMuted,
  focusedCommentId,
  markers = [],
  onCommentClick,
  onFullscreen,
  onSeek,
  onMarkerClick,
  onToggleMute,
}) {
  const touchTooltipTimeoutRef = useRef(null);
  const [hoverTime, setHoverTime] = useState(null);
  const [hoverLeft, setHoverLeft] = useState(0);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const progress = safeDuration
    ? Math.min(Math.max((currentTime / safeDuration) * 100, 0), 100)
    : 0;
  const displayProgress = safeDuration ? progress : isLoading ? 12 : 0;
  const showTimeTooltip = safeDuration > 0 && hoverTime !== null;

  useEffect(
    () => () => {
      window.clearTimeout(touchTooltipTimeoutRef.current);
    },
    [],
  );

  /** Actualiza el tooltip temporal según la posición actual del puntero. */
  function updateHoverTime(event) {
    if (!safeDuration) {
      return;
    }

    const nextHover = getPointerTime(event, safeDuration);
    setHoverLeft(nextHover.left);
    setHoverTime(nextHover.time);
  }

  /** Mantiene visible brevemente el tooltip tras interacción táctil. */
  function handlePointerDown(event) {
    updateHoverTime(event);

    if (event.pointerType === "mouse") {
      return;
    }

    window.clearTimeout(touchTooltipTimeoutRef.current);
    touchTooltipTimeoutRef.current = window.setTimeout(() => {
      setHoverTime(null);
    }, 1200);
  }

  /** Limpia tooltip y timeout al abandonar la barra. */
  function handlePointerLeave() {
    window.clearTimeout(touchTooltipTimeoutRef.current);
    setHoverTime(null);
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 h-[84px]">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[84px] bg-[linear-gradient(0deg,rgba(0,0,0,0.28)_0%,rgba(0,0,0,0)_100%)]" />

      <div
        className="absolute left-[24px] right-[24px] top-[12px] h-[8px]"
        onPointerDown={handlePointerDown}
        onPointerEnter={updateHoverTime}
        onPointerLeave={handlePointerLeave}
        onPointerMove={updateHoverTime}
      >
        {showTimeTooltip ? (
          <div
            className="pointer-events-none absolute bottom-full z-40 mb-[12px] -translate-x-1/2"
            style={{ left: `${Math.min(Math.max(hoverLeft, 2), 98)}%` }}
          >
            <Tooltip
              text={formatPlaybackTime(hoverTime)}
              showTip
              tipPosition="Top center"
              aria-label={`Tiempo ${formatPlaybackTime(hoverTime)}`}
            />
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full bg-white/90">
          <div
            className={clsx(
              "h-full rounded-full bg-[var(--color-neutral-300)]",
              isLoading && !safeDuration && "animate-pulse",
            )}
            style={{ width: `${displayProgress}%` }}
          />
        </div>

        {markers.map((marker) => {
          const markerTime = Number(marker.videoTimeSeconds);
          const markerLeft = safeDuration
            ? Math.min(Math.max((markerTime / safeDuration) * 100, 0), 100)
            : 0;
          const isActive =
            marker.pending || String(marker.id) === String(focusedCommentId);
          const markerLabel = `${marker.pending ? "Referencia pendiente" : "Ir a la observación"} en ${formatVideoObservationTime(markerTime)}`;

          return (
            <Tooltip
              key={marker.id}
              asChild
              portal
              showTip
              text={markerLabel}
              tipPosition="Top center"
            >
              <button
                type="button"
                aria-label={markerLabel}
                className={clsx(
                  "absolute top-1/2 z-20 h-[16px] w-[4px] -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full bg-[var(--color-accent-300)] transition-[height,box-shadow,width] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                  isActive
                    ? "h-[20px] w-[6px] shadow-[0_0_0_3px_rgba(255,68,49,0.28)]"
                    : "hover:h-[20px]",
                  marker.pending && "opacity-65",
                )}
                style={{ left: `${markerLeft}%` }}
                onClick={() => onMarkerClick?.(marker)}
              />
            </Tooltip>
          );
        })}

        <input
          type="range"
          min="0"
          max={safeDuration || 0}
          step="0.1"
          value={Math.min(currentTime, safeDuration || currentTime)}
          aria-label="Progreso del video"
          className="absolute inset-x-0 top-1/2 z-10 h-[20px] -translate-y-1/2 cursor-pointer opacity-0 disabled:cursor-default"
          disabled={!safeDuration}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </div>

      <div className="absolute bottom-[12px] left-[24px] flex items-center gap-[8px]">
        <Tooltip
          asChild
          portal
          showTip
          text={isMuted ? "Activar sonido" : "Silenciar video"}
          tipPosition="Top center"
        >
          <button
            type="button"
            aria-label={isMuted ? "Activar sonido" : "Silenciar video"}
            className="flex size-[44px] cursor-pointer items-center justify-center rounded-[var(--radius-2)] bg-[var(--color-neutral-300)] text-[var(--color-neutral-100-uniform)] shadow-[0_8px_20px_rgba(0,0,0,0.22)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)]"
            onClick={onToggleMute}
          >
            {isMuted ? (
              <VolumeMutedIcon className="size-5" />
            ) : (
              <VolumeIcon className="size-5" />
            )}
          </button>
        </Tooltip>

        <Tooltip asChild portal showTip text="Comentar video" tipPosition="Top center">
          <button
            type="button"
            aria-label="Comentar video"
            className="flex size-[44px] cursor-pointer items-center justify-center rounded-[var(--radius-2)] bg-[var(--color-neutral-300)] text-[var(--color-neutral-100-uniform)] shadow-[0_8px_20px_rgba(0,0,0,0.22)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)]"
            onClick={onCommentClick}
            disabled={!onCommentClick}
          >
            <CommentIcon className="size-5" />
          </button>
        </Tooltip>
      </div>

      <Tooltip asChild portal showTip text="Pantalla completa" tipPosition="Top right">
        <button
          type="button"
          aria-label="Pantalla completa"
          className="absolute bottom-[12px] right-[24px] flex size-[44px] cursor-pointer items-center justify-center rounded-[var(--radius-2)] bg-[var(--color-neutral-300)] text-[var(--color-neutral-100-uniform)] shadow-[0_8px_20px_rgba(0,0,0,0.22)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)]"
          onClick={onFullscreen}
        >
          <SettingsIcon className="size-5" />
        </button>
      </Tooltip>
    </div>
  );
}
