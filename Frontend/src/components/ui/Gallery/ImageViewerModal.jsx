import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { getToggledCommentId } from "../../../utils/commentSelection.js";
import MainLogo from "../../../assets/logos/MainLogo.jsx";
import Button from "../../ui/Button/Button.jsx";
import Tooltip from "../../ui/Tooltip/Tooltip.jsx";
import GeneralCommentsDrawer from "./GeneralCommentsDrawer.jsx";
import ImageHighlighter from "./ImageHighlighter.jsx";
import { useImageComments } from "./useImageComments.js";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";

const MODAL_TRANSITION_MS = 320;
const MODAL_EASING = "ease-in-out";
const IMAGE_TRANSITION_MS = 180;

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

function ArrowLeftIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12.5 15L7.5 10L12.5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowRightIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M7.5 15L12.5 10L7.5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function normalizeItems(items) {
  const seen = new Set();

  return items.filter((item) => {
    if (!item?.image) return false;

    const key = item.id ?? item.image;
    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function ImageCarouselControl({ items, activeIndex, onSelect, onPrevious, onNext }) {
  if (items.length <= 1) {
    return null;
  }

  return (
    <div className="absolute bottom-[16px] left-1/2 flex -translate-x-1/2 items-center gap-[12px]">
      <Tooltip asChild portal showTip text="Imagen anterior" tipPosition="Top center">
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full text-[var(--color-neutral-100-uniform)] transition-colors hover:bg-[rgba(42,41,41,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)]"
          onClick={onPrevious}
          aria-label="Imagen anterior"
        >
          <ArrowLeftIcon className="size-5" />
        </button>
      </Tooltip>

      <div className="flex max-w-[340px] items-center gap-[6px] rounded-full bg-[rgba(42,41,41,0.82)] px-[10px] py-[7px]">
        {items.map((item, index) => (
          <Tooltip
            key={item.id ?? item.image}
            asChild
            portal
            showTip
            text={`Ver imagen ${index + 1}`}
            tipPosition="Top center"
          >
            <button
              type="button"
              className={clsx(
                "h-[8px] rounded-full transition-[width,background-color] duration-200",
                index === activeIndex
                  ? "w-[28px] bg-[var(--color-neutral-100-uniform)]"
                  : "w-[8px] bg-[var(--color-text-100)] hover:bg-[var(--color-neutral-300)]",
              )}
              onClick={() => onSelect(index)}
              aria-label={`Ver imagen ${index + 1}`}
              aria-current={index === activeIndex ? "true" : undefined}
            />
          </Tooltip>
        ))}
      </div>

      <Tooltip asChild portal showTip text="Imagen siguiente" tipPosition="Top center">
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full text-[var(--color-neutral-100-uniform)] transition-colors hover:bg-[rgba(42,41,41,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)]"
          onClick={onNext}
          aria-label="Imagen siguiente"
        >
          <ArrowRightIcon className="size-5" />
        </button>
      </Tooltip>
    </div>
  );
}

function getRootCommentId(comments, commentId) {
  if (!commentId) {
    return null;
  }

  const comment = comments.find(
    (currentComment) => String(currentComment.id) === String(commentId),
  );

  return comment?.parentCommentId || comment?.id || commentId;
}

export default function ImageViewerModal({
  focusedCommentId,
  visible = false,
  items = [],
  initialItem,
  projectId,
  onClose,
}) {
  const { readOnly } = useProjectReadOnly();
  const galleryItems = useMemo(() => normalizeItems(items), [items]);
  const initialIndex = useMemo(() => {
    const index = galleryItems.findIndex(
      (item) =>
        item.id === initialItem?.id ||
        (!item.id && item.image === initialItem?.image),
    );

    return index >= 0 ? index : 0;
  }, [galleryItems, initialItem]);

  const [shouldRender, setShouldRender] = useState(visible);
  const [isActive, setIsActive] = useState(false);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [displayIndex, setDisplayIndex] = useState(initialIndex);
  const [isImageVisible, setIsImageVisible] = useState(true);
  const [focusedSelectionCommentId, setFocusedSelectionCommentId] =
    useState(focusedCommentId);
  const closeTimeoutRef = useRef(null);
  const frameRef = useRef(null);
  const imageTimeoutRef = useRef(null);

  const displayItem = galleryItems[displayIndex];
  const { addComment, comments } = useImageComments(displayItem, {
    commentType: "image",
    projectId,
  });
  const [pendingSelection, setPendingSelection] = useState(null);
  const drawerComments = useMemo(() => {
    if (!focusedCommentId) {
      return comments;
    }

    return [...comments].sort((left, right) => {
      if (String(left.id) === String(focusedCommentId)) return -1;
      if (String(right.id) === String(focusedCommentId)) return 1;
      return 0;
    });
  }, [comments, focusedCommentId]);
  const annotationComments = useMemo(
    () =>
      comments.filter(
        (comment) => comment.selection && !comment.parentCommentId,
      ),
    [comments],
  );
  const focusedAnnotationId = useMemo(
    () => getRootCommentId(comments, focusedSelectionCommentId),
    [comments, focusedSelectionCommentId],
  );

  useEffect(() => {
    window.clearTimeout(closeTimeoutRef.current);
    window.cancelAnimationFrame(frameRef.current);

    if (visible && galleryItems.length > 0) {
      setActiveIndex(initialIndex);
      setDisplayIndex(initialIndex);
      setIsImageVisible(true);
      setIsActive(false);
      setPendingSelection(null);
      setFocusedSelectionCommentId(focusedCommentId);
      setShouldRender(true);
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = window.requestAnimationFrame(() => {
          setIsActive(true);
        });
      });

      return undefined;
    }

    setIsActive(false);
    closeTimeoutRef.current = window.setTimeout(() => {
      setShouldRender(false);
    }, MODAL_TRANSITION_MS);

    return () => {
      window.clearTimeout(closeTimeoutRef.current);
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [focusedCommentId, visible, galleryItems.length, initialIndex]);

  useEffect(() => {
    if (!visible || activeIndex === displayIndex) {
      return undefined;
    }

    window.clearTimeout(imageTimeoutRef.current);
    setIsImageVisible(false);

    imageTimeoutRef.current = window.setTimeout(() => {
      setDisplayIndex(activeIndex);
      setPendingSelection(null);
      setFocusedSelectionCommentId(null);
      window.requestAnimationFrame(() => setIsImageVisible(true));
    }, IMAGE_TRANSITION_MS);

    return () => {
      window.clearTimeout(imageTimeoutRef.current);
    };
  }, [activeIndex, displayIndex, visible]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose?.();
      }

      if (event.key === "ArrowLeft") {
        setActiveIndex((current) =>
          current === 0 ? galleryItems.length - 1 : current - 1,
        );
      }

      if (event.key === "ArrowRight") {
        setActiveIndex((current) =>
          current === galleryItems.length - 1 ? 0 : current + 1,
        );
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [galleryItems.length, onClose, visible]);

  useEffect(
    () => () => {
      window.clearTimeout(closeTimeoutRef.current);
      window.clearTimeout(imageTimeoutRef.current);
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

  const handlePrevious = () => {
    setActiveIndex((current) =>
      current === 0 ? galleryItems.length - 1 : current - 1,
    );
  };

  const handleNext = () => {
    setActiveIndex((current) =>
      current === galleryItems.length - 1 ? 0 : current + 1,
    );
  };

  const handleSelectionChange = (selection) => {
    if (readOnly) return;
    setFocusedSelectionCommentId(null);
    setPendingSelection({
      ...selection,
      image: {
        id: displayItem.id,
        src: displayItem.image,
        title: displayItem.title,
      },
      imageSrc: displayItem.image,
    });
  };

  const handleSubmitComment = async ({ message, parentCommentId, selection }) => {
    const comment = await addComment({ message, parentCommentId, selection });

    if (comment && !parentCommentId) {
      setPendingSelection(null);
    }
  };

  return createPortal(
    <div
      className={clsx(
        "fixed inset-0 z-[60] overflow-hidden bg-[rgba(0,0,0,0.42)] backdrop-blur-[10px] transition-opacity",
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
          className={clsx(
            "relative min-w-0 flex-1 overflow-hidden",
            "rounded-[var(--radius-3)] bg-[var(--color-neutral-200)]",
            "h-[calc(100dvh-32px)]",
            "max-[920px]:h-[62dvh] max-[920px]:min-h-[360px] max-[920px]:flex-none",
            "max-[520px]:h-[58dvh] max-[520px]:min-h-[300px]",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className={clsx(
              "absolute inset-0 transition-[opacity,transform] duration-200 ease-out",
              isImageVisible
                ? "scale-100 opacity-100"
                : "scale-[1.01] opacity-0",
            )}
          >
            <ImageHighlighter
              annotations={annotationComments}
              focusedAnnotationId={focusedAnnotationId}
              imageSrc={displayItem.image}
              onSelectionChange={readOnly ? undefined : handleSelectionChange}
            />
          </div>

          <div className="pointer-events-none absolute inset-0 bg-[rgba(42,41,41,0.18)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[120px] bg-[linear-gradient(180deg,rgba(0,0,0,0.26)_0%,rgba(0,0,0,0)_100%)]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[170px] bg-[linear-gradient(0deg,rgba(0,0,0,0.40)_0%,rgba(0,0,0,0)_100%)]" />

          <div className="absolute left-[12px] top-[12px]">
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
            aria-label="Cerrar imagen"
            tooltip={false}
            onClick={onClose}
            className="absolute right-[8px] top-[8px] size-9 text-[var(--color-text-200)]"
          />

          <ImageCarouselControl
            items={galleryItems}
            activeIndex={activeIndex}
            onSelect={setActiveIndex}
            onPrevious={handlePrevious}
            onNext={handleNext}
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
            comments={drawerComments}
            focusedSelectionCommentId={focusedSelectionCommentId}
            mediaItem={displayItem}
            mediaType="image"
            pendingSelection={pendingSelection}
            onClearSelection={() => setPendingSelection(null)}
            onSelectionPreviewClick={(commentId) =>
              setFocusedSelectionCommentId((currentId) =>
                getToggledCommentId(currentId, commentId),
              )
            }
            onSubmitComment={handleSubmitComment}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}
