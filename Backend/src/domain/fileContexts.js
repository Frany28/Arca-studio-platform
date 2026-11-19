// Catálogo de contextos de archivos existentes (E1, Fase 1.2). Dominio puro: describe dónde vive cada
// tipo de archivo, a qué entidad pertenece, quién lo aporta y con qué nombres se muestra. No consulta
// PostgreSQL ni el almacenamiento y todavía no está conectado a los flujos reales.
//
// Separación de conceptos:
// - Ubicación visible: cadena de entidades identificadas por su nombre (cliente, usuario, proyecto,
//   carpeta…). Nunca se usa un id como etiqueta.
// - Identificadores internos: cada segmento conserva el id que sostiene relaciones y permisos.
// - Clave física: prefijo que usan hoy los constructores de claves; es diagnóstico y nunca concede
//   acceso ni organiza la vista.
// - Permisos: fuera de este módulo. Que una entidad aparezca en la ubicación no da acceso a nada.

/**
 * Congela recursivamente un objeto de catálogo para que ningún consumidor pueda alterarlo.
 * Los catálogos son configuración de dominio y deben ser inmutables en tiempo de ejecución.
 *
 * @param {object} value - Objeto o arreglo a congelar.
 * @returns {object} El mismo valor, congelado en profundidad.
 */
export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

// Entidades que pueden aparecer en una ubicación visible y el dato legible que las nombra.
export const FILE_OWNER_ENTITIES = deepFreeze({
  client: { labelSource: "clients.name", table: "clients" },
  project: { labelSource: "projects.name", table: "projects" },
  project_folder: { labelSource: "project_folders.name", table: "project_folders" },
  project_request: { labelSource: "project_requests.project_name", table: "project_requests" },
  quote: { labelSource: "quotes.code", table: "quotes" },
  support_request: { labelSource: "support_requests.subject", table: "support_requests" },
  user: { labelSource: "users.first_name + users.last_name", table: "users" },
});

// Contextos existentes en el código actual. `ownerChain` define la ubicación visible con entidades
// nombradas; `pendingDecisions` señala lo que este catálogo deliberadamente no fija todavía.
export const FILE_CONTEXTS = deepFreeze({
  profile_photo: {
    bucketRole: "general",
    code: "profile_photo",
    generated: false,
    label: "Foto de perfil",
    ownerChain: ["user"],
    ownerEntity: "user",
    ownership: "personal",
    pendingDecisions: ["A1", "A4"],
    providedBy: ["account_owner"],
    registry: { keyColumn: "profile_photo_url", keyStoredAs: "url", table: "users" },
    storageKeyPrefix: "users",
    uploadPolicy: "avatar",
    versioned: false,
  },
  project_file: {
    bucketRole: "general",
    code: "project_file",
    generated: false,
    label: "Archivo del proyecto",
    ownerChain: ["client", "project", "project_folder"],
    ownerEntity: "project",
    ownership: "project",
    // D5 quedó superada (las subidas del equipo pasan por revisión) y D10 forma parte de DA4. DA2,
    // DA3 y DA5 se resolvieron en B4. Las decisiones del dominio de archivos están en
    // domain/projectFileDecisions.js.
    pendingDecisions: ["A1", "D3", "D4", "DA1", "DA4"],
    providedBy: ["admin", "architect", "client"],
    registry: { keyColumn: "file_versions.file_name", keyStoredAs: "key", ownerColumn: "files.project_id", table: "files" },
    storageKeyPrefix: "projects",
    uploadPolicy: "document",
    versioned: true,
  },
  project_request_attachment: {
    bucketRole: "general",
    code: "project_request_attachment",
    generated: false,
    label: "Adjunto de solicitud",
    ownerChain: ["client", "project_request"],
    ownerEntity: "project_request",
    ownership: "client_request",
    pendingDecisions: ["A1"],
    providedBy: ["client", "admin"],
    registry: { keyColumn: "file_versions.file_name", keyStoredAs: "key", ownerColumn: "files.project_request_id", table: "files" },
    storageKeyPrefix: "project-requests",
    // Al aprobar la solicitud, la misma fila pasa al proyecto (project_id) y conserva su origen en
    // origin_project_request_id; el objeto y su clave no se mueven.
    transfersTo: { context: "project_file", keepsStorageKey: true, originColumn: "files.origin_project_request_id" },
    uploadPolicy: "projectRequest",
    versioned: true,
  },
  quote_pdf: {
    bucketRole: "quotes",
    code: "quote_pdf",
    generated: true,
    label: "PDF de cotización",
    ownerChain: ["client", "quote"],
    ownerEntity: "quote",
    ownership: "generated",
    pendingDecisions: ["A6"],
    providedBy: ["system"],
    registry: { keyColumn: "quote_pdf_documents.object_key", keyStoredAs: "key", table: "quote_pdf_documents" },
    storageKeyPrefix: "quotes",
    uploadPolicy: null,
    versioned: true,
  },
  support_attachment: {
    bucketRole: "general",
    code: "support_attachment",
    generated: false,
    label: "Adjunto de soporte",
    ownerChain: ["user", "support_request"],
    ownerEntity: "support_request",
    ownership: "support",
    pendingDecisions: ["A1", "A2"],
    providedBy: ["support_requester"],
    registry: { keyColumn: "support_request_files.storage_key", keyStoredAs: "key", table: "support_request_files" },
    storageKeyPrefix: "support-requests",
    uploadPolicy: "document",
    versioned: false,
  },
});

/**
 * Devuelve la definición de un contexto de archivos o lanza un error si no existe.
 * Evita que un código mal escrito se trate silenciosamente como un contexto válido.
 *
 * @param {string} code - Código del contexto.
 * @returns {Readonly<object>} Definición del contexto.
 * @throws {Error} UNKNOWN_FILE_CONTEXT si el código no está en el catálogo.
 */
export function getFileContext(code) {
  const context = Object.hasOwn(FILE_CONTEXTS, code) ? FILE_CONTEXTS[code] : null;
  if (!context) throw Object.assign(new Error(`Contexto de archivo desconocido: ${code}`), { code: "UNKNOWN_FILE_CONTEXT" });
  return context;
}

/**
 * Determina el contexto de una fila de `files` con la regla de propiedad vigente (`chk_files_owner`).
 * Un archivo pertenece a un proyecto o a una solicitud, nunca a ambos ni a ninguno.
 *
 * @param {{ project_id?: unknown, project_request_id?: unknown }} row - Fila de `files`.
 * @returns {"project_file"|"project_request_attachment"} Contexto del archivo.
 * @throws {Error} INVALID_FILE_OWNER si la fila no tiene exactamente un propietario.
 */
export function resolveFilesRowContext(row) {
  const hasProject = row?.project_id !== null && row?.project_id !== undefined;
  const hasRequest = row?.project_request_id !== null && row?.project_request_id !== undefined;
  if (hasProject === hasRequest) {
    throw Object.assign(new Error("Un archivo debe pertenecer a un proyecto o a una solicitud, no a ambos ni a ninguno."), { code: "INVALID_FILE_OWNER" });
  }
  return hasProject ? "project_file" : "project_request_attachment";
}

/**
 * Construye la ubicación visible de un archivo con nombres legibles y sus ids internos.
 * Cada segmento usa el nombre de su entidad; si falta, se informa en lugar de mostrar un número.
 *
 * @param {string} contextCode - Código del contexto.
 * @param {Record<string, { id: number|string, name?: string|null, firstName?: string|null,
 *   lastName?: string|null } | Array<{ id: number|string, name?: string|null }>>} entities - Entidades
 *   de la cadena; `project_folder` es la ruta de carpetas desde la raíz (puede estar vacía).
 * @returns {{ segments: Array<{ entity: string, id: string, label: string }>,
 *   missingLabels: Array<{ entity: string, id: string|null }> }} Segmentos y etiquetas ausentes.
 */
export function describeVisibleLocation(contextCode, entities) {
  const context = getFileContext(contextCode);
  const segments = [];
  const missingLabels = [];
  for (const entity of context.ownerChain) {
    const values = entity === "project_folder" ? entities?.project_folder || [] : [entities?.[entity]];
    for (const value of values) {
      const id = value?.id === null || value?.id === undefined ? null : String(value.id);
      const label = readableLabel(entity, value);
      if (!id || !label) {
        missingLabels.push({ entity, id });
        continue;
      }
      segments.push({ entity, id, label });
    }
  }
  return { missingLabels, segments };
}

/**
 * Obtiene el nombre legible de una entidad según su fuente de etiqueta.
 * Nunca usa el id como etiqueta: sin nombre devuelve null para que el llamador lo informe.
 *
 * @param {string} entity - Tipo de entidad.
 * @param {{ name?: string|null, firstName?: string|null, lastName?: string|null }|undefined} value - Entidad.
 * @returns {string|null} Etiqueta o null.
 */
function readableLabel(entity, value) {
  if (!value) return null;
  const raw = entity === "user"
    ? [value.firstName, value.lastName].map((part) => String(part ?? "").trim()).filter(Boolean).join(" ")
    : String(value.name ?? "").trim();
  return raw || null;
}

/**
 * Agrupa entidades del mismo tipo cuyo nombre visible coincide sin distinguir mayúsculas ni espacios.
 * Solo detecta la ambigüedad: el formato para distinguirlas en pantalla depende de la decisión D12.
 *
 * @param {Array<{ id: number|string, label: string }>} items - Entidades con su etiqueta visible.
 * @returns {Array<{ key: string, ids: string[] }>} Grupos con más de una entidad.
 */
export function findAmbiguousLabels(items) {
  const groups = new Map();
  for (const item of items) {
    const key = String(item.label ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), String(item.id)]);
  }
  return [...groups].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ ids, key }));
}
