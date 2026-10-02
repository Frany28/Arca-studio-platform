import clsx from "clsx";
import Tag from "../../Tag/Tag.jsx";

/**
 * Presenta tags seleccionados y sugerencias con sus avatares y acciones.
 * En el campo devuelve solo los tags; debajo conserva el grupo y su overlay opcional.
 * @param {object} props Selección, sugerencias, estilos, accesibilidad y acciones del hook.
 * @returns {import("react").ReactNode} Tags inline o grupo externo.
 */
export default function InputTagGroup({
  inline = false, normalizedVisibleTags, sizing, disabled, handleRemoveTag,
  handleTagOptionSelection, tagGroupId, tagGroupAriaLabel, label,
  showSelectedTagsBelow, showTagOptionsOnFocus, visibleSelectableTags,
  showTagGroupAsOverlay,
}) {
  const selectedTags = inline || showSelectedTagsBelow
    ? normalizedVisibleTags.map((tag, index) => (
        <Tag
          key={tag.id ?? `${tag.label}-${index}`}
          size={sizing.tagSize}
          label={tag.label}
          avatar={tag.avatar ?? true}
          avatarText={tag.avatarText ?? "A"}
          avatarSrc={tag.avatarSrc ?? ""}
          avatarTheme={tag.avatarTheme ?? "Neutral"}
          avatarContent={tag.avatarContent ?? "Text"}
          closeIcon={tag.closeIcon ?? true}
          count={false}
          className={inline ? "max-w-full" : undefined}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onRemove={() => handleRemoveTag(tag.id)}
        />
      ))
    : null;

  if (inline) return selectedTags;

  return (
    <div
      id={tagGroupId}
      className={clsx(
        "flex h-[22px] w-full flex-nowrap items-center gap-[4px] overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        showTagGroupAsOverlay &&
          "absolute left-0 top-full z-[110] mt-[4px] rounded-[var(--radius-2)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e1)]",
      )}
      role="group"
      aria-label={
        tagGroupAriaLabel ?? `${label}: opciones y elementos seleccionados`
      }
    >
      {showSelectedTagsBelow ? selectedTags : null}
      {showTagOptionsOnFocus
        ? visibleSelectableTags.map((tag, index) => (
            <Tag
              key={tag.id ?? `${tag.label}-option-${index}`}
              size={sizing.tagSize}
              label={tag.label}
              avatar={tag.avatar ?? true}
              avatarText={tag.avatarText ?? "A"}
              avatarSrc={tag.avatarSrc ?? ""}
              avatarTheme={tag.avatarTheme ?? "Neutral"}
              avatarContent={tag.avatarContent ?? "Text"}
              closeIcon={false}
              count={false}
              disabled={disabled}
              interactive
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleTagOptionSelection(tag)}
            />
          ))
        : null}
    </div>
  );
}
