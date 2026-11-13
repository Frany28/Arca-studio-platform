import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";

const SECTION_SAVERS = Object.freeze({
  general: (projectId, payload) => api.projectConfiguration.saveGeneral({ payload, projectId }),
  tracking: (projectId, payload) => api.projectConfiguration.saveTracking({ payload, projectId }),
  warranties: (projectId, payload) => api.projectConfiguration.saveWarranties({ payload, projectId }),
});

/**
 * Lee y guarda la configuración administrativa de un proyecto (formulario «Nuevo Proyecto»).
 *
 * Sin `projectId` (modo creación) no lee nada. La lectura se cancela al cambiar de proyecto o
 * desmontar y una respuesta obsoleta no sustituye a la vigente. Cada guardado aplica la
 * configuración que devuelve la API (fuente de verdad) y nunca cambia el estado del proyecto:
 * solo `finalize` lo pasa a pending. `saving` bloquea guardados repetidos mientras hay uno en curso.
 *
 * @param {number|null} projectId - Proyecto a configurar o null al crear.
 * @returns {{configuration: Object|null, error: Object|null, loading: boolean, saving: boolean,
 *   reload: Function, saveSection: (section: "general"|"tracking"|"warranties", payload: Object, id?: number) => Promise<Object>,
 *   finalize: () => Promise<Object>, createDraft: (params: {clientId: number, name: string}) => Promise<number>}} Estado y acciones.
 */
export default function useProjectConfiguration(projectId) {
  const [state, setState] = useState({ configuration: null, error: null, loadedId: null });
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!projectId) return undefined;
    const controller = new AbortController();
    api.projectConfiguration.get({ projectId, signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ configuration: data?.configuration || null, error: null, loadedId: projectId });
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === "AbortError") return;
        setState({ configuration: null, error, loadedId: projectId });
      });
    return () => controller.abort();
  }, [projectId, revision]);

  /**
   * Ejecuta una escritura de forma exclusiva y aplica la configuración devuelta.
   *
   * @param {() => Promise<{configuration?: Object}>} write - Petición a la API.
   * @returns {Promise<Object>} Respuesta de la API (propaga sus errores).
   */
  const runWrite = useCallback(async (write) => {
    if (savingRef.current) throw Object.assign(new Error("Hay un guardado en curso."), { code: "SAVE_IN_PROGRESS" });
    savingRef.current = true;
    setSaving(true);
    try {
      const data = await write();
      if (data?.configuration) setState({ configuration: data.configuration, error: null, loadedId: data.configuration.id });
      return data;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, []);

  const saveSection = useCallback(
    (section, payload, targetId = projectId) => runWrite(() => SECTION_SAVERS[section](targetId, payload)),
    [projectId, runWrite],
  );
  const finalize = useCallback(() => runWrite(() => api.projectConfiguration.finalize({ projectId })), [projectId, runWrite]);
  const createDraft = useCallback(async ({ clientId, name }) => {
    const data = await runWrite(() => api.projectConfiguration.createDraft({ clientId, name }));
    return data.projectId;
  }, [runWrite]);

  const isCurrent = projectId && state.loadedId === projectId;
  return {
    configuration: isCurrent ? state.configuration : null,
    createDraft,
    error: isCurrent ? state.error : null,
    finalize,
    loading: Boolean(projectId) && !isCurrent,
    reload: () => setRevision((current) => current + 1),
    saveSection,
    saving,
  };
}
