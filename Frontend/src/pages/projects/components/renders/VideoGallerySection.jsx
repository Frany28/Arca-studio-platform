import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import VideoThumbnail from "../../../../components/ui/Gallery/VideoThumbnail.jsx";
import ScrollBar from "../../../../components/ui/ScrollBar.jsx";
import { getFileDisplayName } from "../../../../utils/fileDisplayName.js";
import MediaEmptyState from "./MediaEmptyState.jsx";

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

function VideoPreviewCard({ item, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative h-[385px] w-full cursor-pointer overflow-hidden rounded-[var(--radius-2)] text-left shadow-[var(--shadow-e2)] transition-opacity duration-150 hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-neutral-bg)]"
    >
      <VideoThumbnail
        item={item}
        alt={item.label ?? item.title}
        className="h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.00)_0%,rgba(0,0,0,0.10)_44%,rgba(0,0,0,0.56)_100%)]" />

      <div className="absolute left-1/2 top-1/2 flex size-[48px] -translate-x-1/2 -translate-y-1/2 items-center justify-center text-[var(--color-neutral-100-uniform)]">
        <PlayIcon className="size-[48px]" />
      </div>

      <div className="absolute bottom-0 left-0 p-[10px]">
        <span className="text-heading-8 text-[var(--color-neutral-100-uniform)]">
          {getFileDisplayName(item.label ?? item.title)}
        </span>
      </div>
    </button>
  );
}

function VideoListItem({ item, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className={clsx(
        "flex w-full cursor-pointer items-start gap-[12px] text-left transition-opacity duration-150",
        active ? "opacity-100" : "opacity-90 hover:opacity-100",
      )}
    >
      <div className="group relative h-[90px] w-[150px] shrink-0 overflow-hidden rounded-[var(--radius-1)] shadow-[var(--shadow-e2)]">
        <VideoThumbnail
          item={item}
          alt={item.label ?? item.title}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.00)_0%,rgba(0,0,0,0.10)_44%,rgba(0,0,0,0.56)_100%)]" />
        <div className="absolute left-1/2 top-1/2 flex size-[20px] -translate-x-1/2 -translate-y-1/2 items-center justify-center text-[var(--color-neutral-100-uniform)]">
          <PlayIcon className="size-5" />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
        <p className="truncate text-heading-8 text-[var(--color-text-300)]">
          {getFileDisplayName(item.title)}
        </p>
        <p className="text-body-3 text-[var(--color-text-100)]">
          {item.uploadedAt}
        </p>
        <p className="text-body-3 text-[var(--color-text-100)]">{item.size}</p>
      </div>
    </button>
  );
}

export default function VideoGallerySection({ items, onOpenGallery, onOpenVideo }) {
  const [activeVideoId, setActiveVideoId] = useState(items[0]?.id);
  const listViewportRef = useRef(null);
  const [scrollState, setScrollState] = useState({
    length: 1,
    position: 0,
  });

  const activeVideo = useMemo(
    () => items.find((item) => item.id === activeVideoId) ?? items[0],
    [activeVideoId, items],
  );

  const syncScrollState = useCallback(() => {
    const element = listViewportRef.current;

    if (!element) {
      return;
    }

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
    });
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      syncScrollState();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [items, syncScrollState]);

  const handleScrollBarPositionChange = useCallback((nextPosition) => {
    const element = listViewportRef.current;

    if (!element) {
      return;
    }

    const maxScrollTop = Math.max(
      element.scrollHeight - element.clientHeight,
      0,
    );
    element.scrollTop = maxScrollTop * nextPosition;
  }, []);

  if (!items.length || !activeVideo) {
    return (
      <section className="flex h-[287px] w-full flex-col gap-[16px] overflow-hidden rounded-[var(--radius-3)]">
        <div className="flex w-full items-center justify-between">
          <span className="text-heading-8 text-[var(--color-text-200)]">
            Galería de Videos
          </span>

          <Button
            theme="Primary"
            type="Outline"
            size="S"
            fitContent
            showLeftIcon={false}
            showRightIcon={false}
            onClick={onOpenGallery}
          >
            Ver más
          </Button>
        </div>

        <MediaEmptyState
          title="Aún no hay videos"
          description="Esta sección muestra los videos creados para el proyecto."
          className="h-[206px]"
          small
        />
      </section>
    );
  }

  return (
    <div className="flex w-full flex-col gap-[16px]">
      <div className="flex w-full items-center justify-between">
        <span className="text-heading-8 text-[var(--color-text-200)]">
          Galería de Videos
        </span>

        <Button
          theme="Primary"
          type="Outline"
          size="S"
          fitContent
          showLeftIcon={false}
          showRightIcon={false}
          onClick={onOpenGallery}
        >
          Ver más
        </Button>
      </div>

      <div className="flex h-[385px] w-full items-start gap-[16px] max-[1024px]:h-auto max-[1024px]:flex-col">
        <div className="w-[696px] max-w-full flex-1">
          <VideoPreviewCard
            item={activeVideo}
            onClick={() => onOpenVideo(activeVideo)}
          />
        </div>

        <div className="flex h-full min-w-[0] flex-1 items-start max-[1024px]:w-full">
          <div
            ref={listViewportRef}
            className="flex h-full min-w-0 flex-1 flex-col gap-[16px] overflow-y-auto pr-[12px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden max-[1024px]:max-h-[385px]"
            onScroll={syncScrollState}
          >
            {items.map((item) => (
              <VideoListItem
                key={item.id}
                item={item}
                active={item.id === activeVideo.id}
                onSelect={setActiveVideoId}
              />
            ))}
          </div>

          <div className="flex shrink-0 self-stretch">
            <ScrollBar
              height={385}
              length={scrollState.length}
              position={scrollState.position}
              interactive
              onPositionChange={handleScrollBarPositionChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
