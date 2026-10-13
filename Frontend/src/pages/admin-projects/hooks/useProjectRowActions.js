import { useRef, useState } from "react";

import { isArchivedProject } from "../../admin-dashboard/components/admin-active-projects/utils/adminProjectBulkActions.js";
import { getProjectActionFeedback, PROJECT_ROW_ACTION_IDS } from "../utils/projectRowActions.js";
import {
  getProjectSettings,
  getProjectSettingsOperation,
  updateProjectSettingsDraft,
} from "../utils/projectSettings.js";

/**
 * Coordina las acciones por fila de Gestión: menú, modal de configuración y confirmación
 * de archivo. Ambos modales delegan en la misma operación de dominio (`runProjectAction`).
 *
 * - El diálogo guarda un snapshot del proyecto al abrirse; el borrador se reinicia en cada
 *   apertura, así que nunca se comparte entre proyectos.
 * - `open` se separa del snapshot para que Modal ejecute su animación de salida con contenido.
 * - Una ref bloquea confirmaciones repetidas antes del siguiente render; el estado
 *   `submitting` solo controla la interfaz.
 * - La tabla solo cambia cuando el servidor responde (reconciliación en `runProjectAction`).
 *
 * @param {Object} params - Dependencias del consumidor.
 * @param {(params: {action: string, projects: Object[], isPublic?: boolean}) => Promise<Object>} params.runProjectAction
 * Operación compartida de `useAdminProjectMutations`.
 * @returns {Object} Estado del diálogo, borrador, feedback y manejadores.
 */
export function useProjectRowActions({ runProjectAction }) {
  const [dialog, setDialog] = useState(null);
  const [draft, setDraft] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const submittingRef = useRef(false);

  /**
   * Abre un diálogo para un proyecto concreto con estado temporal limpio.
   * @param {"settings"|"archive"} type - Diálogo solicitado.
   * @param {Object} project - Proyecto de la fila que abrió el menú.
   * @returns {void}
   */
  const openDialog = (type, project) => {
    if (submittingRef.current) return;
    setDraft(getProjectSettings(project));
    setError("");
    setDialog({ type, project, open: true });
  };

  /**
   * Traduce la acción elegida en el menú de una fila al diálogo correspondiente.
   * @param {Object} project - Proyecto de la fila.
   * @param {{id: string}} item - Acción del ActionMenu.
   * @returns {void}
   */
  const handleRowAction = (project, item) => {
    if (item.id === PROJECT_ROW_ACTION_IDS.settings) openDialog("settings", project);
    else openDialog("archive", project);
  };

  /**
   * Cierra el diálogo descartando el borrador; se ignora mientras se guarda.
   * @returns {void}
   */
  const close = () => {
    if (submittingRef.current) return;
    setDialog((current) => (current ? { ...current, open: false } : current));
  };

  /**
   * Modifica temporalmente una opción del borrador sin persistirla.
   * @param {string} settingId - Opción editable.
   * @param {boolean} value - Valor pendiente.
   * @returns {void}
   */
  const changeSetting = (settingId, value) => {
    if (!dialog || submittingRef.current) return;
    setError("");
    setDraft((current) => updateProjectSettingsDraft(dialog.project, current, settingId, value));
  };

  /**
   * Resuelve la operación pendiente del diálogo abierto.
   * @returns {{action: string, isPublic?: boolean}|null} Operación o null sin cambios.
   */
  const getPendingOperation = () => {
    if (!dialog) return null;
    if (dialog.type === "archive") {
      return { action: isArchivedProject(dialog.project) ? "unarchive" : "archive" };
    }
    return getProjectSettingsOperation(dialog.project, draft);
  };

  /**
   * Persiste la operación pendiente y solo cierra tras la confirmación del servidor.
   * Un rechazo conserva el diálogo y el borrador para reintentar, con error visible.
   * @returns {Promise<void>} Finalización del guardado; los errores se muestran, no se lanzan.
   */
  const confirm = async () => {
    const operation = getPendingOperation();
    if (!operation || submittingRef.current) return;

    const { project } = dialog;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await runProjectAction({ ...operation, projects: [project] });
      setDialog((current) => (current ? { ...current, open: false } : current));
      setFeedback({ id: Date.now(), ...getProjectActionFeedback(operation, project) });
    } catch (operationError) {
      const nextFeedback = getProjectActionFeedback(operation, project, operationError);
      setError(nextFeedback.description);
      setFeedback({ id: Date.now(), ...nextFeedback });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return {
    dialog,
    draft,
    error,
    feedback,
    submitting,
    hasPendingChanges: Boolean(getPendingOperation()),
    handleRowAction,
    changeSetting,
    close,
    confirm,
    dismissFeedback: () => setFeedback(null),
  };
}
