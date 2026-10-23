import { Add } from "iconsax-react";

import Button from "../../../../components/ui/Button/Button.jsx";
import Input from "../../../../components/ui/Input/Input.jsx";
import Loader from "../../../../components/ui/Loader/Loader.jsx";
import Modal, { ModalCloseButton } from "../../../../components/ui/Modal/Modal.jsx";
import TextArea from "../../../../components/ui/TextArea.jsx";
import { useDialogKeyboard } from "../../../../hooks/useDialogKeyboard.js";
import {
  rateFromPastedText, rateFromTypedValue, SERVICE_DESCRIPTION_MAX_LENGTH, SERVICE_NAME_MAX_LENGTH,
} from "../utils/serviceFormValues.js";
import ServiceModalityField from "./ServiceModalityField.jsx";
import ServiceUnitField from "./ServiceUnitField.jsx";

const DIALOG_SELECTOR = "[data-service-form]";
const FIELD_IDS = { name: "service-form-name", kind: "service-form-kind", unit: "service-form-unit" };
// Anotación de Figma: el mismo modal edita, con los datos completos y el título «Servicio».
const COPY = {
  create: { title: "Nuevo servicio", submit: "Crear", submitting: "Creando...", close: "Cerrar formulario de nuevo servicio" },
  edit: { title: "Servicio", submit: "Guardar", submitting: "Guardando...", close: "Cerrar formulario del servicio" },
};
// Elemento que recibe el foco al abrir o al volver de «+ Crear unidad».
const FOCUS_SELECTORS = {
  name: `#${FIELD_IDS.name}`,
  unit: `#${FIELD_IDS.unit}`,
  "create-unit": "[data-service-create-unit]",
};

/**
 * Modal único de alta y edición de servicios (Figma 5764:226084): nombre, modalidad de
 * contratación, descripción opcional, unidad de medida (base + denominación), tarifa en USD y
 * «+ Crear unidad». No guarda estado propio: el borrador vive en ServiceFormDialog para
 * sobrevivir al paso por el formulario de unidades. El código no se muestra: lo genera el sistema.
 *
 * @param {Object} props - Modo, borrador, opciones y callbacks.
 * @param {"create"|"edit"} props.mode - Alta o edición.
 * @param {"loading"|"error"|"ready"} props.status - Lectura del servicio en la edición.
 * @param {string} [props.loadError] - Mensaje si la lectura falló.
 * @param {() => void} [props.onRetryLoad] - Repite la lectura.
 * @param {Object} props.draft - Borrador (createServiceDraft).
 * @param {(patch: Object) => void} props.onDraftChange - Aplica cambios parciales al borrador.
 * @param {(kind: string) => void} props.onKindChange - Aplica la modalidad elegida (y sus efectos en la unidad).
 * @param {Object} props.fieldErrors - Errores por campo (name, kind, description, unit, referenceRate).
 * @param {string} props.submitError - Error general del envío.
 * @param {boolean} props.submitting - Envío en curso.
 * @param {Array<Object>} props.baseOptions - Unidades base del selector.
 * @param {{options: Array<Object>, loading: boolean, error: string, retry: () => void}} props.denominations
 * Denominaciones de la base elegida.
 * @param {string} props.unitHint - Ayuda del campo de unidad (carga o error del catálogo).
 * @param {boolean} props.catalogUnavailable - El catálogo de bases no está disponible.
 * @param {"name"|"unit"|"create-unit"} props.focusTarget - Elemento enfocado al abrir.
 * @param {() => void} props.onCancel - Cierra sin guardar.
 * @param {() => void} props.onSubmit - Valida y envía.
 * @param {() => void} props.onCreateUnit - Abre el formulario de unidades conservando el borrador.
 * @returns {import("react").ReactElement} Modal en portal.
 */
function ServiceFormModal({
  baseOptions, catalogUnavailable, denominations, draft, fieldErrors, focusTarget, loadError, mode,
  onCancel, onCreateUnit, onDraftChange, onKindChange, onRetryLoad, onSubmit, status, submitError, submitting, unitHint,
}) {
  const copy = COPY[mode === "edit" ? "edit" : "create"];
  const ready = status === "ready";

  useDialogKeyboard({
    open: true,
    getContainer: () => document.querySelector(DIALOG_SELECTOR),
    onEscape: () => {
      if (!submitting) onCancel();
    },
    getInitialFocus: (elements) => elements.find((element) => element.matches(FOCUS_SELECTORS[focusTarget] ?? FOCUS_SELECTORS.name)),
  });

  /**
   * Evita el envío nativo y delega la validación y el guardado.
   *
   * @param {import("react").FormEvent} event - Envío del formulario.
   * @returns {void}
   */
  function handleSubmit(event) {
    event.preventDefault();
    if (!submitting && ready) onSubmit();
  }

  return (
    <Modal mount="viewport" visible onClose={submitting ? undefined : onCancel} className="z-[100]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-form-title"
        aria-busy={status === "loading" || undefined}
        data-service-form
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-[400px] flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
        onClick={(event) => event.stopPropagation()}
      >
        <form id="service-form" className="relative flex min-h-0 flex-col gap-[16px] overflow-y-auto p-[16px]" onSubmit={handleSubmit} noValidate>
          <div className="absolute right-0 top-0">
            <ModalCloseButton disabled={submitting} ariaLabel={copy.close} onClick={onCancel} />
          </div>
          <h2 id="service-form-title" className="text-heading-6 m-0 pr-[28px] text-[var(--color-text-300)]">{copy.title}</h2>

          {status === "loading" ? <Loader preset="detailValue" label="Cargando servicio" /> : null}
          {status === "error" ? (
            <div className="flex flex-col items-start gap-[8px]">
              <p className="text-body-3 m-0 text-[var(--color-danger-100)]" role="alert">{loadError}</p>
              <Button theme="Primary" type="Link" size="S" fitContent showLeftIcon={false} showRightIcon={false} onClick={onRetryLoad}>Reintentar</Button>
            </div>
          ) : null}

          {ready ? (
            <>
              <Input
                id={FIELD_IDS.name}
                type="Default input"
                size="M"
                label="Nombre del servicio"
                required
                showLabelInfo={false}
                showLeftIcon={false}
                showRightIcon={false}
                placeholder="Ej. “Diseño de interiores”"
                value={draft.name}
                maxLength={SERVICE_NAME_MAX_LENGTH}
                state={fieldErrors.name ? "Error" : "Default"}
                showHint={Boolean(fieldErrors.name)}
                hintText={fieldErrors.name}
                disabled={submitting}
                className="max-w-none"
                autoComplete="off"
                onChange={(event) => onDraftChange({ name: event.target.value }, "name")}
              />
              <ServiceModalityField
                id={FIELD_IDS.kind}
                value={draft.kind}
                error={fieldErrors.kind}
                disabled={submitting}
                onChange={onKindChange}
              />
              <TextArea
                label="Descripción (opcional)"
                showLabelInfo={false}
                placeholder="Descripción del servicio."
                value={draft.description}
                maxLength={SERVICE_DESCRIPTION_MAX_LENGTH}
                // Figma: caja de 130 px con 12 px de padding vertical.
                minHeight={106}
                state={fieldErrors.description ? "Error" : "Default"}
                showHint={Boolean(fieldErrors.description)}
                hintText={fieldErrors.description}
                disabled={submitting}
                className="max-w-none"
                onChange={(event) => onDraftChange({ description: event.target.value }, "description")}
              />
              <div className="flex items-start gap-[16px]">
                <div className="flex min-w-0 flex-1 flex-col items-start gap-[8px]">
                  <ServiceUnitField
                    id={FIELD_IDS.unit}
                    baseOptions={baseOptions}
                    measurementUnitId={draft.measurementUnitId}
                    unitDenomination={draft.unitDenomination}
                    denominations={denominations.options}
                    hint={fieldErrors.unit || unitHint}
                    invalid={Boolean(fieldErrors.unit)}
                    disabled={submitting || catalogUnavailable}
                    onChange={(changes) => onDraftChange(changes, "unit")}
                  />
                  {denominations.error ? (
                    <Button theme="Primary" type="Link" size="S" fitContent showLeftIcon={false} showRightIcon={false} onClick={denominations.retry}>
                      Reintentar carga de unidades
                    </Button>
                  ) : null}
                  <Button
                    theme="Primary"
                    type="Outline"
                    size="S"
                    fitContent
                    showLeftIcon
                    iconLeft={<Add size="20" color="currentColor" />}
                    showRightIcon={false}
                    disabled={submitting || catalogUnavailable}
                    data-service-create-unit
                    onClick={onCreateUnit}
                  >
                    Crear unidad
                  </Button>
                </div>
                <Input
                  type="Default input"
                  size="M"
                  label="Tarifa USD"
                  required
                  showLabelInfo={false}
                  showLeftIcon={false}
                  showRightIcon={false}
                  placeholder="0.00"
                  // Entrada de caja registradora: los dígitos entran por la derecha y los dos
                  // últimos son céntimos ("1", "0", "0" → 1.00); el teclado solo necesita dígitos.
                  inputMode="numeric"
                  value={draft.referenceRate}
                  state={fieldErrors.referenceRate ? "Error" : "Default"}
                  showHint={Boolean(fieldErrors.referenceRate)}
                  hintText={fieldErrors.referenceRate}
                  disabled={submitting}
                  // Figma: 125 px. `!` porque la raíz de Input fija `w-full`, que ganaría al ancho propio.
                  className="!w-[125px] !max-w-[125px] shrink-0"
                  inputClassName="text-right tabular-nums"
                  autoComplete="off"
                  onChange={(event) => onDraftChange({ referenceRate: rateFromTypedValue(event.target.value, draft.referenceRate) }, "referenceRate")}
                  onPaste={(event) => {
                    event.preventDefault();
                    onDraftChange({ referenceRate: rateFromPastedText(event.clipboardData.getData("text"), draft.referenceRate) }, "referenceRate");
                  }}
                />
              </div>
              {submitError ? <p className="text-body-3 m-0 text-[var(--color-danger-100)]" role="alert">{submitError}</p> : null}
            </>
          ) : null}
        </form>

        <footer className="flex items-center gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
          <Button theme="Primary" type="Outline" size="M" showLeftIcon={false} showRightIcon={false} disabled={submitting} className="!h-[41px] !w-full min-w-0 flex-1" onClick={onCancel}>Cancelar</Button>
          <Button theme="Primary" type="Solid" size="M" showLeftIcon={false} showRightIcon={false} disabled={submitting || !ready || catalogUnavailable} className="!h-[41px] !w-full min-w-0 flex-1" htmlType="submit" form="service-form">
            {submitting ? copy.submitting : copy.submit}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

export default ServiceFormModal;
