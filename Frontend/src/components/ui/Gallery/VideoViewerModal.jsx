import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import MainLogo from "../../../assets/logos/MainLogo.jsx";
import Button from "../../ui/Button/Button.jsx";
import Loader from "../Loader/Loader.jsx";
import Tooltip from "../../ui/Tooltip/Tooltip.jsx";
import {
  createVideoTimeSelection,
  formatVideoObservationTime,
  getVideoObservationTiming,
} from "../../../utils/videoObservation.js";
import GeneralCommentsDrawer from "./GeneralCommentsDrawer.jsx";
import { useImageComments } from "./useImageComments.js";
import { useVideoThumbnail } from "./useVideoThumbnail.js";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";
import useBodyScrollLock from "../../../hooks/useBodyScrollLock.js";

const MODAL_TRANSITION_MS = 320;
const MODAL_EASING = "ease-in-out";

function CloseIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0.195262 0.195262C0.455612 -0.0650874 0.877722 -0.0650874 1.13807 0.195262L6 5.05719L10.8619 0.195263C11.1223 -0.0650867 11.5444 -0.0650866 11.8047 0.195263C12.0651 0.455612 12.0651 0.877722 11.8047 1.13807L6.94281 6L11.8047 10.8619C12.0651 11.1223 12.0651 11.5444 11.8047 11.8047C11.5444 12.0651 11.1223 12.0651 10.8619 11.8047L6 6.94281L1.13807 11.8047C0.877722 12.0651 0.455612 12.0651 0.195262 11.8047C-0.0650873 11.5444 -0.0650873 11.1223 0.195262 10.8619L5.05719 6L0.195262 1.13807C-0.0650874 0.877722 -0.0650874 0.455612 0.195262 0.195262Z"
        fill="currentColor"
      />
    </svg>
  );
}

function VolumeIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2.5 7.358V12.642C2.5 13.45 3.158 14.108 3.967 14.108H6.342L10.292 17.217C10.95 17.733 11.917 17.267 11.917 16.425V3.575C11.917 2.733 10.95 2.267 10.292 2.783L6.342 5.892H3.967C3.158 5.892 2.5 6.55 2.5 7.358Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.417 6.875C15.458 8.75 15.458 11.25 14.417 13.125"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.792 5.208C18.458 8.125 18.458 11.875 16.792 14.792"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VolumeMutedIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2.5 7.358V12.642C2.5 13.45 3.158 14.108 3.967 14.108H6.342L10.292 17.217C10.95 17.733 11.917 17.267 11.917 16.425V3.575C11.917 2.733 10.95 2.267 10.292 2.783L6.342 5.892H3.967C3.158 5.892 2.5 6.55 2.5 7.358Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.167 8.333L17.5 11.667M17.5 8.333L14.167 11.667"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CommentIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M5.417 13.333H5C3.619 13.333 2.5 12.214 2.5 10.833V5.833C2.5 4.452 3.619 3.333 5 3.333H15C16.381 3.333 17.5 4.452 17.5 5.833V10.833C17.5 12.214 16.381 13.333 15 13.333H10.833L6.667 16.667V14.583C6.667 13.893 6.107 13.333 5.417 13.333Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.667 7.5H13.333M6.667 10H10.833"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayIcon({ className }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M13.812 9.07404C13.6298 8.96602 13.4223 8.90815 13.2105 8.9063C12.9987 8.90445 12.7902 8.95869 12.6061 9.06351C12.4221 9.16833 12.269 9.32 12.1626 9.50311C12.0561 9.68621 12 9.89424 12 10.106V37.894C12 38.1058 12.0561 38.3139 12.1626 38.497C12.269 38.6801 12.4221 38.8317 12.6061 38.9366C12.7902 39.0414 12.9987 39.0956 13.2105 39.0938C13.4223 39.0919 13.6298 39.0341 13.812 38.926L37.258 25.032C37.4371 24.9258 37.5854 24.7748 37.6884 24.5938C37.7915 24.4129 37.8456 24.2083 37.8456 24C37.8456 23.7918 37.7915 23.5872 37.6884 23.4062C37.5854 23.2253 37.4371 23.0743 37.258 22.968L13.812 9.07404Z"
        stroke="currentColor"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PauseIcon({ className }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M17 10V38M31 10V38"
        stroke="currentColor"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SettingsIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10 12.5C11.381 12.5 12.5 11.381 12.5 10C12.5 8.619 11.381 7.5 10 7.5C8.619 7.5 7.5 8.619 7.5 10C7.5 11.381 8.619 12.5 10 12.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M1.667 10.733V9.267C1.667 8.4 2.375 7.683 3.25 7.683C4.758 7.683 5.375 6.617 4.617 5.308C4.183 4.558 4.442 3.583 5.2 3.15L6.642 2.325C7.3 1.933 8.15 2.167 8.542 2.825L8.633 2.983C9.383 4.292 10.617 4.292 11.375 2.983L11.467 2.825C11.858 2.167 12.708 1.933 13.367 2.325L14.808 3.15C15.567 3.583 15.825 4.558 15.392 5.308C14.633 6.617 15.25 7.683 16.758 7.683C17.625 7.683 18.342 8.392 18.342 9.267V10.733C18.342 11.6 17.633 12.317 16.758 12.317C15.25 12.317 14.633 13.383 15.392 14.692C15.825 15.45 15.567 16.417 14.808 16.85L13.367 17.675C12.708 18.067 11.858 17.833 11.467 17.175L11.375 17.017C10.625 15.708 9.392 15.708 8.633 17.017L8.542 17.175C8.15 17.833 7.3 18.067 6.642 17.675L5.2 16.85C4.442 16.417 4.183 15.442 4.617 14.692C5.375 13.383 4.758 12.317 3.25 12.317C2.375 12.317 1.667 11.6 1.667 10.733Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatPlaybackTime(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

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

function PlaybackBar({
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

  function updateHoverTime(event) {
    if (!safeDuration) {
      return;
    }

    const nextHover = getPointerTime(event, safeDuration);
    setHoverLeft(nextHover.left);
    setHoverTime(nextHover.time);
  }

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
            style={{
              left: `${Math.min(Math.max(hoverLeft, 2), 98)}%`,
            }}
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

export default function VideoViewerModal({
  visible = false,
  item,
  projectId,
  onClose,
}) {
  const { readOnly } = useProjectReadOnly();
  const [shouldRender, setShouldRender] = useState(visible);
  const [isActive, setIsActive] = useState(false);
  const [displayItem, setDisplayItem] = useState(item);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const [focusedCommentId, setFocusedCommentId] = useState(null);
  const [pendingSelection, setPendingSelection] = useState(null);
  const closeTimeoutRef = useRef(null);
  const frameRef = useRef(null);
  const stageRef = useRef(null);
  const videoRef = useRef(null);
  const generatedPoster = useVideoThumbnail(displayItem?.video, displayItem?.poster);
  const { addComment, comments } = useImageComments(displayItem, {
    commentType: "video",
    projectId,
  });

  useBodyScrollLock(visible);

  useEffect(() => {
    window.clearTimeout(closeTimeoutRef.current);
    window.cancelAnimationFrame(frameRef.current);
    let cancelled = false;

    if (visible && item) {
      queueMicrotask(() => {
        if (cancelled) return;

        setDisplayItem(item);
        setCurrentTime(0);
        setDuration(0);
        setIsActive(false);
        setIsMuted(false);
        setIsPlaying(false);
        setFocusedCommentId(null);
        setPendingSelection(null);
        setIsVideoLoading(Boolean(item.video));
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
  }, [visible, item]);

  useEffect(
    () => () => {
      window.clearTimeout(closeTimeoutRef.current);
      window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  if (!shouldRender || !displayItem || typeof document === "undefined") {
    return null;
  }

  const transitionStyle = {
    transitionDuration: `${MODAL_TRANSITION_MS}ms`,
    transitionTimingFunction: MODAL_EASING,
  };

  async function handleSubmitComment({ message, parentCommentId, selection }) {
    const comment = await addComment({ message, parentCommentId, selection });

    if (selection && comment) {
      setPendingSelection(null);
      setFocusedCommentId(comment.id);
    }

    return comment;
  }

  async function handleTogglePlay() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (video.paused) {
      setIsVideoLoading(video.readyState < 3);
      try {
        await video.play();
      } catch {
        setIsPlaying(false);
        setIsVideoLoading(false);
      }
      return;
    }

    video.pause();
  }

  function handleSeek(nextTime) {
    const video = videoRef.current;

    if (!video || !Number.isFinite(nextTime)) {
      return;
    }

    video.currentTime = Math.min(Math.max(nextTime, 0), duration || nextTime);
    setCurrentTime(video.currentTime);
  }

  function handleToggleMute() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.muted = !video.muted;
    setIsMuted(video.muted);
  }

  function handleCommentClick() {
    if (readOnly) return;
    const video = videoRef.current;
    const selection = createVideoTimeSelection(
      video?.currentTime ?? currentTime,
      video?.duration ?? duration,
    );

    video?.pause();
    setPendingSelection(selection);
    setFocusedCommentId(null);
    setComposerFocusSignal((currentSignal) => currentSignal + 1);
  }

  function handleTemporalCommentSelect(comment) {
    const timing = getVideoObservationTiming(comment?.selection || comment);

    if (!timing) return;

    if (
      !comment.pending &&
      String(focusedCommentId) === String(comment.id)
    ) {
      setFocusedCommentId(null);
      return;
    }

    videoRef.current?.pause();
    handleSeek(timing.videoTimeSeconds);
    setFocusedCommentId(comment.pending ? null : comment.id);
  }

  const temporalComments = comments.filter(
    (comment) => !comment.parentCommentId && getVideoObservationTiming(comment.selection),
  );
  const pendingTiming = getVideoObservationTiming(pendingSelection);
  const timelineMarkers = [
    ...temporalComments,
    pendingTiming
      ? {
          id: "pending-video-observation",
          pending: true,
          selection: pendingSelection,
          ...pendingTiming,
        }
      : null,
  ].filter(Boolean);

  async function handleFullscreen() {
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
        return;
      }

      await stage.requestFullscreen?.();
    } catch {
      // Fullscreen can be blocked by the browser if the gesture is not trusted.
    }
  }

  return createPortal(
    <div
      className={clsx(
        "fixed inset-0 z-[60] overflow-hidden bg-[rgba(0,0,0,0.42)] backdrop-blur-[10px] transition-opacity",
        visible ? "pointer-events-auto" : "pointer-events-none",
        isActive ? "opacity-100" : "opacity-0",
      )}
      style={transitionStyle}
    >
      <section
        className={clsx(
          "flex h-dvh w-dvw gap-[16px] p-[16px] transition-[opacity,transform] transform-gpu will-change-transform will-change-opacity max-[920px]:flex-col max-[920px]:overflow-y-auto",
          isActive
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-[12px] scale-[0.985] opacity-0",
        )}
        style={transitionStyle}
        role="dialog"
        aria-modal="true"
        aria-label={displayItem.title}
        onClick={onClose}
      >
        <div
          ref={stageRef}
          className={clsx(
            "group/video",
            "relative min-w-0 flex-1 overflow-hidden",
            "rounded-[var(--radius-3)] bg-[var(--color-neutral-950-uniform)]",
            "h-[calc(100dvh-32px)]",
            "max-[920px]:h-[62dvh] max-[920px]:min-h-[360px] max-[920px]:flex-none",
            "max-[520px]:h-[58dvh] max-[520px]:min-h-[300px]",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          {displayItem.video ? (
            <video
              ref={videoRef}
              src={displayItem.video}
              poster={generatedPoster || undefined}
              className="absolute inset-0 h-full w-full cursor-pointer object-contain"
              muted={isMuted}
              playsInline
              preload="metadata"
              aria-label={displayItem.title}
              onClick={handleTogglePlay}
              onDurationChange={(event) => {
                setDuration(event.currentTarget.duration || 0);
              }}
              onLoadedData={(event) => {
                setDuration(event.currentTarget.duration || 0);
                setIsVideoLoading(false);
              }}
              onCanPlay={() => setIsVideoLoading(false)}
              onPause={() => setIsPlaying(false)}
              onPlay={() => {
                setIsPlaying(true);
                setIsVideoLoading(false);
              }}
              onPlaying={() => {
                setIsPlaying(true);
                setIsVideoLoading(false);
              }}
              onTimeUpdate={(event) => {
                setCurrentTime(event.currentTarget.currentTime || 0);
              }}
              onVolumeChange={(event) => {
                setIsMuted(event.currentTarget.muted);
              }}
              onWaiting={() => setIsVideoLoading(true)}
            />
          ) : (
            <img
              src={generatedPoster || displayItem.image}
              alt={displayItem.label ?? displayItem.title}
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}

          {displayItem.video && isVideoLoading ? (
            <Loader
              preset="videoStage"
              label="Cargando video"
              className="absolute inset-0 z-20"
            />
          ) : null}

          <div className="pointer-events-none absolute inset-0 bg-[rgba(42,41,41,0.18)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[120px] bg-[linear-gradient(180deg,rgba(0,0,0,0.26)_0%,rgba(0,0,0,0)_100%)]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[120px] bg-[linear-gradient(0deg,rgba(0,0,0,0.30)_0%,rgba(0,0,0,0)_100%)]" />

          {displayItem.video ? (
            <Tooltip
              asChild
              portal
              showTip
              text={isPlaying ? "Pausar video" : "Reproducir video"}
              tipPosition="Top center"
            >
              <button
                type="button"
                aria-label={isPlaying ? "Pausar video" : "Reproducir video"}
                className={clsx(
                  "group/play absolute inset-0 z-10 flex cursor-pointer items-center justify-center text-[var(--color-neutral-100-uniform)] transition-opacity duration-200 focus-visible:outline-none",
                  isPlaying
                    ? "opacity-0 hover:opacity-100 focus-visible:opacity-100 group-hover/video:opacity-100"
                    : "opacity-100",
                )}
                onClick={handleTogglePlay}
              >
                <span className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.24)_0%,rgba(0,0,0,0.14)_28%,rgba(0,0,0,0.04)_56%,rgba(0,0,0,0)_100%)]" />
                <span className="relative flex size-[64px] items-center justify-center rounded-full text-[var(--color-neutral-100-uniform)] drop-shadow-[0_8px_24px_rgba(0,0,0,0.34)] group-focus-visible/play:ring-2 group-focus-visible/play:ring-[var(--color-neutral-100-uniform)]">
                  {isPlaying ? (
                    <PauseIcon className="size-[56px]" />
                  ) : (
                    <PlayIcon className="size-[56px]" />
                  )}
                </span>
              </button>
            </Tooltip>
          ) : null}

          <div className="absolute left-[12px] top-[12px] z-30">
            <MainLogo size="32px" appearance="dark" alt="ARCA Studio" />
          </div>

          <Button
            theme="Primary"
            type="Solid"
            size="S"
            showText={false}
            showLeftIcon
            showRightIcon={false}
            iconLeft={<CloseIcon className="size-3" />}
            aria-label="Cerrar video"
            tooltip={false}
            onClick={onClose}
            className="absolute right-[8px] top-[8px] z-30 size-9 text-[var(--color-text-200)]"
          />

          <PlaybackBar
            currentTime={currentTime}
            duration={duration}
            isLoading={isVideoLoading}
            isMuted={isMuted}
            focusedCommentId={focusedCommentId}
            markers={timelineMarkers}
            onCommentClick={readOnly ? undefined : handleCommentClick}
            onFullscreen={handleFullscreen}
            onSeek={handleSeek}
            onMarkerClick={handleTemporalCommentSelect}
            onToggleMute={handleToggleMute}
          />
        </div>

        <div
          className={clsx(
            "min-h-0 w-[296px] shrink-0",
            "max-[920px]:h-[360px] max-[920px]:w-full max-[920px]:shrink-0",
            "max-[520px]:h-[320px]",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <GeneralCommentsDrawer
            composerFocusSignal={composerFocusSignal}
            comments={comments}
            focusedSelectionCommentId={focusedCommentId}
            mediaItem={{ ...displayItem, image: generatedPoster || displayItem.image }}
            mediaType="video"
            onClearSelection={() => setPendingSelection(null)}
            onSelectionPreviewClick={(commentId) => {
              const comment = comments.find(
                (current) => String(current.id) === String(commentId),
              );
              handleTemporalCommentSelect(comment);
            }}
            onSubmitComment={handleSubmitComment}
            pendingSelection={pendingSelection}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}
