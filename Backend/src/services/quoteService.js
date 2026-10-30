import { withTransaction } from "../config/db.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/appError.js";
import {
  QUOTE_CURRENCY,
  QUOTE_SORT_FIELDS,
  chooseQuoteUnitOption,
  collectDuplicateServiceErrors,
  collectWholeQuantityErrors,
  formatGeneratedQuoteCode,
  hasQuoteContentChanged,
} from "../domain/quote.js";
import { resolveQuoteReferenceVat } from "../domain/quoteReferenceVat.js";
import { calculateQuoteTotals } from "../domain/quoteTotals.js";
import {
  findQuoteClient,
  listClientProjectOptions,
  listQuoteClientOptions,
  lockQuoteProject,
} from "../repositories/quoteParticipantRepository.js";
import {
  countQuotes,
  findQuoteById,
  insertQuoteItems,
  insertQuoteRecord,
  insertQuoteVersion,
  listQuotes,
  lockQuoteForUpdate,
  reserveQuoteId,
  retireCurrentQuoteVersion,
  touchQuoteRecord,
} from "../repositories/quoteRepository.js";
import { findServiceVersionUnitOptions, lockQuotableServices } from "../repositories/serviceCatalogRepository.js";
import { decodeCursor, pageResult, parsePageLimit } from "../utils/pagination.js";
import { QUOTE_VERSION_CONFLICT_MESSAGE, translateQuoteError } from "./quoteErrors.js";

const QUOTE_NOT_FOUND_MESSAGE = "La cotización solicitada no existe.";

/**
 * Obtiene una página del listado de cotizaciones con búsqueda, intervalo de fechas y orden por
 * código o por total, paginada por cursor. No usa caché: los datos cambian por edición directa.
 *
 * @param {object} filters - Consulta validada por quoteListSchema.
 * @returns {Promise<{ quotes: Array<object>, nextCursor: string|null }>} Página del listado.
 */
export async function getQuotesPage(filters) {
  const limit = parsePageLimit(filters.limit);
  const rows = await listQuotes({
    createdBefore: filters.createdBefore,
    createdFrom: filters.createdFrom,
    cursor: decodeCursor(filters.cursor),
    direction: filters.direction,
    limit,
    search: filters.search,
    sort: filters.sort,
  });
  const cursorValues = filters.sort === QUOTE_SORT_FIELDS.TOTAL
    ? (quote) => [quote.servicesTotal, String(quote.id)]
    : (quote) => [String(quote.id), String(quote.id)];
  const page = pageResult(rows, limit, (quote) => quote, cursorValues);
  return { nextCursor: page.nextCursor, quotes: page.items };
}

/**
 * Devuelve los indicadores del módulo que dependen de las cotizaciones guardadas.
 * Hoy solo el total, que alimenta «Cotizaciones totales» en la cabecera del módulo.
 *
 * @returns {Promise<{ total: number }>} Resumen.
 */
export async function getQuoteSummary() {
  return { total: await countQuotes() };
}

/**
 * Obtiene una cotización con su versión vigente y sus conceptos.
 * Responde 404 si el identificador no corresponde a ninguna cotización.
 *
 * @param {number} quoteId - Identificador validado.
 * @returns {Promise<object>} Cotización.
 * @throws {NotFoundError} QUOTE_NOT_FOUND si no existe.
 */
export async function getQuote(quoteId) {
  const quote = await findQuoteById(quoteId);
  if (!quote) throw new NotFoundError("QUOTE_NOT_FOUND", QUOTE_NOT_FOUND_MESSAGE);
  return quote;
}

/**
 * Lista los clientes activos que pueden asociarse a una cotización, en orden alfabético.
 * La paginación usa el nombre y el id del último cliente como cursor.
 *
 * @param {object} filters - Consulta validada por quoteClientOptionsSchema.
 * @returns {Promise<{ clients: Array<object>, nextCursor: string|null }>} Página de clientes.
 */
export async function getQuoteClientOptions(filters) {
  const limit = parsePageLimit(filters.limit);
  const rows = await listQuoteClientOptions({ cursor: decodeCursor(filters.cursor), limit, search: filters.search });
  const page = pageResult(rows, limit, (client) => client, (client) => [client.name, String(client.id)]);
  return { clients: page.items, nextCursor: page.nextCursor };
}

/**
 * Lista los proyectos no eliminados de un cliente para asociarlos a una cotización. Se admite
 * un cliente inactivo para poder editar cotizaciones ya guardadas con él.
 *
 * @param {object} options - Cliente y consulta validados por quoteProjectOptionsSchema.
 * @param {number} options.clientId - Cliente propietario.
 * @param {object} options.filters - Búsqueda y paginación.
 * @returns {Promise<{ projects: Array<object>, nextCursor: string|null }>} Página de proyectos.
 * @throws {NotFoundError} QUOTE_CLIENT_NOT_FOUND si el cliente no existe.
 */
export async function getClientProjectOptions({ clientId, filters }) {
  if (!(await findQuoteClient(clientId))) {
    throw new NotFoundError("QUOTE_CLIENT_NOT_FOUND", "El cliente seleccionado no existe.");
  }
  const limit = parsePageLimit(filters.limit);
  const rows = await listClientProjectOptions({ clientId, cursor: decodeCursor(filters.cursor), limit, search: filters.search });
  const page = pageResult(rows, limit, (project) => project, (project) => [project.name, String(project.id)]);
  return { nextCursor: page.nextCursor, projects: page.items };
}

/**
 * Valida y bloquea con FOR SHARE el cliente y el proyecto, que debe pertenecer al cliente. Uno
 * nuevo debe estar activo y no eliminado; si no cambian respecto a la versión vigente conservan
 * sus nombres copiados, para que editar otros datos no falle ni reescriba el documento.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} options - Datos de la operación.
 * @param {number} options.clientId - Cliente elegido.
 * @param {number} options.projectId - Proyecto elegido.
 * @param {object|null} options.current - Cotización vigente al editar; null al crear.
 * @returns {Promise<{ client: { id: number, name: string }, project: { id: number, name: string } }>} Participantes.
 * @throws {ValidationError} Con `fields.clientId` o `fields.projectId` si no son válidos.
 */
async function resolveQuoteParticipants(client, { clientId, current, projectId }) {
  const fields = {};
  const keepsClient = current?.client.id === clientId;
  const keepsProject = keepsClient && current?.project.id === projectId;

  const clientRecord = await findQuoteClient(clientId, client, true);
  if (!clientRecord) fields.clientId = "El cliente seleccionado no existe.";
  else if (!keepsClient && !clientRecord.isAvailable) fields.clientId = "El cliente seleccionado está inactivo o fue eliminado.";

  const project = await lockQuoteProject(client, projectId);
  if (!project) fields.projectId = "El proyecto seleccionado no existe.";
  else if (project.clientId !== clientId) fields.projectId = "El proyecto no pertenece al cliente seleccionado.";
  else if (!keepsProject && !project.isAvailable) fields.projectId = "El proyecto seleccionado fue eliminado.";

  if (Object.keys(fields).length) throw new ValidationError(undefined, fields);
  return {
    client: { id: clientId, name: keepsClient ? current.client.name : clientRecord.name },
    project: { id: projectId, name: keepsProject ? current.project.name : project.name },
  };
}

/**
 * Elige la versión de servicio de cada concepto. Un servicio ya cotizado conserva su versión
 * (nombre, unidad y tarifa de referencia no cambian al editar otros datos) aunque esté inactivo;
 * uno nuevo en la cotización debe existir, estar activo y tener versión vigente.
 *
 * @param {Array<{ serviceId: number }>} items - Conceptos recibidos.
 * @param {Map<number, object>} services - Estado de los servicios bloqueados.
 * @param {object|null} current - Cotización vigente al editar.
 * @returns {Array<number>} Versión de servicio por concepto, en el mismo orden.
 * @throws {ValidationError} Con `fields.items.N.serviceId` si un servicio no puede cotizarse.
 */
function chooseServiceVersions(items, services, current) {
  const fields = {};
  const quotedVersions = new Map((current?.items ?? []).map((item) => [item.service.id, item.service.versionId]));
  const versionIds = items.map((item, index) => {
    if (quotedVersions.has(item.serviceId)) return quotedVersions.get(item.serviceId);
    const service = services.get(item.serviceId);
    const path = `items.${index}.serviceId`;
    if (!service) fields[path] = "El servicio seleccionado no existe.";
    else if (!service.isActive) fields[path] = "El servicio está inactivo y no puede añadirse a la cotización.";
    else if (service.currentVersionId === null) fields[path] = "El servicio no tiene una versión vigente registrada.";
    return service?.currentVersionId ?? null;
  });
  if (Object.keys(fields).length) throw new ValidationError(undefined, fields);
  return versionIds;
}

/**
 * Elige la unidad copiada de cada concepto: la ya cotizada con esa misma versión o la única
 * unidad del servicio.
 *
 * @param {Array<{ serviceId: number }>} items - Conceptos recibidos.
 * @param {Array<number>} versionIds - Versión de servicio por concepto.
 * @param {Map<number, Array<object>>} unitOptionsByVersion - Unidades copiadas por versión.
 * @param {object|null} current - Cotización vigente al editar.
 * @returns {Array<object>} Unidad elegida por concepto, en el mismo orden.
 * @throws {ValidationError} Con `fields.items.N.serviceId` si la versión no tiene una unidad cotizable.
 */
function chooseUnitOptions(items, versionIds, unitOptionsByVersion, current) {
  const fields = {};
  const quotedPositions = new Map((current?.items ?? []).map((item) => [`${item.service.id}:${item.service.versionId}`, item.unit.position]));
  const options = items.map((item, index) => {
    const choice = chooseQuoteUnitOption({
      quotedPosition: quotedPositions.get(`${item.serviceId}:${versionIds[index]}`) ?? null,
      unitOptions: unitOptionsByVersion.get(versionIds[index]) ?? [],
    });
    if (choice.error) fields[`items.${index}.serviceId`] = choice.error;
    return choice.option ?? null;
  });
  if (Object.keys(fields).length) throw new ValidationError(undefined, fields);
  return options;
}

/**
 * Resuelve los conceptos en la transacción: rechaza servicios repetidos, bloquea los servicios
 * FOR SHARE (SERVICE_MODALITY_IN_USE), fija versión y unidad (su tarifa es la de referencia),
 * exige cantidades enteras en unidades sin decimales y calcula los importes con el motor único.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} options - Datos de la operación.
 * @param {Array<{ serviceId: number, quantity: string, unitRate: string }>} options.items - Conceptos validados.
 * @param {object|null} options.current - Cotización vigente al editar; null al crear.
 * @param {{ enabled: boolean, rate: string|null }} options.referenceVat - IVA referencial que se aplica.
 * @returns {Promise<{ lines: Array<object>, servicesTotal: string, referenceVat: { enabled: boolean,
 *   rate: string|null, amount: string } }>} Conceptos con subtotal, total de servicios e IVA referencial.
 * @throws {ValidationError} Si algún concepto no puede guardarse.
 */
async function resolveQuoteLines(client, { current, items, referenceVat }) {
  const fields = {};
  collectDuplicateServiceErrors(items, fields);
  if (Object.keys(fields).length) throw new ValidationError(undefined, fields);

  const serviceIds = [...new Set(items.map((item) => item.serviceId))].sort((left, right) => left - right);
  const services = await lockQuotableServices(client, serviceIds);
  const versionIds = chooseServiceVersions(items, services, current);
  const unitOptionsByVersion = await findServiceVersionUnitOptions(client, [...new Set(versionIds)]);
  const unitOptions = chooseUnitOptions(items, versionIds, unitOptionsByVersion, current);
  const lines = items.map((item, index) => ({
    quantity: item.quantity,
    referenceRate: unitOptions[index].referenceRate,
    serviceId: item.serviceId,
    serviceVersionId: versionIds[index],
    serviceVersionUnitOptionId: unitOptions[index].id,
    unitAllowsDecimals: unitOptions[index].unitAllowsDecimals,
    unitRate: item.unitRate,
  }));
  collectWholeQuantityErrors(lines, fields);
  if (Object.keys(fields).length) throw new ValidationError(undefined, fields);

  const totals = calculateQuoteTotals({ items: lines, referenceVat });
  return {
    lines: lines.map((line, index) => ({ ...line, subtotal: totals.items[index].subtotal })),
    referenceVat: { amount: totals.referenceVat.amount, enabled: totals.referenceVat.enabled, rate: totals.referenceVat.rate },
    servicesTotal: totals.servicesTotal,
  };
}

/**
 * Registra una versión vigente con sus conceptos para la cotización indicada.
 * La versión y sus conceptos se escriben en la transacción recibida.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} version - Datos resueltos de la versión.
 * @returns {Promise<void>}
 */
async function writeQuoteVersion(client, version) {
  const versionId = await insertQuoteVersion(client, { ...version, currency: QUOTE_CURRENCY });
  await insertQuoteItems(client, versionId, version.lines);
}

/**
 * Crea una cotización y su versión 1 en una única transacción: si falla cualquier escritura no
 * queda ningún registro. El código `COT-001` lo genera siempre el sistema a partir del id
 * reservado y PostgreSQL garantiza además su unicidad (uq_quotes_code).
 *
 * @param {object} options - Datos de la operación.
 * @param {object} options.payload - Cuerpo validado por quoteCreateSchema.
 * @param {{ id: number }} options.user - Administrador autenticado.
 * @returns {Promise<object>} Cotización creada con currentVersion = 1.
 * @throws {ValidationError} Si el cliente, el proyecto o algún concepto no son válidos.
 */
export async function createQuote({ payload, user }) {
  // Una cotización nueva se calcula con la tasa referencial fija (QUOTE_REFERENCE_VAT_RATE).
  const referenceVat = resolveQuoteReferenceVat({ stored: null });
  try {
    return await withTransaction(async (client) => {
      const participants = await resolveQuoteParticipants(client, { ...payload, current: null });
      const { lines, referenceVat: vat, servicesTotal } = await resolveQuoteLines(client, { current: null, items: payload.items, referenceVat });
      const quoteId = await reserveQuoteId(client);
      await insertQuoteRecord(client, { code: formatGeneratedQuoteCode(quoteId), id: quoteId, userId: user.id });
      await writeQuoteVersion(client, {
        ...participants,
        lines,
        notes: payload.notes,
        quoteId,
        referenceVat: vat,
        servicesTotal,
        userId: user.id,
        versionNumber: 1,
      });
      return findQuoteById(quoteId, client);
    });
  } catch (error) {
    throw translateQuoteError(error);
  }
}

/**
 * Representa el contenido versionado de una cotización guardada con la misma forma que el
 * contenido resuelto de un guardado, para compararlos.
 *
 * @param {object} quote - Cotización de findQuoteById.
 * @returns {object} Contenido comparable.
 */
function toStoredContent(quote) {
  return {
    clientId: quote.client.id,
    items: quote.items.map((item) => ({
      quantity: item.quantity,
      serviceId: item.service.id,
      serviceVersionId: item.service.versionId,
      serviceVersionUnitOptionId: item.unit.optionId,
      unitRate: item.unitRate,
    })),
    notes: quote.notes,
    projectId: quote.project.id,
    referenceVat: { enabled: quote.referenceVat.enabled, rate: quote.referenceVat.rate },
  };
}

/**
 * Guarda una versión nueva de la cotización solo si cambia su contenido. Bloquea la cotización,
 * exige que `expectedVersion` sea la vigente (control optimista entre administradores), retira
 * la versión anterior e inserta la nueva con sus conceptos en la misma transacción.
 *
 * @param {object} options - Datos de la operación.
 * @param {number} options.quoteId - Cotización a editar.
 * @param {object} options.payload - Cuerpo validado por quoteUpdateSchema.
 * @param {{ id: number }} options.user - Administrador autenticado.
 * @returns {Promise<{ quote: object, changed: boolean }>} Resultado; `changed` es false cuando no
 *   había cambios efectivos y no se creó versión.
 * @throws {NotFoundError} QUOTE_NOT_FOUND si la cotización no existe.
 * @throws {ConflictError} QUOTE_VERSION_CONFLICT si otra edición se confirmó antes.
 * @throws {ValidationError} Si el cliente, el proyecto o algún concepto no son válidos.
 */
export async function updateQuote({ payload, quoteId, user }) {
  try {
    return await withTransaction(async (client) => {
      const current = await lockQuoteForUpdate(client, quoteId);
      if (!current) throw new NotFoundError("QUOTE_NOT_FOUND", QUOTE_NOT_FOUND_MESSAGE);
      if (current.currentVersion !== payload.expectedVersion) {
        throw new ConflictError("QUOTE_VERSION_CONFLICT", QUOTE_VERSION_CONFLICT_MESSAGE);
      }

      const participants = await resolveQuoteParticipants(client, { ...payload, current });
      // Conserva el IVA de la versión guardada: su tasa histórica, o sin IVA si es anterior a la regla.
      const referenceVat = resolveQuoteReferenceVat({ stored: current.referenceVat });
      const { lines, referenceVat: vat, servicesTotal } = await resolveQuoteLines(client, { current, items: payload.items, referenceVat });
      const next = { clientId: payload.clientId, items: lines, notes: payload.notes, projectId: payload.projectId, referenceVat };
      if (!hasQuoteContentChanged(toStoredContent(current), next)) return { changed: false, quote: current };

      await retireCurrentQuoteVersion(client, quoteId);
      await writeQuoteVersion(client, {
        ...participants,
        lines,
        notes: payload.notes,
        quoteId,
        referenceVat: vat,
        servicesTotal,
        userId: user.id,
        versionNumber: current.currentVersion + 1,
      });
      await touchQuoteRecord(client, quoteId, user.id);
      return { changed: true, quote: await findQuoteById(quoteId, client) };
    });
  } catch (error) {
    throw translateQuoteError(error);
  }
}
