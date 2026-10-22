import { useRef, useState } from "react";

import { api } from "../../../../api/http.js";
import { getServiceStatusErrorFeedback } from "../utils/serviceCatalogErrors.js";

/**
 * Coordina la activación y desactivación individual de servicios: confirmación previa, envío con
 * la versión leída (`expectedVersion`), actualización de la tabla y aviso del resultado. Nunca
 * elimina servicios. Un segundo envío se bloquea mientras hay uno en curso (también ante dobles
 * clics del mismo render, mediante una ref). Tras un cambio efectivo se recargan los indicadores;
 * si hay un filtro de estado, la fila ya no pertenece a la consulta y se recarga la página.
 *
 * @param {Object} params - Coordinación con el listado y el resumen.
 * @param {(service: Object) => void} params.replaceItem - Sustituye la fila actualizada.
 * @param {() => void} params.reload - Repite la lectura de la página actual.
 * @param {boolean} params.hasStatusFilter - La consulta visible filtra por estado.
 * @param {() => void} params.onCatalogChanged - Recarga los indicadores del módulo.
 * @param {(tone: "success"|"danger", title: string, message: string) => void} params.notify - Aviso
 * compartido del tabulador (useAlertFeedback).
 * @returns {Object} Cambio pendiente, envío en curso y acciones.
 */
export function useServiceStatusActions({ hasStatusFilter, notify, onCatalogChanged, reload, replaceItem }) {
  const busyRef = useRef(false);
  const [pending, setPending] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Confirma el cambio pendiente. El modal permanece abierto y bloqueado hasta la respuesta.
   *
   * @returns {Promise<void>}
   */
  async function confirm() {
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    const { isActive, service } = pending;
    const name = `${service.code} · ${service.name}`;
    try {
      const response = await api.serviceCatalog.changeServiceStatus({
        expectedVersion: service.currentVersion,
        isActive,
        serviceId: service.id,
      });
      if (hasStatusFilter) reload();
      else if (response?.service) replaceItem(response.service);
      if (response?.changed !== false) onCatalogChanged();
      notify("success", isActive ? "Servicio activado" : "Servicio desactivado", name);
    } catch (error) {
      const result = getServiceStatusErrorFeedback(error, "No se pudo cambiar el estado del servicio.");
      if (result.shouldReload) reload();
      notify("danger", isActive ? "No se pudo activar" : "No se pudo desactivar", result.message);
    } finally {
      busyRef.current = false;
      setSubmitting(false);
      setPending(null);
    }
  }

  return {
    pending,
    submitting,
    request: (service, isActive) => setPending({ isActive, service }),
    cancel: () => {
      if (!busyRef.current) setPending(null);
    },
    confirm,
  };
}
