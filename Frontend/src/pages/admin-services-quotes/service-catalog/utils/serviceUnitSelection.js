/**
 * Construye el mismo catálogo seleccionable para Crear y Editar, con cualquier modalidad: bases
 * activas que tienen denominaciones activas registradas. La referencia histórica se muestra
 * aparte; nunca se incorpora al catálogo como si fuera una nueva asignación válida.
 *
 * @param {Array<Object>} baseOptions - Opciones de bases activas obtenidas de la API.
 * @param {Array<Object>} denominations - Denominaciones registradas.
 * @returns {{prefixOptions: Array<Object>, denominations: Array<Object>}} Opciones de nuevas asignaciones.
 */
export function getServiceUnitCatalog(baseOptions, denominations) {
  const bases = (Array.isArray(baseOptions) ? baseOptions : []).filter((base) => base.isActive !== false);
  const baseIds = new Set(bases.map((base) => base.id));
  const selectable = (denominations || []).filter((item) => item.isActive !== false
    && item.measurementUnit?.isActive !== false && baseIds.has(item.measurementUnit?.id));
  const registeredBaseIds = new Set(selectable.map((item) => item.measurementUnit.id));
  return { prefixOptions: bases.filter((base) => registeredBaseIds.has(base.id)), denominations: selectable };
}

/**
 * Reconoce la combinación guardada por sus identificadores, incluida una base sin denominación.
 * Permite conservar referencias históricas sin exigir que vuelvan a estar disponibles en el catálogo.
 *
 * @param {Object} draft - Borrador actual.
 * @param {Object|null} service - Servicio original leído por GET.
 * @returns {boolean} La base y denominación conservan sus identificadores originales.
 */
export function preservesServiceUnit(draft, service) {
  return Boolean(service && draft.measurementUnitId === service.measurementUnit.id
    && (draft.unitDenomination?.id ?? null) === (service.unitDenomination?.id ?? null));
}

/**
 * Normaliza un texto para la búsqueda del campo de unidad: sin distinguir mayúsculas ni acentos,
 * con los superíndices como cifras (NFKD: «m²» se encuentra escribiendo «m2») y espacios simples.
 *
 * @param {*} value - Texto escrito o dato de una unidad.
 * @returns {string} Texto comparable.
 */
export function normalizeUnitSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Opción del combobox «Unidad de medida» a partir de una denominación registrada: símbolo de su
 * base («m²»), categoría (la denominación, «de construcción») y nombre de la base («Metro
 * cuadrado»). La búsqueda se precalcula sobre esos tres datos y la etiqueta del backend.
 *
 * @param {{id: number, denomination: string, label?: string, measurementUnit: {id: number, symbol: string, name?: string}}} denomination
 * Denominación con la forma del contrato.
 * @returns {{id: number, symbol: string, category: string, baseName: string, label: string, searchText: string, denomination: Object}}
 * Opción presentable y su texto de búsqueda.
 */
export function toServiceUnitOption(denomination) {
  const symbol = denomination.measurementUnit?.symbol ?? "";
  const baseName = denomination.measurementUnit?.name ?? "";
  const label = denomination.label || `${symbol} ${denomination.denomination}`.trim();
  return {
    id: denomination.id,
    symbol,
    category: denomination.denomination,
    baseName,
    label,
    searchText: normalizeUnitSearchText([symbol, denomination.denomination, baseName, label].join(" ")),
    denomination,
  };
}

/**
 * Filtra las opciones por lo escrito: cada palabra debe aparecer en el símbolo, la categoría o el
 * nombre de la base, en cualquier orden («cuadrado constru» encuentra «m² de construcción»).
 * Sin texto devuelve todas, en el orden del catálogo.
 *
 * @param {Array<{searchText: string}>} options - Opciones de toServiceUnitOption.
 * @param {string} query - Texto escrito en el campo.
 * @returns {Array<Object>} Opciones coincidentes.
 */
export function filterServiceUnitOptions(options, query) {
  const terms = normalizeUnitSearchText(query).split(" ").filter(Boolean);
  if (terms.length === 0) return options;
  return options.filter((option) => terms.every((term) => option.searchText.includes(term)));
}

/**
 * Símbolo que muestra el prefijo del campo de unidad, derivado de los identificadores del
 * borrador (la única fuente de verdad): primero la base elegida en el catálogo de bases (incluye
 * una base histórica en la edición) y, si ese catálogo aún no la contiene, la base de la
 * denominación elegida. Así el prefijo no desaparece por un catálogo de bases incompleto o que
 * todavía está cargando.
 *
 * @param {Object} params - Selección y catálogos.
 * @param {number|null} params.measurementUnitId - Base del borrador.
 * @param {{id: number}|null} params.unitDenomination - Denominación del borrador.
 * @param {{id: number, label: string}|null} params.selectedBaseOption - Base del catálogo de bases.
 * @param {Array<{id: number, measurementUnit?: {id: number, symbol: string}}>} params.denominations - Denominaciones.
 * @returns {string} Símbolo o cadena vacía si no hay base elegida.
 */
export function resolveSelectedUnitSymbol({ denominations, measurementUnitId, selectedBaseOption, unitDenomination }) {
  if (!measurementUnitId) return "";
  if (selectedBaseOption?.id === measurementUnitId && selectedBaseOption.label) return selectedBaseOption.label;
  const denomination = (denominations || []).find((item) => item.id === unitDenomination?.id && item.measurementUnit?.id === measurementUnitId);
  return denomination?.measurementUnit?.symbol ?? "";
}
