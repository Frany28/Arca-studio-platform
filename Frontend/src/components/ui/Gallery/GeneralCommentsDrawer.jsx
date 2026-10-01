import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import AvatarLabel from "../AvatarLabel/AvatarLabel.jsx";
import Button from "../Button/Button.jsx";
import Label from "../Label/Label.jsx";
import TextArea from "../TextArea/TextArea.jsx";
import Tooltip from "../Tooltip/Tooltip.jsx";
import { orderCommentsByThread } from "../../../utils/commentDisplay.js";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";
import SelectionPreview from "./SelectionPreview.jsx";
function MoreIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M4.167 10H4.176M10 10H10.009M15.833 10H15.842"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M7.92473 3.52462L15.0581 7.09129C18.2581 8.69129 18.2581 11.308 15.0581 12.908L7.92473 16.4746C3.12473 18.8746 1.1664 16.908 3.5664 12.1163L4.2914 10.6746C4.47473 10.308 4.47473 9.69962 4.2914 9.33296L3.5664 7.88296C1.1664 3.09129 3.13306 1.12462 7.92473 3.52462Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.53345 10H9.03345"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReplyArrowIcon({ className }) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={clsx("h-[16.5px] w-[16.5px] shrink-0", className)}
      aria-hidden="true"
    >
      <path
        d="M6.75 13.5H4.5C3.25736 13.5 2.25 12.4926 2.25 11.25V4.5"
        stroke="var(--color-neutral-300)"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.75 11.25L9 13.5L6.75 15.75"
        stroke="var(--color-neutral-300)"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReplyButton() {
  return (
    <div className="flex items-center gap-[4px]">
      <ReplyArrowIcon />
      <Button
        theme="Primary"
        type="Ghost"
        size="S"
        fitContent
        showLeftIcon={false}
        showRightIcon={false}
        className="!h-auto !px-0 !py-0 text-[var(--color-text-300)] hover:!bg-transparent hover:opacity-75"
      >
        Responder
      </Button>
    </div>
  );
}

function CommentCard({
  id,
  author,
  avatarSrc,
  time,
  body,
  image,
  mediaItem,
  mediaType = "render",
  message,
  name,
  observationTypeLabel,
  pointNumber,
  selection,
  selectionDisabled = false,
  timestamp,
  type = "comment",
  selectionActive = false,
  showReplyAction = false,
  onMoreClick,
  onReplyClick,
  onSelectionClick,
}) {
  const isReply = type === "reply";
  const displayAuthor = name ?? author;
  const displayTime = time ?? timestamp;
  const displayBody = body ?? message;
  const resolveString = (value) => {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean")
      return String(value);
    if (typeof value === "object") {
      return value.name ?? value.email ?? JSON.stringify(value);
    }
    return String(value);
  };

  const safeDisplayAuthor = resolveString(displayAuthor);
  const safeDisplayTime = resolveString(displayTime);

  return (
    <div
      className={clsx(
        "flex w-full items-start",
        isReply ? "gap-[4px]" : "gap-0",
      )}
    >
      {isReply ? (
        <span className="mt-0 inline-flex size-[16.5px] shrink-0 items-start justify-center">
          <ReplyArrowIcon />
        </span>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
        <article className="relative flex min-w-0 flex-1 flex-col gap-[2px] rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-10)] p-[8px] transition-colors">
          <div className="flex w-full items-start pr-[28px]">
            <div className="flex min-w-0 items-center gap-[8px]">
              <AvatarLabel
                size="S"
                label={safeDisplayAuthor}
                showSubtitle={false}
                avatarTheme="Neutral"
                avatarContent={avatarSrc ? "Image" : "Text"}
                avatarName={safeDisplayAuthor}
                avatarSrc={avatarSrc}
                avatarAlt={safeDisplayAuthor}
                avatarDecorative={false}
              />
              <span className="shrink-0 text-[10px] leading-[12px] tracking-[-0.5px] text-[var(--color-text-100)]">
                {safeDisplayTime}
              </span>
            </div>

            <Tooltip
              asChild
              portal
              showTip
              text="Más opciones"
              tipPosition="Bottom right"
            >
              <button
                type="button"
                aria-label="Más opciones"
                aria-expanded={showReplyAction}
                aria-controls={`image-reply-action-${id}`}
                className="absolute right-[-1px] top-[-1px] flex cursor-pointer shrink-0 items-center justify-center rounded-[var(--radius-2)] p-[8px] text-[var(--color-text-200)] transition-colors hover:bg-[var(--color-neutral-10)] hover:text-[var(--color-text-300)]"
                data-reply-interaction="true"
                onClick={onMoreClick}
              >
                <MoreIcon className="size-5" />
              </button>
            </Tooltip>
          </div>

          <p className="text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-100)]">
            {displayBody}
          </p>

          {selection && !isReply ? (
            <SelectionPreview
              active={selectionActive}
              fileType={mediaItem?.fileType}
              image={image}
              mediaType={mediaType}
              observationTitle={observationTypeLabel}
              pointNumber={pointNumber}
              selection={selection}
              disabled={selectionDisabled}
              compact
              onSelect={onSelectionClick}
            />
          ) : !isReply && mediaType === "video" ? (
            <MediaReferencePreview
              imageSrc={image?.src || mediaItem?.image}
              subtitle="Vista asociada a la observación"
              title="Video adjunto"
            />
          ) : null}
        </article>

        {showReplyAction ? (
          <Tooltip
            asChild
            text="Presiona para responder"
            tipPosition="Top center"
            showTip
            portal
          >
            <button
              id={`image-reply-action-${id}`}
              type="button"
              className="w-fit cursor-pointer"
              data-reply-interaction="true"
              onClick={onReplyClick}
            >
              <ReplyButton />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

function MediaReferencePreview({ imageSrc, subtitle, title }) {
  if (!imageSrc) {
    return null;
  }

  return (
    <div className="flex w-full items-center gap-[8px] rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[6px] text-left">
      <div
        className="relative size-[44px] shrink-0 overflow-hidden rounded-[6px] bg-[var(--color-neutral-200)] bg-cover bg-center"
        style={{ backgroundImage: `url(${imageSrc})` }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] leading-[14px] tracking-[-0.5px] text-[var(--color-text-300)]">
          {title}
        </p>
        <p className="truncate text-[10px] leading-[12px] tracking-[-0.5px] text-[var(--color-text-100)]">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

function MessageInput({
  disabled = false,
  fileType,
  focusSignal,
  mediaType = "render",
  onClearSelection,
  onSubmit,
  pendingSelection,
  placeholder,
  multiline = false,
  requireSelection = false,
}) {
  const fieldRef = useRef(null);
  const fieldId = useId();
  const [textAreaValue, setTextAreaValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const trimmedValue = textAreaValue.trim();

  useEffect(() => {
    if (!focusSignal) {
      return;
    }

    const field = fieldRef.current?.querySelector("textarea, input");

    field?.focus?.();
    field?.scrollIntoView?.({
      block: "nearest",
      behavior: "smooth",
    });
  }, [focusSignal]);

  async function handleSubmit() {
    if (disabled || isSubmitting || !trimmedValue || (requireSelection && !pendingSelection)) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit?.(trimmedValue);
      setTextAreaValue("");
    } catch {
      // The caller renders the request error; keep the draft available to retry.
    } finally {
      setIsSubmitting(false);
    }
  }

  return multiline ? (
    <div ref={fieldRef} className="flex flex-col gap-[8px]">
      <Label
        htmlFor={fieldId}
        label="Observación general"
        information={false}
        required={false}
      />
      {pendingSelection ? (
        <SelectionPreview
          fileType={fileType}
          image={pendingSelection.image}
          mediaType={mediaType}
          pointNumber={pendingSelection.pointNumber}
          selection={pendingSelection}
          onClear={onClearSelection}
        />
      ) : null}
      <TextArea
        id={fieldId}
        disabled={disabled || isSubmitting || (requireSelection && !pendingSelection)}
        showLabel={false}
        placeholder={
          disabled
            ? placeholder
            : requireSelection && !pendingSelection
              ? "Selecciona un punto en el documento"
              : placeholder
        }
        value={textAreaValue}
        showHint={false}
        showLabelInfo={false}
        minHeight={104}
        rows={4}
        className="!max-w-none"
        onChange={(event) => setTextAreaValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSubmit();
          }
        }}
      />
      <div className="flex justify-end">
        <Tooltip asChild portal showTip text="Enviar observación" tipPosition="Top right">
          <button
            type="button"
            aria-label="Enviar observación"
            disabled={
              disabled ||
              isSubmitting ||
              !trimmedValue ||
              (requireSelection && !pendingSelection)
            }
            className="flex size-8 cursor-pointer items-center justify-center rounded-[var(--radius-2)] text-[var(--color-neutral-300)] transition-colors hover:bg-[var(--color-neutral-200)] hover:text-[var(--color-text-300)] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handleSubmit}
          >
            <SendIcon className="size-5" />
          </button>
        </Tooltip>
      </div>
    </div>
  ) : (
    <div ref={fieldRef} className="flex w-full items-start gap-[4px]">
      <ReplyArrowIcon />

      <div className="flex min-w-0 flex-1 items-center rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] px-[12px] py-[8px]">
        <input
          type="text"
          placeholder={placeholder}
          value={textAreaValue}
          className="min-w-0 flex-1 border-0 bg-transparent text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-300)] outline-none placeholder:text-[var(--color-text-100)]"
          onChange={(event) => setTextAreaValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSubmit();
            }
          }}
        />

        <Tooltip asChild portal showTip text="Enviar mensaje" tipPosition="Top right">
          <button
            type="button"
            aria-label="Enviar mensaje"
            disabled={!trimmedValue}
            className="flex size-5 cursor-pointer shrink-0 items-center justify-center text-[var(--color-neutral-300)] hover:text-[var(--color-text-300)] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handleSubmit}
          >
            <SendIcon className="size-5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function ReplyComposer({ disabled = false, focusSignal, onSubmit, placeholder = "Escribe tu mensaje..." }) {
  return (
    <div data-reply-interaction="true">
      <MessageInput disabled={disabled} focusSignal={focusSignal} placeholder={placeholder} onSubmit={onSubmit} />
    </div>
  );
}

export default function GeneralCommentsDrawer({
  composerDisabled = false,
  composerDisabledMessage = "",
  commentsError = "",
  composerFocusSignal,
  comments = [],
  focusedSelectionCommentId = null,
  mediaItem = null,
  mediaType = "render",
  onClearSelection,
  onSelectionPreviewClick,
  onSubmitComment,
  pendingSelection,
  replyRequest = null,
  requireSelectionForRoot = false,
  selectionDisabled = false,
}) {
  const { message: readOnlyMessage, readOnly } = useProjectReadOnly();
  const [visibleReplyAction, setVisibleReplyAction] = useState(null);
  const [activeReplyComposer, setActiveReplyComposer] = useState(null);
  const commentRefs = useRef(new Map());
  const orderedComments = orderCommentsByThread(comments);
  const resolvedComposerDisabled = composerDisabled || readOnly;
  const resolvedComposerDisabledMessage = readOnly
    ? readOnlyMessage
    : composerDisabledMessage;
  const resolvedSelectionDisabled = selectionDisabled || readOnly;

  useEffect(() => {
    if (!replyRequest?.commentId) return;
    const frameId = window.requestAnimationFrame(() => {
      setVisibleReplyAction(null);
      setActiveReplyComposer(replyRequest.commentId);
      commentRefs.current.get(String(replyRequest.commentId))?.scrollIntoView?.({
        block: "nearest",
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [replyRequest]);

  useEffect(() => {
    if (!focusedSelectionCommentId) {
      return;
    }

    const element = commentRefs.current.get(String(focusedSelectionCommentId));

    element?.scrollIntoView?.({
      block: "nearest",
      behavior: "smooth",
    });
  }, [focusedSelectionCommentId]);

  useEffect(() => {
    if (!visibleReplyAction && !activeReplyComposer) {
      return undefined;
    }

    function handlePointerDown(event) {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest("[data-reply-interaction='true']")
      ) {
        return;
      }

      setVisibleReplyAction(null);
      setActiveReplyComposer(null);
    }

    window.addEventListener("mousedown", handlePointerDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [visibleReplyAction, activeReplyComposer]);

  function handleMoreClick(commentId) {
    if (resolvedComposerDisabled) return;
    setActiveReplyComposer(null);
    setVisibleReplyAction((currentId) =>
      currentId === commentId ? null : commentId,
    );
  }

  function handleReplyClick(commentId) {
    if (resolvedComposerDisabled) return;
    setVisibleReplyAction(null);
    setActiveReplyComposer(commentId);
  }

  async function handleCommentSubmit(message, parentComment = null) {
    const parentCommentId =
      parentComment && typeof parentComment === "object"
        ? parentComment.parentCommentId || parentComment.id
        : parentComment;

    await onSubmitComment?.({
      message,
      parentCommentId,
      selection: parentCommentId ? null : pendingSelection,
    });

    if (parentCommentId) {
      setActiveReplyComposer(null);
    }
  }

  return (
    <aside className="flex h-full w-full shrink-0 flex-col rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[16px]">
      <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto pr-[2px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <MessageInput
          disabled={resolvedComposerDisabled}
          fileType={mediaItem?.fileType}
          focusSignal={composerFocusSignal}
          multiline
          mediaType={mediaType}
          pendingSelection={pendingSelection}
          requireSelection={requireSelectionForRoot}
          placeholder="Escribe algo..."
          onClearSelection={onClearSelection}
          onSubmit={(message) => handleCommentSubmit(message)}
        />
        {resolvedComposerDisabled && resolvedComposerDisabledMessage ? (
          <p className="text-[12px] leading-[16px] text-[var(--color-text-100)]">
            {resolvedComposerDisabledMessage}
          </p>
        ) : null}
        {commentsError ? (
          <p role="alert" className="text-[12px] leading-[16px] text-[var(--color-danger-300)]">
            {commentsError}
          </p>
        ) : null}

        <div className="flex flex-col gap-[8px]">
          {orderedComments.map((comment) => (
            <div
              key={comment.id}
              ref={(element) => {
                const key = String(comment.id);

                if (element) {
                  commentRefs.current.set(key, element);
                  return;
                }

                commentRefs.current.delete(key);
              }}
              className="flex flex-col gap-[8px]"
            >
              <CommentCard
                {...comment}
                mediaItem={mediaItem}
                mediaType={mediaType}
                selectionActive={
                  String(focusedSelectionCommentId) === String(comment.id)
                }
                selectionDisabled={resolvedSelectionDisabled}
                showReplyAction={!resolvedComposerDisabled && visibleReplyAction === comment.id}
                onMoreClick={resolvedComposerDisabled ? undefined : () => handleMoreClick(comment.id)}
                onReplyClick={resolvedComposerDisabled ? undefined : () => handleReplyClick(comment.id)}
                onSelectionClick={
                  comment.selection
                    ? () => onSelectionPreviewClick?.(comment.id)
                    : undefined
                }
              />

              {activeReplyComposer === comment.id ? (
                <ReplyComposer
                  disabled={resolvedComposerDisabled}
                  focusSignal={replyRequest?.requestId || comment.id}
                  onSubmit={(message) =>
                    handleCommentSubmit(message, comment)
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

