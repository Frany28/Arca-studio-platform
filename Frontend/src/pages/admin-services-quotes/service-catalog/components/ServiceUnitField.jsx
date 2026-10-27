import { useMemo, useState } from "react";

import Input from "../../../../components/ui/Input/Input.jsx";
import HintText from "../../../../components/ui/HintText/HintText.jsx";
import { useServiceUnitCombobox } from "../hooks/useServiceUnitCombobox.js";
import { toDenominationTag } from "../utils/serviceFormValues.js";
import { filterServiceUnitOptions, toServiceUnitOption } from "../utils/serviceUnitSelection.js";
import ServiceUnitOptionsList from "./ServiceUnitOptionsList.jsx";

/**
 * Campo «Unidad de medida» del formulario de servicios (Figma 5764:226084): un único combobox
 * editable. Al hacer clic se despliegan las unidades registradas (denominaciones activas con su
 * base); escribir en el mismo campo las filtra por símbolo, categoría o nombre de la base, sin
 * distinguir mayúsculas ni acentos. Conserva la composición de Figma: el símbolo de la base en
 * el prefijo («m²») y la categoría como Tag con cierre («de construcción»), ambos derivados de
 * la unidad elegida.
 *
 * - Elegir una opción fija base y denominación a la vez y cierra el listado.
 * - Volver a hacer clic o escribir busca otra unidad, que sustituye a la anterior.
 * - Quitar el Tag (cierre o Retroceso con el campo vacío) deja el campo sin unidad.
 * - La unidad guardada se muestra aunque sea histórica, pero solo se ofrecen las disponibles.
 * - Escribir y pulsar Enter nunca crea unidades; para eso está «+ Crear unidad».
 *
 * @param {Object} props - Selección, opciones y callbacks.
 * @param {string} props.id - Id del campo nativo (enfoque inicial y etiqueta).
 * @param {Array<Object>} props.denominations - Unidades registradas que se ofrecen (forma del
 * contrato), ya filtradas por modalidad y disponibilidad.
 * @param {{id: number, label: string}|null} props.selectedBaseOption - Base elegida (su `label` es el
 * símbolo), incluida una histórica que ya no se ofrece.
 * @param {number|null} props.measurementUnitId - Base elegida.
 * @param {{id: number, denomination: string}|null} props.unitDenomination - Unidad elegida.
 * @param {(changes: {measurementUnitId: number|null, unitDenomination: Object|null}) => void} props.onChange
 * Recibe la nueva combinación coherente.
 * @param {string} props.hint - Mensaje del formulario (error, carga o estado vacío); prevalece
 * sobre el aviso de búsqueda sin resultados.
 * @param {boolean} props.invalid - Muestra el estado de error.
 * @param {boolean} props.disabled - Bloquea el campo.
 * @returns {import("react").ReactElement} Campo de unidad con su listado.
 */
function ServiceUnitField({ denominations, disabled, hint, id, invalid, measurementUnitId, onChange, selectedBaseOption, unitDenomination }) {
  // La consulta pertenece a esta combinación. Un cambio externo de base o unidad (modalidad,
  // alta contextual) no puede reutilizar texto anterior ni necesita sincronizarlo con un efecto.
  const searchKey = `${measurementUnitId}:${unitDenomination?.id ?? ""}`;
  const [search, setSearch] = useState({ key: searchKey, text: "" });
  const query = search.key === searchKey ? search.text : "";
  const allOptions = useMemo(() => (denominations || []).map(toServiceUnitOption), [denominations]);
  const options = useMemo(() => filterServiceUnitOptions(allOptions, query), [allOptions, query]);
  const {
    activeIndex, anchorRef, close, handleKeyDownCapture, highlightedIndex, hoverOption, isOpen, listboxRef, open, position, select,
  } = useServiceUnitCombobox({ disabled, options, onSelect: selectOption });
  const listboxId = `${id}-options`;
  const optionId = (index) => `${id}-option-${index}`;
  const hintId = `${id}-unit-hint`;
  const selectionId = `${id}-selection`;
  const symbol = selectedBaseOption?.id === measurementUnitId ? selectedBaseOption?.label ?? "" : "";
  const noResults = Boolean(query.trim()) && options.length === 0 && allOptions.length > 0;
  const visibleHint = hint || (noResults ? `No hay unidades que coincidan con «${query.trim()}». Puedes crearla con «Crear unidad».` : "");
  // El prefijo es decorativo (aria-hidden): el nombre accesible de la selección vive aquí.
  const selectionText = [symbol, unitDenomination?.denomination].filter(Boolean).join(" ");

  /**
   * Elige una unidad registrada, con su base, sustituyendo la anterior (selección única).
   *
   * @param {{denomination: {id: number, denomination: string, measurementUnit: {id: number}}}} option - Opción elegida.
   * @returns {void}
   */
  function selectOption(option) {
    setSearch({ key: searchKey, text: "" });
    onChange({
      measurementUnitId: option.denomination.measurementUnit.id,
      unitDenomination: { id: option.denomination.id, denomination: option.denomination.denomination },
    });
  }

  /**
   * Retira la unidad elegida junto con su símbolo y su Tag, y despliega el listado para elegir
   * otra: quitarla es una acción explícita sobre el campo (cierre del Tag o Retroceso), y el clic
   * del cierre no llega a abrirlo porque su botón ya no está en el DOM.
   *
   * @returns {void}
   */
  function clearSelection() {
    setSearch({ key: searchKey, text: "" });
    onChange({ measurementUnitId: null, unitDenomination: null });
    open();
  }

  return (
    // El clic en cualquier punto del campo (prefijo, Tag o texto) despliega el listado. Los clics
    // del listado también llegan aquí (React propaga a través del portal), pero no están en este
    // nodo del DOM: elegir una opción no vuelve a abrirlo.
    <div
      ref={anchorRef}
      className="flex w-full flex-col gap-[8px]"
      onClick={(event) => {
        if (event.currentTarget.querySelector("[data-input-shell]")?.contains(event.target)) open();
      }}
    >
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
        placeholder={unitDenomination ? "" : measurementUnitId ? "Sin denominación guardada" : "Buscar unidad"}
        value={query}
        state={invalid ? "Error" : "Default"}
        showHint={false}
        aria-describedby={[selectionText ? selectionId : null, visibleHint ? hintId : null].filter(Boolean).join(" ") || undefined}
        disabled={disabled}
        prefixReadOnly
        prefixSelectedOption={symbol ? selectedBaseOption : null}
        tags={unitDenomination ? [toDenominationTag(unitDenomination)] : []}
        tagOptions={[]}
        // Controlado: Enter con texto libre propone una etiqueta nueva que aquí se descarta; quitar
        // la etiqueta deja el campo sin unidad.
        onTagsChange={(nextTags) => {
          if (nextTags.length === 0) clearSelection();
        }}
        onChange={(event) => {
          setSearch({ key: searchKey, text: event.target.value });
          open();
        }}
        onBlur={() => {
          close();
          setSearch({ key: searchKey, text: "" });
        }}
        onKeyDownCapture={handleKeyDownCapture}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen ? optionId(activeIndex) : undefined}
        className="max-w-none"
        autoComplete="off"
      />
      {selectionText ? <span id={selectionId} className="sr-only">{`Seleccionada: ${selectionText}`}</span> : null}
      {isOpen ? (
        <ServiceUnitOptionsList
          id={listboxId}
          optionId={optionId}
          options={options}
          selectedId={unitDenomination?.id ?? null}
          activeIndex={activeIndex}
          highlightedIndex={highlightedIndex}
          position={position}
          listboxRef={listboxRef}
          onHover={hoverOption}
          onSelect={select}
        />
      ) : null}
      {/* El estado vacío debe seguir visible al enfocar, aunque Input oculte su hint de Tags. */}
      {visibleHint ? (
        <HintText
          id={hintId}
          hintText={visibleHint}
          state={invalid ? "Error" : "Default"}
          role={invalid ? "alert" : "status"}
          className="w-full"
        />
      ) : null}
    </div>
  );
}

export default ServiceUnitField;
