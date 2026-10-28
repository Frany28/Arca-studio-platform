import { Add, Trash } from "iconsax-react";
import { useState } from "react";

import Button from "../../../../components/ui/Button/Button.jsx";
import Input from "../../../../components/ui/Input/Input.jsx";
import {
  PRESENTATION_LABEL_MAX_LENGTH, SERVICE_UNIT_OPTIONS_MAX, createAlternativeUnit, rateFromPastedText, rateFromTypedValue,
} from "../utils/serviceFormValues.js";
import ServiceUnitField from "./ServiceUnitField.jsx";

const PENDING_RATE_HINT = "Sin tarifa: pendiente de validación comercial. No se podrá cotizar con esta unidad.";

/**
 * Campo de tarifa opcional de una unidad, con la misma entrada de caja registradora que «Tarifa
 * USD». Vacío significa «pendiente de validación comercial» y se indica junto al campo.
 *
 * @param {Object} props - Valor, error y callbacks.
 * @param {string} props.id - Id del campo.
 * @param {string} props.label - Etiqueta visible.
 * @param {string} props.value - Tarifa escrita («450.00» o vacía).
 * @param {string} [props.error] - Error de formato.
 * @param {boolean} props.disabled - Bloquea el campo.
 * @param {(rate: string) => void} props.onChange - Recibe la tarifa resultante.
 * @returns {import("react").ReactElement} Campo de tarifa.
 */
function UnitRateField({ disabled, error, id, label, onChange, value }) {
  const pending = !String(value ?? "").trim();
  return (
    <Input
      id={id}
      type="Default input"
      size="M"
      label={label}
      required={false}
      showLabelInfo={false}
      showLeftIcon={false}
      showRightIcon={false}
      placeholder="Pendiente"
      inputMode="numeric"
      value={value}
      state={error ? "Error" : "Default"}
      showHint={Boolean(error) || pending}
      hintText={error || PENDING_RATE_HINT}
      disabled={disabled}
      className="!w-[125px] !max-w-[125px] shrink-0"
      inputClassName="tabular-nums"
      autoComplete="off"
      onChange={(event) => onChange(rateFromTypedValue(event.target.value, value))}
      onPaste={(event) => {
        event.preventDefault();
        onChange(rateFromPastedText(event.clipboardData.getData("text"), value));
      }}
    />
  );
}

/**
 * Unidades alternativas y texto comercial del formulario de servicios. No hay frame de Figma para
 * varias unidades: se compone solo con componentes del sistema (ServiceUnitField, Input y Button
 * Outline/Ghost) sin alterar la fila de Figma de una sola unidad, que sigue siendo el caso común.
 *
 * - «Añadir unidad alternativa» añade una fila con el mismo combobox de unidad (base sola o con
 *   denominación) y una tarifa opcional. Con alternativas, la unidad principal muestra también su
 *   propia tarifa y «Tarifa USD» queda como tarifa de referencia del tabulador.
 * - Una tarifa vacía es «pendiente de validación comercial»: nunca se copia otra tarifa. Al añadir
 *   la primera alternativa, la principal parte de la tarifa que ya tenía como unidad única.
 * - «Texto comercial» sustituye la etiqueta de la unidad principal («Global por Proyecto»).
 *
 * @param {Object} props - Borrador, catálogo, errores y callbacks.
 * @param {Object} props.draft - Borrador del formulario.
 * @param {string} props.primaryLabel - Etiqueta de la unidad principal elegida («proy.»).
 * @param {Array<Object>} props.bases - Bases activas seleccionables sin denominación.
 * @param {Array<Object>} props.denominations - Denominaciones activas seleccionables.
 * @param {(baseId: number) => Object|null} props.findBaseOption - Base (incluida una histórica) por id.
 * @param {Record<string, string>} props.fieldErrors - Errores por campo.
 * @param {boolean} props.disabled - Envío en curso o catálogo no disponible.
 * @param {(patch: Object, field: string) => void} props.onDraftChange - Aplica cambios al borrador.
 * @returns {import("react").ReactElement} Sección de unidades alternativas.
 */
function ServiceUnitAlternatives({ bases, denominations, disabled, draft, fieldErrors, findBaseOption, onDraftChange, primaryLabel }) {
  const alternatives = draft.alternativeUnits ?? [];
  const [labelRequested, setLabelRequested] = useState(false);
  const showLabelField = labelRequested || Boolean(draft.presentationLabel);
  const atLimit = alternatives.length + 1 >= SERVICE_UNIT_OPTIONS_MAX;

  /**
   * Sustituye las alternativas del borrador; sin alternativas la principal vuelve a usar la tarifa
   * del servicio y su tarifa propia se descarta.
   *
   * @param {Array<Object>} next - Alternativas resultantes.
   * @param {string} field - Campo que cambia (retira su error).
   * @param {Object} [extra] - Otros cambios del borrador.
   * @returns {void}
   */
  function setAlternatives(next, field, extra = {}) {
    onDraftChange({ alternativeUnits: next, ...(next.length ? {} : { primaryUnitRate: "" }), ...extra }, field);
  }

  /**
   * Cambia una fila de alternativa conservando las demás.
   *
   * @param {number} index - Fila.
   * @param {Object} patch - Campos de la fila que cambian.
   * @param {string} field - Campo que cambia.
   * @returns {void}
   */
  function updateAlternative(index, patch, field) {
    setAlternatives(alternatives.map((alternative, position) => (position === index ? { ...alternative, ...patch } : alternative)), field);
  }

  return (
    <div className="flex flex-col gap-[12px]" data-service-unit-alternatives>
      {alternatives.length ? (
        <>
          <div className="flex items-start gap-[16px]" data-service-unit-primary-rate>
            <p className="text-body-3 m-0 min-w-0 flex-1 self-center text-[var(--color-text-200)]">
              Unidad principal: <span className="text-[var(--color-text-300)]">{primaryLabel || "sin elegir"}</span>
            </p>
            <UnitRateField
              id="service-form-primary-rate"
              label="Tarifa USD"
              value={draft.primaryUnitRate}
              error={fieldErrors.primaryUnitRate}
              disabled={disabled}
              onChange={(primaryUnitRate) => onDraftChange({ primaryUnitRate }, "primaryUnitRate")}
            />
          </div>
          {alternatives.map((alternative, index) => (
            <div key={alternative.key} className="flex items-start gap-[8px]" data-service-unit-alternative>
              <div className="flex min-w-0 flex-1 flex-col">
                <ServiceUnitField
                  id={`service-form-alternative-${index}`}
                  label={`Unidad alternativa ${index + 1}`}
                  bases={bases}
                  denominations={denominations}
                  selectedBaseOption={findBaseOption(alternative.measurementUnitId)}
                  measurementUnitId={alternative.measurementUnitId}
                  unitDenomination={alternative.unitDenomination}
                  hint={fieldErrors[`alternative.${index}`] ?? ""}
                  invalid={Boolean(fieldErrors[`alternative.${index}`])}
                  disabled={disabled}
                  // Otra unidad deja de tener el texto comercial de la anterior.
                  onChange={(changes) => updateAlternative(index, { ...changes, presentationLabel: "" }, `alternative.${index}`)}
                />
              </div>
              <UnitRateField
                id={`service-form-alternative-rate-${index}`}
                label="Tarifa USD"
                value={alternative.referenceRate}
                error={fieldErrors[`alternativeRate.${index}`]}
                disabled={disabled}
                onChange={(referenceRate) => updateAlternative(index, { referenceRate }, `alternativeRate.${index}`)}
              />
              <div className="pt-[29px]">
                <Button
                  theme="Primary"
                  type="Ghost"
                  size="S"
                  showText={false}
                  showLeftIcon
                  iconLeft={<Trash size="20" color="currentColor" />}
                  showRightIcon={false}
                  disabled={disabled}
                  aria-label={`Quitar unidad alternativa ${index + 1}`}
                  onClick={() => setAlternatives(alternatives.filter((_item, position) => position !== index), "alternatives")}
                />
              </div>
            </div>
          ))}
        </>
      ) : null}
      {fieldErrors.alternatives ? <p className="text-body-4 m-0 text-[var(--color-danger-100)]" role="alert">{fieldErrors.alternatives}</p> : null}
      {/* Apilados: en el modal de 400 px no caben en una fila y el skeleton replica esta altura. */}
      <div className="flex flex-col items-start gap-[8px]">
        <Button
          theme="Primary"
          type="Outline"
          size="S"
          fitContent
          showLeftIcon
          iconLeft={<Add size="20" color="currentColor" />}
          showRightIcon={false}
          disabled={disabled || atLimit || !draft.measurementUnitId}
          data-service-add-alternative
          onClick={() => setAlternatives(
            [...alternatives, createAlternativeUnit()],
            "alternatives",
            // La primera alternativa parte de la tarifa confirmada que tenía la unidad única.
            alternatives.length ? {} : { primaryUnitRate: draft.referenceRate },
          )}
        >
          Añadir unidad alternativa
        </Button>
        {showLabelField ? null : (
          <Button theme="Primary" type="Link" size="S" fitContent showLeftIcon={false} showRightIcon={false} disabled={disabled} onClick={() => setLabelRequested(true)}>
            Añadir texto comercial
          </Button>
        )}
      </div>
      {showLabelField ? (
        <Input
          id="service-form-presentation-label"
          type="Default input"
          size="M"
          label="Texto comercial de la unidad (opcional)"
          required={false}
          showLabelInfo={false}
          showLeftIcon={false}
          showRightIcon={false}
          placeholder="Ej. “Global por Proyecto”"
          value={draft.presentationLabel}
          maxLength={PRESENTATION_LABEL_MAX_LENGTH}
          state={fieldErrors.presentationLabel ? "Error" : "Default"}
          showHint
          hintText={fieldErrors.presentationLabel || "Sustituye la etiqueta de la unidad principal en el tabulador, las cotizaciones y el PDF."}
          disabled={disabled}
          className="max-w-none"
          autoComplete="off"
          onChange={(event) => onDraftChange({ presentationLabel: event.target.value }, "presentationLabel")}
        />
      ) : null}
    </div>
  );
}

export default ServiceUnitAlternatives;
