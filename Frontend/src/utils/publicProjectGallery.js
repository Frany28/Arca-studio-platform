import { getProjectTypeDisplay } from "./projectTypeDisplay.js";

/**
 * Normaliza texto de búsqueda sin diacríticos, en minúsculas y sin espacios externos.
 * No modifica los espacios internos ni elimina signos de puntuación.
 *
 * @param {string|null} value - Texto candidato.
 * @returns {string} Texto para comparación.
 */
export function normalizeProjectSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Determina pertenencia visual para clientes y arquitectos comparando IDs numéricos.
 * Clientes usan clientId; arquitectos usan responsable principal o listas de asignados.
 * Otros roles devuelven false; no representa una autorización de acceso.
 *
 * @param {Object|null} project - Proyecto con cliente y responsables.
 * @param {Object|null} user - Usuario con rol e identificadores.
 * @returns {boolean|undefined} Pertenencia; puede ser undefined para arquitectos sin listas ni coincidencia principal.
 */
export function isOwnProject(project, user) {
  const role = user?.role || user?.roleDetails?.code;

  if (role === "client") {
    return Number(project?.client?.id) === Number(user?.clientId);
  }

  if (role === "architect") {
    return (
      Number(project?.assignedArchitect?.id) === Number(user?.id) ||
      (project?.assignees || project?.assignedArchitects)?.some(
        (assignee) => Number(assignee?.id) === Number(user?.id),
      )
    );
  }

  return false;
}

/**
 * Selecciona proyectos marcados isPublic excluyendo los propios del usuario.
 * Normaliza entradas no array a []; no solicita ni autoriza datos de la API.
 *
 * @param {Array|null} projects - Proyectos candidatos.
 * @param {Object|null} user - Usuario para determinar pertenencia.
 * @returns {Array} Proyectos para la galería pública.
 */
export function getPublicGalleryProjects(projects, user) {
  return (Array.isArray(projects) ? projects : []).filter(
    (project) => project?.isPublic && !isOwnProject(project, user),
  );
}

function getProjectYear(project) {
  const date = project?.startDate || project?.createdAt;
  const year = date ? new Date(date).getFullYear() : null;
  return Number.isFinite(year) ? String(year) : "";
}

/**
 * Filtra por coincidencia textual normalizada en título, tipo, responsables y año.
 * El año usa startDate o createdAt; una consulta vacía devuelve el array recibido
 * o [] si no es un array. Con consulta no vacía espera una colección válida.
 *
 * @param {Array} projects - Proyectos previamente seleccionados para la galería.
 * @param {string|null} query - Búsqueda sin distinguir acentos ni mayúsculas.
 * @returns {Array} Proyectos coincidentes.
 */
export function filterPublicProjects(projects, query) {
  const normalizedQuery = normalizeProjectSearch(query);
  if (!normalizedQuery) return Array.isArray(projects) ? projects : [];

  return projects.filter((project) => {
    const searchable = [
      project?.name,
      project?.title,
      getProjectTypeDisplay(project?.projectType),
      project?.assignedArchitect?.name,
      ...(project?.assignees || project?.assignedArchitects || []).map(
        (assignee) => assignee?.name,
      ),
      getProjectYear(project),
    ]
      .map(normalizeProjectSearch)
      .join(" ");

    return searchable.includes(normalizedQuery);
  });
}

function getProjectTimestamp(project) {
  const value = project?.updatedAt || project?.createdAt;
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Ordena una copia por updatedAt o createdAt y desempata por ID numérico.
 * Fechas ausentes o inválidas usan cero; únicamente asc invierte el orden descendente.
 *
 * @param {Array|null} projects - Colección candidata.
 * @param {string} [direction="desc"] - asc para ascendente; cualquier otro valor para descendente.
 * @returns {Array} Copia ordenada.
 */
export function sortPublicProjects(projects, direction = "desc") {
  const multiplier = direction === "asc" ? 1 : -1;

  return [...(Array.isArray(projects) ? projects : [])].sort(
    (left, right) =>
      (getProjectTimestamp(left) - getProjectTimestamp(right)) * multiplier ||
      (Number(left?.id) - Number(right?.id)) * multiplier,
  );
}

