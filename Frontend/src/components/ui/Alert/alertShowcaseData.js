/* Contiene ejemplos de contenido, temas y layouts de Alert para el sistema de diseño. */
import {
  createAlertProps,
  createAlertShowcaseItem,
} from "./alertConfig.js";

export const alertMainComponent = createAlertProps({});

export const alertQuickToggleItems = [
  createAlertShowcaseItem("Base", {
    showIcon: false,
    showText: false,
    showActions: false,
    showCloseButton: false,
  }),
  createAlertShowcaseItem("Icon", {
    showText: false,
    showActions: false,
    showCloseButton: false,
  }),
  createAlertShowcaseItem("CTA Buttons", {
    showIcon: false,
    showText: false,
    showActions: true,
    showCloseButton: false,
  }),
  createAlertShowcaseItem("Close X", {
    showIcon: false,
    showText: false,
    showActions: false,
    showCloseButton: true,
  }),
  createAlertShowcaseItem("Subtext", {
    showActions: false,
    showIcon: false,
    showCloseButton: false,
    showText: true,
  }),
];

export const alertThemeItems = [
  createAlertShowcaseItem("Brand", {
    theme: "Brand",
  }),
  createAlertShowcaseItem("Warning", {
    theme: "Warning",
  }),
  createAlertShowcaseItem("Error", {
    theme: "Danger",
  }),
  createAlertShowcaseItem("Success", {
    theme: "Success",
  }),
  createAlertShowcaseItem("Info", {
    theme: "Info",
  }),
];

export const alertStyleItems = [
  createAlertShowcaseItem("Box", {
    layout: "Box",
  }),
  createAlertShowcaseItem("Full width", {
    layout: "Full width",
  }),
];
