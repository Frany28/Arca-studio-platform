import {
  assignEmployeesToProject,
  assignEmployeesToProjectRequest,
  loadAdminDashboardMetrics,
  loadAdminDashboardOverview,
  loadAdminAssignees,
  manageAdminProjects,
} from "../services/adminDashboardService.js";
import { getAdminAssigneeProfilePhoto } from "../services/profilePhotoService.js";
import { streamStoredObject } from "../utils/streamResponse.js";

/**
 * Transmite la foto de perfil del responsable administrativo sin cargar el contenido completo en memoria.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function streamAdminAssigneeProfilePhoto(req, res, next) {
  try {
    const photo = await getAdminAssigneeProfilePhoto({
      userId: req.params.userId,
    });

    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Content-Type", photo.contentType);
    res.setHeader("Cache-Control", "private, max-age=60, must-revalidate");
    if (photo.contentLength !== undefined) {
      res.setHeader("Content-Length", String(photo.contentLength));
    }
    res.status(200);
    await streamStoredObject(photo.body, res, "profile_photo");
  } catch (error) {
    next(error);
  }
}

/**
 * Obtiene los responsables disponibles para administración para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} _req - Solicitud HTTP que este controlador no necesita inspeccionar.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getAdminAssignees(_req, res, next) {
  try {
    const assignees = await loadAdminAssignees();

    res.setHeader("Cache-Control", "private, max-age=30, must-revalidate");
    res.status(200).json({ assignees });
  } catch (error) {
    next(error);
  }
}

/**
 * Obtiene las métricas del panel para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} _req - Solicitud HTTP que este controlador no necesita inspeccionar.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getDashboardMetrics(_req, res, next) {
  try {
    const metrics = await loadAdminDashboardMetrics();

    res.setHeader("Cache-Control", "private, max-age=30, must-revalidate");
    res.status(200).json({ metrics });
  } catch (error) {
    next(error);
  }
}

/**
 * Obtiene el resumen del panel para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} _req - Solicitud HTTP que este controlador no necesita inspeccionar.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getDashboardOverview(_req, res, next) {
  try {
    const overview = await loadAdminDashboardOverview();

    res.setHeader("Cache-Control", "private, max-age=30, must-revalidate");
    res.status(200).json({ overview });
  } catch (error) {
    next(error);
  }
}

/**
 * Actualiza el valor de proyecto responsables conservando las reglas de acceso e integridad.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function updateProjectAssignees(req, res, next) {
  try {
    const assignees = await assignEmployeesToProject({
      assigneeIds: req.body.assigneeIds,
      assignedBy: req.user.id,
      projectId: req.params.projectId,
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ assignees });
  } catch (error) {
    next(error);
  }
}

/**
 * Actualiza los proyectos gestionados desde administración conservando las reglas de acceso e integridad.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function updateAdminProjects(req, res, next) {
  try {
    const projects = await manageAdminProjects({
      action: req.body.action,
      isPublic: req.body.isPublic,
      projectIds: req.body.projectIds,
      userId: req.user.id,
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ projects });
  } catch (error) {
    next(error);
  }
}

/**
 * Actualiza el valor de proyecto solicitud responsables conservando las reglas de acceso e integridad.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function updateProjectRequestAssignees(req, res, next) {
  try {
    const assignees = await assignEmployeesToProjectRequest({
      assigneeIds: req.body.assigneeIds,
      assignedBy: req.user.id,
      projectRequestId: req.params.projectRequestId,
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ assignees });
  } catch (error) {
    next(error);
  }
}
