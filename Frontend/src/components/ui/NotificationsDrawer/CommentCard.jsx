import clsx from "clsx";

import Avatar from "../Avatar/Avatar.jsx";
import Button from "../Button/Button.jsx";
import SelectionPreview from "../Gallery/SelectionPreview.jsx";
import Tooltip from "../Tooltip/Tooltip.jsx";
import { MoreIcon, ReplyArrowIcon } from "./NotificationsDrawerIcons.jsx";

/**
 * Presenta una observación o respuesta con autor, fecha y referencia multimedia.
 * Delega selección y apertura de acciones mediante props; no navega ni controla
 * el drawer. Conserva la selección por teclado y la propagación original.
 * @param {Object} props Observación preparada y callbacks locales de interacción.
 * @returns {import("react").ReactElement} Tarjeta y acción de respuesta opcional.
 */
export default function CommentCard({
  avatarSrc,
  commentType,
  fileType,
  id,
  image,
  imageComment = false,
  name,
  observationTypeLabel,
  onSelect,
  pointNumber,
  timestamp,
  message,
  selection,
  type = "comment",
  showReplyAction = false,
  onMoreClick,
  onReplyClick,
}) {
  const isReply = type === "reply";
  const displayName =
    name && typeof name === "object"
      ? (name.name ?? name.email ?? String(name))
      : name;
  const isViewer3dComment = commentType === "panorama";
  const displayPointNumber = isViewer3dComment
    ? Number(pointNumber) || null
    : null;

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

      <div className="flex flex-1 flex-col gap-[8px]">
        <article
          className={clsx(
            "relative flex min-w-0 flex-1 flex-col gap-[2px] rounded-[8px] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-10)] p-[8px]",
            imageComment &&
              onSelect &&
              "cursor-pointer transition-colors hover:border-[var(--color-neutral-300)] focus-within:ring-2 focus-within:ring-[var(--color-primary-300)]",
          )}
          role={imageComment && onSelect ? "button" : undefined}
          tabIndex={imageComment && onSelect ? 0 : undefined}
          onClick={imageComment && onSelect ? onSelect : undefined}
          onKeyDown={
            imageComment && onSelect
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect();
                  }
                }
              : undefined
          }
        >
          <div className="flex w-full items-start pr-[28px]">
            <div className="flex min-w-0 items-center gap-[8px]">
              <Avatar
                size="S"
                content={avatarSrc ? "Image" : "Text"}
                theme="Brand 1"
                name={displayName}
                src={avatarSrc}
                alt={displayName}
                decorative={false}
              />
              <p className="text-[12px] font-normal leading-[14px] tracking-[-0.5px] text-[var(--color-text-300)]">
                {displayName}
              </p>
              <p className="text-[10px] font-normal leading-[12px] tracking-[-0.5px] text-[var(--color-text-100)]">
                {timestamp}
              </p>
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
                aria-controls={`reply-action-${id}`}
                className="absolute right-[-1px] top-[-1px] flex cursor-pointer shrink-0 items-center justify-center rounded-[8px] p-[8px] text-[var(--color-text-200)] transition-colors duration-200 hover:bg-[var(--color-neutral-10)] hover:text-[var(--color-text-300)]"
                data-reply-interaction="true"
                onClick={(event) => {
                  event.stopPropagation();
                  onMoreClick?.();
                }}
              >
                <MoreIcon />
              </button>
            </Tooltip>
          </div>

          <p className="text-[14px] font-normal leading-[17px] tracking-[-0.5px] text-[var(--color-text-100)]">
            {message}
          </p>

          {imageComment && selection && !isReply ? (
            <SelectionPreview
              compact
              fileType={fileType}
              image={image}
              mediaType={commentType}
              observationTypeLabel={observationTypeLabel}
              pointNumber={displayPointNumber}
              selection={selection}
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
              id={`reply-action-${id}`}
              type="button"
              onClick={onReplyClick}
              className="w-fit cursor-pointer"
              data-reply-interaction="true"
            >
              <ReplyButton />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

// Deuda conservada: Button queda dentro del botón de respuesta del padre.
// Su corrección cambiaría el markup, la navegación por teclado y la propagación.
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
