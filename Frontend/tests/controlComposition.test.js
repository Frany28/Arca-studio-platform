import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Compila JSX en memoria; React permanece externo para usar una única instancia.
const compiled = buildSync({
  stdin: {
    contents: `
      export { default as Button } from './src/components/ui/Button/Button.jsx';
      export { default as Input } from './src/components/ui/Input/Input.jsx';
      export { default as TextArea } from './src/components/ui/TextArea/TextArea.jsx';
    `,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    loader: "js",
  },
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  packages: "external",
  jsx: "automatic",
}).outputFiles[0].text;
// esbuild asigna module.exports, por lo que se conserva el objeto contenedor.
const moduleContainer = { exports: {} };
new Function("require", "exports", "module", compiled)(
  createRequire(import.meta.url), moduleContainer.exports, moduleContainer,
);
const { Button, Input, TextArea } = moduleContainer.exports;

test("content buttons preserve direct children, DOM refs, events and disabled semantics", () => {
  const ref = { current: null };
  let clicked = false;
  const child = createElement("img", { src: "project.webp", alt: "Proyecto" });
  const button = Button({ layout: "content", ref, children: child, "aria-label": "Abrir proyecto",
    onClick: () => { clicked = true; }, disabled: true, htmlType: "submit", className: "custom-card" });
  assert.equal(button.type, "button");
  assert.equal(button.props.children, child);
  assert.equal(button.props.ref, ref);
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.type, "submit");
  assert.equal(button.props["aria-label"], "Abrir proyecto");
  assert.match(button.props.className, /cursor-not-allowed/);
  assert.doesNotMatch(button.props.className, /w-\[115px\]|h-9/);
  button.props.onClick();
  assert.equal(clicked, true);
});

test("standard buttons preserve their action layout and content span", () => {
  const button = Button({ children: "Guardar" });
  assert.match(button.props.className, /h-9/);
  assert.match(button.props.className, /cursor-pointer/);
  assert.match(renderToStaticMarkup(button), /<span[^>]*>Guardar<\/span>/);
});

test("embedded fields preserve values, validation, references and change events", () => {
  const inputRef = { current: null };
  let value;
  const input = Input({ presentation: "control", inputRef, htmlType: "number", min: 1, max: 8,
    value: 3, required: true, "aria-label": "Página", "aria-invalid": true,
    onChange: (event) => { value = event.target.value; } });
  assert.equal(input.type, "input");
  assert.equal(input.props.ref, inputRef);
  assert.equal(input.props.type, "number");
  assert.equal(input.props.value, 3);
  assert.equal(input.props.min, 1);
  assert.equal(input.props.max, 8);
  assert.equal(input.props.required, true);
  assert.equal(input.props["aria-invalid"], true);
  input.props.onChange({ target: { value: "4" } });
  assert.equal(value, "4");
  const area = TextArea({ presentation: "control", inputRef, defaultValue: "Descripción", maxLength: 100 });
  assert.equal(area.type, "textarea");
  assert.equal(area.props.ref, inputRef);
  assert.equal(area.props.defaultValue, "Descripción");
  assert.equal(area.props.maxLength, 100);
  assert.match(renderToStaticMarkup(area), /^<textarea[^>]*>Descripción<\/textarea>$/);
});

test("file controls remain optional and accept multiple files without visual wrappers", () => {
  const input = Input({ presentation: "control", htmlType: "file", multiple: true, accept: ".pdf,.png" });
  assert.equal(input.props.type, "file");
  assert.equal(input.props.required, undefined);
  assert.equal(input.props.multiple, true);
  assert.equal(input.props.accept, ".pdf,.png");
});
