// Presentación del administrador de archivos (Figma 3727:682730). Funciones puras: pestañas,
// árbol de carpetas, formatos y reglas de carpetas tal como las aplica el backend (B7). Las reglas
// solo anticipan lo que la API rechazaría: el backend sigue siendo la autoridad.

export const ADMIN_FILES_TABS = Object.freeze([
  { id: "approved", label: "Aprobados" },
  { id: "pending", label: "Pendientes por aprobación" },
  { id: "rejected", label: "Rechazados" },
]);

// Formatos que la plataforma sirve (Backend/src/utils/fileResponseSecurity.js): el filtro «Tipo».
export const ADMIN_FILES_TYPE_OPTIONS = Object.freeze([
  { id: "pdf", label: "PDF" },
  { id: "png", label: "PNG" },
  { id: "jpg", label: "JPG" },
  { id: "jpeg", label: "JPEG" },
  { id: "webp", label: "WEBP" },
  { id: "mp4", label: "MP4" },
  { id: "docx", label: "DOCX" },
  { id: "xlsx", label: "XLSX" },
]);

// Carpeta predeterminada que no admite subcarpetas (una sola imagen de portada).
const COVER_FOLDER_KEY = "cover";
// «Documentos › Cotizaciones» (Backend/src/domain/projectFolderCatalog.js): carpeta gestionada por
// Cotizaciones. Muestra sus PDF generados; no admite archivos manuales ni subcarpetas.
export const QUOTES_FOLDER_KEY = "documents.quotes";
// Mensajes de las reglas confirmadas y pendientes de carpetas (domain/projectFolderCatalog.js).
export const FOLDER_RULE_MESSAGES = Object.freeze({
  coverNoSubfolders: "La portada admite una sola imagen: no admite subcarpetas.",
  quotesManaged: "Cotizaciones genera el contenido de esta carpeta: no admite subcarpetas ni archivos manuales.",
  rootUndecided: "Crear carpetas en la raíz del proyecto está pendiente de decisión. Selecciona una carpeta.",
  selectFolder: "Selecciona una carpeta del árbol para crear una subcarpeta.",
  systemProtected: "Las carpetas predeterminadas no se pueden renombrar ni eliminar.",
});

/**
 * Indica si un error de la API corresponde a la activación apagada: las rutas del administrador
 * de archivos responden 404 API_ROUTE_NOT_FOUND antes de autenticar.
 *
 * @param {unknown} error - Error de apiRequest.
 * @returns {boolean} true si el administrador no está disponible en este entorno.
 */
export function isFileManagerUnavailable(error) {
  return error?.status === 404 && error?.code === "API_ROUTE_NOT_FOUND";
}

/**
 * Convierte la lista plana de carpetas (preorden de la API) en un árbol anidado, conservando el
 * orden recibido. Una carpeta cuya madre no llega se trata como raíz para no perderla.
 *
 * @param {Array<{id: number, parentId: number|null}>} folders - Carpetas del proyecto.
 * @returns {Array<Object>} Nodos raíz con `children`.
 */
export function buildFolderTree(folders) {
  const nodes = new Map((folders || []).map((folder) => [folder.id, { ...folder, children: [] }]));
  const roots = [];
  for (const folder of folders || []) {
    const node = nodes.get(folder.id);
    const parent = folder.parentId === null || folder.parentId === undefined ? null : nodes.get(folder.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Indica qué se puede hacer con una carpeta según las reglas confirmadas: crear subcarpetas en
 * cualquiera salvo la portada y Cotizaciones; renombrar y retirar solo las personalizadas (retirar exige que estén
 * vacías y lo comprueba el backend).
 *
 * @param {{ systemKey: string|null }|null} folder - Carpeta seleccionada (null: raíz o ninguna).
 * @returns {{ canCreateChild: boolean, createReason: string, canManage: boolean }} Permisos.
 */
export function getFolderCapabilities(folder) {
  if (!folder) return { canCreateChild: false, canManage: false, createReason: FOLDER_RULE_MESSAGES.selectFolder };
  if (folder.systemKey === COVER_FOLDER_KEY) {
    return { canCreateChild: false, canManage: false, createReason: FOLDER_RULE_MESSAGES.coverNoSubfolders };
  }
  if (folder.systemKey === QUOTES_FOLDER_KEY) {
    return { canCreateChild: false, canManage: false, createReason: FOLDER_RULE_MESSAGES.quotesManaged };
  }
  return { canCreateChild: true, canManage: !folder.systemKey, createReason: "" };
}

/**
 * Presenta la extensión de una versión como en Figma (`.PDF`).
 *
 * @param {string|null} extension - Extensión de la API.
 * @returns {string} Etiqueta o «—».
 */
export function formatExtension(extension) {
  const value = String(extension || "").trim().replace(/^\./, "");
  return value ? `.${value.toUpperCase()}` : "—";
}

/**
 * Fecha de carga de una versión en español («22 mar 2026»), en la zona del navegador.
 *
 * @param {string|null} value - Fecha ISO.
 * @returns {string} Fecha o «Sin fecha».
 */
export function formatFileDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-VE", { day: "numeric", month: "short", year: "numeric" }).format(date).replace(/\./g, "");
}

/**
 * Ruta legible de una carpeta encontrada por la búsqueda: proyecto › carpetas.
 *
 * @param {{ project: { name: string }, path: Array<{ name: string }> }} folder - Resultado de búsqueda.
 * @returns {string} Ruta.
 */
export function formatFolderPath(folder) {
  return [folder.project?.name, ...(folder.path || []).map((segment) => segment.name)].filter(Boolean).join(" › ");
}

/**
 * Textos del estado vacío de una pestaña, según si hay búsqueda o filtros aplicados.
 *
 * @param {"approved"|"pending"|"rejected"} tab - Pestaña.
 * @param {boolean} filtered - Hay búsqueda, tipo o ámbito aplicados.
 * @returns {{ title: string, description: string }} Textos.
 */
export function getItemsEmptyCopy(tab, filtered) {
  if (filtered) return { description: "Prueba con otro nombre, otro tipo u otra carpeta.", title: "No hay coincidencias" };
  if (tab === "pending") return { description: "Las versiones que esperan revisión aparecerán aquí.", title: "No hay archivos pendientes" };
  if (tab === "rejected") return { description: "Las versiones rechazadas se conservan y aparecerán aquí con su motivo.", title: "No hay archivos rechazados" };
  return { description: "Los archivos aprobados de los proyectos aparecerán aquí.", title: "Aún no hay archivos aprobados" };
}

// Estados de proyecto que no admiten archivos nuevos (el administrador sí prepara un borrador).
const UPLOAD_READ_ONLY_STATUSES = Object.freeze({ archived: "El proyecto está archivado: no admite archivos nuevos.", finished: "El proyecto está finalizado: no admite archivos nuevos." });

/**
 * Motivo por el que «+ Nuevo» no puede subir a la selección del árbol, o cadena vacía si puede.
 * Los archivos se suben dentro de una carpeta (crear archivos en la raíz no se ofrece); la portada
 * admite una sola imagen, que se reemplaza. El backend vuelve a comprobar cada regla.
 *
 * @param {{ status?: string }|null} project - Proyecto seleccionado.
 * @param {{ systemKey?: string|null, fileCount?: number }|null} folder - Carpeta seleccionada.
 * @returns {string} Motivo o "".
 */
export function getUploadDisabledReason(project, folder) {
  if (!project) return "Selecciona una carpeta del árbol para subir archivos.";
  if (UPLOAD_READ_ONLY_STATUSES[project.status]) return UPLOAD_READ_ONLY_STATUSES[project.status];
  if (!folder) return "Los archivos se suben dentro de una carpeta: selecciona una.";
  if (folder.systemKey === "cover" && Number(folder.fileCount) >= 1) return "La portada ya tiene su imagen: usa «Reemplazar archivo».";
  if (folder.systemKey === QUOTES_FOLDER_KEY) return "Las cotizaciones se generan desde Cotizaciones al guardar cada una.";
  return "";
}
