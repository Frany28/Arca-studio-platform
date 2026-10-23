import { useState } from "react";

import Input from "../../../../components/ui/Input/Input.jsx";
import { toDenominationOption, toDenominationTag } from "../utils/serviceFormValues.js";

// Sugerencias visibles bajo el campo; escribir filtra el resto.
const VISIBLE_SUGGESTIONS = 6;

/**
 * Campo «Unidad de medida» del formulario de servicios (Figma 5764:226084): solo ofrece unidades
 * de medida registradas (denominaciones activas), nunca las unidades base sueltas. Conserva la
 * composición de Figma: la abreviatura en el selector de prefijo y la unidad elegida como Tag
 * dentro del campo (variante "Tags" del Input con prefijo).
 *
 * - Las sugerencias muestran símbolo y texto («m² de construcción»); escribir las filtra.
 * - Elegir una fija a la vez su base y su denominación: una sola unidad por servicio.
 * - El selector de prefijo solo lista las bases que tienen unidades registradas y filtra las
 *   sugerencias; cambiarlo retira una unidad de otra base.
 * - Escribir y pulsar Enter nunca crea unidades; para eso está «+ Crear unidad».
 *
 * @param {Object} props - Selección, opciones y callbacks.
 * @param {string} props.id - Id del campo nativo (enfoque inicial y etiqueta).
 * @param {Array<{id: number, label: string, description: string}>} props.prefixOptions - Bases con unidades registradas.
 * @param {number|null} props.measurementUnitId - Base elegida.
 * @param {{id: number, denomination: string}|null} props.unitDenomination - Unidad elegida.
 * @param {Array<Object>} props.denominations - Unidades registradas que se ofrecen (forma del contrato).
 * @param {(changes: {measurementUnitId: number|null, unitDenomination: Object|null}) => void} props.onChange
 * Recibe la nueva combinación coherente.
 * @param {string} props.hint - Mensaje bajo el campo (error, carga o estado vacío); vacío lo oculta.
 * @param {boolean} props.invalid - Muestra el estado de error.
 * @param {boolean} props.disabled - Bloquea el campo.
 * @returns {import("react").ReactElement} Campo de unidad.
 */
function ServiceUnitField({ denominations, disabled, hint, id, invalid, measurementUnitId, onChange, prefixOptions, unitDenomination }) {
  const [query, setQuery] = useState("");
  const selectedTags = unitDenomination ? [toDenominationTag(unitDenomination)] : [];
  const suggestions = denominations.map(toDenominationOption);

  /**
   * Elige una unidad registrada, con su base, sustituyendo la anterior (selección única).
   *
   * @param {{id: number}} tag - Sugerencia elegida.
   * @returns {void}
   */
  function selectDenomination(tag) {
    const denomination = denominations.find((item) => item.id === tag.id);
    if (!denomination) return;
    setQuery("");
    onChange({
      measurementUnitId: denomination.measurementUnit?.id ?? measurementUnitId,
      unitDenomination: { id: denomination.id, denomination: denomination.denomination },
    });
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
      prefixOptions={prefixOptions}
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
      tagGroupAriaLabel="Unidades de medida registradas"
      // Controlado: solo se aceptan unidades registradas; Enter con texto libre propone una
      // etiqueta nueva que aquí se descarta. Quitar la etiqueta deja el campo sin unidad.
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
