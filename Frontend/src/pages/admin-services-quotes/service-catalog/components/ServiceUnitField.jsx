import { useState } from "react";

import Input from "../../../../components/ui/Input/Input.jsx";
import { toDenominationTag } from "../utils/serviceFormValues.js";

// Sugerencias visibles bajo el campo; escribir filtra el resto.
const VISIBLE_SUGGESTIONS = 6;

/**
 * Campo «Unidad de medida» del formulario de servicios (Figma 5764:226084): abreviatura de la
 * unidad base en el selector de prefijo y la denominación elegida como Tag dentro del campo
 * (variante "Tags" del Input con prefijo). Solo ofrece denominaciones de la base elegida, así que
 * no admite combinaciones incompatibles: cambiar de base retira la denominación. El texto escrito
 * filtra las sugerencias y nunca crea denominaciones; para eso está «+ Crear unidad».
 *
 * @param {Object} props - Selección, opciones y callbacks.
 * @param {string} props.id - Id del campo nativo (enfoque inicial y etiqueta).
 * @param {Array<{id: number, label: string, description: string}>} props.baseOptions - Unidades base.
 * @param {number|null} props.measurementUnitId - Base elegida.
 * @param {{id: number, denomination: string}|null} props.unitDenomination - Denominación elegida.
 * @param {Array<{id: number, denomination: string}>} props.denominations - Denominaciones de la base.
 * @param {(changes: {measurementUnitId: number, unitDenomination: Object|null}) => void} props.onChange
 * Recibe la nueva combinación coherente.
 * @param {string} props.hint - Mensaje bajo el campo (error o carga); vacío lo oculta.
 * @param {boolean} props.invalid - Muestra el estado de error.
 * @param {boolean} props.disabled - Bloquea el campo.
 * @returns {import("react").ReactElement} Campo de unidad.
 */
function ServiceUnitField({ baseOptions, denominations, disabled, hint, id, invalid, measurementUnitId, onChange, unitDenomination }) {
  const [query, setQuery] = useState("");
  const selectedTags = unitDenomination ? [toDenominationTag(unitDenomination)] : [];
  const suggestions = denominations.map(toDenominationTag);

  /**
   * Elige una denominación de la base actual, sustituyendo la anterior (selección única).
   *
   * @param {{id: number}} tag - Sugerencia elegida.
   * @returns {void}
   */
  function selectDenomination(tag) {
    const denomination = denominations.find((item) => item.id === tag.id);
    if (!denomination) return;
    setQuery("");
    onChange({ measurementUnitId, unitDenomination: { id: denomination.id, denomination: denomination.denomination } });
  }

  return (
    <Input
      id={id}
      type="Tags"
      size="M"
      label="Unidad de medida"
      required
      showLabel
      showLabelInfo={false}
      showLeftIcon={false}
      showRightIcon={false}
      placeholder={unitDenomination ? "" : "Buscar unidad"}
      value={query}
      state={invalid ? "Error" : "Default"}
      showHint={Boolean(hint)}
      hintText={hint}
      disabled={disabled}
      prefixOptions={baseOptions}
      prefixValue={measurementUnitId}
      prefixAriaLabel="Unidad base del servicio"
      onPrefixChange={(option) => {
        if (option.id === measurementUnitId) return;
        setQuery("");
        onChange({ measurementUnitId: option.id, unitDenomination: null });
      }}
      tags={selectedTags}
      tagOptions={suggestions}
      showTagOptionsOnFocus
      maxVisibleTagOptions={VISIBLE_SUGGESTIONS}
      tagGroupAriaLabel="Unidades de medida de la unidad base elegida"
      // Controlado: solo se aceptan denominaciones existentes de la base; Enter con texto libre
      // propone una etiqueta nueva que aquí se descarta. Quitar la etiqueta deja solo la base.
      onTagsChange={(nextTags) => {
        if (nextTags.length === 0) {
          onChange({ measurementUnitId, unitDenomination: null });
          return;
        }
        selectDenomination(nextTags[nextTags.length - 1]);
      }}
      onTagOptionSelect={selectDenomination}
      onChange={(event) => setQuery(event.target.value)}
      className="max-w-none"
      autoComplete="off"
    />
  );
}

export default ServiceUnitField;
