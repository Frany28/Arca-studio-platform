import { useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { buildAdminProjectRequestEditPayload, getAdminProjectRequestSaveFailure } from "../utils/adminProjectRequestEdit.js";

/**
 * Guarda la edición administrativa de una solicitud (`PUT /admin/project-requests/:id/form`).
 *
 * - Sin envíos duplicados: un ref síncrono descarta un segundo guardado mientras otro está en
 *   curso (doble clic o Enter repetido), además de deshabilitar el botón con `saving`.
 * - Confirmación real: `onSaved` solo se llama con la respuesta correcta del backend; ante un
 *   error se expone `failure` (validación, permisos, conflicto de versión o de estado) y el
 *   formulario conserva lo ingresado.
 * - Desmontaje: si la página se abandona durante el guardado, la respuesta no actualiza estado.
 *
 * @param {Object} params - Solicitud, versión y continuación.
 * @param {number|string} params.projectRequestId - Solicitud editada.
 * @param {string} params.expectedUpdatedAt - Versión leída al abrir el formulario.
 * @param {(result: {changedFields: Array<string>, projectRequest: Object}) => void} params.onSaved - Recibe la versión guardada.
 * @returns {{dismissFailure: () => void, failure: Object|null, save: (form: Object) => Promise<void>, saving: boolean}}
 *   Estado del guardado, aviso de error y acciones.
 */
export default function useAdminProjectRequestSave({ expectedUpdatedAt, onSaved, projectRequestId }) {
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const failureIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Envía el formulario con la versión de apertura. Ignora la llamada si ya hay un guardado en curso.
   *
   * @param {Object} form - Campos de useProjectRequestForm ya validados en el cliente.
   * @returns {Promise<void>} Finaliza tras llamar a `onSaved` o registrar el error.
   */
  const save = async (form) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFailure(null);
    try {
      const result = await api.admin.updateProjectRequestForm({
        payload: buildAdminProjectRequestEditPayload(form, expectedUpdatedAt),
        projectRequestId,
      });
      if (mountedRef.current) onSaved(result);
    } catch (error) {
      if (!mountedRef.current) return;
      failureIdRef.current += 1;
      setFailure({ id: failureIdRef.current, ...getAdminProjectRequestSaveFailure(error) });
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return {
    dismissFailure: () => setFailure(null),
    failure,
    save,
    saving,
  };
}
