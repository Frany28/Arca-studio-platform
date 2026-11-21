import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { getToggledCommentId } from "../../../utils/commentSelection.js";
import GeneralCommentsDrawer from "./GeneralCommentsDrawer.jsx";
import ImageViewerStage from "./ImageViewerStage.jsx";
import { useImageComments } from "./useImageComments.js";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";

const MODAL_TRANSITION_MS = 320;
const MODAL_EASING = "ease-in-out";
const IMAGE_TRANSITION_MS = 180;

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
      queueMicrotask(() => {
        setActiveIndex(initialIndex);
        setDisplayIndex(initialIndex);
        setIsImageVisible(true);
        setIsActive(false);
        setPendingSelection(null);
        setFocusedSelectionCommentId(focusedCommentId);
        setShouldRender(true);
      });
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = window.requestAnimationFrame(() => {
          setIsActive(true);
        });
      });

      return undefined;
    }

    queueMicrotask(() => {
      setIsActive(false);
    });
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
    queueMicrotask(() => {
      setIsImageVisible(false);
    });

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
        <ImageViewerStage
          annotations={annotationComments}
          focusedAnnotationId={focusedAnnotationId}
          imageSrc={displayItem.image}
          isImageVisible={isImageVisible}
          onSelectionChange={readOnly ? undefined : handleSelectionChange}
          onClose={onClose}
          carousel={{ activeIndex, items: galleryItems, onNext: handleNext, onPrevious: handlePrevious, onSelect: setActiveIndex }}
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
