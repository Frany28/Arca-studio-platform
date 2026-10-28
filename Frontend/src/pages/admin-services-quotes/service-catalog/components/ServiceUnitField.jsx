import { useMemo, useRef, useState } from "react";

import Input from "../../../../components/ui/Input/Input.jsx";
import HintText from "../../../../components/ui/HintText/HintText.jsx";
import { useServiceUnitCombobox } from "../hooks/useServiceUnitCombobox.js";
import { toBaseUnitTag, toDenominationTag } from "../utils/serviceFormValues.js";
import {
  baseOnlyOptionId, buildServiceUnitSelectionOptions, filterServiceUnitOptions, groupServiceUnitOptions, resolveSelectedUnitSymbol,
} from "../utils/serviceUnitSelection.js";
import ServiceUnitOptionsList from "./ServiceUnitOptionsList.jsx";

/**
 * Campo «Unidad de medida» del formulario de servicios (Figma 5764:226084): un único combobox
 * editable. Al hacer clic se despliegan las unidades agrupadas por su unidad base: primero la base
 * sola (sin denominación, como admite el backend) y después sus denominaciones activas; escribir
 * en el mismo campo las filtra por símbolo, categoría o nombre de la base, sin distinguir
 * mayúsculas ni acentos. Conserva la composición de Figma: el símbolo de la base en el prefijo
 * («m²») y la categoría como Tag con cierre («de construcción» o, sin denominación, el nombre de
 * la base), ambos derivados de la unidad elegida. Se reutiliza para las unidades alternativas.
 *
 * Tres estados, con la unidad del borrador (`measurementUnitId` + `unitDenomination`) como única
 * fuente de verdad y la búsqueda como estado temporal de interfaz:
 *
 * - Sin unidad: el texto ocupa el segmento derecho con «Buscar unidad».
 * - Unidad elegida: símbolo y Tag, siempre visibles con o sin foco. El campo nativo sigue
 *   enfocable pero sin ancho detrás del Tag, para que el contenedor de Tags nunca se desplace
 *   y oculte la selección (antes el texto y el Tag compartían ese desplazamiento).
 * - Buscando (hay texto): el texto sustituye temporalmente al Tag; el símbolo y la unidad del
 *   borrador no cambian hasta elegir otra opción. Escape, vaciar el texto o salir del campo
 *   descartan la búsqueda y restauran el Tag.
 *
 * - Elegir una opción (clic o Enter) fija base y denominación a la vez y cierra el listado.
 * - Quitar el Tag (cierre o Retroceso con el campo vacío) deja el campo sin unidad.
 * - La unidad guardada se muestra aunque sea histórica, pero solo se ofrecen las disponibles.
 * - Escribir y pulsar Enter nunca crea unidades; para eso está «+ Crear unidad».
 *
 * @param {Object} props - Selección, opciones y callbacks.
 * @param {string} props.id - Id del campo nativo (enfoque inicial y etiqueta).
 * @param {string} [props.label="Unidad de medida"] - Etiqueta visible del campo.
 * @param {Array<{id: number, label: string, description?: string}>} [props.bases] - Bases activas que
 * pueden asignarse sin denominación (abreviatura en `label`, nombre en `description`).
 * @param {Array<Object>} props.denominations - Unidades registradas que se ofrecen (forma del
 * contrato), ya filtradas por disponibilidad.
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
function ServiceUnitField({
  bases = [], denominations, disabled, hint, id, invalid, label = "Unidad de medida", measurementUnitId, onChange, selectedBaseOption, unitDenomination,
}) {
  // La consulta pertenece a esta combinación. Un cambio externo de base o unidad (modalidad,
  // alta contextual) no puede reutilizar texto anterior ni necesita sincronizarlo con un efecto.
  const searchKey = `${measurementUnitId}:${unitDenomination?.id ?? ""}`;
  const [search, setSearch] = useState({ key: searchKey, text: "" });
  const query = search.key === searchKey ? search.text : "";
  const searching = query !== "";
  const inputRef = useRef(null);
  const allOptions = useMemo(() => buildServiceUnitSelectionOptions(bases, denominations), [bases, denominations]);
  // Grupos por unidad base con resultados; la lista plana (índices de teclado y
  // aria-activedescendant) sigue el mismo orden visual que los grupos.
  const groups = useMemo(() => groupServiceUnitOptions(filterServiceUnitOptions(allOptions, query)), [allOptions, query]);
  const options = useMemo(() => groups.flatMap((group) => group.options), [groups]);
  const {
    activeIndex, anchorRef, close, handleKeyDownCapture, highlightedIndex, hoverOption, isOpen, listboxRef, open, position, select,
  } = useServiceUnitCombobox({
    disabled, options, onSelect: selectOption, searching, onCancelSearch: clearSearch, rowCount: options.length + groups.length,
  });
  const listboxId = `${id}-options`;
  const optionId = (index) => `${id}-option-${index}`;
  const hintId = `${id}-unit-hint`;
  const selectionId = `${id}-selection`;
  const symbol = resolveSelectedUnitSymbol({ denominations, measurementUnitId, selectedBaseOption, unitDenomination });
  // Base elegida sin denominación: su Tag es el nombre de la base (incluida una base histórica).
  const selectedBase = measurementUnitId && !unitDenomination
    ? bases.find((base) => base.id === measurementUnitId) ?? (selectedBaseOption?.id === measurementUnitId ? selectedBaseOption : null)
    : null;
  const selectionTag = unitDenomination ? toDenominationTag(unitDenomination) : selectedBase ? toBaseUnitTag(selectedBase) : null;
  // El Tag solo cede su lugar mientras hay texto de búsqueda.
  const showSelectionTag = Boolean(selectionTag) && !searching;
  const noResults = Boolean(query.trim()) && options.length === 0 && allOptions.length > 0;
  const visibleHint = hint || (noResults ? `No hay unidades que coincidan con «${query.trim()}». Puedes crearla con «Crear unidad».` : "");
  // El prefijo es decorativo (aria-hidden): el nombre accesible de la selección vive aquí.
  const selectionText = [symbol, unitDenomination?.denomination ?? selectionTag?.label].filter(Boolean).join(" ");
  const selectedOptionId = unitDenomination?.id ?? (measurementUnitId ? baseOnlyOptionId(measurementUnitId) : null);

  /**
   * Elige una unidad, con o sin denominación, sustituyendo la anterior (selección única).
   *
   * @param {{baseOnly?: boolean, baseId?: number, denomination: {id: number, denomination: string,
   * measurementUnit: {id: number}}|null}} option - Opción elegida.
   * @returns {void}
   */
  function selectOption(option) {
    setSearch({ key: searchKey, text: "" });
    if (option.baseOnly) {
      onChange({ measurementUnitId: option.baseId, unitDenomination: null });
      return;
    }
    onChange({
      measurementUnitId: option.denomination.measurementUnit.id,
      unitDenomination: { id: option.denomination.id, denomination: option.denomination.denomination },
    });
  }

  /**
   * Descarta el texto de búsqueda temporal sin tocar la unidad elegida (Escape o salir del campo).
   *
   * @returns {void}
   */
  function clearSearch() {
    setSearch({ key: searchKey, text: "" });
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
    // El clic en cualquier punto del campo (prefijo, Tag o hueco) enfoca el texto y despliega el
    // listado: con una unidad elegida el campo nativo no tiene ancho propio que pulsar. Los clics
    // del listado también llegan aquí (React propaga a través del portal), pero no están en este
    // nodo del DOM: elegir una opción no vuelve a abrirlo.
    <div
      ref={anchorRef}
      className="flex w-full flex-col gap-[8px]"
      onClick={(event) => {
        if (!event.currentTarget.querySelector("[data-input-shell]")?.contains(event.target)) return;
        inputRef.current?.focus({ preventScroll: true });
        open();
      }}
    >
      <Input
        id={id}
        type="Tags"
        size="M"
        label={label}
        required
        showLabel
        showLabelInfo={false}
        showLeftIcon={false}
        showRightIcon={false}
        placeholder={measurementUnitId ? "" : "Buscar unidad"}
        inputRef={inputRef}
        // Con el Tag visible, el texto (vacío) no ocupa espacio: el Tag dispone de todo el segmento.
        inputClassName={showSelectionTag ? "!w-0 !min-w-0 !flex-none" : undefined}
        value={query}
        state={invalid ? "Error" : "Default"}
        showHint={false}
        aria-describedby={[selectionText ? selectionId : null, visibleHint ? hintId : null].filter(Boolean).join(" ") || undefined}
        disabled={disabled}
        prefixReadOnly
        // Figma: el segmento del símbolo se ve siempre, separado del texto; en el alta, vacío.
        prefixSelectedOption={{ id: measurementUnitId ?? "", label: symbol }}
        tags={showSelectionTag ? [selectionTag] : []}
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
          clearSearch();
        }}
        onKeyDownCapture={handleKeyDownCapture}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen ? optionId(activeIndex) : undefined}
        // Con el listado abierto, campo y panel forman una sola pieza: el campo pierde el radio del
        // lado unido y su borde de foco, y ese lado hace de divisor (patrón del DropdownMenu).
        attachedOptionsPlacement={isOpen ? position?.placement ?? "bottom" : null}
        className="max-w-none"
        autoComplete="off"
      />
      {selectionText ? <span id={selectionId} className="sr-only">{`Seleccionada: ${selectionText}`}</span> : null}
      {isOpen ? (
        <ServiceUnitOptionsList
          id={listboxId}
          optionId={optionId}
          groups={groups}
          selectedId={selectedOptionId}
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
