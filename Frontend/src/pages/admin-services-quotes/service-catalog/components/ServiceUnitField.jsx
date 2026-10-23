import { useState } from "react";

import Input from "../../../../components/ui/Input/Input.jsx";
import HintText from "../../../../components/ui/HintText/HintText.jsx";
import { filterDenominationsForBase, toDenominationOption, toDenominationTag } from "../utils/serviceFormValues.js";

// Sugerencias visibles bajo el campo; escribir filtra el resto.
const VISIBLE_SUGGESTIONS = 6;

/**
 * Campo «Unidad de medida» del formulario de servicios (Figma 5764:226084): solo ofrece unidades
 * de medida registradas (denominaciones activas), nunca las unidades base sueltas. Conserva la
 * composición de Figma: la abreviatura en el selector de prefijo y la unidad elegida como Tag
 * dentro del campo (variante "Tags" del Input con prefijo).
 *
 * - Las sugerencias muestran símbolo y texto («m² de construcción»); escribir las filtra.
 * - Primero se elige una base; sin ella el texto es de solo lectura y no hay sugerencias.
 * - El prefijo solo ofrece bases con denominaciones activas; la guardada se muestra aparte si es histórica.
 * - Solo admite una denominación activa de la base elegida, comparada por identificador.
 * - Escribir y pulsar Enter nunca crea unidades; para eso está «+ Crear unidad».
 *
 * @param {Object} props - Selección, opciones y callbacks.
 * @param {string} props.id - Id del campo nativo (enfoque inicial y etiqueta).
 * @param {Array<{id: number, label: string, description: string}>} props.prefixOptions - Bases permitidas.
 * @param {Object|null} props.selectedBaseOption - Base actual, incluida una histórica no seleccionable.
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
function ServiceUnitField({ denominations, disabled, hint, id, invalid, measurementUnitId, onChange, prefixOptions, selectedBaseOption, unitDenomination }) {
  // La consulta pertenece a esta combinación. Un cambio externo de base o unidad (modalidad,
  // alta contextual) no puede reutilizar texto anterior ni necesita sincronizarlo con un efecto.
  const searchKey = `${measurementUnitId}:${unitDenomination?.id ?? ""}`;
  const [search, setSearch] = useState({ key: searchKey, text: "" });
  const query = search.key === searchKey ? search.text : "";
  const selectedTags = unitDenomination ? [toDenominationTag(unitDenomination)] : [];
  const compatibleDenominations = filterDenominationsForBase(denominations, measurementUnitId);
  const suggestions = compatibleDenominations.map(toDenominationOption);
  const hintId = `${id}-unit-hint`;
  const selectableBase = prefixOptions.some((option) => option.id === measurementUnitId);

  /**
   * Elige una unidad registrada, con su base, sustituyendo la anterior (selección única).
   *
   * @param {{id: number}} tag - Sugerencia elegida.
   * @returns {void}
   */
  function selectDenomination(tag) {
    const denomination = compatibleDenominations.find((item) => item.id === tag.id);
    if (!denomination) return;
    setSearch({ key: searchKey, text: "" });
    onChange({
      measurementUnitId,
      unitDenomination: { id: denomination.id, denomination: denomination.denomination },
    });
  }

  return (
    <div className="flex w-full flex-col gap-[8px]">
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
        placeholder={!measurementUnitId ? "Selecciona un símbolo" : unitDenomination ? "" : selectableBase ? "Buscar unidad" : "Sin denominación guardada"}
        readOnly={!measurementUnitId || !selectableBase}
        value={query}
        state={invalid ? "Error" : "Default"}
        showHint={false}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        prefixOptions={prefixOptions}
        prefixValue={measurementUnitId}
        prefixSelectedOption={selectedBaseOption}
        prefixAriaLabel="Unidad base del servicio"
        onPrefixChange={(option) => {
          if (option.id === measurementUnitId || !prefixOptions.some((base) => base.id === option.id)) return;
          setSearch({ key: searchKey, text: "" });
          onChange({ measurementUnitId: option.id, unitDenomination: null });
        }}
        tags={selectedTags}
        tagOptions={suggestions}
        showTagOptionsOnFocus={Boolean(measurementUnitId)}
        maxVisibleTagOptions={VISIBLE_SUGGESTIONS}
        tagGroupAriaLabel="Unidades de medida registradas"
        // Controlado: solo se aceptan unidades registradas; Enter con texto libre propone una
        // etiqueta nueva que aquí se descarta. Quitar la etiqueta deja el campo sin unidad.
        onTagsChange={(nextTags) => {
          if (nextTags.length === 0) {
            setSearch({ key: searchKey, text: "" });
            onChange({ measurementUnitId, unitDenomination: null });
            return;
          }
          selectDenomination(nextTags[nextTags.length - 1]);
        }}
        onTagOptionSelect={selectDenomination}
        onChange={(event) => {
          if (measurementUnitId) setSearch({ key: searchKey, text: event.target.value });
        }}
        className="max-w-none"
        autoComplete="off"
      />
      {/* El estado vacío debe seguir visible al enfocar, aunque Input oculte su hint de Tags. */}
      {hint ? (
        <HintText
          id={hintId}
          hintText={hint}
          state={invalid ? "Error" : "Default"}
          role={invalid ? "alert" : "status"}
          className="w-full"
        />
      ) : null}
    </div>
  );
}

export default ServiceUnitField;
