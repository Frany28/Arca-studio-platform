import { pipeline } from "node:stream/promises";

import { getQuotePdf } from "../services/quotePdfService.js";
import {
  createQuote,
  getClientProjectOptions,
  getQuote,
  getQuoteClientOptions,
  getQuoteReferenceVatSettings,
  getQuoteSummary,
  getQuotesPage,
  updateQuote,
} from "../services/quoteService.js";
import { getFileResponseSecurity } from "../utils/fileResponseSecurity.js";

// Las lecturas no se guardan en caché: editar con una versión antigua provocaría conflictos 409.
const NO_STORE = "no-store";

/**
 * Devuelve una página del listado de cotizaciones con su cursor siguiente.
 * Delega filtros, orden y paginación en el servicio y responde `{ quotes, nextCursor }`.
 *
 * @param {import("express").Request} req - Solicitud con la consulta validada.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function getQuotes(req, res, next) {
  try {
    res.set("Cache-Control", NO_STORE).status(200).json(await getQuotesPage(req.validatedQuery));
  } catch (error) {
    next(error);
  }
}

/**
 * Devuelve los indicadores de cotizaciones del módulo (total registrado).
 * Responde `{ summary: { total } }` sin caché, porque cambia con cada alta.
 *
 * @param {import("express").Request} _req - Solicitud HTTP (no se usa).
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function getQuotesSummary(_req, res, next) {
  try {
    res.set("Cache-Control", NO_STORE).status(200).json({ summary: await getQuoteSummary() });
  } catch (error) {
    next(error);
  }
}

/**
 * Devuelve la tasa configurada del IVA referencial (informativo, no fiscal) para la vista previa
 * del formulario: `{ referenceVat: { enabled, rate } }`; sin tasa, `enabled=false` y `rate=null`.
 * Sin caché: la tasa puede cambiar con un redespliegue.
 *
 * @param {import("express").Request} _req - Solicitud HTTP (no se usa).
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {void}
 */
export function getQuoteReferenceVat(_req, res, next) {
  try {
    res.set("Cache-Control", NO_STORE).status(200).json({ referenceVat: getQuoteReferenceVatSettings() });
  } catch (error) {
    next(error);
  }
}

/**
 * Devuelve una cotización con su versión vigente y sus conceptos.
 * Responde 404 QUOTE_NOT_FOUND a través del middleware de errores cuando no existe.
 *
 * @param {import("express").Request} req - Solicitud con `params.quoteId` validado.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function getQuoteById(req, res, next) {
  try {
    res.set("Cache-Control", NO_STORE).status(200).json({ quote: await getQuote(req.params.quoteId) });
  } catch (error) {
    next(error);
  }
}

/**
 * Crea una cotización con el administrador autenticado como autor.
 * Responde 201 con la cotización creada y su código generado.
 *
 * @param {import("express").Request} req - Solicitud con el cuerpo validado.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function postQuote(req, res, next) {
  try {
    const quote = await createQuote({ payload: req.body, user: req.user });
    res.status(201).json({ message: "Cotización creada correctamente.", quote });
  } catch (error) {
    next(error);
  }
}

/**
 * Guarda una versión nueva de la cotización con `expectedVersion`. Sin cambios efectivos
 * responde 200 con `changed: false` y la versión no aumenta.
 *
 * @param {import("express").Request} req - Solicitud con parámetros y cuerpo validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function patchQuote(req, res, next) {
  try {
    const result = await updateQuote({ payload: req.body, quoteId: req.params.quoteId, user: req.user });
    res.status(200).json({
      changed: result.changed,
      message: result.changed ? "Cotización actualizada correctamente." : "No había cambios para guardar.",
      quote: result.quote,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Lista los clientes activos que pueden asociarse a una cotización.
 * Responde `{ clients, nextCursor }` sin caché.
 *
 * @param {import("express").Request} req - Solicitud con la consulta validada.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function getQuoteClients(req, res, next) {
  try {
    res.set("Cache-Control", NO_STORE).status(200).json(await getQuoteClientOptions(req.validatedQuery));
  } catch (error) {
    next(error);
  }
}

/**
 * Lista los proyectos de un cliente que pueden asociarse a una cotización.
 * Responde `{ projects, nextCursor }` o 404 QUOTE_CLIENT_NOT_FOUND.
 *
 * @param {import("express").Request} req - Solicitud con cliente y consulta validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function getQuoteClientProjects(req, res, next) {
  try {
    const page = await getClientProjectOptions({ clientId: req.params.clientId, filters: req.validatedQuery });
    res.set("Cache-Control", NO_STORE).status(200).json(page);
  } catch (error) {
    next(error);
  }
}

/**
 * Envía por streaming el PDF de la versión vigente. Se sirve como descarga con la política
 * estricta de los PDF de la API (el visor integrado lo lee con fetch) y con un ETag por versión:
 * `private, no-cache` obliga a revalidar con la sesión antes de reutilizar la copia (304).
 *
 * @param {import("express").Request} req - Solicitud con `params.quoteId` y `timeZone` validados.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function getQuotePdfDocument(req, res, next) {
  let stream = null;
  try {
    const pdf = await getQuotePdf({
      ifNoneMatch: req.headers["if-none-match"],
      quoteId: req.params.quoteId,
      timeZone: req.validatedQuery.timeZone,
    });
    stream = pdf.stream;
    res.setHeader("Cache-Control", "private, no-cache");
    res.setHeader("ETag", pdf.etag);
    res.vary("Cookie");
    if (pdf.notModified) {
      res.status(304).end();
      return;
    }
    const security = getFileResponseSecurity({ contentType: "application/pdf" });
    res.status(200);
    res.setHeader("Content-Security-Policy", security.contentSecurityPolicy);
    res.setHeader("Content-Type", security.contentType);
    res.setHeader("Content-Disposition", `${security.disposition}; filename="${encodeURIComponent(pdf.fileName)}"`);
    await pipeline(stream, res);
  } catch (error) {
    // Un cliente que cancela la descarga no es un error de la API; con cabeceras enviadas no se responde JSON.
    if (error?.code === "ERR_STREAM_PREMATURE_CLOSE") return;
    if (res.headersSent) {
      stream?.destroy();
      res.destroy(error);
      return;
    }
    next(error);
  }
}
