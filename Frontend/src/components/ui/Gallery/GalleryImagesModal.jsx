import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import Button from "../../ui/Button/Button.jsx";
import Modal from "../../ui/Modal/Modal.jsx";
import ScrollBar from "../../ui/ScrollBar/ScrollBar.jsx";
import GalleryImageCard from "./GalleryImageCard.jsx";
import ImageViewerModal from "./ImageViewerModal.jsx";

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

function GalleryMosaic({ items, onSelectImage }) {
  const desktopRowPatterns = [
    "grid-cols-[220.515px_minmax(0,1fr)_minmax(0,1fr)]",
    "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220.515px]",
    "grid-cols-[minmax(0,1fr)_220.515px_minmax(0,1fr)]",
  ];
  const rows = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 3) {
    rows.push(items.slice(itemIndex, itemIndex + 3));
  }

  return (
    <div className="flex w-full flex-col gap-[20px] max-[900px]:gap-[16px] max-[520px]:gap-[12px]">
      {rows.map((row, rowIndex) => (
        <div
          key={`gallery-row-${rowIndex}`}
          className={clsx(
            "grid w-full gap-[20px] max-[900px]:grid-cols-2 max-[900px]:gap-[16px] max-[520px]:grid-cols-1 max-[520px]:gap-[12px]",
            desktopRowPatterns[rowIndex % desktopRowPatterns.length],
          )}
        >
          {row.map((item, columnIndex) => {
            const itemIndex = rowIndex * 3 + columnIndex;

            return (
              <GalleryImageCard
                key={item.id ?? `gallery-modal-${itemIndex}`}
                item={item}
                size="full"
                onClick={() => onSelectImage(item)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function GalleryImagesModal({
  visible = false,
  items = [],
  projectId,
  title = "Galería de Imágenes",
  onClose,
  className,
}) {
  const viewportRef = useRef(null);
  const [selectedImage, setSelectedImage] = useState(null);

  const [scrollState, setScrollState] = useState({
    length: 1,
    position: 0,
    height: 240,
  });

  const handleClose = useCallback(() => {
    setSelectedImage(null);
    onClose?.();
  }, [onClose]);

  const syncScrollState = useCallback(() => {
    const element = viewportRef.current;

    if (!element) return;

    const maxScrollTop = Math.max(
      element.scrollHeight - element.clientHeight,
      0,
    );

    const nextLength =
      element.scrollHeight > 0
        ? Math.min(element.clientHeight / element.scrollHeight, 1)
        : 1;

    const nextPosition =
      maxScrollTop > 0 ? element.scrollTop / maxScrollTop : 0;

    setScrollState({
      length: nextLength,
      position: nextPosition,
      height: element.clientHeight,
    });
  }, []);

  const handleScrollBarPositionChange = useCallback((nextPosition) => {
    const element = viewportRef.current;

    if (!element) return;

    const maxScrollTop = Math.max(
      element.scrollHeight - element.clientHeight,
      0,
    );

    element.scrollTop = maxScrollTop * nextPosition;
  }, []);

  useEffect(() => {
    if (!visible) return undefined;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frameId = window.requestAnimationFrame(syncScrollState);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.cancelAnimationFrame(frameId);
    };
  }, [visible, items, syncScrollState]);

  useEffect(() => {
    if (!visible) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (selectedImage) {
          setSelectedImage(null);
          return;
        }

        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleClose, selectedImage, visible]);

  useEffect(() => {
    if (visible) return undefined;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSelectedImage(null);
    });

    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (
      !visible ||
      !viewportRef.current ||
      typeof ResizeObserver === "undefined"
    ) {
      return undefined;
    }

    const observer = new ResizeObserver(syncScrollState);
    observer.observe(viewportRef.current);

    return () => {
      observer.disconnect();
    };
  }, [visible, syncScrollState]);

  return (
    <Modal
      visible={visible}
      mount="viewport"
      alignment="Centered"
      overlayVariant="blurred"
      transitionPreset="fade-scale"
      showDialog
      onClose={handleClose}
      className="z-50"
      dialogShellClassName="!pb-0"
      contentClassName="!p-0"
    >
      <section
        className={clsx(
          "flex w-[min(956px,calc(100vw-32px))] flex-col items-start overflow-hidden",
          "h-[min(769px,calc(100dvh-32px))]",
          "gap-[var(--spacing-spacing-gap-5,16px)]",
          "p-[var(--spacing-spacing-gap-6,20px)]",
          "rounded-[var(--radius-radius-3,var(--radius-3,12px))]",
          "bg-[var(--Color-neutral-100,var(--color-neutral-100,#fff))]",
          "dark:bg-[var(--color-neutral-100)]",
          "max-[768px]:h-[calc(100dvh-24px)] max-[768px]:w-[calc(100vw-24px)]",
          "max-[520px]:h-[calc(100dvh-16px)] max-[520px]:w-[calc(100vw-16px)]",
          "max-[640px]:p-[12px]",
          "max-[640px]:gap-[12px]",
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex w-full items-center justify-between">
          <h2 className="text-heading-8 text-[var(--Color-text-primary-300,var(--color-text-300,#2A2929))]">
            {title}
          </h2>

          <Button
            theme="Primary"
            type="Ghost"
            size="S"
            showText={false}
            showLeftIcon
            showRightIcon={false}
            iconLeft={<CloseIcon className="size-3" />}
            aria-label="Cerrar galería de imágenes"
            tooltip={false}
            onClick={handleClose}
            className="size-9 shrink-0 text-[var(--Color-text-primary-200,var(--color-text-200,#4E4E4E))] dark:text-[var(--color-text-200)]"
          />
        </header>

        {/* Sin overflow-hidden: el ScrollBar se sitúa en el padding derecho de la sección y este
            contenedor lo recortaba. El área desplazable ya recorta las imágenes y la sección el modal. */}
        <div className="relative min-h-0 w-full flex-1">
          <div
            ref={viewportRef}
            className={clsx(
              // Con padding de 12px el track (16px) invadiría 4px de las imágenes: se les reservan.
              "h-full overflow-y-auto max-[640px]:pr-[4px] max-[520px]:pr-0",
              "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
            )}
            onScroll={syncScrollState}
          >
            <GalleryMosaic
              items={items}
              onSelectImage={setSelectedImage}
            />
          </div>

          <div className="pointer-events-auto absolute right-[-20px] top-[-4px] h-full max-[640px]:right-[-12px] max-[520px]:hidden">
            <ScrollBar
              length={scrollState.length}
              position={scrollState.position}
              height={scrollState.height}
              interactive
              onPositionChange={handleScrollBarPositionChange}
            />
          </div>
        </div>
      </section>

      <ImageViewerModal
        visible={Boolean(selectedImage)}
        items={items}
        initialItem={selectedImage}
        projectId={projectId}
        onClose={() => setSelectedImage(null)}
      />
    </Modal>
  );
}
