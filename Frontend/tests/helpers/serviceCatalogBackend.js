// Backend simulado del tabulador de servicios para las pruebas de navegador, con la forma del
// contrato (docs/API_CONTRACT.md): datos de prueba en memoria, nunca Supabase ni el catálogo
// comercial. Lo comparten la tabla (adminServiceCatalog) y el formulario (adminServiceForm).

export const UNITS = {
  m2: { id: 1, code: "square_meter", name: "Metro cuadrado", symbol: "m²", allowsDecimals: true, isActive: true, sortOrder: 101 },
  ml: { id: 6, code: "linear_meter", name: "Metro lineal", symbol: "m.l.", allowsDecimals: true, isActive: true, sortOrder: 201 },
  m3: { id: 13, code: "cubic_meter", name: "Metro cúbico", symbol: "m³", allowsDecimals: true, isActive: true, sortOrder: 301 },
  pto: { id: 30, code: "point", name: "Punto", symbol: "pto.", allowsDecimals: false, isActive: true, sortOrder: 401 },
};
export const DENOMINATIONS = {
  construccion: { id: 10, denomination: "de construcción", isActive: true, unit: "m2" },
  intervenir: { id: 11, denomination: "a intervenir", isActive: true, unit: "m2" },
  electrico: { id: 12, denomination: "eléctrico", isActive: true, unit: "pto" },
  volumen: { id: 13, denomination: "de excavación", isActive: true, unit: "m3" },
};
export const LONG_DESCRIPTION = "Diseña las áreas exteriores de prueba, con vegetación, superficies e iluminación, e integra jardines y terrazas con el resto del proyecto para comprobar textos extensos.";

const unitById = (id) => Object.values(UNITS).find((unit) => unit.id === Number(id));

/**
 * Denominación con la forma de la API (publicCode generado como PostgreSQL).
 *
 * @param {{id: number, denomination: string, isActive: boolean, unit: string}} fixture - Datos.
 * @returns {Object} Denominación.
 */
export function denominationRecord({ id, denomination, isActive = true, unit }) {
  const measurementUnit = UNITS[unit];
  return {
    id,
    publicCode: `UNID-${String(id).padStart(3, "0")}`,
    denomination,
    label: `${measurementUnit.symbol} ${denomination}`,
    isActive,
    activeServiceCount: 0,
    baseUnitEditable: true,
    measurementUnit,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  };
}

/**
 * Servicio con la forma del contrato: `unitLabel` compuesto como el backend (abreviatura +
 * denominación) y `referenceRate` como texto decimal.
 *
 * @param {number} id - Identificador.
 * @param {Object} fields - Código, nombre, unidad, denominación y demás campos.
 * @returns {Object} Servicio.
 */
export function service(id, { code, name, unit = "m2", denomination = null, rate = "10.00", description = null, isActive = true, currentVersion = 1 }) {
  const measurementUnit = UNITS[unit];
  const unitDenomination = denomination
    ? { id: DENOMINATIONS[denomination].id, denomination: DENOMINATIONS[denomination].denomination, isActive: DENOMINATIONS[denomination].isActive }
    : null;
  return {
    id,
    code,
    name,
    description,
    kind: "individual",
    measurementUnit,
    unitDenomination,
    unitLabel: unitDenomination ? `${measurementUnit.symbol} ${unitDenomination.denomination}` : measurementUnit.symbol,
    referenceRate: rate,
    currency: "USD",
    isActive,
    sortOrder: id,
    currentVersion,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  };
}

/**
 * Catálogo de prueba: servicios con y sin descripción, con y sin denominación, activos e
 * inactivos y tarifas con céntimos y miles.
 *
 * @returns {Array<Object>} Servicios.
 */
export function sampleCatalog() {
  return [
    service(1, { code: "TST-001", name: "Anteproyecto de prueba", denomination: "construccion", rate: "12.00", description: "Primera propuesta del espacio." }),
    service(2, { code: "TST-002", name: "Diseño interior de prueba", denomination: "intervenir", rate: "1250.50", description: "   " }),
    service(3, { code: "TST-003", name: "Paisajismo de prueba", denomination: "intervenir", rate: "18.00", description: LONG_DESCRIPTION }),
    service(4, { code: "TST-004", name: "Canalizaciones de prueba", unit: "ml", rate: "0.05", isActive: false }),
    service(5, { code: "TST-005", name: "Puntos eléctricos de prueba", unit: "pto", denomination: "electrico", rate: "45.00", description: "Cada punto incluye cableado." }),
  ];
}

/**
 * Compone la etiqueta de unidad de un servicio a partir de su base y su denominación.
 *
 * @param {Object} item - Servicio en memoria.
 * @returns {string} unitLabel.
 */
function composeUnitLabel(item) {
  return item.unitDenomination ? `${item.measurementUnit.symbol} ${item.unitDenomination.denomination}` : item.measurementUnit.symbol;
}

/**
 * Backend simulado con estado: búsqueda literal, filtros y cursor del listado; detalle; alta con
 * código generado (`SERV-` + id) y tipo individual; edición versionada (409 si la versión no
 * coincide, `changed=false` sin cambios); cambio de estado; unidades base; denominaciones por
 * base y su alta. Admite fallos y retrasos inyectados por operación.
 *
 * @param {Array<Object>} initial - Servicios iniciales.
 * @returns {Object} Estado, registro de peticiones y manejador de rutas.
 */
export function createServiceCatalogBackend(initial) {
  const state = {
    items: initial.map((item) => ({ ...item })),
    denominations: Object.values(DENOMINATIONS).map(denominationRecord),
    requests: [],
    failures: {},
    delays: {},
  };
  state.nextServiceId = Math.max(0, ...state.items.map((item) => item.id)) + 1;
  state.nextDenominationId = Math.max(0, ...state.denominations.map((item) => item.id)) + 1;
  const json = (route, status, body) => route.fulfill({ status, json: body });

  state.handle = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    const params = Object.fromEntries(url.searchParams);
    state.requests.push({ method, path, params, body });
    const failureKey = `${method} ${path.replace(/\d+/g, ":id")}`;
    const failure = state.failures[failureKey];
    const delay = state.delays[failureKey] ?? state.delays[params.search ?? (params.limit === "100" ? "summary" : "")];
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

    if (path === "/api/auth/me") return json(route, 200, { user: { id: 1, firstName: "Ana", lastName: "Admin", email: "ana@example.test", role: "admin", status: "active" } });
    if (path === "/api/projects") return json(route, 200, { projects: [], nextCursor: null });
    // El resumen de los indicadores (limit=100) no se ve afectado por los fallos de la tabla.
    if (failure && !(method === "GET" && path === "/api/admin/services" && params.limit === "100")) {
      return json(route, failure.status, failure.body);
    }

    if (path === "/api/admin/measurement-units" && method === "GET") {
      return json(route, 200, { measurementUnits: Object.values(UNITS).filter((unit) => unit.isActive) });
    }
    if (path === "/api/admin/measurement-unit-denominations" && method === "GET") {
      const matches = state.denominations.filter((item) => (!params.measurementUnitId || item.measurementUnit.id === Number(params.measurementUnitId))
        && (!params.status || item.isActive === (params.status === "active")));
      const limit = Number(params.limit || 25);
      const start = Number(params.cursor || 0);
      return json(route, 200, { unitDenominations: matches.slice(start, start + limit), nextCursor: start + limit < matches.length ? String(start + limit) : null });
    }
    if (path === "/api/admin/measurement-unit-denominations" && method === "POST") {
      const unitKey = Object.keys(UNITS).find((key) => UNITS[key].id === body.measurementUnitId);
      const created = denominationRecord({ id: state.nextDenominationId, denomination: body.denomination.trim(), unit: unitKey });
      state.nextDenominationId += 1;
      state.denominations.push(created);
      return json(route, 201, { message: "Unidad de medida creada correctamente.", unitDenomination: created });
    }

    if (path === "/api/admin/services" && method === "GET") {
      const search = (params.search || "").toLowerCase();
      const matches = state.items.filter((item) => (!search || item.name.toLowerCase().includes(search) || item.code.toLowerCase().includes(search))
        && (!params.status || item.isActive === (params.status === "active"))
        && (!params.measurementUnitId || item.measurementUnit.id === Number(params.measurementUnitId))
        && (!params.unitDenominationId || item.unitDenomination?.id === Number(params.unitDenominationId)));
      const limit = Number(params.limit || 25);
      const start = Number(params.cursor || 0);
      return json(route, 200, { services: matches.slice(start, start + limit), nextCursor: start + limit < matches.length ? String(start + limit) : null });
    }
    if (path === "/api/admin/services" && method === "POST") {
      const id = state.nextServiceId;
      state.nextServiceId += 1;
      const denomination = body.unitDenominationId ? state.denominations.find((item) => item.id === body.unitDenominationId) : null;
      const created = {
        ...service(id, { code: body.code ?? `SERV-${String(id).padStart(3, "0")}`, name: body.name, unit: "m2", rate: body.referenceRate, description: body.description ?? null }),
        measurementUnit: unitById(body.measurementUnitId),
        unitDenomination: denomination ? { id: denomination.id, denomination: denomination.denomination, isActive: denomination.isActive } : null,
        kind: body.kind ?? "individual",
        sortOrder: 0,
      };
      created.unitLabel = composeUnitLabel(created);
      state.items.unshift(created);
      return json(route, 201, { message: "Servicio creado correctamente.", service: created });
    }

    const match = /^\/api\/admin\/services\/(\d+)(\/status)?$/.exec(path);
    if (match) {
      const item = state.items.find((candidate) => candidate.id === Number(match[1]));
      if (!item) return json(route, 404, { code: "SERVICE_NOT_FOUND", message: "El servicio no existe." });
      if (method === "GET" && !match[2]) return json(route, 200, { service: { ...item } });
      if (method === "PATCH") {
        if (body.expectedVersion !== item.currentVersion) return json(route, 409, { code: "SERVICE_VERSION_CONFLICT", message: "Versión desactualizada." });
        if (match[2] && body.isActive && item.unitDenomination && !item.unitDenomination.isActive) {
          return json(route, 400, { code: "VALIDATION_ERROR", message: "Datos inválidos.", fields: { unitDenominationId: "La denominación está inactiva." } });
        }
        const before = JSON.stringify(item);
        if (body.name !== undefined) item.name = body.name;
        if (body.description !== undefined) item.description = body.description;
        if (body.referenceRate !== undefined) item.referenceRate = body.referenceRate;
        if (body.isActive !== undefined) item.isActive = body.isActive;
        if (body.measurementUnitId !== undefined) item.measurementUnit = unitById(body.measurementUnitId);
        if (body.unitDenominationId !== undefined) {
          const denomination = body.unitDenominationId ? state.denominations.find((candidate) => candidate.id === body.unitDenominationId) : null;
          item.unitDenomination = denomination ? { id: denomination.id, denomination: denomination.denomination, isActive: denomination.isActive } : null;
        }
        item.unitLabel = composeUnitLabel(item);
        const changed = JSON.stringify(item) !== before;
        if (changed) item.currentVersion += 1;
        return json(route, 200, { changed, changedFields: [], message: "Servicio actualizado.", service: { ...item } });
      }
    }
    state.requests.push({ unexpected: true, method, path });
    return json(route, 404, { code: "TEST_ROUTE_MISSING", message: "Fixture no definida" });
  };
  return state;
}
