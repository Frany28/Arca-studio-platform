import { useEffect, useRef, useState } from "react";

import { api } from "../../../../api/http.js";
import { getServiceStatusErrorFeedback } from "../utils/serviceCatalogErrors.js";
import { verifyServiceStatusSelection } from "../utils/serviceStatusOperation.js";
import { describeServiceStatusSuccess } from "../utils/serviceStatusFeedback.js";

/**
 * Coordina la activación y desactivación individual de servicios: confirmación previa, envío con
 * la versión leída (`expectedVersion`), actualización de la tabla y aviso del resultado. Nunca
 * elimina servicios. Un segundo envío se bloquea mientras hay uno en curso (también ante dobles
 * clics del mismo render, mediante una ref). Tras un cambio efectivo se recargan los indicadores;
 * si hay un filtro de estado, la fila ya no pertenece a la consulta y se recarga la página.
 * Antes del PATCH relee el servicio y cancela si cambió su estado o versión o no puede reactivarse.
 *
 * @param {Object} params - Coordinación con el listado y el resumen.
 * @param {(service: Object) => void} params.replaceItem - Sustituye la fila actualizada.
 * @param {() => void} params.reload - Repite la lectura de la página actual.
 * @param {boolean} params.hasStatusFilter - La consulta visible filtra por estado.
 * @param {() => void} params.onCatalogChanged - Recarga los indicadores del módulo.
 * @param {(tone: "success"|"danger", title: string, message: string, content?: string) => void} params.notify - Aviso
 * compartido del tabulador (useAlertFeedback).
 * @returns {Object} Cambio pendiente, envío en curso y acciones.
 */
export function useServiceStatusActions({ hasStatusFilter, notify, onCatalogChanged, reload, replaceItem }) {
  const busyRef = useRef(false);
  const readAbortRef = useRef(null);
  const [pending, setPending] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Cancelar lecturas al desmontar evita iniciar cambios después de abandonar el panel.
  useEffect(() => () => readAbortRef.current?.abort(), []);

  /**
   * Confirma el cambio pendiente. El modal permanece abierto y bloqueado hasta la respuesta.
   *
   * @returns {Promise<void>}
   */
  async function confirm() {
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    const controller = new AbortController();
    readAbortRef.current = controller;
    const { isActive, service } = pending;
    try {
      await verifyServiceStatusSelection([service], isActive, api.serviceCatalog.getService, controller.signal);
      const response = await api.serviceCatalog.changeServiceStatus({
        expectedVersion: service.currentVersion,
        isActive,
        serviceId: service.id,
      });
      if (controller.signal.aborted) return;
      if (hasStatusFilter) reload();
      else if (response?.service) replaceItem(response.service);
      if (response?.changed !== false) onCatalogChanged();
      const result = describeServiceStatusSuccess({ isActive, service: response?.service ?? service });
      notify(result.tone, result.title, result.message, result.content);
    } catch (error) {
      if (controller.signal.aborted) return;
      const result = getServiceStatusErrorFeedback(error, "No se pudo cambiar el estado del servicio.");
      if (result.shouldReload) {
        reload();
        onCatalogChanged();
      }
      notify("danger", isActive ? "No se pudo activar" : "No se pudo desactivar", result.message);
    } finally {
      busyRef.current = false;
      if (!controller.signal.aborted) {
        setSubmitting(false);
        setPending(null);
      }
    }
  }

  return {
    pending,
    submitting,
    request: (service, isActive) => {
      if (!busyRef.current && service?.isActive === !isActive) setPending({ isActive, service });
    },
    cancel: () => {
      if (!busyRef.current) setPending(null);
    },
    confirm,
  };
}
