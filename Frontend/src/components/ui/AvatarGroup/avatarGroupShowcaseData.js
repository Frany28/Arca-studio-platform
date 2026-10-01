/* Agrupa configuraciones de ejemplo de AvatarGroup para documentación y showcases. */
import {
  createAvatarGroupProps,
  createAvatarGroupShowcaseItem,
} from "./avatarGroupConfig.js";

const BASE_GROUP_ITEMS = [
  { content: "Icon", theme: "Neutral" },
  { content: "Icon", theme: "Neutral" },
  { content: "Icon", theme: "Neutral" },
];

export const avatarGroupMainComponent = createAvatarGroupProps({
  size: "S",
  items: [
    ...BASE_GROUP_ITEMS,
    { content: "Text", theme: "Neutral", name: "Karen Espinoza" },
  ],
});

export const avatarGroupQuickToggleItems = [
  {
    ...createAvatarGroupShowcaseItem("Basic", {
      size: "S",
      items: BASE_GROUP_ITEMS,
    }),
    previewWidthClassName: "w-[92px]",
  },
  {
    ...createAvatarGroupShowcaseItem("More user badge", {
      size: "S",
      items: BASE_GROUP_ITEMS,
      moreCount: 4,
    }),
    previewWidthClassName: "w-[114px]",
  },
];

export const avatarGroupSizeItems = [
  {
    ...createAvatarGroupShowcaseItem("S", {
      size: "S",
      items: [
        ...BASE_GROUP_ITEMS,
        { content: "Text", theme: "Neutral", name: "Karen Espinoza" },
      ],
    }),
    previewWidthClassName: "w-[110px]",
  },
  {
    ...createAvatarGroupShowcaseItem("M", {
      size: "M",
      items: [
        ...BASE_GROUP_ITEMS,
        { content: "Text", theme: "Neutral", name: "Karen Espinoza" },
      ],
    }),
    previewWidthClassName: "w-[174px]",
  },
  {
    ...createAvatarGroupShowcaseItem("L", {
      size: "L",
      items: [
        ...BASE_GROUP_ITEMS,
        { content: "Text", theme: "Neutral", name: "Karen Espinoza" },
      ],
    }),
    previewWidthClassName: "w-[238px]",
  },
];

export const avatarGroupReferenceItems = ["S", "M", "L"].map((size) =>
  createAvatarGroupProps({
    size,
    items: [
      ...BASE_GROUP_ITEMS,
      { content: "Text", theme: "Neutral", name: "Karen Espinoza" },
    ],
  }),
);
