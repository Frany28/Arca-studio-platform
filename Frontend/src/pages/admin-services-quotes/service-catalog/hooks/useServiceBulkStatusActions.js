import { useRef, useState } from "react";

import { api } from "../../../../api/http.js";
import {
  SERVICE_BULK_STATUS_CONCURRENCY,
  describeBulkStatusResult,
  getServiceStatusTargets,
  runWithConcurrency,
} from "../utils/serviceBulkStatus.js";
import { getServiceStatusErrorFeedback } from "../utils/serviceCatalogErrors.js";

/**
 * Activa o desactiva los servicios seleccionados desde el pie de la tabla (Figma 5790:351653).
 * Sin endpoint masivo, cada servicio usa PATCH /admin/services/:id/status con su `expectedVersion`
 * y como máximo SERVICE_BULK_STATUS_CONCURRENCY peticiones a la vez; el conjunto no es atómico.
 *
 * - La confirmación lleva solo los servicios que cambiarán (se excluyen los que ya están en el
 *   estado pedido) y el número de seleccionados, para explicarlo.
 * - Un segundo envío se ignora mientras hay uno en curso (ref, también ante dobles clics).
 * - Cada fallo se traduce con los mismos mensajes que el cambio individual (unidad o
 *   denominación inactiva al reactivar, versión desactualizada, 403/429…) y se informa con el
 *   código del servicio; los que sí cambiaron no se repiten.
 * - Al terminar se recarga la página visible (estados y versiones vigentes), lo que reinicia la
 *   selección, y se recargan los indicadores si algo cambió.
 *
 * @param {Object} params - Filas, selección y coordinación con el panel.
 * @param {Array<Object>} params.items - Filas visibles.
 * @param {{selectedIds: Set<string>, selectedCount: number}} params.selection - Selección de la página.
 * @param {() => void} params.reload - Repite la lectura de la página actual.
 * @param {() => void} params.onCatalogChanged - Recarga los indicadores del módulo.
 * @param {(tone: "success"|"danger", title: string, message: string) => void} params.notify - Aviso del tabulador.
 * @returns {Object} Destinos por acción, cambio pendiente, envío en curso y acciones.
 */
export function useServiceBulkStatusActions({ items, notify, onCatalogChanged, reload, selection }) {
  const busyRef = useRef(false);
  const [pending, setPending] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const targets = {
    activate: getServiceStatusTargets(items, selection.selectedIds, true),
    deactivate: getServiceStatusTargets(items, selection.selectedIds, false),
  };

  /**
   * Prepara la confirmación con los servicios que cambiarán; sin ninguno no hace nada.
   *
   * @param {boolean} isActive - Estado pedido.
   * @returns {void}
   */
  function request(isActive) {
    const services = isActive ? targets.activate : targets.deactivate;
    if (!services.length || busyRef.current) return;
    setPending({ isActive, selectedCount: selection.selectedCount, services });
  }

  /**
   * Aplica el cambio servicio a servicio y avisa del resultado. El modal permanece bloqueado
   * hasta que todas las peticiones terminan.
   *
   * @returns {Promise<void>}
   */
  async function confirm() {
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    const { isActive, services } = pending;
    try {
      const results = await runWithConcurrency(services, SERVICE_BULK_STATUS_CONCURRENCY, (service) => api.serviceCatalog.changeServiceStatus({
        expectedVersion: service.currentVersion,
        isActive,
        serviceId: service.id,
      }));
      const failures = results.filter((result) => !result.ok).map(({ error, item }) => ({
        message: getServiceStatusErrorFeedback(error, "No se pudo cambiar el estado.").message,
        service: item,
      }));
      const succeeded = results.length - failures.length;
      reload();
      if (succeeded) onCatalogChanged();
      const result = describeBulkStatusResult({ failures, isActive, succeeded });
      notify(result.tone, result.title, result.message);
    } finally {
      busyRef.current = false;
      setSubmitting(false);
      setPending(null);
    }
  }

  return {
    targets,
    pending,
    submitting,
    request,
    cancel: () => {
      if (!busyRef.current) setPending(null);
    },
    confirm,
  };
}
