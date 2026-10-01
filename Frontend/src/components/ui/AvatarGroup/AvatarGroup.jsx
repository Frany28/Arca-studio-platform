/* Agrupa varios avatares superpuestos y permite mostrar un contador de usuarios adicionales. */
import clsx from "clsx";
import Avatar from "../Avatar/Avatar.jsx";
import {
  AVATAR_GROUP_DEFAULT_PROPS,
  AVATAR_GROUP_SIZE_STYLES,
} from "./avatarGroupConfig.js";

// Normaliza tamaño e items antes de construir el grupo visual de avatares.
function AvatarGroup({
  className,
  size = AVATAR_GROUP_DEFAULT_PROPS.size,
  items = AVATAR_GROUP_DEFAULT_PROPS.items,
  moreCount = AVATAR_GROUP_DEFAULT_PROPS.moreCount,
  ...props
}) {
  const resolvedSize = AVATAR_GROUP_SIZE_STYLES[size]
    ? size
    : AVATAR_GROUP_DEFAULT_PROPS.size;
  const styles = AVATAR_GROUP_SIZE_STYLES[resolvedSize];
  const safeItems = Array.isArray(items) ? items : AVATAR_GROUP_DEFAULT_PROPS.items;
  const visibleItems =
    moreCount == null
      ? safeItems
      : [
          ...safeItems,
          {
            content: "Text",
            theme: "Neutral",
            initials: `+${moreCount}`,
            decorative: true,
          },
        ];

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0",
        styles.container,
        className,
      )}
      {...props}
    >
      {visibleItems.map((item, index) => (
        <Avatar
          key={`${item.name ?? item.initials ?? item.content ?? "avatar"}-${index}`}
          size={resolvedSize}
          {...item}
          className={clsx(
            "border-[var(--color-neutral-bg)] shadow-[var(--shadow-e1)]",
            styles.border,
            index > 0 && styles.margin,
            item.className,
          )}
        />
      ))}
    </span>
  );
}

export default AvatarGroup;
