/**
 * Genera un slug ASCII sin diacríticos, en minúsculas y separado por guiones.
 * Usa proyecto si el valor inicial o el resultado normalizado está vacío.
 *
 * @param {string|number|null} value - Nombre o referencia del proyecto.
 * @returns {string} Slug normalizado.
 */
export function slugifyProjectName(value) {
  const normalized = String(value || "proyecto")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "proyecto";
}

/**
 * Prioriza publicSlug recortado, conservando su escritura original.
 * Sin slug público normaliza name, title o id, en ese orden, con fallback proyecto.
 *
 * @param {Object|null} project - Proyecto con referencias de identificación.
 * @returns {string} Slug para navegación.
 */
export function getProjectSlug(project) {
  return (
    String(project?.publicSlug || "").trim() ||
    slugifyProjectName(project?.name || project?.title || project?.id)
  );
}

/**
 * Construye la ruta por slug y añade la consulta opcional.
 * Retira solo el signo de interrogación inicial; no codifica ni valida el search recibido.
 *
 * @param {Object|null} project - Proyecto usado para resolver el slug.
 * @param {string} [search=""] - Consulta serializada, con o sin interrogación inicial.
 * @returns {string} Ruta /proyectos con consulta opcional.
 */
export function getProjectPath(project, search = "") {
  const slug = getProjectSlug(project);
  const query = String(search || "").replace(/^\?/, "");

  return `/proyectos/${slug}${query ? `?${query}` : ""}`;
}

/**
 * Busca la primera coincidencia de slug dentro de una colección de proyectos.
 * Normaliza a minúsculas el destino, pero compara con getProjectSlug sin normalizarlo
 * de nuevo; no busca directamente por ID salvo que este origine el slug.
 *
 * @param {Array} projects - Proyectos candidatos.
 * @param {string|null} slug - Destino recibido de navegación.
 * @returns {Object|undefined} Proyecto coincidente o undefined.
 */
export function findProjectBySlug(projects, slug) {
  const normalizedSlug = String(slug || "").trim().toLowerCase();

  return projects.find((project) => getProjectSlug(project) === normalizedSlug);
}
