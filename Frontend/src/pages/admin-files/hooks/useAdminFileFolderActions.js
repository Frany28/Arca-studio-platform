import { useState } from "react";

import { api } from "../../../api/http.js";

// Mensajes de los conflictos que documenta el contrato (docs/API_CONTRACT.md, B7).
const CONFLICT_MESSAGES = Object.freeze({
  PROJECT_ARCHIVED: "El proyecto está archivado: sus carpetas no se pueden modificar.",
  PROJECT_FINALIZED: "El proyecto está finalizado: sus carpetas no se pueden modificar.",
  PROJECT_FOLDER_DECISION_PENDING: "Esta operación de carpetas está pendiente de decisión.",
  PROJECT_FOLDER_TOO_DEEP: "Se alcanzó la profundidad máxima de carpetas.",
  PROJECT_FOLDER_NOT_EMPTY: "Solo se pueden retirar carpetas vacías: esta carpeta contiene archivos o subcarpetas.",
  PROJECT_FOLDER_PROTECTED: "Las carpetas predeterminadas no se pueden renombrar ni eliminar.",
  PROJECT_FOLDER_SUBFOLDERS_NOT_ALLOWED: "Esta carpeta no admite subcarpetas.",
});

/**
 * Traduce un error de la API de carpetas a un mensaje y, si lo hay, al error del campo nombre.
 *
 * @param {Object} error - Error de apiRequest (`status`, `code`, `fields`).
 * @param {string} fallback - Mensaje por defecto.
 * @returns {{ message: string, fieldError: string }} Mensajes.
 */
export function describeFolderError(error, fallback) {
  const fieldError = error?.fields?.["body.name"] || error?.fields?.name || "";
  const message = CONFLICT_MESSAGES[error?.code] || error?.message || fallback;
  return { fieldError: Array.isArray(fieldError) ? fieldError[0] : fieldError, message };
}

/**
 * Operaciones de carpetas del árbol: crear una subcarpeta, renombrar y retirar una carpeta
 * personalizada vacía. Las respuestas traen las carpetas del proyecto, que sustituyen a las del
 * árbol sin volver a leerlo. Los archivos guardados nunca se eliminan: retirar solo afecta a
 * carpetas vacías y lo comprueba el backend.
 *
 * @param {Object} params - Árbol, aviso y efectos sobre la selección.
 * @param {(projectId: number, folders: Array<Object>) => void} params.onFoldersChange - Actualiza el árbol.
 * @param {(folderId: number, projectId: number) => void} params.onFolderRemoved - La carpeta retirada deja de estar seleccionada.
 * @param {(folder: Object, projectId: number) => void} params.onFolderCreated - Selecciona la carpeta creada.
 * @param {{ notify: Function }} params.feedback - Avisos (useAlertFeedback).
 * @returns {Object} Diálogo, confirmación, estado en curso y acciones.
 */
export function useAdminFileFolderActions({ feedback, onFolderCreated, onFolderRemoved, onFoldersChange }) {
  const [dialog, setDialog] = useState(null);
  const [removal, setRemoval] = useState(null);
  const [removing, setRemoving] = useState(false);

  /**
   * Envía el formulario de crear o renombrar; devuelve el resultado al diálogo, que conserva lo
   * escrito y muestra el error junto al campo si la API lo rechaza.
   *
   * @param {string} name - Nombre normalizado.
   * @returns {Promise<{ok: boolean, message?: string, fieldError?: string}>} Resultado.
   */
  async function submitDialog(name) {
    if (!dialog) return { ok: false };
    const { folder, mode, parent, project } = dialog;
    try {
      if (mode === "create") {
        const response = await api.fileManager.createFolder({ name, parentId: parent?.id ?? null, projectId: project.id });
        onFoldersChange(project.id, response?.folders || []);
        if (response?.folder) onFolderCreated(response.folder, project.id);
        feedback.notify("success", "Carpeta creada", `La carpeta «${response?.folder?.name || name}» se creó en ${project.name}.`);
      } else {
        const response = await api.fileManager.renameFolder({ folderId: folder.id, name, projectId: project.id });
        onFoldersChange(project.id, response?.folders || []);
        feedback.notify("success", "Carpeta renombrada", `La carpeta ahora se llama «${name}».`);
      }
      setDialog(null);
      return { ok: true };
    } catch (error) {
      return { ok: false, ...describeFolderError(error, mode === "create" ? "No se pudo crear la carpeta." : "No se pudo renombrar la carpeta.") };
    }
  }

  /**
   * Retira la carpeta confirmada. Un rechazo (no vacía, protegida, proyecto de solo lectura) se
   * comunica con un aviso y cierra la confirmación sin cambios.
   *
   * @returns {Promise<void>}
   */
  async function confirmRemoval() {
    if (!removal || removing) return;
    const { folder, project } = removal;
    setRemoving(true);
    try {
      const response = await api.fileManager.deleteFolder({ folderId: folder.id, projectId: project.id });
      onFoldersChange(project.id, response?.folders || []);
      onFolderRemoved(folder.id, project.id);
      feedback.notify("success", "Carpeta retirada", `La carpeta «${folder.name}» se retiró de ${project.name}.`);
    } catch (error) {
      feedback.notify("danger", "No se pudo retirar la carpeta", describeFolderError(error, "Inténtalo de nuevo.").message, folder.name);
    } finally {
      setRemoving(false);
      setRemoval(null);
    }
  }

  return {
    cancelRemoval: () => {
      if (!removing) setRemoval(null);
    },
    closeDialog: () => setDialog(null),
    confirmRemoval,
    dialog,
    openCreate: (project, parent) => setDialog({ folder: null, mode: "create", parent, project }),
    openRename: (project, folder) => setDialog({ folder, mode: "rename", parent: null, project }),
    requestRemoval: (project, folder) => setRemoval({ folder, project }),
    removal,
    removing,
    submitDialog,
  };
}
