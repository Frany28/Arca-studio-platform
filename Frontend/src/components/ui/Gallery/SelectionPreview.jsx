import clsx from "clsx";
import { getVideoObservationTiming } from "../../../utils/videoObservation.js";
import { getPanoramaOrientation } from "../../../utils/panoramaCoordinates.js";
import FileAttachmentIcons from "../FileAttachmentIcons/FileAttachmentIcons.jsx";
import { CloseIcon } from "./viewerIcons.jsx";
export default function SelectionPreview({
  active = false,
  compact = false,
  disabled = false,
  fileType = "PDF",
  image,
  mediaType = "render",
  observationTitle,
  onClear,
  onSelect,
  pointNumber,
  selection,
}) {
  if (!selection) {
    return null;
  }

  const videoTiming = getVideoObservationTiming(selection);
  const Container = onSelect && !onClear ? "button" : "div";

  if (videoTiming) {
    return (
      <Container
        type={onSelect ? "button" : undefined}
        disabled={onSelect ? disabled : undefined}
        className={clsx(
          "flex w-full items-center gap-[8px] rounded-[var(--radius-2)] border bg-[var(--color-neutral-100)] p-[6px] text-left transition-colors",
          active
            ? "border-[var(--color-accent-300)]"
            : "border-[var(--color-neutral-200)]",
          onSelect && !disabled &&
            "cursor-pointer hover:border-[var(--color-neutral-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)]",
          onSelect && disabled && "cursor-not-allowed opacity-60",
        )}
        onClick={onSelect}
      >
        <div className="flex size-[44px] shrink-0 items-center justify-center rounded-[6px] bg-[var(--color-neutral-200)] text-[12px] font-semibold text-[var(--color-text-300)]">
          {videoTiming.videoTimeLabel}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] leading-[14px] tracking-[-0.5px] text-[var(--color-text-300)]">
            {observationTitle || "Observación sobre video"}
          </p>
          <p className="truncate text-[10px] leading-[12px] tracking-[-0.5px] text-[var(--color-text-100)]">
            Momento {videoTiming.videoTimeLabel}
          </p>
        </div>
        {onClear ? (
          <button
            type="button"
            aria-label="Quitar referencia"
            className="flex size-[28px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[var(--color-text-200)] transition-colors hover:bg-[var(--color-neutral-200)] hover:text-[var(--color-text-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)]"
            onClick={(event) => {
              event.stopPropagation();
              onClear();
            }}
          >
            <CloseIcon className="size-3" />
          </button>
        ) : null}
      </Container>
    );
  }

  const isViewerPoint = ["panorama-point", "viewer3d-point"].includes(selection.kind);
  const isDocumentPoint = selection.kind === "document-point";
  const pixels = selection.imagePixels ?? selection.displayPixels;
  const naturalSize = selection.naturalSize ?? {
    height: pixels?.height || 1,
    width: pixels?.width || 1,
  };
  const imageSrc = image?.src ?? selection.imageSrc;
  const safeWidth = Math.max(pixels?.width || 1, 1);
  const safeHeight = Math.max(pixels?.height || 1, 1);
  const panoramaOrientation = isViewerPoint
    ? getPanoramaOrientation(selection)
    : null;
  const panoramaU = panoramaOrientation
    ? ((((panoramaOrientation.yaw + 180) % 360) + 360) % 360) / 360
    : null;
  const panoramaV = panoramaOrientation
    ? Math.min(Math.max((90 - panoramaOrientation.pitch) / 180, 0), 1)
    : null;
  const bgSize = imageSrc
    ? isViewerPoint && panoramaOrientation
      ? "400% 200%"
      : `${(naturalSize.width / safeWidth) * 100}% ${(naturalSize.height / safeHeight) * 100}%`
    : undefined;
  const bgPosition = imageSrc
    ? isViewerPoint && panoramaOrientation
      ? `${Math.min(Math.max(((panoramaU * 4 - 0.5) / 3) * 100, 0), 100)}% ${Math.min(Math.max((panoramaV * 2 - 0.5) * 100, 0), 100)}%`
      : `${naturalSize.width === safeWidth ? 0 : (pixels.x / (naturalSize.width - safeWidth)) * 100}% ${
          naturalSize.height === safeHeight
            ? 0
            : (pixels.y / (naturalSize.height - safeHeight)) * 100
        }%`
    : undefined;

  const referenceNumber = Number(pointNumber) || null;
  const documentReferenceLabel = isDocumentPoint
    ? String(selection.pageNumber || "—")
    : selection.kind === "document-section-point"
      ? String(Number(selection.sectionIndex) + 1)
      : selection.kind === "document-cell-point"
        ? selection.cell
        : "—";
  const documentReferenceCaption = isDocumentPoint
    ? "Página"
    : selection.kind === "document-section-point"
      ? "Sección"
      : selection.kind === "document-cell-point"
        ? "Celda"
        : "Referencia";
  const referenceTitle =
    observationTitle ||
    (mediaType === "panorama"
      ? "Observación en panorámica 360"
      : mediaType === "image"
      ? "Observación sobre imagen"
      : mediaType === "video"
        ? "Observación sobre video"
        : mediaType === "document"
          ? "Observación sobre documento"
          : "Observación en modelo 3D");
  const referenceSubtitle =
    mediaType === "panorama"
      ? "Punto señalado en la panorámica"
      : mediaType === "image"
      ? "Área señalada en la imagen"
      : isDocumentPoint
        ? `Página ${selection.pageNumber}`
        : mediaType === "document"
          ? `${documentReferenceCaption} ${documentReferenceLabel}`
        : "Punto señalado en el modelo 3D";

  return (
    <Container
      type={onSelect ? "button" : undefined}
      disabled={onSelect ? disabled : undefined}
      className={clsx(
        "flex w-full items-center gap-[8px] rounded-[var(--radius-2)] border bg-[var(--color-neutral-100)] p-[6px] text-left transition-colors",
        active
          ? "border-[var(--color-accent-300)]"
          : "border-[var(--color-neutral-200)]",
        onSelect && !disabled &&
          "cursor-pointer hover:border-[var(--color-neutral-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)]",
        onSelect && disabled && "cursor-not-allowed opacity-60",
      )}
      onClick={onSelect}
    >
      <div
        className={clsx(
          "relative shrink-0 overflow-hidden rounded-[6px] bg-[var(--color-neutral-200)]",
          isViewerPoint &&
            !imageSrc &&
            "relative bg-[radial-gradient(circle_at_50%_50%,rgba(255,68,49,0.42)_0%,rgba(255,68,49,0.18)_24%,rgba(42,41,41,0.95)_25%,rgba(42,41,41,0.95)_100%)]",
          mediaType === "document" &&
            "flex items-center justify-center rounded-[var(--radius-1)] border-0 bg-transparent",
          mediaType === "document"
            ? compact ? "size-[36px]" : "size-[40px]"
            : compact ? "size-[44px]" : "size-[56px]",
        )}
        style={
          imageSrc
            ? {
                backgroundImage: `url(${imageSrc})`,
                backgroundPosition: bgPosition,
                backgroundRepeat: "no-repeat",
                backgroundSize: bgSize,
              }
            : undefined
        }
        aria-hidden="true"
      >
        {isViewerPoint && !imageSrc ? (
          <span className="absolute left-1/2 top-1/2 size-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent-300)] shadow-[0_0_0_4px_rgba(255,68,49,0.22)]" />
        ) : null}
        {mediaType === "document" ? (
          <FileAttachmentIcons
            aria-label={`Documento ${fileType}`}
            className="scale-[0.8]"
            type={fileType}
          />
        ) : referenceNumber ? (
          <span className="absolute left-1/2 top-1/2 flex size-[24px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[var(--color-neutral-100-uniform)] bg-[var(--color-accent-300)] text-[11px] font-semibold leading-none text-[var(--color-neutral-100-uniform)] shadow-[0_0_0_4px_rgba(255,68,49,0.22),0_2px_8px_rgba(0,0,0,0.28)]">
            {referenceNumber}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] leading-[14px] tracking-[-0.5px] text-[var(--color-text-300)]">
          {referenceTitle}
        </p>
        <p className="truncate text-[10px] leading-[12px] tracking-[-0.5px] text-[var(--color-text-100)]">
          {referenceSubtitle}
        </p>
      </div>
      {onClear ? (
        <button
          type="button"
          aria-label="Quitar referencia"
          className="flex size-[28px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[var(--color-text-200)] transition-colors hover:bg-[var(--color-neutral-200)] hover:text-[var(--color-text-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)]"
          onClick={(event) => {
            event.stopPropagation();
            onClear();
          }}
        >
          <CloseIcon className="size-3" />
        </button>
      ) : null}
    </Container>
  );
}

