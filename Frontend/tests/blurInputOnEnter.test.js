import assert from "node:assert/strict";
import { test } from "node:test";
import { blurInputOnEnter } from "../src/utils/blurInputOnEnter.js";

function dispatchEnter({ tagName = "INPUT", type = "text", key = "Enter", handled = false, composing = false, sameForm = true } = {}) {
  const form = {};
  const result = { prevented: false, blurred: false };
  blurInputOnEnter({
    key,
    currentTarget: form,
    defaultPrevented: handled,
    nativeEvent: { isComposing: composing },
    preventDefault() { result.prevented = true; },
    target: {
      tagName, type, form: sameForm ? form : {},
      blur() { result.blurred = true; },
    },
  });
  return result;
}

test("Enter finaliza la edición de los campos de una línea", () => {
  for (const type of ["text", "search", "email", "tel", "url", "password", "number"]) {
    assert.deepEqual(dispatchEnter({ type }), { prevented: true, blurred: true }, type);
  }
});

test("mantiene el teclado de botones, áreas de texto y controles con manejo propio", () => {
  for (const options of [
    { tagName: "BUTTON", type: "submit" },
    { tagName: "TEXTAREA" },
    { type: "checkbox" },
    { type: "file" },
    { handled: true },
    { composing: true },
    { sameForm: false },
    { key: "Tab" },
  ]) {
    assert.deepEqual(dispatchEnter(options), { prevented: false, blurred: false }, JSON.stringify(options));
  }
});
