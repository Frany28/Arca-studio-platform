import { useMemo, useState } from "react";

import { api } from "../../../../api/http.js";
import MeasurementUnitFormModal from "../../measurement-units/components/MeasurementUnitFormModal.jsx";
import { getMeasurementUnitErrorFeedback } from "../../measurement-units/utils/measurementUnitErrors.js";
import { toEditBaseUnitOptions } from "../../measurement-units/utils/measurementUnitPresentation.js";
import { useServiceDenominationOptions } from "../hooks/useServiceDenominationOptions.js";
import { useServiceDetail } from "../hooks/useServiceDetail.js";
import { useServiceFormSubmit } from "../hooks/useServiceFormSubmit.js";
import { getServiceFormErrorFeedback } from "../utils/serviceCatalogErrors.js";
import { createServiceDraft, validateServiceDraft } from "../utils/serviceFormValues.js";
import ServiceFormModal from "./ServiceFormModal.jsx";

const NO_ERRORS = Object.freeze({});

/**
 * Flujo del formulario de servicios: alta o edición en un único modal y, desde él, alta de una
 * unidad de medida con el formulario existente de Unidades (MeasurementUnitFormModal), sin
 * duplicarlo. En lugar de apilar dos diálogos (dos overlays, dos focus traps y dos Escape), el
 * flujo alterna entre ellos: el borrador y los errores viven aquí, así que el servicio conserva
 * lo escrito al ir y volver. Crear la unidad la selecciona y devuelve el foco al campo de unidad;
 * cancelar vuelve sin cambios con el foco en «+ Crear unidad».
 *
 * @param {Object} props - Solicitud y callbacks.
 * @param {{options: Array<Object>, loading: boolean, error: string, retry: () => void}} props.baseUnits
 * Catálogo de unidades base (useMeasurementUnitBaseOptions del panel: se lee una vez y se conserva).
 * @param {"create"|"edit"} props.mode - Alta o edición.
 * @param {number|null} [props.serviceId] - Servicio editado.
 * @param {() => void} props.onClose - Cierra sin guardar.
 * @param {(result: {mode: string, service: Object|null, changed: boolean}) => void} props.onSaved - Guardado correcto.
 * @param {(message: string) => void} props.onNotFound - El servicio editado ya no existe.
 * @param {() => void} props.onStale - La versión editada quedó desactualizada (recargar el listado).
 * @returns {import("react").ReactElement} Paso activo del flujo.
 */
function ServiceFormDialog({ baseUnits, mode, onClose, onNotFound, onSaved, onStale, serviceId = null }) {
  const editing = mode === "edit";
  const detail = useServiceDetail(editing ? serviceId : null);
  const service = detail.service;
  const status = !editing || service ? "ready" : detail.error ? "error" : "loading";
  const [draftState, setDraftState] = useState(null);
  // El borrador nace de la lectura del servicio (edición) o vacío (alta) y después es del usuario.
  const draft = draftState ?? createServiceDraft(service);
  const [fieldErrors, setFieldErrors] = useState(NO_ERRORS);
  const [submitError, setSubmitError] = useState("");
  const [step, setStep] = useState("service");
  const [focusTarget, setFocusTarget] = useState("name");
  const denominations = useServiceDenominationOptions({ enabled: status === "ready", measurementUnitId: draft.measurementUnitId });
  const form = useServiceFormSubmit({ mode, service });

  // En la edición la base actual figura aunque esté inactiva; la denominación actual también.
  const baseOptions = useMemo(
    () => (service ? toEditBaseUnitOptions(baseUnits.options, service.measurementUnit) : baseUnits.options),
    [baseUnits.options, service],
  );
  const denominationOptions = useMemo(() => {
    const current = service?.unitDenomination;
    if (!current || draft.measurementUnitId !== service.measurementUnit.id) return denominations.options;
    return denominations.options.some((item) => item.id === current.id) ? denominations.options : [current, ...denominations.options];
  }, [denominations.options, draft.measurementUnitId, service]);
  const catalogUnavailable = !editing && (Boolean(baseUnits.error) || baseUnits.options.length === 0);
  const unitHint = baseUnits.error
    || (baseUnits.loading ? "Cargando unidades base..." : "")
    || denominations.error
    || (denominations.loading ? "Cargando unidades de medida..." : "");

  /**
   * Aplica cambios al borrador y retira el error del campo editado.
   *
   * @param {Object} patch - Campos cambiados.
   * @param {string} field - Campo del formulario que cambió.
   * @returns {void}
   */
  function changeDraft(patch, field) {
    setDraftState((current) => ({ ...(current ?? draft), ...patch }));
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    setSubmitError("");
  }

  /**
   * Valida y envía. Un error conserva el borrador y se muestra junto a los campos.
   *
   * @returns {Promise<void>}
   */
  async function submit() {
    const errors = validateServiceDraft(draft);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }
    const result = await form.submit(draft);
    if (result.ignored) return;
    if (result.ok) {
      onSaved({ changed: result.changed, mode, service: result.service });
      return;
    }
    if (result.notFound) {
      onNotFound(result.message);
      return;
    }
    if (result.shouldReload) onStale();
    setFieldErrors(result.fieldErrors);
    setSubmitError(result.message);
  }

  /**
   * Crea la unidad de medida con el formulario de Unidades y vuelve al servicio con ella elegida.
   *
   * @param {{measurementUnitId: number, denomination: string}} values - Valores del formulario de unidades.
   * @returns {Promise<{ok: boolean, message?: string, fieldErrors?: Object}>} Resultado para ese formulario.
   */
  async function createDenomination(values) {
    try {
      const response = await api.measurementUnits.createDenomination(values);
      const created = response?.unitDenomination;
      if (created) {
        denominations.add(created);
        changeDraft({
          measurementUnitId: created.measurementUnit.id,
          unitDenomination: { id: created.id, denomination: created.denomination },
        }, "unit");
      }
      setFocusTarget("unit");
      setStep("service");
      return { ok: true };
    } catch (error) {
      return { ok: false, ...getMeasurementUnitErrorFeedback(error, "No se pudo crear la unidad.") };
    }
  }

  if (step === "unit") {
    return (
      <MeasurementUnitFormModal
        mode="create"
        denomination={null}
        baseUnits={baseUnits}
        initialMeasurementUnitId={draft.measurementUnitId}
        onClose={() => {
          setFocusTarget("create-unit");
          setStep("service");
        }}
        onSubmit={createDenomination}
      />
    );
  }

  return (
    <ServiceFormModal
      mode={mode}
      status={status}
      loadError={detail.error ? getServiceFormErrorFeedback(detail.error, "No se pudo cargar el servicio.").message : ""}
      onRetryLoad={detail.retry}
      draft={draft}
      onDraftChange={changeDraft}
      fieldErrors={fieldErrors}
      submitError={submitError}
      submitting={form.submitting}
      baseOptions={baseOptions}
      denominations={{ ...denominations, options: denominationOptions }}
      unitHint={unitHint}
      catalogUnavailable={catalogUnavailable}
      focusTarget={focusTarget}
      onCancel={onClose}
      onSubmit={submit}
      onCreateUnit={() => setStep("unit")}
    />
  );
}

export default ServiceFormDialog;
