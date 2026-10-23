import { useRef, useState } from "react";

import { api } from "../../../../api/http.js";
import { getMeasurementUnitErrorFeedback } from "../../measurement-units/utils/measurementUnitErrors.js";
import {
  denominationEquivalenceKey,
  normalizeDenominationText,
  validateDenominationText,
} from "../../measurement-units/utils/measurementUnitPresentation.js";

const DUPLICATE_CODE = "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS";
const CLOSED = Object.freeze({ open: false, unitId: null, text: "", fieldError: "", message: "", duplicate: null });

/**
 * Busca, entre las denominaciones activas ya leídas de una base, una equivalente al texto (misma
 * clave que el índice único de PostgreSQL).
 *
 * @param {Array<{denomination: string}>} existing - Denominaciones de la base.
 * @param {string} text - Texto normalizado.
 * @returns {Object|null} Denominación equivalente o null.
 */
function findEquivalent(existing, text) {
  const key = denominationEquivalenceKey(text);
  return (existing || []).find((item) => denominationEquivalenceKey(item.denomination) === key) ?? null;
}

/**
 * Alta contextual de una unidad de medida (denominación) dentro del formulario de servicios
 * (Figma 5767:342334): «+ Crear unidad» despliega la fila en el mismo modal, sin otro diálogo.
 * Reutiliza las reglas y el contrato de Unidades (normalización, validación, POST
 * /admin/measurement-unit-denominations y su traducción de errores), así que no duplica reglas.
 *
 * - Abre con la base del servicio si es una opción válida; si no, con la primera del catálogo.
 * - Antes de enviar avisa de un duplicado evidente entre las denominaciones ya leídas de la base
 *   y ofrece usarlo; el 409 de duplicado del backend, que decide, se trata igual. Otros 409, 400
 *   o errores de red se muestran sin confundirlos con un duplicado.
 * - Un segundo envío mientras hay uno en curso se ignora (ref, también ante dobles clics).
 * - Crear la unidad no guarda el servicio: `onCreated` la incorpora al borrador.
 *
 * @param {Object} params - Opciones y callbacks.
 * @param {Array<{id: number, label: string}>} params.baseOptions - Bases activas permitidas (por modalidad).
 * @param {number|null} params.preferredUnitId - Base del servicio, preseleccionada al abrir.
 * @param {(denomination: Object) => void} params.onCreated - Recibe la denominación creada.
 * @returns {Object} Estado (`open`, `unitId`, `text`, `fieldError`, `message`, `duplicate`,
 * `submitting`) y acciones (`start`, `cancel`, `changeUnit`, `changeText`, `submit`).
 */
export function useInlineDenominationCreator({ baseOptions, onCreated, preferredUnitId }) {
  const [state, setState] = useState(CLOSED);
  const [submitting, setSubmitting] = useState(false);
  const busyRef = useRef(false);
  // Una base elegida que deja de estar permitida (p. ej. al pasar a llave en mano) cede a la primera.
  const unitId = baseOptions.some((option) => option.id === state.unitId) ? state.unitId : baseOptions[0]?.id ?? null;

  /**
   * Cambia campos y retira los avisos previos.
   *
   * @param {Object} patch - Campos cambiados.
   * @returns {void}
   */
  function update(patch) {
    setState((current) => ({ ...current, fieldError: "", message: "", duplicate: null, ...patch }));
  }

  /**
   * Envía la denominación. Devuelve la creada, o null si no se creó.
   *
   * @param {Array<Object>} existing - Denominaciones activas ya leídas de la base elegida.
   * @returns {Promise<Object|null>} Denominación creada.
   */
  async function submit(existing) {
    if (busyRef.current || !unitId) return null;
    const validationError = validateDenominationText(state.text);
    if (validationError) {
      update({ fieldError: validationError });
      return null;
    }
    const denomination = normalizeDenominationText(state.text);
    const equivalent = findEquivalent(existing, denomination);
    if (equivalent) {
      update({ fieldError: `Ya existe «${equivalent.label ?? equivalent.denomination}» en esta unidad base.`, duplicate: equivalent });
      return null;
    }
    busyRef.current = true;
    setSubmitting(true);
    try {
      const response = await api.measurementUnits.createDenomination({ denomination, measurementUnitId: unitId });
      const created = response?.unitDenomination ?? null;
      setState(CLOSED);
      if (created) onCreated(created);
      return created;
    } catch (error) {
      const feedback = getMeasurementUnitErrorFeedback(error, "No se pudo crear la unidad.");
      const fieldError = feedback.fieldErrors.denomination || feedback.fieldErrors.measurementUnitId || "";
      update({
        fieldError,
        message: fieldError ? "" : feedback.message,
        // Solo el 409 de duplicado ofrece la existente, si ya figura entre las leídas.
        duplicate: error?.code === DUPLICATE_CODE ? findEquivalent(existing, denomination) : null,
      });
      return null;
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  return {
    ...state,
    unitId,
    submitting,
    /**
     * Despliega el formulario con la base del servicio si está permitida.
     *
     * @returns {void}
     */
    start: () => setState({ ...CLOSED, open: true, unitId: preferredUnitId }),
    /**
     * Cierra el formulario sin escribir nada (no durante un envío).
     *
     * @returns {void}
     */
    cancel: () => {
      if (!busyRef.current) setState(CLOSED);
    },
    /**
     * Cierra el formulario tras elegir una denominación existente.
     *
     * @returns {void}
     */
    close: () => setState(CLOSED),
    changeUnit: (nextUnitId) => update({ unitId: nextUnitId }),
    changeText: (text) => update({ text }),
    submit,
  };
}
