// Límite del texto de una denominación según docs/API_CONTRACT.md (1–80 caracteres).
export const DENOMINATION_MAX_LENGTH = 80;

/**
 * Normaliza el texto como lo hace el backend antes de guardarlo (NFC, sin espacios exteriores
 * ni dobles), para validar y previsualizar exactamente lo que se enviará.
 *
 * @param {string} value - Texto escrito por el usuario.
 * @returns {string} Texto normalizado.
 */
export function normalizeDenominationText(value) {
  return String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * Valida la denominación en el cliente con las mismas reglas del contrato; el backend sigue
 * siendo la fuente de verdad (duplicados equivalentes, base inactiva).
 *
 * @param {string} value - Texto escrito por el usuario.
 * @returns {string} Mensaje de error, o cadena vacía si es válido.
 */
export function validateDenominationText(value) {
  const text = normalizeDenominationText(value);
  if (!text) return "Escribe el nombre de la unidad.";
  if (text.length > DENOMINATION_MAX_LENGTH) return `Admite como máximo ${DENOMINATION_MAX_LENGTH} caracteres.`;
  if (/\p{Cc}/u.test(text)) return "No admite caracteres de control.";
  return "";
}

/**
 * Clave de equivalencia de una denominación dentro de su unidad base, la misma que usa el índice
 * único de PostgreSQL (`lower(normalize(denomination, NFKC))` sobre el texto ya normalizado):
 * «De Construcción», «DE CONSTRUCCIÓN» y «ｄｅ construcción» son la misma unidad. Sirve para
 * avisar de duplicados evidentes antes de enviar; el backend sigue decidiendo (409).
 *
 * @param {string} value - Texto de la denominación.
 * @returns {string} Clave comparable.
 */
export function denominationEquivalenceKey(value) {
  return normalizeDenominationText(value).normalize("NFKC").toLowerCase();
}

/**
 * Previsualiza la etiqueta que compondrá la API (`m²` + `de construcción`). Solo es una ayuda
 * visual: la tabla siempre muestra el `label` devuelto por el backend.
 *
 * @param {string} symbol - Abreviatura de la unidad base.
 * @param {string} denomination - Texto escrito.
 * @returns {string} Etiqueta resultante, o cadena vacía si falta alguna parte.
 */
export function previewUnitLabel(symbol, denomination) {
  const text = normalizeDenominationText(denomination);
  return symbol && text ? `${symbol} ${text}` : "";
}

/**
 * Explica por qué una acción no está disponible: una denominación usada por servicios activos
 * no se edita ni se desactiva (regla del backend, 409 MEASUREMENT_UNIT_IN_USE).
 *
 * @param {Object} denomination - Denominación con `activeServiceCount`.
 * @returns {string} Motivo, o cadena vacía si la acción está disponible.
 */
export function getInUseReason(denomination) {
  const count = denomination?.activeServiceCount || 0;
  if (count <= 0) return "";
  return `En uso por ${count} servicio${count === 1 ? "" : "s"} activo${count === 1 ? "" : "s"}`;
}

/**
 * Identifica una unidad de medida con los datos del backend: código público generado («UNID-001»)
 * y nombre compuesto («m² de construcción»). Lo comparten la confirmación de estado y los avisos.
 *
 * @param {{publicCode?: string, label?: string}|null|undefined} denomination - Unidad de la API.
 * @returns {string} «Código · nombre», solo el dato disponible o cadena vacía.
 */
export function formatMeasurementUnitIdentity(denomination) {
  return [denomination?.publicCode, denomination?.label].filter(Boolean).join(" · ");
}

// Motivo visible cuando la abreviatura de una unidad existente está bloqueada en la edición.
export const BASE_UNIT_LOCKED_REASON = "La abreviatura no se puede cambiar porque esta unidad ya se usa en servicios o en su historial.";

/**
 * Indica si la edición puede ofrecer otra unidad base. Solo se habilita con el indicador
 * explícito del backend (`baseUnitEditable`); sin él se bloquea, que es lo seguro.
 *
 * @param {Object|null} denomination - Denominación leída de la API.
 * @returns {boolean} true si el selector de abreviaturas puede habilitarse.
 */
export function canEditBaseUnit(denomination) {
  return denomination?.baseUnitEditable === true;
}

/**
 * Opciones del selector al editar: el catálogo de bases activas y, si la base actual ya no
 * figura en él (inactiva), también la actual al inicio, para conservar el símbolo mostrado.
 *
 * @param {Array<{id: number, code: string, label: string, description: string}>} options - Catálogo activo.
 * @param {{id: number, code: string, symbol: string, name: string}} currentUnit - Base actual.
 * @returns {Array<{id: number, code: string, label: string, description: string}>} Opciones del Input.
 */
export function toEditBaseUnitOptions(options, currentUnit) {
  const catalog = Array.isArray(options) ? options : [];
  if (catalog.some((option) => option.id === currentUnit.id)) return catalog;
  return [{ id: currentUnit.id, code: currentUnit.code, label: currentUnit.symbol, description: currentUnit.name }, ...catalog];
}

/**
 * Convierte las unidades base del API en opciones del selector: el disparador muestra solo la
 * abreviatura (m², m.l., hrs…) y el listado añade el nombre completo para distinguirlas. El
 * `code` estable (`square_meter`) permite aplicar reglas sin depender del símbolo visible.
 *
 * @param {Array<{id: number, code: string, symbol: string, name: string}>} units - Unidades base activas.
 * @returns {Array<{id: number, code: string, label: string, description: string}>} Opciones del Input.
 */
export function toBaseUnitOptions(units) {
  return (Array.isArray(units) ? units : []).map((unit) => ({
    id: unit.id,
    code: unit.code,
    label: unit.symbol,
    description: unit.name,
  }));
}
