import {
  deleteProjectFile,
  findProjectForFileUpload,
  findProjectFileForDownload,
  findProjectRequestFileForDownload,
  getProjectFileObject,
  uploadProjectFile,
} from "../repositories/fileRepository.js";
import { getFileResponseSecurity } from "../utils/fileResponseSecurity.js";
import { getProjectFileCacheHeaders } from "../utils/projectFileCache.js";
import {
  prepareProjectRequestUpload,
  runUpload,
  uploadPolicies,
} from "../services/fileUploadService.js";
import { getAllowedOrigins } from "../config/cors.js";
import {
  deleteProjectRequestAttachment as deleteProjectRequestAttachmentService,
  uploadProjectRequestAttachment as uploadProjectRequestAttachmentService,
} from "../services/projectRequestFileService.js";
import { assertProjectOperationallyMutable } from "../services/projectService.js";

/**
 * Carga el adjunto de la solicitud de proyecto coordinando la persistencia y el almacenamiento.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function uploadProjectRequestAttachment(req, res, next) {
  try {
    const upload = prepareProjectRequestUpload(req);
    const file = await uploadProjectRequestAttachmentService({
      projectRequestId: req.params.projectRequestId,
      upload,
      user: req.user,
    });

    res.status(201).json({ file });
  } catch (error) {
    if (error.code === "DUPLICATE_PROJECT_REQUEST_FILE") {
      res.status(409).json({
        code: error.code,
        message: "Ese archivo ya existe en esta solicitud.",
      });
      return;
    }

    if (error.code === "23505") {
      res.status(409).json({
        code: "DUPLICATE_PROJECT_REQUEST_FILE",
        message: "Ese archivo ya existe en esta solicitud.",
      });
      return;
    }

    next(error);
  }
}

/**
 * Elimina el adjunto de la solicitud de proyecto después de comprobar acceso y existencia.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function deleteProjectRequestAttachment(req, res, next) {
  try {
    const deletedFile = await deleteProjectRequestAttachmentService({
      fileId: req.params.fileId,
      projectRequestId: req.params.projectRequestId,
      user: req.user,
    });

    res.status(200).json(deletedFile);
  } catch (error) {
    next(error);
  }
}

/**
 * Carga el valor de proyecto attachment coordinando la persistencia y el almacenamiento.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function uploadProjectAttachment(req, res, next) {
  try {
    const projectId = Number(req.params.projectId);

    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({
        code: "INVALID_PROJECT_ID",
        message: "El proyecto no es valido.",
      });
      return;
    }

    const project = await findProjectForFileUpload(projectId, req.user);

    if (!project) {
      res.status(404).json({
        code: "PROJECT_NOT_FOUND",
        message: "No se encontro el proyecto.",
      });
      return;
    }

    await assertProjectOperationallyMutable(projectId);

    const file = await runUpload({ req, policy: uploadPolicies.document,     /**
     * Procesa el valor de operation para completar la responsabilidad asignada al módulo.
     * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
     *
     * @param {unknown} upload - Valor de `upload` requerido por esta operación.
     * @returns {void} Finalización de la operación.
     */
operation: (upload) => uploadProjectFile({ ...upload, projectId, user: req.user }) });

    res.status(201).json({ file });
  } catch (error) {
    if (error.code === "DUPLICATE_PROJECT_FILE" || error.code === "23505") {
      res.status(409).json({
        code: "DUPLICATE_PROJECT_FILE",
        message: "Ese archivo ya existe en este proyecto.",
      });
      return;
    }

    next(error);
  }
}

/**
 * Elimina el valor de proyecto attachment después de comprobar acceso y existencia.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function deleteProjectAttachment(req, res, next) {
  try {
    const projectId = Number(req.params.projectId);
    const fileId = Number(req.params.fileId);

    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({
        code: "INVALID_PROJECT_ID",
        message: "El proyecto no es valido.",
      });
      return;
    }

    if (!Number.isInteger(fileId) || fileId <= 0) {
      res.status(400).json({
        code: "INVALID_FILE_ID",
        message: "El archivo no es valido.",
      });
      return;
    }

    const project = await findProjectForFileUpload(projectId, req.user);

    if (!project) {
      res.status(404).json({
        code: "PROJECT_NOT_FOUND",
        message: "No se encontro el proyecto.",
      });
      return;
    }

    await assertProjectOperationallyMutable(projectId);

    const deletedFile = await deleteProjectFile({
      fileId,
      projectId,
      user: req.user,
    });

    if (!deletedFile) {
      res.status(404).json({
        code: "FILE_NOT_FOUND",
        message: "No se encontro el archivo en este proyecto.",
      });
      return;
    }

    res.status(200).json(deletedFile);
  } catch (error) {
    next(error);
  }
}

/**
 * Transmite el archivo del proyecto sin cargar el contenido completo en memoria.
 * Aplica tipo, disposición y CSP según getFileResponseSecurity: tipos fuera de la lista se fuerzan a descarga.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function streamProjectFile(req, res, next) {
  try {
    const projectId = Number(req.params.projectId);
    const fileId = Number(req.params.fileId);

    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({
        code: "INVALID_PROJECT_ID",
        message: "El proyecto no es valido.",
      });
      return;
    }

    if (!Number.isInteger(fileId) || fileId <= 0) {
      res.status(400).json({
        code: "INVALID_FILE_ID",
        message: "El archivo no es valido.",
      });
      return;
    }

    const file = await findProjectFileForDownload({
      fileId,
      projectId,
      user: req.user,
    });

    if (!file) {
      res.status(404).json({
        code: "FILE_NOT_FOUND",
        message: "No se encontro el archivo.",
      });
      return;
    }

    const cacheHeaders = getProjectFileCacheHeaders({
      currentVersionId: file.currentVersionId,
      fileId: file.id,
      requestedVersionId: req.validatedQuery?.versionId,
    });

    const range = req.headers.range;
    const object = await getProjectFileObject({
      fileName: file.fileName,
      range,
    });
    const frameAncestors = getAllowedOrigins().filter((origin) => origin !== "*");
    const security = getFileResponseSecurity({
      contentType: object.ContentType || file.fileType,
      frameAncestors,
      // Los PDF de proyectos solo se ven en el visor integrado (fetch + PDF.js).
      pdfViewing: "in-app",
    });
    res.removeHeader("X-Frame-Options");
    res.setHeader(
      "Content-Security-Policy",
      security.contentSecurityPolicy,
    );
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    if (range && object.ContentRange) {
      res.status(206);
      res.setHeader("Content-Range", object.ContentRange);
      res.setHeader("Accept-Ranges", "bytes");
    } else {
      res.status(200);
      res.setHeader("Accept-Ranges", "bytes");
    }

    res.setHeader("Content-Type", security.contentType);
    res.setHeader("Cache-Control", cacheHeaders.cacheControl);
    res.vary("Cookie");
    if (cacheHeaders.etag) {
      res.setHeader("ETag", cacheHeaders.etag);
    }
    res.setHeader(
      "Content-Disposition",
      `${security.disposition}; filename="${encodeURIComponent(file.originalName)}"`,
    );

    if (object.ContentLength) {
      res.setHeader("Content-Length", object.ContentLength);
    } else if (!range && file.fileSize) {
      res.setHeader("Content-Length", file.fileSize);
    }

    object.Body.pipe(res);
  } catch (error) {
    next(error);
  }
}

/**
 * Transmite el archivo de la solicitud de proyecto sin cargar el contenido completo en memoria.
 * Aplica tipo, disposición y CSP según getFileResponseSecurity: tipos fuera de la lista se fuerzan a descarga.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function streamProjectRequestFile(req, res, next) {
  try {
    const projectRequestId = Number(req.params.projectRequestId);
    const fileId = Number(req.params.fileId);
    const file = await findProjectRequestFileForDownload({
      fileId,
      projectRequestId,
      user: req.user,
    });
    if (!file) {
      res.status(404).json({ code: "FILE_NOT_FOUND", message: "No se encontró el archivo." });
      return;
    }

    const object = await getProjectFileObject({
      fileName: file.fileName,
      range: req.headers.range,
    });
    if (req.headers.range && object.ContentRange) {
      res.status(206);
      res.setHeader("Content-Range", object.ContentRange);
      res.setHeader("Accept-Ranges", "bytes");
    } else {
      res.status(200);
    }
    // Solo 'self' puede incrustar adjuntos de solicitudes. Sus PDF se abren en una pestaña nueva
    // (no hay visor integrado en el modal de revisión) y conservan la política de Helmet.
    const security = getFileResponseSecurity({ contentType: object.ContentType || file.fileType, pdfViewing: "direct" });
    if (security.contentSecurityPolicy) res.setHeader("Content-Security-Policy", security.contentSecurityPolicy);
    res.setHeader("Content-Type", security.contentType);
    res.setHeader("Cache-Control", "private, max-age=60, must-revalidate");
    res.setHeader("Content-Disposition", `${security.disposition}; filename="${encodeURIComponent(file.originalName)}"`);
    res.vary("Cookie");
    if (object.ContentLength) res.setHeader("Content-Length", object.ContentLength);
    object.Body.pipe(res);
  } catch (error) {
    next(error);
  }
}
