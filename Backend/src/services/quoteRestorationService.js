import { withTransaction } from "../config/db.js";
import { AppError, ConflictError, NotFoundError } from "../errors/appError.js";
import { hasQuoteContentChanged } from "../domain/quote.js";
import { resolveQuoteReferenceVat } from "../domain/quoteReferenceVat.js";
import { collectRestoreReferenceConflicts, restoredAmountsMatch, toRestoredLines } from "../domain/quoteRestoration.js";
import { calculateQuoteTotals } from "../domain/quoteTotals.js";
import { insertAuditLog } from "../repositories/auditLogRepository.js";
import { findQuoteClient, lockQuoteProject } from "../repositories/quoteParticipantRepository.js";
import {
  findQuoteById,
  findQuoteRestoreRequest,
  lockQuoteForUpdate,
  retireCurrentQuoteVersion,
  touchQuoteRecord,
} from "../repositories/quoteRepository.js";
import { lockQuotableServices } from "../repositories/serviceCatalogRepository.js";
import { QUOTE_VERSION_CONFLICT_MESSAGE, translateQuoteError } from "./quoteErrors.js";
import { ensureQuotePdf } from "./quotePdfService.js";
import { QUOTE_NOT_FOUND_MESSAGE, toStoredContent, writeQuoteVersion } from "./quoteService.js";

/*
 * Restauración comercial de versiones de cotizaciones (exclusiva del administrador, sin aprobación
 * posterior). Es independiente de la restauración de archivos generales del proyecto, que conserva
 * su flujo de revisión. Reglas de contenido en domain/quoteRestoration.js.
 */

/**
 * Devuelve la versión ya creada por un envío repetido de la misma restauración, o rechaza el envío
 * si ese identificador ya restauró otra versión u otro motivo. Requiere la cotización bloqueada.
 *
 * @param {{ query: Function }} client - Cliente de la transacción con la cotización bloqueada.
 * @param {object} options - Envío recibido.
 * @param {number} options.quoteId - Cotización.
 * @param {number} options.versionNumber - Versión de origen pedida.
 * @param {string} options.reason - Motivo normalizado.
 * @param {string} options.requestId - UUID del envío.
 * @returns {Promise<object|null>} Versión creada por el envío anterior, o null si el envío es nuevo.
 * @throws {ConflictError} QUOTE_RESTORE_REQUEST_REUSED si el identificador guardó otra restauración.
 */
async function findReplayedRestoration(client, { quoteId, reason, requestId, versionNumber }) {
  const previous = await findQuoteRestoreRequest(client, quoteId, requestId);
  if (!previous) return null;
  if (previous.restoredFrom.versionNumber !== versionNumber || previous.restoredFrom.reason !== reason) {
    throw new ConflictError(
      "QUOTE_RESTORE_REQUEST_REUSED",
      "Este envío ya restauró otra versión. Cierra el diálogo y vuelve a intentarlo.",
    );
  }
  return findQuoteById(quoteId, client, previous.versionNumber);
}

/**
 * Comprueba que la versión pedida sea histórica (anterior a la vigente) y la lee con sus
 * conceptos, dentro de la transacción que bloquea la cotización.
 *
 * @param {{ query: Function }} client - Cliente de la transacción con la cotización bloqueada.
 * @param {object} current - Versión vigente bloqueada.
 * @param {number} versionNumber - Versión de origen pedida.
 * @returns {Promise<object>} Versión de origen completa.
 * @throws {ConflictError} QUOTE_RESTORE_SOURCE_CURRENT si es la vigente.
 * @throws {NotFoundError} QUOTE_VERSION_NOT_FOUND si no existe.
 */
async function requireHistoricalSource(client, current, versionNumber) {
  if (versionNumber === current.currentVersion) {
    throw new ConflictError("QUOTE_RESTORE_SOURCE_CURRENT", "La versión seleccionada ya es la vigente; no hay nada que restaurar.");
  }
  const source = versionNumber < current.currentVersion ? await findQuoteById(current.id, client, versionNumber) : null;
  if (!source) throw new NotFoundError("QUOTE_VERSION_NOT_FOUND", "La versión seleccionada no existe en esta cotización.");
  return source;
}

/**
 * Bloquea FOR SHARE cliente, proyecto y servicios de la versión de origen (en el orden de bloqueos
 * del módulo: cotización → cliente → proyecto → servicios por id) y rechaza la restauración si
 * alguna referencia ya no puede cotizarse, con la lista de conflictos para el administrador.
 *
 * @param {{ query: Function }} client - Cliente de la transacción con la cotización bloqueada.
 * @param {object} source - Versión de origen.
 * @param {object} current - Versión vigente.
 * @returns {Promise<void>}
 * @throws {AppError} QUOTE_RESTORE_REFERENCE_UNAVAILABLE (409) con `details.conflicts`.
 */
async function assertSourceReferencesAvailable(client, source, current) {
  const clientRecord = await findQuoteClient(source.client.id, client, true);
  const projectRecord = await lockQuoteProject(client, source.project.id);
  const serviceIds = [...new Set(source.items.map((item) => item.service.id))].sort((left, right) => left - right);
  const services = await lockQuotableServices(client, serviceIds);
  const conflicts = collectRestoreReferenceConflicts({ clientRecord, current, projectRecord, services, source });
  if (!conflicts.length) return;
  throw new AppError({
    code: "QUOTE_RESTORE_REFERENCE_UNAVAILABLE",
    details: { conflicts },
    message: `No se puede restaurar la versión ${source.currentVersion}: ${conflicts.map((conflict) => conflict.message).join(" ")}`,
    status: 409,
  });
}

/**
 * Recalcula con el motor único los importes de la versión de origen y exige que coincidan
 * exactamente con los guardados; así la versión restaurada nunca se aproxima.
 *
 * @param {object} source - Versión de origen.
 * @returns {{ lines: Array<object>, servicesTotal: string, referenceVat: { enabled: boolean, rate: string|null, amount: string } }}
 *   Líneas con subtotal, total de servicios e IVA referencial de la versión nueva.
 * @throws {AppError} QUOTE_RESTORE_INTEGRITY_ERROR (409) si el motor no reproduce los importes.
 */
function recalculateSourceAmounts(source) {
  const lines = toRestoredLines(source.items);
  const totals = calculateQuoteTotals({ items: lines, referenceVat: resolveQuoteReferenceVat({ stored: source.referenceVat }) });
  if (!restoredAmountsMatch(source, totals)) {
    throw new AppError({
      code: "QUOTE_RESTORE_INTEGRITY_ERROR",
      message: "Los importes de la versión seleccionada no se pueden reproducir con exactitud. Requiere revisión administrativa.",
      status: 409,
    });
  }
  return {
    lines: lines.map((line, index) => ({ ...line, subtotal: totals.items[index].subtotal })),
    referenceVat: { amount: totals.referenceVat.amount, enabled: totals.referenceVat.enabled, rate: totals.referenceVat.rate },
    servicesTotal: totals.servicesTotal,
  };
}

/**
 * Restaura una versión histórica creando una versión nueva y vigente con su contenido comercial,
 * su motivo, su origen y el administrador responsable; las versiones anteriores no cambian.
 *
 * Una transacción: cotización FOR UPDATE → repetición del envío (`requestId`) → `expectedVersion`
 * → versión de origen histórica → referencias FOR SHARE → importes exactos → contenido distinto del
 * vigente → retirar vigencia → versión, conceptos y reserva del PDF → auditoría. Tras el COMMIT se
 * genera y almacena el PDF de la versión nueva con el generador existente; un fallo del PDF no
 * revierte la restauración y se informa en `quote.pdf` (pending/error, recuperable con reintento).
 *
 * @param {object} options - Datos de la operación.
 * @param {number} options.quoteId - Cotización.
 * @param {number} options.versionNumber - Versión histórica que se restaura.
 * @param {{ expectedVersion: number, reason: string, requestId: string }} options.payload - Cuerpo validado.
 * @param {{ id: number }} options.user - Administrador autenticado.
 * @returns {Promise<{ quote: object, replayed: boolean }>} Versión creada (con `pdf`) y si el envío ya se había aplicado.
 * @throws {NotFoundError} QUOTE_NOT_FOUND o QUOTE_VERSION_NOT_FOUND.
 * @throws {ConflictError} QUOTE_VERSION_CONFLICT, QUOTE_RESTORE_SOURCE_CURRENT, QUOTE_RESTORE_NO_CHANGES o QUOTE_RESTORE_REQUEST_REUSED.
 * @throws {AppError} QUOTE_RESTORE_REFERENCE_UNAVAILABLE o QUOTE_RESTORE_INTEGRITY_ERROR (409).
 */
export async function restoreQuoteVersion({ payload, quoteId, user, versionNumber }) {
  const { expectedVersion, reason, requestId } = payload;
  try {
    const result = await withTransaction(async (client) => {
      const current = await lockQuoteForUpdate(client, quoteId);
      if (!current) throw new NotFoundError("QUOTE_NOT_FOUND", QUOTE_NOT_FOUND_MESSAGE);
      const replayed = await findReplayedRestoration(client, { quoteId, reason, requestId, versionNumber });
      if (replayed) return { quote: replayed, replayed: true };
      if (current.currentVersion !== expectedVersion) {
        throw new ConflictError("QUOTE_VERSION_CONFLICT", QUOTE_VERSION_CONFLICT_MESSAGE);
      }

      const source = await requireHistoricalSource(client, current, versionNumber);
      await assertSourceReferencesAvailable(client, source, current);
      const { lines, referenceVat, servicesTotal } = recalculateSourceAmounts(source);
      if (!hasQuoteContentChanged(toStoredContent(current), toStoredContent(source))) {
        throw new ConflictError("QUOTE_RESTORE_NO_CHANGES", `La versión ${versionNumber} tiene el mismo contenido que la vigente; no se creó una versión nueva.`);
      }

      const newVersionNumber = current.currentVersion + 1;
      await retireCurrentQuoteVersion(client, quoteId);
      await writeQuoteVersion(client, {
        client: source.client,
        lines,
        notes: source.notes,
        project: source.project,
        quoteId,
        referenceVat,
        restoration: { fromVersionNumber: versionNumber, reason, requestId },
        servicesTotal,
        userId: user.id,
        versionNumber: newVersionNumber,
      });
      await touchQuoteRecord(client, quoteId, user.id);
      await insertAuditLog({
        action: "quote.version_restore",
        description: `Versión ${versionNumber} de ${current.code} restaurada como versión ${newVersionNumber}.`,
        entityId: quoteId,
        entityType: "quote",
        newValues: { reason, restoredFromVersion: versionNumber, servicesTotal, versionNumber: newVersionNumber },
        oldValues: { servicesTotal: current.servicesTotal, versionNumber: current.currentVersion },
        userId: user.id,
      }, client);
      return { quote: await findQuoteById(quoteId, client), replayed: false };
    });
    // Restauración confirmada y conexión liberada: el PDF se genera con el flujo persistente existente.
    return { ...result, quote: { ...result.quote, pdf: await ensureQuotePdf(result.quote) } };
  } catch (error) {
    throw translateQuoteError(error);
  }
}
