import {
  isArchivedProject,
  isFinalizedProject,
} from "../../admin-dashboard/components/admin-active-projects/utils/adminProjectBulkActions.js";

// Opciones del modal "Configuración del proyecto" (Figma 3727:686869) en su orden visual.
export const PROJECT_SETTING_IDS = Object.freeze({
  portfolio: "portfolio",
  featured: "featured",
  clientAccess: "clientAccess",
  archived: "archived",
});

/**
 * Opciones sin contrato persistente en el backend. Se muestran bloqueadas con su valor
 * efectivo: no existe un campo de proyectos destacados, y el cliente accede siempre a
 * sus proyectos por client_id (no hay un permiso configurable que lo restrinja).
 */
export const PENDING_PROJECT_SETTINGS = Object.freeze({
  [PROJECT_SETTING_IDS.featured]: Object.freeze({
    value: false,
    reason: "Integración pendiente: el servidor aún no permite destacar proyectos.",
  }),
  [PROJECT_SETTING_IDS.clientAccess]: Object.freeze({
    value: true,
    reason: "El cliente siempre accede a su proyecto; el servidor aún no permite restringirlo.",
  }),
});

/**
 * Lee del proyecto confirmado por el servidor las opciones editables del modal.
 * @param {Object} project - Fila real de la tabla.
 * @returns {{portfolio: boolean, archived: boolean}} Estado original del proyecto.
 */
export function getProjectSettings(project) {
  return {
    [PROJECT_SETTING_IDS.portfolio]: Boolean(project?.isPublic),
    [PROJECT_SETTING_IDS.archived]: isArchivedProject(project),
  };
}

/**
 * Aplica un cambio temporal respetando los efectos del backend: archivar fuerza
 * is_public=false, así que el portafolio se apaga en el borrador y se restaura al
 * revertir el archivo. No modifica el borrador recibido.
 * @param {Object} project - Proyecto original del modal.
 * @param {{portfolio: boolean, archived: boolean}} draft - Borrador actual.
 * @param {string} settingId - Opción editable que cambia.
 * @param {boolean} value - Nuevo valor solicitado.
 * @returns {{portfolio: boolean, archived: boolean}} Nuevo borrador.
 */
export function updateProjectSettingsDraft(project, draft, settingId, value) {
  if (settingId === PROJECT_SETTING_IDS.archived) {
    const original = getProjectSettings(project);
    return {
      archived: value,
      portfolio: value ? false : original.portfolio,
    };
  }

  if (settingId === PROJECT_SETTING_IDS.portfolio) {
    return { ...draft, portfolio: value };
  }

  return draft;
}

/**
 * Determina qué opciones editables admite el contrato bulk-action para este borrador.
 * change_visibility exige un proyecto finalizado y no archivado; unarchive restablece
 * is_public=false, por lo que la visibilidad se cambia después de desarchivar.
 * @param {Object} project - Proyecto original del modal.
 * @param {{portfolio: boolean, archived: boolean}} draft - Borrador actual.
 * @returns {Record<string, {disabled: boolean, reason: string}>} Disponibilidad por opción.
 */
export function getProjectSettingsAvailability(project, draft) {
  const original = getProjectSettings(project);
  let portfolioReason = "";

  if (original.archived) {
    portfolioReason = "Desarchiva el proyecto para cambiar su visibilidad pública.";
  } else if (draft.archived) {
    portfolioReason = "Al archivar, el proyecto deja de mostrarse en el portafolio público.";
  } else if (!isFinalizedProject(project)) {
    portfolioReason = "Solo los proyectos finalizados pueden mostrarse en el portafolio público.";
  }

  return {
    [PROJECT_SETTING_IDS.portfolio]: { disabled: Boolean(portfolioReason), reason: portfolioReason },
    [PROJECT_SETTING_IDS.archived]: { disabled: false, reason: "" },
  };
}

/**
 * Traduce el borrador a la única operación del contrato existente que lo persiste.
 * Archivar o desarchivar tiene prioridad porque ya define la visibilidad resultante.
 * @param {Object} project - Proyecto original del modal.
 * @param {{portfolio: boolean, archived: boolean}} draft - Borrador pendiente.
 * @returns {{action: "archive"|"unarchive"|"change_visibility", isPublic?: boolean}|null}
 * Operación a confirmar, o null si el borrador coincide con el estado original.
 */
export function getProjectSettingsOperation(project, draft) {
  const original = getProjectSettings(project);

  if (draft.archived !== original.archived) {
    return { action: draft.archived ? "archive" : "unarchive" };
  }

  if (draft.portfolio !== original.portfolio) {
    return { action: "change_visibility", isPublic: draft.portfolio };
  }

  return null;
}

/**
 * Lista las opciones del borrador que difieren del estado confirmado por el servidor.
 * @param {Object} project - Proyecto original del modal.
 * @param {{portfolio: boolean, archived: boolean}} draft - Borrador actual.
 * @returns {Set<string>} IDs de opciones pendientes de confirmación.
 */
export function getPendingProjectSettingIds(project, draft) {
  const original = getProjectSettings(project);
  return new Set(
    Object.keys(original).filter((settingId) => original[settingId] !== draft[settingId]),
  );
}
