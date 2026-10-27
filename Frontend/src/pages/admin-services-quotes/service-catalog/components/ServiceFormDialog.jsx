import { useEffect, useEffectEvent, useMemo, useState } from "react";

import { toEditBaseUnitOptions } from "../../measurement-units/utils/measurementUnitPresentation.js";
import { useActiveDenominations } from "../hooks/useActiveDenominations.js";
import { useInlineDenominationCreator } from "../hooks/useInlineDenominationCreator.js";
import { useServiceDetail } from "../hooks/useServiceDetail.js";
import { useServiceFormSubmit } from "../hooks/useServiceFormSubmit.js";
import { getServiceFormErrorFeedback } from "../utils/serviceCatalogErrors.js";
import {
  changeDraftKind, createServiceDraft, filterBaseOptionsForKind, filterDenominationsForBase,
  validateServiceDraft,
} from "../utils/serviceFormValues.js";
import { getServiceUnitCatalog, preservesServiceUnit } from "../utils/serviceUnitSelection.js";
import ServiceFormModal from "./ServiceFormModal.jsx";

const NO_ERRORS = Object.freeze({});

/**
 * Flujo del formulario de servicios: alta o edición en un único modal. «Unidad de medida» solo
 * permite elegir primero una base y después una denominación activa de esa base; no admite una
 * base suelta nueva. En la edición conserva la unidad guardada aunque esté inactiva. «+ Crear unidad»
 * despliega dentro del mismo modal la fila de alta de una unidad de medida (Figma 5767:342334;
 * useInlineDenominationCreator), sin abrir otro diálogo: el borrador del servicio no se toca.
 * Crear la unidad la añade a las opciones, la elige en el borrador y devuelve el foco al campo de
 * unidad; cancelar cierra solo la fila con el foco en «+ Crear unidad». Crear la unidad no guarda
 * el servicio; el panel confirma su creación con la alerta de éxito compartida.
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
 * @param {(unit: Object) => void} props.onUnitCreated - Notifica al panel la unidad creada para mostrar su alerta.
 * @param {(message: string) => void} props.onNotFound - El servicio editado ya no existe.
 * @param {() => void} props.onStale - La versión editada quedó desactualizada (recargar el listado).
 * @returns {import("react").ReactElement} Modal del formulario.
 */
function ServiceFormDialog({ baseUnits, mode, onClose, onNotFound, onSaved, onStale, onUnitCreated, serviceId = null }) {
  const editing = mode === "edit";
  const detail = useServiceDetail(editing ? serviceId : null);
  const service = detail.service;
  const status = !editing || service ? "ready" : detail.error ? "error" : "loading";
  const loadError = detail.error ? getServiceFormErrorFeedback(detail.error, "No se pudo cargar el servicio.") : null;
  // Un servicio inexistente no se recupera reintentando: su mensaje anuncia que la lista se
  // actualiza, así que se recarga una vez y el formulario solo ofrece cerrar.
  const loadNotFound = Boolean(loadError?.notFound);
  const reloadStaleList = useEffectEvent(onStale);
  useEffect(() => {
    if (loadNotFound) reloadStaleList();
  }, [loadNotFound]);
  const [draftState, setDraftState] = useState(null);
  // El borrador nace de la lectura del servicio (edición) o vacío (alta) y después es del usuario.
  const draft = draftState ?? createServiceDraft(service);
  const [fieldErrors, setFieldErrors] = useState(NO_ERRORS);
  const [submitError, setSubmitError] = useState("");
  // Confirmación discreta al reutilizar una unidad existente tras detectar un duplicado.
  const [unitNotice, setUnitNotice] = useState("");
  // Foco tras desplegar, cancelar o completar el alta de unidad (cada petición es un objeto nuevo).
  const [focusRequest, setFocusRequest] = useState(null);
  const form = useServiceFormSubmit({ mode, service });

  // Catálogo de bases (con su código): fuente del alta contextual y de las reglas de modalidad.
  // En la edición incluye la base actual aunque esté inactiva.
  const baseOptions = useMemo(
    () => (service ? toEditBaseUnitOptions(baseUnits.options, service.measurementUnit) : baseUnits.options),
    [baseUnits.options, service],
  );
  // Una unidad nueva solo puede crearse en una base activa (catálogo) permitida por la modalidad.
  const creatableBaseOptions = useMemo(() => filterBaseOptionsForKind(baseUnits.options, draft.kind), [baseUnits.options, draft.kind]);
  const unitCode = baseOptions.find((option) => option.id === draft.measurementUnitId)?.code;

  const creator = useInlineDenominationCreator({
    baseOptions: creatableBaseOptions,
    preferredUnitId: draft.measurementUnitId,
    onCreated: selectCreatedDenomination,
  });
  // Ambos modos necesitan las denominaciones al abrir para construir los símbolos seleccionables.
  const activeDenominations = useActiveDenominations({ enabled: status === "ready" });
  const unitCatalog = useMemo(() => getServiceUnitCatalog(baseUnits.options, activeDenominations.options, draft.kind),
    [activeDenominations.options, baseUnits.options, draft.kind]);
  const unitPrefixOptions = unitCatalog.prefixOptions;
  // La base guardada puede mostrarse sin estar disponible para otra asignación.
  const selectedBaseOption = baseOptions.find((option) => option.id === draft.measurementUnitId) ?? null;
  // La unidad guardada se conserva en el borrador, pero una inactiva no vuelve a ofrecerse.
  const unitSuggestions = useMemo(
    () => filterDenominationsForBase(unitCatalog.denominations, draft.measurementUnitId),
    [draft.measurementUnitId, unitCatalog.denominations],
  );
  // Un servicio guardado solo con la base puede conservarla; cualquier cambio exige una unidad registrada.
  const preserveStoredUnit = preservesServiceUnit(draft, service);
  const noRegisteredUnits = status === "ready" && draft.measurementUnitId && !draft.unitDenomination
    && !activeDenominations.loading && !activeDenominations.error && unitSuggestions.length === 0;
  const catalogUnavailable = !editing && (Boolean(baseUnits.error) || baseUnits.options.length === 0);
  const unitHint = activeDenominations.error
    || (activeDenominations.loading ? "Cargando unidades de medida..." : "")
    || (!draft.measurementUnitId && unitPrefixOptions.length === 0 ? "No hay unidades de medida registradas. Crea una con «+ Crear unidad»." : "")
    || (noRegisteredUnits ? "No hay unidades registradas para este símbolo" : "");
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
   * Elige en el borrador una denominación con su base y devuelve el foco al campo.
   * Solo reutilizar una existente tras un duplicado necesita una confirmación junto al campo.
   *
   * @param {{id: number, denomination: string, label?: string, measurementUnit: {id: number}}} denomination - Denominación elegida.
   * @param {string} [notice] - Confirmación opcional al reutilizar una unidad existente.
   * @returns {void}
   */
  function selectDenomination(denomination, notice = "") {
    changeDraft({
      measurementUnitId: denomination.measurementUnit.id,
      unitDenomination: { id: denomination.id, denomination: denomination.denomination },
    }, "unit");
    setUnitNotice(notice);
    setFocusRequest({ target: "unit" });
  }

  /**
   * Incorpora la denominación recién creada a las opciones de su base y la elige.
   * Notifica al panel para mostrar la alerta de éxito, sin añadir una descripción al campo.
   *
   * @param {Object} created - Denominación devuelta por la API.
   * @returns {void}
   */
  function selectCreatedDenomination(created) {
    activeDenominations.add(created);
    selectDenomination(created);
    onUnitCreated(created);
  }

  /**
   * Valida y envía. Un error conserva el borrador y se muestra junto a los campos.
   *
   * @returns {Promise<void>}
   */
  async function submit() {
    const errors = validateServiceDraft(draft, { availableDenominations: unitCatalog.denominations, originalKind: service?.kind, preserveStoredUnit, unitCode });
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
      loadError={loadError?.message ?? ""}
      onRetryLoad={loadNotFound ? undefined : detail.retry}
      draft={draft}
      onDraftChange={changeDraft}
      onKindChange={changeKind}
      kindLocked={Boolean(service?.kindLocked)}
      fieldErrors={fieldErrors}
      submitError={submitError}
      submitting={form.submitting}
      unitPrefixOptions={unitPrefixOptions}
      selectedBaseOption={selectedBaseOption}
      denominations={{ ...activeDenominations, options: unitSuggestions }}
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
        // El aviso de duplicados compara con las unidades activas ya leídas de la base elegida.
        onSave: () => creator.submit(activeDenominations.options.filter((item) => item.measurementUnit.id === creator.unitId)),
        onUseExisting: (existing) => {
          creator.close();
          selectDenomination(existing, `Se seleccionó la unidad existente «${existing.label ?? existing.denomination}».`);
        },
      }}
    />
  );
}

export default ServiceFormDialog;
