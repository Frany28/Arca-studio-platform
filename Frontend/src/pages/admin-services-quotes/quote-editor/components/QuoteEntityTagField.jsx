import { useState } from "react";

import Button from "../../../../components/ui/Button/Button.jsx";
import HintText from "../../../../components/ui/HintText/HintText.jsx";
import Input from "../../../../components/ui/Input/Input.jsx";

// Sugerencias visibles bajo el campo; escribir filtra en la API.
const VISIBLE_SUGGESTIONS = 6;

/**
 * Campo de selección única con búsqueda en la API para «Nombre del cliente» y «Nombre del
 * proyecto» (Figma 5771:449131): variante «Tags» del Input con icono a la izquierda y la opción
 * elegida como Tag con cierre (con su foto en el caso del cliente). Solo acepta opciones
 * existentes devueltas por la API: escribir y pulsar Enter nunca crea un registro.
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
 * @param {boolean} [props.disabled=false] - Bloquea el campo.
 * @returns {import("react").ReactElement} Campo con su ayuda.
 */
function QuoteEntityTagField({
  disabled = false, emptyMessage, error, icon, id, label, onChange, onQueryChange, placeholder, query, remote, selected, toTag, withAvatar,
}) {
  const [focused, setFocused] = useState(false);
  const hintId = `${id}-hint`;
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
  const suggestions = selected ? [] : remote.options.map(tagOf);
  let hint = error || "";
  if (!hint && !selected && remote.error) hint = remote.error;
  else if (!hint && focused && !selected) {
    if (remote.loading) hint = "Buscando…";
    else if (!remote.options.length && emptyMessage) hint = emptyMessage;
  }

  /**
   * Elige una sugerencia por su id; ignora textos libres que no correspondan a una opción.
   *
   * @param {{id: number}} tag - Sugerencia elegida.
   * @returns {void}
   */
  function selectOption(tag) {
    const option = remote.options.find((candidate) => toTag(candidate).id === tag.id);
    if (!option) return;
    onQueryChange("");
    onChange(option);
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
        // Default mientras se escribe, y el motivo sigue visible en el HintText inferior.
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
          if (!selected) onQueryChange(event.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="max-w-none"
        autoComplete="off"
      />
      {hint ? (
        <HintText
          id={hintId}
          hintText={hint}
          state={error || remote.error ? "Error" : "Default"}
          role={error ? "alert" : "status"}
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
