import clsx from "clsx";
import Model3DThumbnail from "../../../../components/ui/Gallery/Model3DThumbnail.jsx";
import { getFileDisplayName } from "../../../../utils/fileDisplayName.js";

function RenderThumbnail({ item, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        "group relative h-[150px] w-full cursor-pointer overflow-hidden rounded-[var(--radius-2)] text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-neutral-bg)]",
        selected
          ? "ring-1 ring-[var(--color-neutral-300)]"
          : "hover:opacity-90",
      )}
      aria-pressed={selected}
    >
      <Model3DThumbnail
        item={item}
        alt={item.title}
        className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.02)_0%,rgba(0,0,0,0.12)_35%,rgba(0,0,0,0.52)_100%)]" />
      <span className="absolute inset-x-[8px] bottom-[8px] text-heading-8 text-[var(--color-neutral-100-uniform)]">
        {getFileDisplayName(item.title)}
      </span>
    </button>
  );
}

export default function RenderThumbnailRail({ items, activeRenderId, onSelect }) {
  return (
    <aside className="flex h-[480px] w-[200px] shrink-0 flex-col overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] max-[1024px]:h-auto max-[1024px]:w-full [&::-webkit-scrollbar]:hidden">
      <div className="flex flex-col gap-[12px] pr-[4px]">
        {items.map((item) => (
          <RenderThumbnail
            key={item.id}
            item={item}
            selected={item.id === activeRenderId}
            onSelect={() => onSelect(item.id)}
          />
        ))}
      </div>
    </aside>
  );
}
