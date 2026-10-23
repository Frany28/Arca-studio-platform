import { useMemo, useState } from "react";

import { toEditBaseUnitOptions } from "../../measurement-units/utils/measurementUnitPresentation.js";
import { useInlineDenominationCreator } from "../hooks/useInlineDenominationCreator.js";
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
 * Flujo del formulario de servicios: alta o edición en un único modal. «+ Crear unidad»
 * despliega dentro del mismo modal la fila de alta de una unidad de medida (Figma 5767:342334;
 * useInlineDenominationCreator), sin abrir otro diálogo: el borrador del servicio no se toca.
 * Crear la unidad la añade a las opciones, la elige en el borrador y devuelve el foco al campo de
 * unidad; cancelar cierra solo la fila con el foco en «+ Crear unidad». Crear la unidad no guarda
 * el servicio.
 *
 * Modalidad: llave en mano solo ofrece unidades base de m² (también al crear una unidad) y, al
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
 * @returns {import("react").ReactElement} Modal del formulario.
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
  // Confirmación discreta de la unidad recién creada, junto al campo de unidad.
  const [unitNotice, setUnitNotice] = useState("");
  // Foco tras desplegar, cancelar o completar el alta de unidad (cada petición es un objeto nuevo).
  const [focusRequest, setFocusRequest] = useState(null);
  const form = useServiceFormSubmit({ mode, service });

  // En la edición la base actual figura aunque esté inactiva; la denominación actual también.
  const baseOptions = useMemo(
    () => (service ? toEditBaseUnitOptions(baseUnits.options, service.measurementUnit) : baseUnits.options),
    [baseUnits.options, service],
  );
  // Bases que admite la modalidad elegida (solo m² en llave en mano).
  const kindBaseOptions = useMemo(() => filterBaseOptionsForKind(baseOptions, draft.kind), [baseOptions, draft.kind]);
  // Una unidad nueva solo puede crearse en una base activa (catálogo) permitida por la modalidad.
  const creatableBaseOptions = useMemo(() => filterBaseOptionsForKind(baseUnits.options, draft.kind), [baseUnits.options, draft.kind]);
  const unitCode = baseOptions.find((option) => option.id === draft.measurementUnitId)?.code;
  const noTurnkeyUnit = draft.kind === SERVICE_KINDS.TURNKEY && !baseUnits.loading && !baseUnits.error && kindBaseOptions.length === 0;

  const creator = useInlineDenominationCreator({
    baseOptions: creatableBaseOptions,
    preferredUnitId: draft.measurementUnitId,
    onCreated: selectCreatedDenomination,
  });
  const denominationCatalog = useServiceDenominationOptions({
    enabled: status === "ready",
    measurementUnitIds: [draft.measurementUnitId, creator.open ? creator.unitId : null],
  });
  const denominations = denominationCatalog.forUnit(draft.measurementUnitId);
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
  const createUnitHint = baseUnits.error
    || (baseUnits.loading ? "Cargando unidades base..." : "")
    || (creatableBaseOptions.length === 0 && !baseUnits.loading ? "No hay una unidad base activa disponible para esta modalidad." : "");

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
    if (field === "unit" || "measurementUnitId" in patch) setUnitNotice("");
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
   * Elige en el borrador una denominación (creada o existente) con su base y avisa con discreción.
   *
   * @param {{id: number, denomination: string, label?: string, measurementUnit: {id: number}}} denomination - Denominación elegida.
   * @param {string} notice - Confirmación que se muestra junto al campo de unidad.
   * @returns {void}
   */
  function selectDenomination(denomination, notice) {
    changeDraft({
      measurementUnitId: denomination.measurementUnit.id,
      unitDenomination: { id: denomination.id, denomination: denomination.denomination },
    }, "unit");
    setUnitNotice(notice);
    setFocusRequest({ target: "unit" });
  }

  /**
   * Incorpora la denominación recién creada a las opciones de su base y la elige.
   *
   * @param {Object} created - Denominación devuelta por la API.
   * @returns {void}
   */
  function selectCreatedDenomination(created) {
    denominationCatalog.add(created);
    selectDenomination(created, `Unidad «${created.label ?? created.denomination}» creada y seleccionada.`);
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
      denominations={{ ...denominations, options: denominationOptions, retry: () => denominationCatalog.retry(draft.measurementUnitId) }}
      unitHint={unitHint}
      unitNotice={unitNotice}
      catalogUnavailable={catalogUnavailable}
      focusRequest={focusRequest}
      onCancel={onClose}
      onSubmit={submit}
      unitCreation={{
        creator,
        baseOptions: creatableBaseOptions,
        hint: createUnitHint,
        onStart: () => {
          creator.start();
          setFocusRequest({ target: "new-unit" });
        },
        onCancel: () => {
          creator.cancel();
          setFocusRequest({ target: "create-unit" });
        },
        onSave: () => creator.submit(denominationCatalog.forUnit(creator.unitId).options),
        onUseExisting: (existing) => {
          creator.close();
          selectDenomination(existing, `Se seleccionó la unidad existente «${existing.label ?? existing.denomination}».`);
        },
      }}
    />
  );
}

export default ServiceFormDialog;
