/* Contiene variantes de Badge usadas para documentación y vistas de showcase. */
import { createBadgeProps, createBadgeShowcaseItem } from "./badgeConfig.js";

export const badgeSizeItems = [
  createBadgeShowcaseItem("S"),
  createBadgeShowcaseItem("M", { size: "M" }),
  createBadgeShowcaseItem("L", { size: "L" }),
];

export const badgeQuickToggleItems = [
  createBadgeShowcaseItem("Text"),
  createBadgeShowcaseItem("Status Dot", { variation: "Dot" }),
  createBadgeShowcaseItem("Flag / Avatar", {
    variation: "Flag / Avatar",
  }),
];

export const badgeStatusItems = [
  createBadgeShowcaseItem("brand 1"),
  createBadgeShowcaseItem("brand 2", { theme: "Brand 2" }),
  createBadgeShowcaseItem("neutral", { theme: "Neutral" }),
  createBadgeShowcaseItem("danger", { theme: "Danger" }),
  createBadgeShowcaseItem("success", { theme: "Success" }),
  createBadgeShowcaseItem("info", { theme: "Info" }),
  createBadgeShowcaseItem("archived", { theme: "Archived" }),
  createBadgeShowcaseItem("disabled", { theme: "Disabled" }),
];

export const badgeMatrixThemes = [
  "Brand 1",
  "Brand 2",
  "Neutral",
  "Danger",
  "Success",
  "Info",
  "Archived",
  "Disabled",
];

export const badgeMatrixVariations = ["Simple", "Dot", "Flag / Avatar"];

export const badgeMatrixSizes = ["S", "M", "L"];

// Construye las props de cada combinación usada en la matriz visual del componente.
export function createBadgeMatrixProps(theme, variation, size) {
  return createBadgeProps({
    theme,
    variation,
    size,
  });
}
