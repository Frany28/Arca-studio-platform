/* Contiene ejemplos de estados, iconos y validación de contraseña para HintText. */
import {
  PASSWORD_DEFAULT_REQUIREMENTS,
  createHintTextProps,
  createHintTextShowcaseItem,
} from "./hintTextConfig.js";

export const hintTextStateItems = [
  createHintTextShowcaseItem("Default", {
    state: "Default",
  }),
  createHintTextShowcaseItem("Error", {
    state: "Error",
  }),
  createHintTextShowcaseItem("Success", {
    state: "Success",
  }),
  createHintTextShowcaseItem("Disabled", {
    state: "Disabled",
  }),
];

export const hintTextQuickToggleItems = [
  createHintTextShowcaseItem("Text", {
    hintIcon: false,
  }),
  createHintTextShowcaseItem("Icon", {
    hintText: "",
  }),
];

export const passwordHintItems = [
  "Default",
  "Error",
  "Success",
  "Disabled",
].map((state) => ({
  label: state,
  props: createHintTextProps({
    type: "Password",
    state,
    passwordTitle: "Debe contener al menos:",
    requirements: PASSWORD_DEFAULT_REQUIREMENTS,
  }),
}));
