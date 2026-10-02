import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

import Avatar from "../../../../components/ui/Avatar/Avatar.jsx";
import AvatarGroup from "../../../../components/ui/AvatarGroup/AvatarGroup.jsx";
import ObservationTooltip from "../../../../components/ui/ObservationTooltip/ObservationTooltip.jsx";

function DocumentMarker({ comment, focused, onSelect, style }) {
  const markerRef = useRef(null);
  const tooltipCloseTimerRef = useRef(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipClosing, setTooltipClosing] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState(null);
  const isPending = comment.id === "pending";
  const authorName = comment.authorName || comment.name || comment.author?.name || "Usuario";
  const avatarSrc = comment.avatarSrc || "";
  const replyCount = Number(comment.replyCount || comment.replies?.length || 0);
  const participants = Array.isArray(comment.threadParticipants)
    ? comment.threadParticipants
    : [];
  const visibleParticipants = participants.slice(0, 3);
  const hasMultipleParticipants = participants.length > 1;

  useEffect(() => () => window.clearTimeout(tooltipCloseTimerRef.current), []);

  const openTooltip = () => {
    if (isPending || !markerRef.current) return;
    window.clearTimeout(tooltipCloseTimerRef.current);
    setTooltipClosing(false);
    const rect = markerRef.current.getBoundingClientRect();
    setTooltipPosition({
      anchorLeft: rect.left,
      anchorRight: rect.right,
      anchorBottom: rect.bottom,
      anchorTop: rect.top,
      anchorX: rect.left + rect.width / 2,
      replaceAnchor: true,
    });
    setTooltipOpen(true);
  };
  const scheduleTooltipClose = () => {
    window.clearTimeout(tooltipCloseTimerRef.current);
    tooltipCloseTimerRef.current = window.setTimeout(() => {
      setTooltipClosing(true);
      tooltipCloseTimerRef.current = window.setTimeout(() => {
        setTooltipOpen(false);
        setTooltipClosing(false);
      }, 180);
    }, 120);
  };

  useEffect(() => {
    if (!tooltipOpen) return undefined;
    let frameId;
    const followMarker = () => {
      const rect = markerRef.current?.getBoundingClientRect();
      if (rect) {
        setTooltipPosition({
          anchorLeft: rect.left,
          anchorRight: rect.right,
          anchorBottom: rect.bottom,
          anchorTop: rect.top,
          anchorX: rect.left + rect.width / 2,
          replaceAnchor: true,
        });
      }
      frameId = window.requestAnimationFrame(followMarker);
    };
    frameId = window.requestAnimationFrame(followMarker);
    return () => window.cancelAnimationFrame(frameId);
  }, [tooltipOpen]);

  return (
    <>
      <button
        ref={markerRef}
        type="button"
        data-document-marker
        data-comment-id={isPending ? undefined : comment.id}
        aria-label={isPending ? "Ubicación de observación pendiente" : `Observación de ${authorName}`}
        className={clsx(
          "absolute z-[3] flex h-[40px] min-w-[40px] -translate-y-full items-center justify-center border border-[var(--color-neutral-400)] bg-[var(--color-neutral-bg)] transition-[border-color,box-shadow,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-neutral-bg)] motion-reduce:transition-none",
          hasMultipleParticipants
            ? "w-auto rounded-[var(--radius-full)] px-[8px]"
            : "w-[40px] rounded-br-[var(--radius-full)] rounded-tl-[var(--radius-full)] rounded-tr-[var(--radius-full)] p-[8px]",
          isPending ? "pointer-events-none animate-pulse" : "cursor-pointer",
          tooltipOpen && !isPending ? "opacity-0" : "opacity-100",
          focused && "border-[var(--color-accent-300)] ring-2 ring-[var(--color-accent-300)] ring-offset-2 ring-offset-[var(--color-neutral-bg)]",
        )}
        style={style}
        onMouseEnter={openTooltip}
        onMouseLeave={scheduleTooltipClose}
        onFocus={openTooltip}
        onBlur={scheduleTooltipClose}
        onClick={(event) => { event.stopPropagation(); if (!isPending) onSelect?.(comment.id); }}
      >
        {hasMultipleParticipants ? (
          <AvatarGroup
            aria-label={`Participantes: ${participants.map((participant) => participant.name).join(", ")}`}
            items={visibleParticipants}
            moreCount={participants.length > visibleParticipants.length
              ? participants.length - visibleParticipants.length
              : null}
            size="S"
          />
        ) : (
          <Avatar
            size="S"
            theme="Brand 1"
            content={avatarSrc ? "Image" : "Icon"}
            name={authorName}
            src={avatarSrc}
            alt={authorName}
            decorative={isPending}
          />
        )}
      </button>
      <ObservationTooltip
        authorName={authorName}
        avatarSrc={avatarSrc}
        message={comment.message || comment.content}
        closing={tooltipClosing}
        replyCount={replyCount}
        open={tooltipOpen}
        onOpenChange={(nextOpen) => nextOpen ? openTooltip() : scheduleTooltipClose()}
        onReply={onSelect ? () => { setTooltipOpen(false); onSelect(comment.id, { reply: true }); } : undefined}
        position={tooltipOpen ? tooltipPosition : null}
      />
    </>
  );
}

export default DocumentMarker;
