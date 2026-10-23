import { useMemo, useState } from "react";

import { api } from "../../../../api/http.js";
import MeasurementUnitFormModal from "../../measurement-units/components/MeasurementUnitFormModal.jsx";
import { getMeasurementUnitErrorFeedback } from "../../measurement-units/utils/measurementUnitErrors.js";
import { toEditBaseUnitOptions } from "../../measurement-units/utils/measurementUnitPresentation.js";
import { useServiceDenominationOptions } from "../hooks/useServiceDenominationOptions.js";
import { useServiceDetail } from "../hooks/useServiceDetail.js";
import { useServiceFormSubmit } from "../hooks/useServiceFormSubmit.js";
import { getServiceFormErrorFeedback } from "../utils/serviceCatalogErrors.js";
import {
  SERVICE_KINDS, changeDraftKind, createServiceDraft, filterBaseOptionsForKind, validateServiceDraft,
} from "../utils/serviceFormValues.js";
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
 * Modalidad: llave en mano solo ofrece unidades base de m² (también en «+ Crear unidad») y, al
 * elegirla, retira una unidad incompatible ya elegida. La modalidad solo cambia por una elección
 * explícita del administrador; en la edición se precarga la guardada.
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
  // Bases que admite la modalidad elegida (solo m² en llave en mano).
  const kindBaseOptions = useMemo(() => filterBaseOptionsForKind(baseOptions, draft.kind), [baseOptions, draft.kind]);
  const unitCode = baseOptions.find((option) => option.id === draft.measurementUnitId)?.code;
  const noTurnkeyUnit = draft.kind === SERVICE_KINDS.TURNKEY && !baseUnits.loading && !baseUnits.error && kindBaseOptions.length === 0;
  const denominationOptions = useMemo(() => {
    const current = service?.unitDenomination;
    if (!current || draft.measurementUnitId !== service.measurementUnit.id) return denominations.options;
    return denominations.options.some((item) => item.id === current.id) ? denominations.options : [current, ...denominations.options];
  }, [denominations.options, draft.measurementUnitId, service]);
  const catalogUnavailable = !editing && (Boolean(baseUnits.error) || baseUnits.options.length === 0);
  const unitHint = baseUnits.error
    || (baseUnits.loading ? "Cargando unidades base..." : "")
    || (noTurnkeyUnit ? "No hay una unidad base de metros cuadrados activa para llave en mano." : "")
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
   * Aplica la modalidad elegida. Si la unidad base ya elegida no la admite, la retira junto con
   * su denominación (y su error), para que el administrador elija una compatible.
   *
   * @param {string} kind - Modalidad elegida.
   * @returns {void}
   */
  function changeKind(kind) {
    const patch = changeDraftKind(draft, kind, baseOptions);
    changeDraft(patch, "kind");
    if ("measurementUnitId" in patch) setFieldErrors((current) => (current.unit ? { ...current, unit: undefined } : current));
  }

  /**
   * Valida y envía. Un error conserva el borrador y se muestra junto a los campos.
   *
   * @returns {Promise<void>}
   */
  async function submit() {
    const errors = validateServiceDraft(draft, { unitCode });
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
        // En llave en mano solo se pueden crear unidades de la base m².
        baseUnits={draft.kind === SERVICE_KINDS.TURNKEY ? { ...baseUnits, options: filterBaseOptionsForKind(baseUnits.options, draft.kind) } : baseUnits}
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
      onKindChange={changeKind}
      fieldErrors={fieldErrors}
      submitError={submitError}
      submitting={form.submitting}
      baseOptions={kindBaseOptions}
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
