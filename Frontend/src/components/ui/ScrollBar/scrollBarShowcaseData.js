/* Contiene ejemplos de longitud y posición del ScrollBar para documentación visual. */
import {
  createScrollBarProps,
  createScrollBarShowcaseItem,
} from "./scrollBarConfig.js";

export const scrollBarMainComponent = createScrollBarProps({
  length: 0.75,
  position: 0,
});

export const scrollBarLengthItems = [
  createScrollBarShowcaseItem("25 %", {
    length: 0.25,
    position: 0,
  }),
  createScrollBarShowcaseItem("50 %", {
    length: 0.5,
    position: 0,
  }),
  createScrollBarShowcaseItem("75 %", {
    length: 0.75,
    position: 0,
  }),
];
