/* Agrupa ejemplos de estados del Accordion usados en documentación y showcase. */
import {
  createAccordionProps,
  createAccordionShowcaseItem,
} from "./accordionConfig.js";

export const accordionMainComponent = createAccordionProps();

export const accordionStateItems = [
  {
    ...createAccordionShowcaseItem("Default", {
      state: "Default",
    }),
    previewWidthClassName: "w-full max-w-[472px]",
  },
  {
    ...createAccordionShowcaseItem("Hover", {
      state: "Hover",
    }),
    previewWidthClassName: "w-full max-w-[472px]",
  },
  {
    ...createAccordionShowcaseItem("Open", {
      state: "Open",
    }),
    previewWidthClassName: "w-full max-w-[472px]",
  },
];
