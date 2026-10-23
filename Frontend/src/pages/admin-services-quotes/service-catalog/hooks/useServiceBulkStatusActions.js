import { useEffect, useRef, useState } from "react";

import { api } from "../../../../api/http.js";
import {
  describeBulkStatusResult,
  getServiceStatusSelection,
} from "../utils/serviceBulkStatus.js";
import { getServiceStatusErrorFeedback } from "../utils/serviceCatalogErrors.js";
import { executeServiceStatusChanges } from "../utils/serviceStatusOperation.js";

/**
 * Activa o desactiva los servicios seleccionados desde el pie de la tabla (Figma 5790:351653).
 * Solo admite selecciones homogéneas. Comprueba por GET todos sus estados, versiones y unidades
 * antes de enviar PATCH individuales con expectedVersion; el conjunto no es atómico.
 *
 * - Una selección vacía o mixta no abre confirmación ni envía peticiones de estado.
 * - Una lectura fallida o desactualizada cancela toda la operación antes del primer PATCH.
 * - Los envíos pendientes se detienen ante un fallo y se distinguen de los que ya se aplicaron.
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
  const readAbortRef = useRef(null);
  const [pending, setPending] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const selectionState = getServiceStatusSelection(items, selection.selectedIds);
  const { targets } = selectionState;
  // Desmontar durante la comprobación cancela las lecturas: no comienza una mutación tardía.
  // Las escrituras ya enviadas no se abortan, pues el servidor puede haberlas aplicado.
  useEffect(() => () => readAbortRef.current?.abort(), []);

  /**
   * Prepara la confirmación con los servicios que cambiarán; sin ninguno no hace nada.
   *
   * @param {boolean} isActive - Estado pedido.
   * @returns {void}
   */
  function request(isActive) {
    const services = isActive ? targets.activate : targets.deactivate;
    if (!services.length || busyRef.current) return;
    setPending({ isActive, services });
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
    const controller = new AbortController();
    readAbortRef.current = controller;
    const { isActive, services } = pending;
    try {
      const results = await executeServiceStatusChanges({
        services,
        isActive,
        readService: api.serviceCatalog.getService,
        changeStatus: api.serviceCatalog.changeServiceStatus,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const failures = results.filter((result) => !result.ok && !result.skipped).map(({ error, item }) => ({
        message: getServiceStatusErrorFeedback(error, "No se pudo cambiar el estado.").message,
        service: item,
      }));
      const succeeded = results.filter((result) => result.ok).length;
      const cancelled = results.filter((result) => result.skipped).length;
      reload();
      if (succeeded || results.some((result) => result.error?.status === 409)) onCatalogChanged();
      const result = describeBulkStatusResult({ cancelled, failures, isActive, succeeded });
      notify(result.tone, result.title, result.message);
    } catch (error) {
      if (controller.signal.aborted) return;
      const result = getServiceStatusErrorFeedback(error, "No se pudo comprobar la selección. No se enviaron cambios.");
      reload();
      if (result.shouldReload) onCatalogChanged();
      const detail = error?.serviceCode ? `${error.serviceCode}: ${result.message}` : result.message;
      notify("danger", "Operación cancelada", error?.code === "SERVICE_SELECTION_CHANGED"
        ? detail : `${detail} No se enviaron cambios. Actualiza la selección antes de intentarlo de nuevo.`);
    } finally {
      busyRef.current = false;
      if (!controller.signal.aborted) {
        setSubmitting(false);
        setPending(null);
      }
    }
  }

  return {
    targets,
    selectionState,
    pending,
    submitting,
    request,
    cancel: () => {
      if (!busyRef.current) setPending(null);
    },
    confirm,
  };
}
