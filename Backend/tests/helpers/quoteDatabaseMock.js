// PostgreSQL simulado para las pruebas de cotizaciones sin base de datos. Reconoce únicamente las
// sentencias de quoteRepository, quoteParticipantRepository y las lecturas de servicios que usa
// el módulo, y mantiene un estado en memoria con la misma forma de filas que devuelve `pg`
// (ids como texto, NUMERIC como texto con su escala). Cualquier otra sentencia falla, para que
// una consulta inesperada no pase inadvertida. Las pruebas contra PostgreSQL real viven en
// quotes.integration.test.js.

/**
 * Normaliza un decimal a la escala de su columna, como hace PostgreSQL al devolver NUMERIC.
 *
 * @param {string} value - Decimal como texto.
 * @param {number} scale - Decimales de la columna.
 * @returns {string} Decimal con escala fija.
 */
function toNumeric(value, scale) {
  const [integerPart, fractionPart = ""] = String(value).split(".");
  return `${integerPart}.${fractionPart.padEnd(scale, "0").slice(0, scale)}`;
}

/**
 * Crea el estado inicial: un administrador, dos clientes (uno inactivo), proyectos de cada uno y
 * servicios activos e inactivos con su versión vigente.
 *
 * @returns {object} Estado mutable de la base simulada.
 */
function createInitialState() {
  return {
    clients: new Map([
      [3, { id: 3, isAvailable: true, name: "Leonel Pérez" }],
      [4, { id: 4, isAvailable: false, name: "Cliente inactivo" }],
    ]),
    items: [],
    nextQuoteId: 1,
    nextVersionId: 1,
    projects: new Map([
      [9, { clientId: 3, id: 9, isAvailable: true, name: "Apto. 910" }],
      [10, { clientId: 4, id: 10, isAvailable: true, name: "Casa de otro cliente" }],
      [11, { clientId: 3, id: 11, isAvailable: false, name: "Proyecto eliminado" }],
    ]),
    quotes: [],
    serviceVersions: new Map([
      [10, { code: "SERV-001", id: 10, kind: "turnkey", name: "Anteproyecto arquitectónico", referenceRate: "12.00", serviceId: 1, unitAllowsDecimals: true, unitDenomination: "de construcción", unitSymbol: "m²" }],
      [20, { code: "SERV-002", id: 20, kind: "individual", name: "Puntos eléctricos y fuerza", referenceRate: "45.00", serviceId: 2, unitAllowsDecimals: false, unitDenomination: "eléctrico", unitSymbol: "pt." }],
      [30, { code: "SERV-003", id: 30, kind: "individual", name: "Servicio retirado", referenceRate: "8.00", serviceId: 3, unitAllowsDecimals: true, unitDenomination: null, unitSymbol: "m²" }],
      [40, { code: "SERV-004", id: 40, kind: "individual", name: "Modelado 3D & Renders", referenceRate: "450.00", serviceId: 4, unitAllowsDecimals: false, unitDenomination: null, unitSymbol: "proy." }],
    ]),
    // Unidades copiadas por versión: una por servicio salvo la versión 40 («Por Proyecto /
    // Espacio»: proyecto con tarifa y espacio pendiente de validación comercial).
    serviceVersionUnitOptions: new Map([
      [100, { id: 100, position: 1, presentationLabel: null, referenceRate: "12.00", serviceVersionId: 10, unitAllowsDecimals: true, unitDenomination: "de construcción", unitSymbol: "m²" }],
      [200, { id: 200, position: 1, presentationLabel: null, referenceRate: "45.00", serviceVersionId: 20, unitAllowsDecimals: false, unitDenomination: "eléctrico", unitSymbol: "pt." }],
      [300, { id: 300, position: 1, presentationLabel: null, referenceRate: "8.00", serviceVersionId: 30, unitAllowsDecimals: true, unitDenomination: null, unitSymbol: "m²" }],
      [400, { id: 400, position: 1, presentationLabel: null, referenceRate: "450.00", serviceVersionId: 40, unitAllowsDecimals: false, unitDenomination: null, unitSymbol: "proy." }],
      [401, { id: 401, position: 2, presentationLabel: null, referenceRate: null, serviceVersionId: 40, unitAllowsDecimals: false, unitDenomination: null, unitSymbol: "esp." }],
    ]),
    services: new Map([
      [1, { currentVersionId: 10, id: 1, isActive: true }],
      [2, { currentVersionId: 20, id: 2, isActive: true }],
      [3, { currentVersionId: 30, id: 3, isActive: false }],
      [4, { currentVersionId: 40, id: 4, isActive: true }],
    ]),
    users: new Map([[2, { firstName: "Leonel", hasProfilePhoto: true, id: 2, lastName: "Peréz" }]]),
    versions: [],
  };
}

/**
 * Devuelve la fila de listado o detalle de una cotización con su versión vigente.
 *
 * @param {object} state - Estado de la base simulada.
 * @param {object} quote - Cotización.
 * @returns {object} Fila con columnas de quotes y quote_versions.
 */
function quoteRow(state, quote) {
  const version = state.versions.find((candidate) => candidate.quoteId === quote.id && candidate.isCurrent);
  const author = state.users.get(quote.createdBy);
  const editor = state.users.get(version.createdBy);
  return {
    author_first_name: author.firstName,
    author_id: String(author.id),
    author_last_name: author.lastName,
    client_id: String(version.clientId),
    client_name: version.clientName,
    code: quote.code,
    created_at: quote.createdAt,
    currency_code: "USD",
    editor_first_name: editor.firstName,
    editor_has_profile_photo: editor.hasProfilePhoto,
    editor_id: String(editor.id),
    editor_last_name: editor.lastName,
    id: String(quote.id),
    notes: version.notes,
    project_id: String(version.projectId),
    project_name: version.projectName,
    services_total: version.servicesTotal,
    updated_at: quote.updatedAt,
    version_created_at: version.createdAt,
    version_id: String(version.id),
    version_number: version.versionNumber,
  };
}

/**
 * Crea un respondedor para startAdminRouterServer con estado propio. `state` permite preparar o
 * inspeccionar datos y `statements` registra las sentencias en orden (sin el rate limit).
 *
 * @returns {{ respond: Function, state: object, statements: Array<string> }} Respondedor y estado.
 */
export function createQuoteDatabaseMock() {
  const state = createInitialState();
  const statements = [];

  /**
   * Responde una sentencia reconocida con filas en el formato de `pg` y actualiza el estado.
   * Lanza un error para cualquier sentencia que el módulo no debería ejecutar.
   *
   * @param {string} sql - Sentencia.
   * @param {Array<unknown>} [params] - Parámetros.
   * @returns {{ rows: Array<object>, rowCount: number }} Resultado.
   */
  function respond(sql, params = []) {
    const text = sql.replace(/\s+/g, " ").trim();
    statements.push(text);
    const result = (rows, rowCount = rows.length) => ({ rowCount, rows });

    if (/^(begin|commit|rollback)$/i.test(text)) return result([]);
    if (text.startsWith("select id, name, (deleted_at is null and status = 'active') as is_available from public.clients")) {
      const client = state.clients.get(Number(params[0]));
      return result(client ? [{ id: String(client.id), is_available: client.isAvailable, name: client.name }] : []);
    }
    if (text.startsWith("select id, name, client_id, (deleted_at is null) as is_available from public.projects")) {
      const project = state.projects.get(Number(params[0]));
      return result(project ? [{ client_id: String(project.clientId), id: String(project.id), is_available: project.isAvailable, name: project.name }] : []);
    }
    if (text.startsWith("select id from public.services where id = any")) {
      return result(params[0].filter((id) => state.services.has(Number(id))).map((id) => ({ id: String(id) })));
    }
    if (text.startsWith("select s.id, s.is_active, v.id as version_id from public.services s")) {
      return result(params[0].filter((id) => state.services.has(Number(id))).map((id) => {
        const service = state.services.get(Number(id));
        return { id: String(service.id), is_active: service.isActive, version_id: service.currentVersionId === null ? null : String(service.currentVersionId) };
      }));
    }
    if (text.startsWith("select id, service_version_id, position, reference_rate, unit_allows_decimals from public.service_version_unit_options")) {
      const versionIds = new Set(params[0].map(Number));
      return result([...state.serviceVersionUnitOptions.values()]
        .filter((option) => versionIds.has(option.serviceVersionId))
        .sort((left, right) => left.serviceVersionId - right.serviceVersionId || left.position - right.position)
        .map((option) => ({
          id: String(option.id), position: option.position, reference_rate: option.referenceRate,
          service_version_id: String(option.serviceVersionId), unit_allows_decimals: option.unitAllowsDecimals,
        })));
    }
    if (text.includes("pg_get_serial_sequence('public.quotes', 'id')")) return result([{ id: String(state.nextQuoteId++) }]);
    if (text.startsWith("insert into public.quotes")) {
      const now = new Date().toISOString();
      state.quotes.push({ code: params[1], createdAt: now, createdBy: params[2], id: Number(params[0]), updatedAt: now, updatedBy: params[2] });
      return result([], 1);
    }
    if (text.startsWith("insert into public.quote_versions")) {
      const id = state.nextVersionId++;
      state.versions.push({
        clientId: params[2], clientName: params[3], createdAt: new Date().toISOString(), createdBy: params[9], id, isCurrent: true,
        notes: params[6], projectId: params[4], projectName: params[5], quoteId: params[0], servicesTotal: toNumeric(params[7], 2), versionNumber: params[1],
      });
      return result([{ id: String(id) }]);
    }
    if (text.startsWith("insert into public.quote_items")) {
      const [versionId, lineNumbers, serviceIds, serviceVersionIds, quantities, unitRates, referenceRates, subtotals, unitOptionIds] = params;
      lineNumbers.forEach((lineNumber, index) => state.items.push({
        lineNumber, quantity: toNumeric(quantities[index], 3), referenceRate: referenceRates[index], serviceId: serviceIds[index],
        serviceVersionId: serviceVersionIds[index], serviceVersionUnitOptionId: unitOptionIds[index], subtotal: toNumeric(subtotals[index], 2),
        unitRate: toNumeric(unitRates[index], 2), versionId,
      }));
      return result([], lineNumbers.length);
    }
    if (text.includes("inner join public.users author on author.id = q.created_by")) {
      const quote = state.quotes.find((candidate) => candidate.id === Number(params[0]));
      return result(quote ? [quoteRow(state, quote)] : []);
    }
    if (text.includes("from public.quote_items i inner join public.service_versions sv")) {
      return result(state.items.filter((item) => item.versionId === Number(params[0])).sort((left, right) => left.lineNumber - right.lineNumber).map((item) => {
        const version = state.serviceVersions.get(item.serviceVersionId);
        const unitOption = state.serviceVersionUnitOptions.get(item.serviceVersionUnitOptionId);
        return {
          line_number: item.lineNumber, quantity: item.quantity, reference_rate: item.referenceRate, service_code: version.code,
          service_description: null, service_id: String(item.serviceId), service_is_active: state.services.get(item.serviceId).isActive,
          service_kind: version.kind, service_name: version.name, service_version_id: String(item.serviceVersionId),
          service_version_unit_option_id: String(item.serviceVersionUnitOptionId), subtotal: item.subtotal,
          unit_allows_decimals: unitOption.unitAllowsDecimals, unit_denomination: unitOption.unitDenomination, unit_position: unitOption.position,
          unit_presentation_label: unitOption.presentationLabel, unit_rate: item.unitRate, unit_symbol: unitOption.unitSymbol,
        };
      }));
    }
    if (text.startsWith("select id from public.quotes where id = $1 for update")) {
      return result(state.quotes.some((quote) => quote.id === Number(params[0])) ? [{ id: String(params[0]) }] : []);
    }
    if (text.startsWith("update public.quote_versions set is_current = false")) {
      const current = state.versions.filter((version) => version.quoteId === Number(params[0]) && version.isCurrent);
      current.forEach((version) => { version.isCurrent = false; });
      return result([], current.length);
    }
    if (text.startsWith("update public.quotes set updated_by")) {
      const quote = state.quotes.find((candidate) => candidate.id === Number(params[0]));
      if (quote) Object.assign(quote, { updatedAt: new Date().toISOString(), updatedBy: params[1] });
      return result([], quote ? 1 : 0);
    }
    if (text.startsWith("select count(*)::bigint as total from public.quotes")) return result([{ total: String(state.quotes.length) }]);
    if (text.includes("from public.quotes q inner join public.quote_versions v on v.quote_id = q.id and v.is_current where")) {
      const limit = params.at(-1);
      return result(state.quotes.slice(0, limit).map((quote) => quoteRow(state, quote)));
    }
    throw new Error(`Sentencia no simulada: ${text.slice(0, 160)}`);
  }

  return { respond, state, statements };
}
