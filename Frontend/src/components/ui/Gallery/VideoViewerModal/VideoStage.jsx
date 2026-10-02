import clsx from "clsx";

import MainLogo from "../../../../assets/logos/MainLogo.jsx";
import Button from "../../Button/Button.jsx";
import Loader from "../../Loader/Loader.jsx";
import Tooltip from "../../Tooltip/Tooltip.jsx";
import PlaybackBar from "./PlaybackBar.jsx";
import { CloseIcon, PauseIcon, PlayIcon } from "./VideoViewerIcons.jsx";

/**
 * Presenta el escenario visual del video sin apropiarse del estado de reproducción.
 * El modal padre conserva refs, handlers y coordinación con comentarios.
 * @param {Object} props Estado visual y callbacks del escenario.
 * @returns {import("react").ReactElement} Stage de video o imagen de respaldo.
 */
export default function VideoStage({
  currentTime,
  displayItem,
  duration,
  focusedCommentId,
  generatedPoster,
  isMuted,
  isPlaying,
  isVideoLoading,
  onClose,
  onCommentClick,
  onDurationChange,
  onFullscreen,
  onLoadedData,
  onCanPlay,
  onMarkerClick,
  onPause,
  onPlay,
  onPlaying,
  onSeek,
  onTimeUpdate,
  onToggleMute,
  onTogglePlay,
  onVolumeChange,
  onWaiting,
  stageRef,
  timelineMarkers,
  videoRef,
}) {
  return (
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
          onClick={onTogglePlay}
          onDurationChange={onDurationChange}
          onLoadedData={onLoadedData}
          onCanPlay={onCanPlay}
          onPause={onPause}
          onPlay={onPlay}
          onPlaying={onPlaying}
          onTimeUpdate={onTimeUpdate}
          onVolumeChange={onVolumeChange}
          onWaiting={onWaiting}
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
            onClick={onTogglePlay}
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
        onCommentClick={onCommentClick}
        onFullscreen={onFullscreen}
        onSeek={onSeek}
        onMarkerClick={onMarkerClick}
        onToggleMute={onToggleMute}
      />
    </div>
  );
}
