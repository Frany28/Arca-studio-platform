/* Contiene datos de referencia y variantes de AvatarLabel usadas en el sistema de diseño. */
import avatarLabelFigmaAvatarSrc from "../../../assets/avatar-label-figma-40.svg";
import {
  createAvatarLabelProps,
  createAvatarLabelShowcaseItem,
} from "./avatarLabelConfig.js";

export const AVATAR_LABEL_FIGMA_AVATAR_SRC = avatarLabelFigmaAvatarSrc;

export const avatarLabelMainComponent = createAvatarLabelProps({
  size: "M",
  showLabel: true,
  showSubtitle: true,
  avatarSrc: AVATAR_LABEL_FIGMA_AVATAR_SRC,
});

export const avatarLabelQuickToggleItems = [
  {
    ...createAvatarLabelShowcaseItem("Base", {
      size: "M",
      showLabel: false,
      showSubtitle: false,
      avatarSrc: AVATAR_LABEL_FIGMA_AVATAR_SRC,
    }),
    previewWidthClassName: "w-[72px]",
  },
  {
    ...createAvatarLabelShowcaseItem("Label", {
      size: "M",
      showLabel: true,
      showSubtitle: false,
      avatarSrc: AVATAR_LABEL_FIGMA_AVATAR_SRC,
    }),
    previewWidthClassName: "w-[165px]",
  },
  {
    ...createAvatarLabelShowcaseItem("Label with Subtitle", {
      size: "M",
      showLabel: true,
      showSubtitle: true,
      avatarSrc: AVATAR_LABEL_FIGMA_AVATAR_SRC,
    }),
    previewWidthClassName: "w-[166px]",
  },
];

export const avatarLabelSizeItems = [
  {
    ...createAvatarLabelShowcaseItem("S", {
      size: "S",
      showLabel: true,
      showSubtitle: false,
      avatarSrc: AVATAR_LABEL_FIGMA_AVATAR_SRC,
    }),
    previewWidthClassName: "w-[132px]",
  },
  {
    ...createAvatarLabelShowcaseItem("M", {
      size: "M",
      showLabel: true,
      showSubtitle: true,
      avatarSrc: AVATAR_LABEL_FIGMA_AVATAR_SRC,
    }),
    previewWidthClassName: "w-[166px]",
  },
  {
    ...createAvatarLabelShowcaseItem("L", {
      size: "L",
      showLabel: true,
      showSubtitle: true,
      avatarSrc: AVATAR_LABEL_FIGMA_AVATAR_SRC,
    }),
    previewWidthClassName: "w-[182px]",
  },
];
