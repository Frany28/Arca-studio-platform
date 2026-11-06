import { useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { buildProjectRequestPayload } from "../../../utils/projectRequestValidation.js";

// Una solicitud recuperada (borrador o devuelta para correcciones) se sigue editando sobre su id.
const RECOVERABLE_STATUSES = new Set(["draft", "changes_requested"]);

/**
 * Borrador remoto de la solicitud, único para el formulario y compartido por los adjuntos y el
 * envío. Al seleccionar el primer archivo se crea un borrador vacío (solo `submissionId`, sin
 * datos ficticios) para asociar las subidas; al enviar se guarda el formulario completo en ese
 * mismo borrador, que el backend valida con todas sus reglas.
 *
 * Idempotencia: el `submissionId` se genera una sola vez y la creación en curso se comparte, así
 * que varias selecciones rápidas (o un reintento tras un fallo de red) crean un único borrador; el
 * backend también lo deduplica por `submissionId`. Una solicitud recuperada usa su propio id.
 * El borrador se conserva al limpiar el formulario: sus adjuntos guardados siguen asociados a él.
 *
 * @param {Object} params - Formulario y solicitud inicial.
 * @param {Object} params.form - Campos del formulario.
 * @param {Object|null} params.initialRequest - Solicitud recuperada (draft o changes_requested).
 * @returns {{draftId: number|string|null, ensureDraft: () => Promise<number|string>, saveForm: () => Promise<number|string>}}
 *   Borrador vigente, creación idempotente y guardado del formulario completo.
 */
export default function useProjectRequestDraft({ form, initialRequest }) {
  const initialDraftId = RECOVERABLE_STATUSES.has(initialRequest?.status) ? initialRequest.id : null;
  const [draftId, setDraftId] = useState(initialDraftId);
  // Copias síncronas: subidas, código y envío ocurren en manejadores distintos y concurrentes.
  const draftIdRef = useRef(initialDraftId);
  const submissionIdRef = useRef(null);
  const creationRef = useRef(null);

  /**
   * Devuelve el borrador, creándolo vacío si aún no existe. Las llamadas simultáneas comparten la
   * misma creación; si falla, la siguiente llamada lo reintenta con el mismo `submissionId`.
   *
   * @returns {Promise<number|string>} Id del borrador.
   * @throws {Error} Error de la API o respuesta sin identificador.
   */
  const ensureDraft = () => {
    if (draftIdRef.current) return Promise.resolve(draftIdRef.current);
    if (creationRef.current) return creationRef.current;
    if (!submissionIdRef.current) submissionIdRef.current = window.crypto.randomUUID();

    creationRef.current = api.projectRequests.create({ submissionId: submissionIdRef.current })
      .then((created) => {
        const createdId = created?.projectRequest?.id;
        if (!createdId) throw new Error("No se pudo identificar el borrador de la solicitud.");
        draftIdRef.current = createdId;
        setDraftId(createdId);
        return createdId;
      })
      .finally(() => {
        creationRef.current = null;
      });
    return creationRef.current;
  };

  /**
   * Guarda el formulario completo en el borrador (creándolo si hace falta). El backend lo valida
   * con todas las reglas de la solicitud; sus errores se propagan al llamador.
   *
   * @returns {Promise<number|string>} Id del borrador guardado.
   * @throws {Error} Error de validación o de la API.
   */
  const saveForm = async () => {
    const projectRequestId = await ensureDraft();
    await api.projectRequests.update({ payload: buildProjectRequestPayload(form), projectRequestId });
    return projectRequestId;
  };

  return { draftId, ensureDraft, saveForm };
}
