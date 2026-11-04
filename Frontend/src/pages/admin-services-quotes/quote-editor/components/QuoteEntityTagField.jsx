import { useState } from "react";

import Button from "../../../../components/ui/Button/Button.jsx";
import HintText from "../../../../components/ui/HintText/HintText.jsx";
import Input from "../../../../components/ui/Input/Input.jsx";
import { getTagOptionId, normalizeTagSearchText } from "../../../../components/ui/Input/tags/tagUtils.js";

// Sugerencias visibles bajo el campo; escribir filtra en la API.
const VISIBLE_SUGGESTIONS = 6;

/**
 * Campo de selección única con búsqueda en la API para «Nombre del cliente» y «Nombre del
 * proyecto» (Figma 5771:449131): variante «Tags» del Input con icono a la izquierda y la opción
 * elegida como Tag con cierre (con su foto en el caso del cliente). Escribir y pulsar Enter nunca
 * crea un registro.
 *
 * Con `explicitSelection` (proyecto) la elección es siempre explícita: clic en una sugerencia o
 * flechas para activarla y Enter para elegirla. Enter sin opción activa no elige por coincidencia
 * parcial ni envía el formulario, y Escape cierra las sugerencias. El texto escrito sigue en el
 * campo (en el alta es el nombre de un proyecto nuevo) y `statusHint` explica qué ocurrirá con él.
 *
 * @param {Object} props - Selección, opciones remotas y textos.
 * @param {string} props.id - Id del campo nativo.
 * @param {string} props.label - Etiqueta visible.
 * @param {import("react").ReactNode} props.icon - Icono de la izquierda (Figma: profile / edit-2).
 * @param {{id: number, label: string, avatarSrc?: string}|null} props.selected - Opción elegida.
 * @param {(option: Object|null) => void} props.onChange - Elige una opción o la retira (null).
 * @param {{options: Array<Object>, loading: boolean, error: string, retry: () => void}} props.remote - Opciones remotas.
 * @param {(option: Object) => {id: number, label: string, avatarSrc?: string}} props.toTag - Convierte una opción en Tag.
 * @param {string} props.query - Texto de búsqueda (controlado por el padre, que consulta la API).
 * @param {(query: string) => void} props.onQueryChange - Cambia la búsqueda.
 * @param {boolean} props.withAvatar - Muestra avatar en el Tag (cliente) o no (proyecto).
 * @param {string} [props.placeholder] - Texto sin selección.
 * @param {string} [props.error] - Error de validación junto al campo.
 * @param {string} [props.emptyMessage] - Mensaje si la búsqueda no encuentra opciones.
 * @param {string} [props.statusHint] - Aviso informativo del texto escrito (sustituye al vacío).
 * @param {boolean} [props.explicitSelection=false] - Selección solo por clic o por la opción activa.
 * @param {boolean} [props.disabled=false] - Bloquea el campo.
 * @returns {import("react").ReactElement} Campo con su ayuda.
 */
function QuoteEntityTagField({
  disabled = false, emptyMessage, error, explicitSelection = false, icon, id, label, onChange, onQueryChange, placeholder,
  query, remote, selected, statusHint = "", toTag, withAvatar,
}) {
  const [focused, setFocused] = useState(false);
  // Teclado de la selección explícita: opción activa y sugerencias cerradas con Escape.
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const hintId = `${id}-hint`;
  const tagGroupId = `${id}-tags`;
  /**
   * Presenta una opción como Tag del Input: foto real o iniciales para el cliente, sin avatar
   * para el proyecto, y siempre con cierre para poder retirarla.
   *
   * @param {Object} option - Opción de la API o seleccionada.
   * @returns {Object} Tag del Input.
   */
  function tagOf(option) {
    const tag = toTag(option);
    return { ...tag, avatar: withAvatar, avatarContent: tag.avatarSrc ? "Image" : "Text", avatarTheme: "Neutral", closeIcon: true };
  }
  // En la selección explícita se pasan exactamente las sugerencias visibles (mismo filtro y límite
  // que aplica el Input), para que la opción activa del teclado sea la que se ve.
  const searchKey = normalizeTagSearchText(query);
  const suggestions = selected || (explicitSelection && dismissed)
    ? []
    : remote.options
      .map(tagOf)
      .filter((tag) => !explicitSelection || !searchKey || normalizeTagSearchText(tag.label).includes(searchKey))
      .slice(0, explicitSelection ? VISIBLE_SUGGESTIONS : undefined);
  const listOpen = explicitSelection && focused && suggestions.length > 0;
  const active = listOpen && activeIndex < suggestions.length ? activeIndex : -1;

  // Ayuda en vivo de la búsqueda: fallo de lectura, carga, aviso del texto escrito o «sin opciones».
  let liveHint = "";
  if (!selected) {
    if (remote.error) liveHint = remote.error;
    else if (focused && remote.loading) liveHint = "Buscando…";
    else if (statusHint) liveHint = statusHint;
    else if (focused && !remote.options.length && emptyMessage) liveHint = emptyMessage;
  }
  // El error de un intento de guardado anterior cede ante la ayuda en vivo mientras el campo tiene el
  // foco: sin ello, un cliente sin proyectos (o una búsqueda en curso o fallida) no explicaría por qué
  // no aparecen sugerencias. Al salir del campo vuelve a mostrarse si sigue sin resolverse.
  const showError = Boolean(error) && !(focused && liveHint);
  const hint = showError ? error : liveHint;
  const hintIsError = showError || (Boolean(remote.error) && hint === remote.error);

  /**
   * Elige una sugerencia por su id; ignora textos libres que no correspondan a una opción.
   *
   * @param {{id: number}} tag - Sugerencia elegida.
   * @returns {void}
   */
  function selectOption(tag) {
    const option = remote.options.find((candidate) => toTag(candidate).id === tag.id);
    if (!option) return;
    setActiveIndex(-1);
    onQueryChange("");
    onChange(option);
  }

  /**
   * Teclado de la selección explícita (patrón combobox con `aria-activedescendant`): flechas
   * circulares, Enter solo con una opción activa y Escape para cerrar. Enter sin opción activa se
   * consume para no enviar el formulario por accidente.
   *
   * @param {import("react").KeyboardEvent<HTMLInputElement>} event - Tecla pulsada en el campo.
   * @returns {void}
   */
  function handleExplicitKeyDown(event) {
    if (selected) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (dismissed) {
        setDismissed(false);
        setActiveIndex(-1);
        return;
      }
      if (!suggestions.length) return;
      const last = suggestions.length - 1;
      if (event.key === "ArrowDown") setActiveIndex(active >= last ? 0 : active + 1);
      else setActiveIndex(active <= 0 ? last : active - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0) selectOption(suggestions[active]);
    } else if (event.key === "Escape" && listOpen) {
      event.preventDefault();
      setDismissed(true);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="flex w-[320px] max-w-full flex-col gap-[8px] max-[767px]:w-full">
      <Input
        id={id}
        type="Tags"
        size="S"
        label={label}
        required
        showLabel
        showLabelInfo={false}
        showLeftIcon
        leftIcon={icon}
        showRightIcon={false}
        placeholder={selected ? "" : placeholder}
        readOnly={Boolean(selected)}
        value={query}
        // Input solo muestra sugerencias en su estado Focused: con un error previo el campo vuelve a
        // Default mientras tiene el foco; el HintText inferior muestra el motivo o, si la búsqueda
        // tiene algo que decir (cargando, sin opciones, fallo), esa ayuda en vivo.
        state={error && !focused ? "Error" : "Default"}
        showHint={false}
        aria-describedby={hint ? hintId : undefined}
        aria-invalid={error ? true : undefined}
        disabled={disabled}
        tags={selected ? [tagOf(selected)] : []}
        tagOptions={suggestions}
        showTagOptionsOnFocus
        maxVisibleTagOptions={VISIBLE_SUGGESTIONS}
        tagGroupAriaLabel={`Opciones de ${label.toLowerCase()}`}
        tagOptionSelection={explicitSelection ? "explicit" : "auto"}
        activeTagOptionIndex={active}
        {...(explicitSelection && !selected ? {
          "aria-activedescendant": active >= 0 ? getTagOptionId(tagGroupId, active) : undefined,
          "aria-autocomplete": "list",
          "aria-controls": listOpen ? tagGroupId : undefined,
          "aria-expanded": listOpen,
          onKeyDown: handleExplicitKeyDown,
          role: "combobox",
        } : {})}
        onTagsChange={(nextTags) => {
          if (nextTags.length === 0) {
            onQueryChange("");
            onChange(null);
            return;
          }
          selectOption(nextTags[nextTags.length - 1]);
        }}
        onTagOptionSelect={selectOption}
        onChange={(event) => {
          if (selected) return;
          setActiveIndex(-1);
          setDismissed(false);
          onQueryChange(event.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setActiveIndex(-1);
        }}
        className="max-w-none"
        autoComplete="off"
      />
      {hint ? (
        <HintText
          id={hintId}
          hintText={hint}
          state={hintIsError ? "Error" : "Default"}
          role={showError ? "alert" : "status"}
          className="w-full"
        />
      ) : null}
      {remote.error && !selected ? (
        <Button theme="Primary" type="Link" size="S" fitContent showLeftIcon={false} showRightIcon={false} className="self-start" onClick={remote.retry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}

export default QuoteEntityTagField;
