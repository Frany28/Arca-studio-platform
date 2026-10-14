// Proyección pública de proyectos (hallazgo P-1).
//
// Un proyecto con is_public = true puede leerlo cualquier usuario autenticado,
// pero quien no tiene acceso directo (cliente propietario, arquitecto asignado o
// administrador) solo debe recibir el contenido de vitrina. Se usa una lista de
// campos permitidos: cualquier campo nuevo de Project queda privado hasta que se
// añada aquí expresamente.
//
// Se excluyen: presupuesto, identidad del cliente, creador, fecha de fin,
// planos, dirección exacta, coordenadas, identificador de lugar, requisitos,
// especificaciones técnicas, documentos recientes y metadatos de archivo que
// puedan identificar a personas o inmuebles (título original, descripción y
// autor de la carga).

const PUBLIC_PROJECT_FIELDS = [
  "areaUnit",
  "assignedArchitect",
  "assignedArchitects",
  "assignees",
  "city",
  "constructionArea",
  "country",
  "createdAt",
  "description",
  "generalArea",
  "hasImage",
  "id",
  "imageFileId",
  "imageFileVersionId",
  "isPublic",
  "name",
  "progress",
  "projectType",
  "publicSlug",
  "startDate",
  "state",
  "status",
  "updatedAt",
];

const PUBLIC_FILE_LABELS = { image: "Imagen", video: "Video" };

/**
 * Construye una ubicación general a partir de ciudad, estado y país.
 * Omite los componentes ausentes y nunca usa la dirección exacta, las coordenadas ni el lugar del proveedor.
 *
 * @param {{ city?: string|null, state?: string|null, country?: string|null }} project - Proyecto completo.
 * @returns {string|null} Ubicación general, o null si no hay datos geográficos generales.
 */
export function toGeneralLocation(project) {
  const parts = [project?.city, project?.state, project?.country]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Etiqueta genérica de un archivo de vitrina según su tipo MIME.
 * Sustituye al título original, que puede contener nombres de personas o direcciones.
 *
 * @param {string|null} fileType - Tipo MIME del archivo.
 * @param {number|string} id - Identificador del archivo, ya conocido por el usuario.
 * @returns {string} Etiqueta como "Imagen 12" o "Video 7".
 */
function getShowcaseLabel(fileType, id) {
  const kind = String(fileType || "").split("/")[0];
  return `${PUBLIC_FILE_LABELS[kind] || "Archivo"} ${id}`;
}

/**
 * Nombre de descarga genérico para un archivo de vitrina (cabecera Content-Disposition).
 * Conserva solo la extensión saneada, para que la descarga no revele el nombre original.
 *
 * @param {{ extension?: string|null, fileType?: string|null, id: number|string }} file - Datos mínimos del archivo.
 * @returns {string} Nombre como "imagen-12.png".
 */
export function getShowcaseFileName({ extension, fileType, id }) {
  const base = getShowcaseLabel(fileType, id).toLowerCase().replace(/\s+/g, "-");
  const safeExtension = String(extension || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return safeExtension ? `${base}.${safeExtension}` : base;
}

/**
 * Reduce un archivo de vitrina a metadatos que no identifican personas ni inmuebles.
 * Sustituye el título original por una etiqueta genérica y elimina descripción y autor de la carga.
 *
 * @param {object} file - Archivo en formato público de la API (ProjectFile).
 * @returns {object} Archivo apto para usuarios sin acceso directo.
 */
export function toShowcaseProjectFile(file) {
  return {
    ...file,
    description: null,
    title: getShowcaseLabel(file.fileType, file.id),
    uploadedBy: null,
  };
}

/**
 * Proyecta un proyecto completo a la vista autorizada para usuarios sin acceso directo.
 * Conserva solo los campos de vitrina, sustituye la ubicación por la general y, en el detalle,
 * vacía requisitos, especificaciones y documentos recientes y neutraliza los metadatos de archivo.
 *
 * @param {object} project - Proyecto completo (Project o ProjectDetail).
 * @returns {object} Proyecto con únicamente la información pública autorizada.
 */
export function toPublicProjectView(project) {
  const view = Object.fromEntries(
    PUBLIC_PROJECT_FIELDS.filter((field) => field in project).map((field) => [field, project[field]]),
  );
  view.location = toGeneralLocation(project);

  if (Array.isArray(project.files)) {
    view.files = project.files.map(toShowcaseProjectFile);
    view.filesNextCursor = project.filesNextCursor ?? null;
    view.recentDocuments = [];
    view.requirements = [];
    view.technicalSpecifications = [];
  }

  return view;
}
