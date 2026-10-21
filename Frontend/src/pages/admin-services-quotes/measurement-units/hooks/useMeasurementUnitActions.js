import { useRef, useState } from "react";

import { api } from "../../../../api/http.js";
import { getMeasurementUnitErrorFeedback } from "../utils/measurementUnitErrors.js";

/**
 * Coordina las mutaciones de unidades de medida y su retroalimentación: abrir el formulario de
 * alta o edición, enviarlo, pedir confirmación para activar o desactivar y mostrar el resultado.
 * Cada operación bloquea un segundo envío mientras está en curso (también ante dobles clics del
 * mismo render, mediante una ref). Las filas solo cambian con la respuesta del servidor.
 *
 * @param {Object} params - Coordinación con el listado.
 * @param {(item: Object) => void} params.replaceItem - Sustituye la fila editada.
 * @param {() => void} params.reloadFromStart - Recarga la primera página tras crear.
 * @param {() => void} params.reload - Recarga la página actual (registro inexistente).
 * @returns {Object} Estado y acciones de formulario, estado y retroalimentación.
 */
export function useMeasurementUnitActions({ reload, reloadFromStart, replaceItem }) {
  const busyRef = useRef(false);
  const [form, setForm] = useState(null);
  const [pendingStatus, setPendingStatus] = useState(null);
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  /**
   * Publica un aviso con un identificador nuevo para que AlertToast lo vuelva a mostrar.
   *
   * @param {"success"|"danger"} tone - Tono del aviso.
   * @param {string} title - Título.
   * @param {string} message - Descripción.
   * @returns {void}
   */
  function notify(tone, title, message) {
    setFeedback({ id: Date.now(), message, title, tone });
  }

  /**
   * Envía el formulario abierto. Un error se devuelve al formulario (que conserva lo escrito y
   * marca los campos); un éxito cierra el formulario y actualiza el listado.
   *
   * @param {{measurementUnitId: number, denomination: string}} values - Valores normalizados.
   * @returns {Promise<{ok: true}|{ok: false, message: string, fieldErrors: Object}>} Resultado.
   */
  async function submitForm(values) {
    if (!form || busyRef.current) return { ok: false, fieldErrors: {}, message: "" };
    busyRef.current = true;
    const editing = form.mode === "edit";
    try {
      const response = editing
        ? await api.measurementUnits.updateDenomination({ denomination: values.denomination, denominationId: form.denomination.id })
        : await api.measurementUnits.createDenomination(values);
      const saved = response?.unitDenomination;
      setForm(null);
      if (editing) {
        if (saved) replaceItem(saved);
        notify("success", response?.changed === false ? "Sin cambios" : "Unidad actualizada", saved ? `${saved.publicCode} · ${saved.label}` : "");
      } else {
        reloadFromStart();
        notify("success", "Unidad creada", saved ? `${saved.publicCode} · ${saved.label}` : "");
      }
      return { ok: true };
    } catch (error) {
      const result = getMeasurementUnitErrorFeedback(error, editing ? "No se pudo actualizar la unidad." : "No se pudo crear la unidad.");
      if (result.shouldReload) {
        setForm(null);
        reload();
        notify("danger", "No se pudo guardar", result.message);
      }
      return { ok: false, fieldErrors: result.fieldErrors, message: result.message };
    } finally {
      busyRef.current = false;
    }
  }

  /**
   * Confirma el cambio de estado pendiente. El modal permanece abierto y bloqueado hasta la
   * respuesta; el resultado se comunica con el aviso compartido.
   *
   * @returns {Promise<void>}
   */
  async function confirmStatus() {
    if (!pendingStatus || busyRef.current) return;
    busyRef.current = true;
    setStatusSubmitting(true);
    const { denomination, isActive } = pendingStatus;
    try {
      const response = await api.measurementUnits.changeDenominationStatus({ denominationId: denomination.id, isActive });
      if (response?.unitDenomination) replaceItem(response.unitDenomination);
      notify("success", isActive ? "Unidad activada" : "Unidad desactivada", `${denomination.publicCode} · ${denomination.label}`);
    } catch (error) {
      const result = getMeasurementUnitErrorFeedback(error, "No se pudo cambiar el estado de la unidad.");
      if (result.shouldReload) reload();
      notify("danger", isActive ? "No se pudo activar" : "No se pudo desactivar", result.message);
    } finally {
      busyRef.current = false;
      setStatusSubmitting(false);
      setPendingStatus(null);
    }
  }

  return {
    feedback: {
      value: feedback,
      dismiss: () => setFeedback(null),
    },
    form: {
      value: form,
      openCreate: () => setForm({ mode: "create", denomination: null }),
      openEdit: (denomination) => setForm({ mode: "edit", denomination }),
      close: () => {
        if (!busyRef.current) setForm(null);
      },
      submit: submitForm,
    },
    status: {
      pending: pendingStatus,
      submitting: statusSubmitting,
      request: (denomination, isActive) => setPendingStatus({ denomination, isActive }),
      cancel: () => {
        if (!busyRef.current) setPendingStatus(null);
      },
      confirm: confirmStatus,
    },
  };
}
