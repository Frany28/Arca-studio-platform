import { useMemo, useState } from "react";

import Button from "../../../../components/ui/Button/Button.jsx";
import Input from "../../../../components/ui/Input/Input.jsx";
import Modal, { ModalCloseButton } from "../../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../../hooks/useDialogKeyboard.js";
import {
  BASE_UNIT_LOCKED_REASON,
  DENOMINATION_MAX_LENGTH,
  canEditBaseUnit,
  normalizeDenominationText,
  previewUnitLabel,
  toEditBaseUnitOptions,
  validateDenominationText,
} from "../utils/measurementUnitPresentation.js";

const DIALOG_SELECTOR = "[data-measurement-unit-form]";
const COPY = {
  create: { title: "Nueva unidad de medida", submit: "Crear", submitting: "Creando...", close: "Cerrar formulario de nueva unidad de medida" },
  edit: { title: "Editar unidad de medida", submit: "Guardar", submitting: "Guardando...", close: "Cerrar formulario de edición de la unidad de medida" },
};

/**
 * Formulario «Nueva unidad de medida» (Figma 5790:360030): abreviatura de la unidad base y
 * texto de la denominación en un mismo campo, con Cancelar y Crear. En edición la abreviatura
 * solo se habilita si el backend indica `baseUnitEditable` (sin servicios ni historial) y solo se
 * envía si cambia. Conserva lo escrito ante un error, lo señala junto al campo y bloquea el envío
 * mientras la petición está en curso. El formulario de servicios no lo abre: su «+ Crear unidad»
 * despliega una fila en el mismo modal que reutiliza las mismas reglas y la misma API
 * (useInlineDenominationCreator).
 *
 * @param {Object} props - Modo, datos y callbacks.
 * @param {"create"|"edit"} props.mode - Alta o edición.
 * @param {Object|null} props.denomination - Denominación editada (modo edit).
 * @param {{options: Array<Object>, loading: boolean, error: string, retry: Function}} props.baseUnits
 * Catálogo de unidades base para el alta y para editar una unidad cuya base puede cambiar.
 * @param {() => void} props.onClose - Cierra sin guardar.
 * @param {(values: Object) => Promise<{ok: boolean, message?: string, fieldErrors?: Object, baseUnitLocked?: boolean}>} props.onSubmit
 * Envía los valores normalizados y devuelve el resultado; `baseUnitLocked` bloquea la abreviatura.
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
  // Un 409 MEASUREMENT_UNIT_BASE_IN_USE demuestra que la base dejó de ser editable tras la lectura.
  const [baseLockedByServer, setBaseLockedByServer] = useState(false);

  const originalUnitId = denomination?.measurementUnit?.id ?? null;
  const baseEditable = editing && canEditBaseUnit(denomination) && !baseLockedByServer;
  const needsCatalog = !editing || baseEditable;
  const catalogPending = needsCatalog && (baseUnits.loading || Boolean(baseUnits.error) || baseUnits.options.length === 0);
  // En edición la base actual siempre figura (puede estar inactiva y no estar en el catálogo).
  const prefixOptions = useMemo(() => {
    if (!editing) return baseUnits.options;
    return toEditBaseUnitOptions(baseEditable ? baseUnits.options : [], denomination.measurementUnit);
  }, [baseEditable, baseUnits.options, denomination, editing]);
  // Sin base elegida, o si la elegida no figura entre las opciones (inactiva), se usa la primera.
  const unitId = prefixOptions.some((option) => option.id === selectedUnitId) ? selectedUnitId : prefixOptions[0]?.id ?? null;
  const selectedOption = prefixOptions.find((option) => option.id === unitId);
  // Solo el alta depende del catálogo para enviar; la edición puede guardar el texto sin él.
  const catalogUnavailable = !editing && catalogPending;
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
    const baseChanged = editing && unitId !== originalUnitId;
    const result = await onSubmit(editing
      ? { denomination: denominationText, ...(baseChanged ? { measurementUnitId: unitId } : {}) }
      : { denomination: denominationText, measurementUnitId: unitId });
    if (result?.ok) return;
    setSubmitting(false);
    if (result?.baseUnitLocked) {
      setBaseLockedByServer(true);
      setSelectedUnitId(originalUnitId);
    }
    const fieldMessage = result?.fieldErrors?.denomination || result?.fieldErrors?.measurementUnitId || "";
    setFieldError(fieldMessage);
    if (!fieldMessage) setSubmitError(result?.message || "");
  }

  const hint = fieldError
    || (needsCatalog && baseUnits.error ? baseUnits.error : "")
    || (needsCatalog && baseUnits.loading ? "Cargando unidades base..." : "")
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
        <form id="measurement-unit-form" className="relative flex min-h-0 flex-col gap-[16px] overflow-y-auto p-[16px]" onSubmit={handleSubmit} noValidate>
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
            prefixDisabled={editing ? !baseEditable || catalogPending : catalogUnavailable}
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
              {denomination.publicCode} · {baseEditable
                ? "Puedes cambiar la abreviatura mientras ningún servicio use esta unidad."
                : BASE_UNIT_LOCKED_REASON}
            </p>
          ) : null}
          {baseUnits.error && needsCatalog ? (
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
