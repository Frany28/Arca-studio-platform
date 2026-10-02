import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

import {
  createVideoTimeSelection,
  getVideoObservationTiming,
} from "../../../utils/videoObservation.js";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";
import useBodyScrollLock from "../../../hooks/useBodyScrollLock.js";
import GeneralCommentsDrawer from "./GeneralCommentsDrawer.jsx";
import { useImageComments } from "./useImageComments.js";
import { useVideoThumbnail } from "./useVideoThumbnail.js";
import VideoStage from "./VideoViewerModal/VideoStage.jsx";

const MODAL_TRANSITION_MS = 320;
const MODAL_EASING = "ease-in-out";

/**
 * Orquesta el visor de video, su ciclo de vida, reproducción y observaciones temporales.
 * La presentación del escenario y la barra de controles se delega a componentes locales.
 * @param {Object} props Configuración pública del modal.
 * @returns {import("react").ReactElement|null} Visor montado en portal mientras corresponde.
 */
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
  const generatedPoster = useVideoThumbnail(
    displayItem?.video,
    displayItem?.poster,
  );
  const { addComment, comments } = useImageComments(displayItem, {
    commentType: "video",
    projectId,
  });

  useBodyScrollLock(visible);

  /**
   * Mantiene el contenido montado durante la animación de salida y reinicia
   * el estado transitorio al abrir otro recurso sin mostrar el item anterior.
   */
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

  /**
   * Envía una observación y, cuando corresponde, convierte la selección pendiente
   * en una referencia enfocada sobre el timeline.
   * @param {Object} payload Mensaje, padre y selección enviados por el drawer.
   * @returns {Promise<Object|null>} Comentario creado por la fuente compartida.
   */
  async function handleSubmitComment({ message, parentCommentId, selection }) {
    const comment = await addComment({ message, parentCommentId, selection });

    if (selection && comment) {
      setPendingSelection(null);
      setFocusedCommentId(comment.id);
    }

    return comment;
  }

  /**
   * Alterna reproducción usando el elemento real para conservar la semántica
   * nativa y el manejo actual de rechazos de play().
   */
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

  /** Ajusta el tiempo del elemento de video dentro de sus límites actuales. */
  function handleSeek(nextTime) {
    const video = videoRef.current;

    if (!video || !Number.isFinite(nextTime)) {
      return;
    }

    video.currentTime = Math.min(Math.max(nextTime, 0), duration || nextTime);
    setCurrentTime(video.currentTime);
  }

  /** Alterna mute sobre el elemento nativo y sincroniza el estado visual. */
  function handleToggleMute() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.muted = !video.muted;
    setIsMuted(video.muted);
  }

  /**
   * Crea una selección temporal en el instante actual y dirige el foco al compositor.
   */
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

  /**
   * Navega a la marca temporal de una observación o alterna su estado enfocado.
   * @param {Object} comment Comentario o marca temporal seleccionada.
   */
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
    (comment) =>
      !comment.parentCommentId &&
      getVideoObservationTiming(comment.selection),
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

  /**
   * Alterna fullscreen del escenario y conserva silenciosos los rechazos del navegador.
   */
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
        <VideoStage
          currentTime={currentTime}
          displayItem={displayItem}
          duration={duration}
          focusedCommentId={focusedCommentId}
          generatedPoster={generatedPoster}
          isMuted={isMuted}
          isPlaying={isPlaying}
          isVideoLoading={isVideoLoading}
          onClose={onClose}
          onCommentClick={readOnly ? undefined : handleCommentClick}
          onDurationChange={(event) => {
            setDuration(event.currentTarget.duration || 0);
          }}
          onLoadedData={(event) => {
            setDuration(event.currentTarget.duration || 0);
            setIsVideoLoading(false);
          }}
          onCanPlay={() => setIsVideoLoading(false)}
          onFullscreen={handleFullscreen}
          onMarkerClick={handleTemporalCommentSelect}
          onPause={() => setIsPlaying(false)}
          onPlay={() => {
            setIsPlaying(true);
            setIsVideoLoading(false);
          }}
          onPlaying={() => {
            setIsPlaying(true);
            setIsVideoLoading(false);
          }}
          onSeek={handleSeek}
          onTimeUpdate={(event) => {
            setCurrentTime(event.currentTarget.currentTime || 0);
          }}
          onToggleMute={handleToggleMute}
          onTogglePlay={handleTogglePlay}
          onVolumeChange={(event) => {
            setIsMuted(event.currentTarget.muted);
          }}
          onWaiting={() => setIsVideoLoading(true)}
          stageRef={stageRef}
          timelineMarkers={timelineMarkers}
          videoRef={videoRef}
        />

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
            mediaItem={{
              ...displayItem,
              image: generatedPoster || displayItem.image,
            }}
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
