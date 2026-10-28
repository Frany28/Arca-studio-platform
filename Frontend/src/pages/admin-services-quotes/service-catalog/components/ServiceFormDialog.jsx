import { useEffect, useEffectEvent, useMemo, useState } from "react";

import { toEditBaseUnitOptions } from "../../measurement-units/utils/measurementUnitPresentation.js";
import { useActiveDenominations } from "../hooks/useActiveDenominations.js";
import { useInlineDenominationCreator } from "../hooks/useInlineDenominationCreator.js";
import { useServiceDetail } from "../hooks/useServiceDetail.js";
import { useServiceFormSubmit } from "../hooks/useServiceFormSubmit.js";
import { getServiceFormErrorFeedback } from "../utils/serviceCatalogErrors.js";
import { createServiceDraft, getServiceUnitOptions, getStoredUnitKeys, validateServiceDraft } from "../utils/serviceFormValues.js";
import { getServiceUnitCatalog, preservesServiceUnit } from "../utils/serviceUnitSelection.js";
import ServiceFormModal from "./ServiceFormModal.jsx";

const NO_ERRORS = Object.freeze({});

/**
 * Flujo del formulario de servicios: alta o edición en un único modal. «Unidad de medida» admite
 * una base activa sola o con una denominación activa de esa base, y unidades alternativas con su
 * tarifa (vacía = pendiente de validación comercial). En la edición conserva las unidades guardadas
 * aunque estén inactivas. «+ Crear unidad»
 * despliega dentro del mismo modal la fila de alta de una unidad de medida (Figma 5767:342334;
 * useInlineDenominationCreator), sin abrir otro diálogo: el borrador del servicio no se toca.
 * Crear la unidad la añade a las opciones, la elige en el borrador y devuelve el foco al campo de
 * unidad; cancelar cierra solo la fila con el foco en «+ Crear unidad». Crear la unidad no guarda
 * el servicio; el panel confirma su creación con la alerta de éxito compartida.
 *
 * Modalidad: no restringe la unidad. Ambas ofrecen todas las unidades registradas y activas
 * (también al crear una unidad) y cambiarla conserva la unidad elegida. La modalidad solo cambia
 * por una elección explícita del administrador; en la edición se precarga la guardada.
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

  // Catálogo de bases: fuente del símbolo de la unidad elegida. En la edición incluye la base
  // actual aunque esté inactiva.
  const baseOptions = useMemo(
    () => (service ? toEditBaseUnitOptions(baseUnits.options, service.measurementUnit) : baseUnits.options),
    [baseUnits.options, service],
  );

  // Una unidad nueva puede crearse en cualquier base activa del catálogo, con cualquier modalidad.
  const creator = useInlineDenominationCreator({
    baseOptions: baseUnits.options,
    preferredUnitId: draft.measurementUnitId,
    onCreated: selectCreatedDenomination,
  });
  // Ambos modos necesitan las denominaciones al abrir para construir los símbolos seleccionables.
  const activeDenominations = useActiveDenominations({ enabled: status === "ready" });
  const unitCatalog = useMemo(() => getServiceUnitCatalog(baseUnits.options, activeDenominations.options),
    [activeDenominations.options, baseUnits.options]);
  // Bases por id para mostrar el símbolo y el nombre de cualquier unidad elegida: las del catálogo
  // y las guardadas en el servicio (también alternativas), aunque ya no estén disponibles.
  const baseOptionsById = useMemo(() => {
    const byId = new Map(baseOptions.map((option) => [option.id, option]));
    for (const option of getServiceUnitOptions(service)) {
      const unit = option.measurementUnit;
      if (unit?.id && !byId.has(unit.id)) byId.set(unit.id, { id: unit.id, code: unit.code, label: unit.symbol, description: unit.name });
    }
    return byId;
  }, [baseOptions, service]);
  const findBaseOption = (baseId) => baseOptionsById.get(baseId) ?? null;
  // La base guardada puede mostrarse sin estar disponible para otra asignación.
  const selectedBaseOption = findBaseOption(draft.measurementUnitId);
  const primaryUnitLabel = [selectedBaseOption?.label, draft.unitDenomination?.denomination].filter(Boolean).join(" ");
  // La unidad principal guardada (con o sin denominación) puede conservarse aunque sea histórica.
  const preserveStoredUnit = preservesServiceUnit(draft, service);
  const storedUnitKeys = useMemo(() => getStoredUnitKeys(service), [service]);
  const catalogUnavailable = !editing && (Boolean(baseUnits.error) || baseUnits.options.length === 0);
  const unitHint = activeDenominations.error
    || (activeDenominations.loading ? "Cargando unidades de medida..." : "")
    || (status === "ready" && unitCatalog.prefixOptions.length === 0 ? "No hay unidades base activas disponibles." : "");
  const createUnitHint = baseUnits.error
    || (baseUnits.loading ? "Cargando unidades base..." : "")
    || (baseUnits.options.length === 0 && !baseUnits.loading ? "No hay una unidad base activa disponible." : "");

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
   * Aplica la modalidad elegida conservando la unidad y la denominación: cualquier modalidad
   * admite cualquier unidad registrada.
   *
   * @param {string} kind - Modalidad elegida.
   * @returns {void}
   */
  function changeKind(kind) {
    changeDraft({ kind }, "kind");
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
    const errors = validateServiceDraft(draft, {
      availableBases: unitCatalog.prefixOptions,
      availableDenominations: unitCatalog.denominations,
      preserveStoredUnit,
      storedUnitKeys,
    });
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
      selectedBaseOption={selectedBaseOption}
      bases={unitCatalog.prefixOptions}
      findBaseOption={findBaseOption}
      primaryUnitLabel={primaryUnitLabel}
      denominations={{ ...activeDenominations, options: unitCatalog.denominations }}
      unitHint={unitHint}
      unitNotice={unitNotice}
      catalogUnavailable={catalogUnavailable}
      focusRequest={focusRequest}
      onCancel={onClose}
      onSubmit={submit}
      unitCreation={{
        creator,
        baseOptions: baseUnits.options,
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
