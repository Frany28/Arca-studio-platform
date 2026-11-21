import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  createVideoTimeSelection,
  getVideoObservationTiming,
} from "../../../utils/videoObservation.js";
import GeneralCommentsDrawer from "./GeneralCommentsDrawer.jsx";
import VideoViewerStage from "./VideoViewerStage.jsx";
import { useImageComments } from "./useImageComments.js";
import { useVideoThumbnail } from "./useVideoThumbnail.js";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";
import useBodyScrollLock from "../../../hooks/useBodyScrollLock.js";

const MODAL_TRANSITION_MS = 320;
const MODAL_EASING = "ease-in-out";

/**
 * Visor de vídeo del proyecto: escenario compartido (VideoViewerStage) a la izquierda y drawer de
 * comentarios a la derecha (debajo por debajo de 920 px). Añade al escenario las observaciones
 * temporales: marcadores en la línea de tiempo, «Comentar video» en el instante actual y saltar al
 * instante de una observación. En proyectos de solo lectura no se comenta.
 *
 * @param {Object} props - Visibilidad, vídeo, proyecto y cierre.
 * @returns {import("react").ReactElement|null} Modal en portal.
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
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const [focusedCommentId, setFocusedCommentId] = useState(null);
  const [pendingSelection, setPendingSelection] = useState(null);
  const closeTimeoutRef = useRef(null);
  const frameRef = useRef(null);
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
        setIsActive(false);
        setFocusedCommentId(null);
        setPendingSelection(null);
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

  /**
   * Lleva el vídeo a un instante; el escenario actualiza su tiempo con el evento `timeupdate`.
   *
   * @param {number} nextTime - Segundos.
   * @returns {void}
   */
  function seekTo(nextTime) {
    const video = videoRef.current;

    if (!video || !Number.isFinite(nextTime)) {
      return;
    }

    video.currentTime = Math.min(Math.max(nextTime, 0), video.duration || nextTime);
  }

  function handleCommentClick() {
    if (readOnly) return;
    const video = videoRef.current;
    const selection = createVideoTimeSelection(
      video?.currentTime ?? 0,
      video?.duration ?? 0,
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
    seekTo(timing.videoTimeSeconds);
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
        {/* El escenario se reinicia con cada vídeo: tiempo, volumen y carga empiezan de cero. */}
        <VideoViewerStage
          key={displayItem.video || displayItem.id}
          item={displayItem}
          poster={generatedPoster}
          videoRef={videoRef}
          markers={timelineMarkers}
          focusedCommentId={focusedCommentId}
          onClose={onClose}
          onCommentClick={readOnly ? undefined : handleCommentClick}
          onMarkerClick={handleTemporalCommentSelect}
          className={clsx(
            "h-[calc(100dvh-32px)]",
            "max-[920px]:h-[62dvh] max-[920px]:min-h-[360px] max-[920px]:flex-none",
            "max-[520px]:h-[58dvh] max-[520px]:min-h-[300px]",
          )}
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
