import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import Input from "../../../src/components/ui/Input/Input.jsx";
import "../../../src/index.css";

const root = createRoot(document.getElementById("root"));
const inputRef = createRef();
const events = [];
let inputMounted = true;

/**
 * Registra los argumentos públicos antes de que React restaure un valor controlado.
 * Permite verificar el orden de callbacks sin inspeccionar estado interno del componente.
 *
 * @param {string} type Nombre del callback.
 * @param {*} value Argumento serializable observado por el consumidor.
 * @returns {void} Añade un evento a la sesión de prueba.
 */
function record(type, value) {
  events.push({ type, value });
}

let inputProps = {
  id: "contract-input",
  label: "Campo de prueba",
  hintText: "Ayuda del campo",
  showLabelInfo: false,
  inputRef,
  onChange: (event) => record("change", {
    target: event.target.value,
    currentTarget: event.currentTarget.value,
    nativeTarget: event.nativeEvent.target.value,
  }),
  onFocus: () => record("focus", null),
  onBlur: () => record("blur", null),
  onKeyDown: (event) => record("keydown", { key: event.key, defaultPrevented: event.defaultPrevented }),
  onPhoneCountryChange: (option) => record("country", option),
  onClickRightIcon: () => record("right-icon", null),
  ...JSON.parse(new URLSearchParams(window.location.search).get("props") || "{}"),
};

/**
 * Cambia props manteniendo la identidad del Input real y sus estados inicializados.
 * El render síncrono del fixture permite observar transiciones públicas sin esperas arbitrarias.
 *
 * @param {Object} [nextProps] Props que cambian sin remontar el componente.
 * @returns {void} Actualiza la vista de prueba.
 */
function setProps(nextProps = {}) {
  inputProps = { ...inputProps, ...nextProps };
  flushSync(() => root.render(
    <form onSubmit={(event) => { event.preventDefault(); record("submit", null); }}>
      {inputMounted ? <Input {...inputProps} /> : <input ref={inputRef} aria-label="Campo reemplazo" />}
      <button type="button">Fuera del campo</button>
    </form>,
  ));
}

/** Sustituye Input reutilizando su ref pública para detectar focos obsoletos. */
function unmountInput() {
  inputMounted = false;
  setProps();
}

window.inputHarness = { events, record, setProps, unmountInput, inputRef };
setProps();
