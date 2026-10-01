/* Contiene ejemplos de contenido y tamaños del Tag para el sistema de diseño. */
import { createTagProps, createTagShowcaseItem } from "./tagConfig.js";

export const tagQuickToggleItems = [
  createTagShowcaseItem("Text", {
    size: "M",
    avatar: false,
    closeIcon: false,
    count: false,
  }),
  createTagShowcaseItem("Status Dot", {
    size: "M",
    avatar: false,
    closeIcon: false,
    count: false,
    dotIndicator: true,
  }),
  createTagShowcaseItem("Flag / Avatar", {
    size: "M",
    closeIcon: false,
    count: false,
  }),
  createTagShowcaseItem("Close Icon", {
    size: "M",
    avatar: false,
    count: false,
  }),
  createTagShowcaseItem("Count", {
    size: "M",
    avatar: false,
    closeIcon: false,
  }),
];

export const tagMainStackItems = [
  createTagProps({
    size: "S",
  }),
  createTagProps({
    size: "M",
  }),
  createTagProps({
    size: "L",
  }),
];
