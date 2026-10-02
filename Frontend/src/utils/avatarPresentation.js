const INTERNAL_ROLE_CODES = new Set([
  "admin",
  "architect",
  "employee",
  "staff",
  "collaborator",
]);

const CLIENT_FALLBACK_THEMES = ["Brand 1", "Neutral"];

function normalizeRoleCode(value) {
  return String(value || "").trim().toLocaleLowerCase("en");
}

/**
 * Obtiene dos letras del único nombre o las iniciales del primero y el último.
 * Normaliza espacios, convierte a mayúsculas y devuelve vacío si no hay nombre.
 *
 * @param {string|null} name - Nombre visible.
 * @returns {string} Iniciales para el avatar.
 */
export function getAvatarInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

/**
 * Asigna un tema de cliente reproducible mediante un hash de la identidad.
 * Usa cliente como identidad alternativa y limita el índice al catálogo de temas.
 *
 * @param {string|number|null} identity - Identidad usada para estabilizar el color.
 * @returns {number} Índice del tema.
 */
function getStableThemeIndex(identity) {
  const value = String(identity || "cliente");
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  }

  return hash % CLIENT_FALLBACK_THEMES.length;
}

/**
 * Resuelve contenido y tema del avatar sin cargar ni validar la URL de imagen.
 * La imagen tiene prioridad; usuarios internos sin imagen usan iniciales si existen.
 * El resto usa icono y un tema estable por identidad o nombre; internos usan Neutral.
 *
 * @param {Object} [params={}] - Datos de presentación.
 * @param {string|number|null} [params.identity] - Identidad para el tema estable.
 * @param {string|null} [params.name] - Nombre para iniciales.
 * @param {string|null} [params.roleCode] - Rol normalizado para reconocer personal interno.
 * @param {string|null} [params.src] - URL de imagen, recortada antes de usarla.
 * @returns {Object} content, initials, src y theme para el avatar.
 */
export function getAvatarPresentation({
  identity,
  name,
  roleCode,
  src,
} = {}) {
  const imageSrc = String(src || "").trim();
  const initials = getAvatarInitials(name);
  const isInternalUser = INTERNAL_ROLE_CODES.has(normalizeRoleCode(roleCode));

  if (imageSrc) {
    return {
      content: "Image",
      initials,
      src: imageSrc,
      theme: isInternalUser
        ? "Neutral"
        : CLIENT_FALLBACK_THEMES[getStableThemeIndex(identity || name)],
    };
  }

  if (isInternalUser && initials) {
    return {
      content: "Text",
      initials,
      src: "",
      theme: "Neutral",
    };
  }

  return {
    content: "Icon",
    initials: "",
    src: "",
    theme: CLIENT_FALLBACK_THEMES[getStableThemeIndex(identity || name)],
  };
}
