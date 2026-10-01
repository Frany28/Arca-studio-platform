import Button from "../../../components/ui/Button/Button.jsx";
import clsx from "clsx";
import FileAttachmentIcons from "../../../components/ui/FileAttachmentIcons/FileAttachmentIcons.jsx";
import { getFileDisplayName } from "../../../utils/fileDisplayName.js";

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

export default function ProjectDocumentListCard({
  document,
  selected = false,
  onClick,
}) {
  if (!document) {
    return null;
  }

  return (
    <Button layout="content"
      htmlType="button"
      onClick={onClick}
      className={clsx(
        "flex w-full cursor-pointer items-center gap-[24px] rounded-[var(--radius-3)] border bg-[var(--color-neutral-100)] p-[16px] text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-neutral-bg)]",
        selected
          ? "border-[var(--color-neutral-400)]"
          : "border-[var(--color-neutral-200)] hover:border-[var(--color-neutral-300)]",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-[12px]">
        <FileAttachmentIcons
          type={document.fileType}
          className="h-[40px] w-[35px] shrink-0"
        />

        <div className="flex min-w-0 flex-col">
          <p className="truncate text-heading-8 text-[var(--color-text-300)]">
            {getFileDisplayName(document.name)}
          </p>
          <p className="truncate text-body-3 text-[var(--color-text-100)]">
            {document.size}
            {document.uploadedAt ? ` • ${document.uploadedAt}` : ""}
          </p>
        </div>
      </div>

      <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-2)] text-[var(--color-text-200)]">
        <MoreIcon className="size-5" />
      </span>
    </Button>
  );
}
