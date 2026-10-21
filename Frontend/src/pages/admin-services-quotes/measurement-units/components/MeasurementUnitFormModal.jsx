import { useMemo, useState } from "react";

import Button from "../../../../components/ui/Button/Button.jsx";
import Input from "../../../../components/ui/Input/Input.jsx";
import Modal, { ModalCloseButton } from "../../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../../hooks/useDialogKeyboard.js";
import {
  DENOMINATION_MAX_LENGTH,
  normalizeDenominationText,
  previewUnitLabel,
  validateDenominationText,
} from "../utils/measurementUnitPresentation.js";

const DIALOG_SELECTOR = "[data-measurement-unit-form]";
const COPY = {
  create: { title: "Nueva unidad de medida", submit: "Crear", submitting: "Creando...", close: "Cerrar formulario de nueva unidad de medida" },
  edit: { title: "Editar unidad de medida", submit: "Guardar", submitting: "Guardando...", close: "Cerrar formulario de edición de la unidad de medida" },
};

/**
 * Formulario «Nueva unidad de medida» (Figma 5790:360030): abreviatura de la unidad base y
 * texto de la denominación en un mismo campo, con Cancelar y Crear. En edición la unidad base
 * se muestra bloqueada, porque el backend no permite cambiarla. Conserva lo escrito ante un
 * error, lo señala junto al campo y bloquea el envío mientras la petición está en curso.
 *
 * @param {Object} props - Modo, datos y callbacks.
 * @param {"create"|"edit"} props.mode - Alta o edición.
 * @param {Object|null} props.denomination - Denominación editada (modo edit).
 * @param {{options: Array<Object>, loading: boolean, error: string, retry: Function}} props.baseUnits
 * Catálogo de unidades base para el alta.
 * @param {() => void} props.onClose - Cierra sin guardar.
 * @param {(values: Object) => Promise<{ok: boolean, message?: string, fieldErrors?: Object}>} props.onSubmit
 * Envía los valores normalizados y devuelve el resultado.
 * @returns {import("react").ReactElement} Modal en portal.
 */
function MeasurementUnitFormModal({ baseUnits, denomination, mode, onClose, onSubmit }) {
  const editing = mode === "edit";
  const copy = COPY[editing ? "edit" : "create"];
  const [selectedUnitId, setSelectedUnitId] = useState(denomination?.measurementUnit?.id ?? null);
  const [text, setText] = useState(denomination?.denomination ?? "");
  const [fieldError, setFieldError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // En edición solo se presenta la base de la denominación (puede estar ya inactiva y no
  // figurar en el catálogo activo); en el alta se ofrece el catálogo completo de la API.
  const prefixOptions = useMemo(() => (editing
    ? [{ id: denomination.measurementUnit.id, label: denomination.measurementUnit.symbol, description: denomination.measurementUnit.name }]
    : baseUnits.options), [baseUnits.options, denomination, editing]);
  const unitId = selectedUnitId ?? prefixOptions[0]?.id ?? null;
  const selectedOption = prefixOptions.find((option) => option.id === unitId);
  const catalogUnavailable = !editing && (baseUnits.loading || Boolean(baseUnits.error) || prefixOptions.length === 0);
  const labelPreview = previewUnitLabel(selectedOption?.label, text);

  useDialogKeyboard({
    open: true,
    getContainer: () => document.querySelector(DIALOG_SELECTOR),
    onEscape: () => {
      if (!submitting) onClose();
    },
    getInitialFocus: (elements) => elements.find((element) => element.matches("input[type='text']")),
  });

  /**
   * Valida y envía. Los errores del servidor se muestran sin cerrar el formulario.
   *
   * @param {import("react").FormEvent} event - Envío del formulario.
   * @returns {Promise<void>}
   */
  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting || catalogUnavailable) return;
    const validationError = validateDenominationText(text);
    if (validationError) {
      setFieldError(validationError);
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    const denominationText = normalizeDenominationText(text);
    const result = await onSubmit(editing
      ? { denomination: denominationText }
      : { denomination: denominationText, measurementUnitId: unitId });
    if (result?.ok) return;
    setSubmitting(false);
    const fieldMessage = result?.fieldErrors?.denomination || result?.fieldErrors?.measurementUnitId || "";
    setFieldError(fieldMessage);
    if (!fieldMessage) setSubmitError(result?.message || "");
  }

  const hint = fieldError
    || (!editing && baseUnits.error ? baseUnits.error : "")
    || (!editing && baseUnits.loading ? "Cargando unidades base..." : "")
    || (labelPreview ? `Se mostrará como «${labelPreview}».` : "")
    || `Máximo ${DENOMINATION_MAX_LENGTH} caracteres.`;

  return (
    <Modal mount="viewport" visible onClose={submitting ? undefined : onClose} className="z-[100]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="measurement-unit-form-title"
        data-measurement-unit-form
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-[400px] flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Límite del listado de abreviaturas: su borde inferior es el del footer de acciones,
            así que el listado se abre dentro del formulario y nunca tapa Cancelar/Crear. */}
        <form id="measurement-unit-form" data-input-options-boundary className="relative flex min-h-0 flex-col gap-[16px] overflow-y-auto p-[16px]" onSubmit={handleSubmit} noValidate>
          <div className="absolute right-0 top-0">
            <ModalCloseButton disabled={submitting} ariaLabel={copy.close} onClick={onClose} />
          </div>
          <h2 id="measurement-unit-form-title" className="text-heading-6 m-0 pr-[28px] text-[var(--color-text-300)]">{copy.title}</h2>
          <Input
            type="Prefix select"
            size="M"
            label="Nombre de la unidad"
            required
            showLabel
            showLabelInfo={false}
            showLeftIcon={false}
            showRightIcon={false}
            value={text}
            placeholder="Ej. “de recorrido comercial”"
            state={fieldError ? "Error" : "Default"}
            showHint
            hintText={hint}
            disabled={submitting}
            prefixOptions={prefixOptions}
            prefixValue={unitId}
            prefixAriaLabel="Abreviatura de la unidad base"
            prefixDisabled={editing || catalogUnavailable}
            onPrefixChange={(option) => {
              setSelectedUnitId(option.id);
              setFieldError("");
              setSubmitError("");
            }}
            onChange={(event) => {
              setText(event.target.value);
              setFieldError("");
              setSubmitError("");
            }}
            className="max-w-none"
            autoComplete="off"
          />
          {editing ? (
            <p className="text-body-4 m-0 text-[var(--color-text-100)]">
              {denomination.publicCode} · La unidad base no se puede cambiar.
            </p>
          ) : null}
          {baseUnits.error && !editing ? (
            <Button theme="Primary" type="Link" size="S" fitContent showLeftIcon={false} showRightIcon={false} onClick={baseUnits.retry}>
              Reintentar carga de unidades base
            </Button>
          ) : null}
          {submitError ? <p className="text-body-3 m-0 text-[var(--color-danger-100)]" role="alert">{submitError}</p> : null}
        </form>

        <footer className="flex items-center gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
          <Button theme="Primary" type="Outline" size="M" showLeftIcon={false} showRightIcon={false} disabled={submitting} className="!h-[41px] !w-full min-w-0 flex-1" onClick={onClose}>Cancelar</Button>
          <Button theme="Primary" type="Solid" size="M" showLeftIcon={false} showRightIcon={false} disabled={submitting || catalogUnavailable} className="!h-[41px] !w-full min-w-0 flex-1" htmlType="submit" form="measurement-unit-form">
            {submitting ? copy.submitting : copy.submit}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

export default MeasurementUnitFormModal;
