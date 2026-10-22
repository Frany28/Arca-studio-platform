import { useRef, useState } from "react";

import { api } from "../../../../api/http.js";
import { getServiceFormErrorFeedback } from "../utils/serviceCatalogErrors.js";
import { toCreateServicePayload, toUpdateServiceChanges } from "../utils/serviceFormValues.js";

/**
 * Envía el formulario de servicios: alta (POST, el sistema genera el código) o edición (PATCH
 * con `expectedVersion` y solo los campos cambiados). Bloquea un segundo envío mientras hay uno
 * en curso (también ante dobles clics del mismo render, mediante una ref). La edición sin
 * cambios no llama a la API. Un error no cierra el formulario: devuelve su retroalimentación.
 *
 * @param {Object} params - Modo y servicio original.
 * @param {"create"|"edit"} params.mode - Alta o edición.
 * @param {Object|null} params.service - Servicio leído (edición).
 * @returns {{submitting: boolean, submit: (draft: Object) => Promise<Object>}} Estado y envío; el
 * resultado es `{ok: true, service, changed}` o `{ok: false, message, fieldErrors, shouldReload, notFound}`.
 */
export function useServiceFormSubmit({ mode, service }) {
  const busyRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Envía el borrador ya validado.
   *
   * @param {Object} draft - Borrador del formulario.
   * @returns {Promise<Object>} Resultado del envío.
   */
  async function submit(draft) {
    if (busyRef.current) return { ok: false, ignored: true, fieldErrors: {}, message: "" };
    const editing = mode === "edit";
    const changes = editing ? toUpdateServiceChanges(draft, service) : null;
    if (editing && !changes) return { ok: true, changed: false, service };
    busyRef.current = true;
    setSubmitting(true);
    try {
      const response = editing
        ? await api.serviceCatalog.updateService({ changes, serviceId: service.id })
        : await api.serviceCatalog.createService(toCreateServicePayload(draft));
      return { ok: true, changed: response?.changed !== false, service: response?.service ?? null };
    } catch (error) {
      return { ok: false, ...getServiceFormErrorFeedback(error, editing ? "No se pudo guardar el servicio." : "No se pudo crear el servicio.") };
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  return { submit, submitting };
}
