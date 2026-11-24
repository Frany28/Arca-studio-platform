import { deepFreeze } from "./fileContexts.js";

// Catálogo de carpetas predeterminadas de un proyecto (Fase 1.2). Dominio puro: la creación
// idempotente (`projectSystemFolderRepository`) lo usa en las tres altas de proyectos draft.
//
// Fuentes: Figma 3727:618978 y 3727:682730 (árbol, nombres, orden y aviso de la portada) y las reglas
// confirmadas de la fase:
// - claves funcionales estables: la clave clasifica y nunca cambia, aunque cambie el nombre visible
//   (`renders.models` se muestra como «Panorámicas» y contiene imágenes de 360°);
// - las carpetas predeterminadas no se renombran, eliminan ni mueven;
// - se pueden crear carpetas personalizadas dentro de otras, salvo en la portada;
// - los documentos de garantías se guardan en «Documentos › Garantías» (`documents.warranties`);
// - los PDF de cotizaciones se muestran en «Documentos › Cotizaciones» (`documents.quotes`), carpeta
//   gestionada por su módulo (Fase de archivística: Cotizaciones, Actas, Planos y Documentos adicionales).
// Las reglas que dependen de una decisión abierta se devuelven como `pending_decision` con su
// identificador, nunca con un valor supuesto.

export const FOLDER_NAME_MAX_LENGTH = 120;
export const SYSTEM_FOLDER_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
export const WARRANTY_DOCUMENTS_FOLDER_KEY = "documents.warranties";
// «Documentos › Cotizaciones»: ubicación lógica de los PDF generados por Cotizaciones. El PDF sigue
// en su bucket privado y en quote_pdf_documents; la carpeta solo los agrupa en el administrador.
export const QUOTE_DOCUMENTS_FOLDER_KEY = "documents.quotes";

// Decisiones abiertas que afectan a este catálogo. Ver Backend/ARCHITECTURE.md (Fase 1.2).
// Resueltas: D1 (garantías en documents.warranties), D6 («Panorámicas», imágenes de 360°), la parte
// de D13 sobre crear carpetas personalizadas dentro de las predeterminadas, D7 (se admiten carpetas
// personalizadas en la raíz del proyecto) y D14 (cualquier carpeta, también las agrupadoras y
// «Cotizaciones», admite subcarpetas y archivos de cualquier formato aceptado por la subida; la
// portada conserva su regla de Figma: una sola imagen JPG o PNG y sin subcarpetas).
export const FOLDER_PENDING_DECISIONS = deepFreeze({
  D2: "«Antes»: fase o clasificación de su contenido (render en fase inicial o imagen de referencia).",
  D13: "Mover carpetas personalizadas a otra ubicación.",
});

// Profundidad máxima de una carpeta (la raíz del proyecto es 0 y sus carpetas, 1). Evita árboles
// patológicos; el catálogo llega a 4 niveles.
export const MAX_FOLDER_DEPTH = 12;

// Árbol confirmado, en su orden visual. `section` es la sección funcional del proyecto a la que
// pertenece la carpeta y `stage`, la fase que indica su nombre. Ambos son identificadores estables:
// `models_3d` se conserva como sección de «Panorámicas». Los valores nulos con `pendingDecisions` no
// se han asignado a propósito.
export const PROJECT_SYSTEM_FOLDERS = deepFreeze([
  {
    key: "cover",
    name: "Portada del proyecto",
    parentKey: null,
    section: "cover",
    stage: null,
    // Figma: «Esta carpeta admite una sola imagen. Una vez cargada, no podrás agregar imágenes
    // adicionales; únicamente podrás reemplazar la existente. Se aceptan exclusivamente archivos en
    // formato JPG o PNG.»
    content: { acceptedExtensions: ["jpeg", "jpg", "png"], allowsSubfolders: false, maxFiles: 1, replaceOnly: true },
    pendingDecisions: [],
  },
  { key: "renders", name: "Renders e imágenes", parentKey: null, section: "renders", stage: null, content: null, pendingDecisions: [] },
  // Clave conservada de «Modelos 3D»: la sección se llama «Panorámicas» y contiene imágenes de 360°.
  { key: "renders.models", name: "Panorámicas", parentKey: "renders", section: "models_3d", stage: null, content: null, pendingDecisions: [] },
  { key: "renders.models.initial_proposal", name: "Propuesta inicial", parentKey: "renders.models", section: "models_3d", stage: "initial_proposal", content: null, pendingDecisions: [] },
  { key: "renders.models.final_proposal", name: "Propuesta final", parentKey: "renders.models", section: "models_3d", stage: "final_proposal", content: null, pendingDecisions: [] },
  { key: "renders.images", name: "Imágenes", parentKey: "renders", section: "images", stage: null, content: null, pendingDecisions: [] },
  { key: "renders.images.initial_proposal", name: "Propuesta inicial", parentKey: "renders.images", section: "images", stage: "initial_proposal", content: null, pendingDecisions: [] },
  { key: "renders.images.initial_proposal.before", name: "Antes", parentKey: "renders.images.initial_proposal", section: "images", stage: null, content: null, pendingDecisions: ["D2"] },
  { key: "renders.images.execution", name: "Ejecución", parentKey: "renders.images", section: "images", stage: "execution", content: null, pendingDecisions: [] },
  { key: "renders.images.final_result", name: "Resultado final", parentKey: "renders.images", section: "images", stage: "final_result", content: null, pendingDecisions: [] },
  { key: "renders.videos", name: "Videos", parentKey: "renders", section: "videos", stage: null, content: null, pendingDecisions: [] },
  { key: "renders.videos.initial_proposal", name: "Propuesta inicial", parentKey: "renders.videos", section: "videos", stage: "initial_proposal", content: null, pendingDecisions: [] },
  { key: "renders.videos.execution", name: "Ejecución", parentKey: "renders.videos", section: "videos", stage: "execution", content: null, pendingDecisions: [] },
  { key: "renders.videos.final_result", name: "Resultado final", parentKey: "renders.videos", section: "videos", stage: "final_result", content: null, pendingDecisions: [] },
  { key: "documents", name: "Documentos", parentKey: null, section: "documents", stage: null, content: null, pendingDecisions: [] },
  // Cotizaciones: muestra los PDF generados por su módulo (versión comercial vigente, con su
  // historial) sin copiarlos. Esos documentos son virtuales (no tienen fila en `files`), así que no se
  // pueden reemplazar ni mover desde aquí; la carpeta admite además subcarpetas y archivos manuales,
  // que tienen identidad y versiones propias. `generatedBy` identifica al módulo que la alimenta.
  {
    key: QUOTE_DOCUMENTS_FOLDER_KEY,
    name: "Cotizaciones",
    parentKey: "documents",
    section: "quotes",
    stage: null,
    content: null,
    generatedBy: "quotes",
    pendingDecisions: [],
  },
  { key: "documents.initial_proposal", name: "Propuesta inicial", parentKey: "documents", section: "documents", stage: "initial_proposal", content: null, pendingDecisions: [] },
  // Actas (de inicio, de entrega, de reunión...) y planos técnicos: categorías documentales propias.
  // Se clasifican al subirlos eligiendo la carpeta; nunca se deducen de la extensión (un PDF puede ser
  // cualquiera de ellas).
  { key: "documents.records", name: "Actas", parentKey: "documents", section: "records", stage: null, content: null, pendingDecisions: [] },
  { key: "documents.plans", name: "Planos", parentKey: "documents", section: "plans", stage: null, content: null, pendingDecisions: [] },
  // Documentos de garantías: se guardan aquí y se vinculan a garantías del mismo proyecto
  // (domain/projectWarrantyDocuments.js). Admiten cualquier formato aceptado por la subida.
  { key: WARRANTY_DOCUMENTS_FOLDER_KEY, name: "Garantías", parentKey: "documents", section: "warranties", stage: null, content: null, pendingDecisions: [] },
  // Documentos que no pertenecen a otra categoría documental, elegidos expresamente por el usuario.
  { key: "documents.additional", name: "Documentos adicionales", parentKey: "documents", section: "documents", stage: null, content: null, pendingDecisions: [] },
  // Los adjuntos de la solicitud de origen se reconocen hoy como «Archivos del cliente»
  // (origin_project_request_id) y los archivos adicionales que sube el cliente; admite además
  // subcarpetas y archivos del equipo.
  { key: "client_files", name: "Archivos del cliente", parentKey: null, section: "client_files", stage: null, content: null, pendingDecisions: [] },
]);

const FOLDERS_BY_KEY = new Map(PROJECT_SYSTEM_FOLDERS.map((folder) => [folder.key, folder]));
const CATALOG_POSITION = new Map(PROJECT_SYSTEM_FOLDERS.map((folder, index) => [folder.key, index]));

/**
 * Compara dos carpetas hermanas para mostrarlas en un orden determinista.
 * Primero las predeterminadas en el orden del catálogo, después las de claves retiradas por clave
 * y al final las personalizadas por nombre normalizado; el id desempata en todos los casos.
 *
 * @param {{ id: number, name: string, systemKey: string|null }} left - Primera carpeta.
 * @param {{ id: number, name: string, systemKey: string|null }} right - Segunda carpeta.
 * @returns {number} Negativo, cero o positivo, como `Array.prototype.sort`.
 */
export function compareSiblingFolders(left, right) {
  /**
   * Clasifica una carpeta en su grupo de orden entre hermanas.
   * 0: predeterminada del catálogo; 1: clave retirada del catálogo; 2: personalizada.
   *
   * @param {{ systemKey: string|null }} folder - Carpeta.
   * @returns {0|1|2} Grupo de orden.
   */
  const rank = (folder) => (CATALOG_POSITION.has(folder.systemKey) ? 0 : folder.systemKey ? 1 : 2);
  const byRank = rank(left) - rank(right);
  if (byRank !== 0) return byRank;
  if (rank(left) === 0) return CATALOG_POSITION.get(left.systemKey) - CATALOG_POSITION.get(right.systemKey);
  // Comparación por puntos de código: independiente de la intercalación de PostgreSQL y de la región.
  const leftKey = rank(left) === 1 ? left.systemKey : folderNameKey(left.name);
  const rightKey = rank(right) === 1 ? right.systemKey : folderNameKey(right.name);
  if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
  return Number(left.id) - Number(right.id);
}

/**
 * Ordena una lista plana de carpetas como el recorrido en preorden de su árbol.
 * Cada carpeta precede a sus descendientes y las hermanas siguen `compareSiblingFolders`; las
 * carpetas cuya madre no está en la lista se tratan como raíces para no perder ninguna.
 *
 * @param {Array<{ id: number, parentId: number|null, name: string, systemKey: string|null }>} folders -
 *   Carpetas vigentes de un proyecto.
 * @returns {Array<object>} Las mismas carpetas, en orden de presentación.
 */
export function orderFolderTree(folders) {
  const ids = new Set(folders.map((folder) => Number(folder.id)));
  const children = new Map();
  const roots = [];
  for (const folder of folders) {
    const parentId = folder.parentId === null || folder.parentId === undefined ? null : Number(folder.parentId);
    if (parentId === null || !ids.has(parentId)) roots.push(folder);
    else children.set(parentId, [...(children.get(parentId) || []), folder]);
  }
  const ordered = [];
  const visited = new Set();
  const stack = roots.sort(compareSiblingFolders).reverse();
  while (stack.length) {
    const folder = stack.pop();
    if (visited.has(Number(folder.id))) continue;
    visited.add(Number(folder.id));
    ordered.push(folder);
    stack.push(...(children.get(Number(folder.id)) || []).sort(compareSiblingFolders).reverse());
  }
  // Un ciclo de madres (que PostgreSQL no impide) no debe ocultar carpetas: se añaden al final.
  ordered.push(...folders.filter((folder) => !visited.has(Number(folder.id))).sort(compareSiblingFolders));
  return ordered;
}

/**
 * Devuelve la definición de una carpeta predeterminada por su clave funcional estable.
 * La clave, y no el nombre visible, identifica la carpeta en cualquier regla.
 *
 * @param {string} key - Clave funcional (`renders.images.execution`).
 * @returns {Readonly<object>|null} Definición o null si no es una carpeta predeterminada.
 */
export function getSystemFolder(key) {
  return FOLDERS_BY_KEY.get(key) ?? null;
}

/**
 * Devuelve el nombre visible de una carpeta guardada. Para una carpeta predeterminada del catálogo
 * usa el nombre vigente del catálogo, así un cambio de nombre (p. ej. «Panorámicas») llega también a
 * los proyectos que guardaron el anterior; las demás conservan su nombre guardado.
 *
 * @param {{ name: string, systemKey: string|null }} folder - Carpeta guardada.
 * @returns {string} Nombre que se muestra.
 */
export function resolveFolderDisplayName(folder) {
  return getSystemFolder(folder?.systemKey)?.name ?? folder?.name ?? "";
}

/**
 * Normaliza un nombre de carpeta para compararlo con sus hermanas.
 * Reproduce la regla de `uq_project_folders_sibling_name` (lower(btrim(name))) sobre nombres ya recortados.
 *
 * @param {string} name - Nombre visible.
 * @returns {string} Clave de comparación.
 */
export function folderNameKey(name) {
  return String(name ?? "").trim().toLowerCase();
}

/**
 * Comprueba la coherencia interna de un catálogo de carpetas predeterminadas.
 * Verifica formato y unicidad de claves, padres existentes y previos, claves derivadas del padre,
 * nombres válidos y únicos entre hermanas, y la ausencia de ciclos.
 *
 * @param {ReadonlyArray<object>} [catalog] - Catálogo a validar; por defecto, el oficial.
 * @returns {string[]} Errores encontrados; vacío si el catálogo es coherente.
 */
export function validateSystemFolderCatalog(catalog = PROJECT_SYSTEM_FOLDERS) {
  const errors = [];
  const seen = new Map();
  const siblingNames = new Map();
  for (const folder of catalog) {
    if (!SYSTEM_FOLDER_KEY_PATTERN.test(folder.key)) errors.push(`clave inválida: ${folder.key}`);
    if (seen.has(folder.key)) errors.push(`clave duplicada: ${folder.key}`);
    if (folder.parentKey !== null) {
      if (!seen.has(folder.parentKey)) errors.push(`padre ausente o posterior: ${folder.key} → ${folder.parentKey}`);
      if (!folder.key.startsWith(`${folder.parentKey}.`) || folder.key.split(".").length !== folder.parentKey.split(".").length + 1) {
        errors.push(`la clave no deriva de su padre: ${folder.key}`);
      }
      if (seen.get(folder.parentKey)?.content?.allowsSubfolders === false) errors.push(`el padre no admite subcarpetas: ${folder.key}`);
    } else if (folder.key.includes(".")) {
      errors.push(`carpeta raíz con clave compuesta: ${folder.key}`);
    }
    const nameError = describeFolderNameError(folder.name);
    if (nameError) errors.push(`nombre inválido en ${folder.key}: ${nameError}`);
    const siblingKey = `${folder.parentKey ?? ""}\n${folderNameKey(folder.name)}`;
    if (siblingNames.has(siblingKey)) errors.push(`nombre repetido entre hermanas: ${folder.key} y ${siblingNames.get(siblingKey)}`);
    siblingNames.set(siblingKey, folder.key);
    seen.set(folder.key, folder);
  }
  return errors;
}

/**
 * Lista las carpetas predeterminadas en un orden en que cada padre precede a sus hijas.
 * Es el orden que usa la creación idempotente de carpetas en las altas de proyectos.
 *
 * @returns {ReadonlyArray<object>} Carpetas ordenadas por profundidad y luego por orden de Figma.
 */
export function systemFolderCreationOrder() {
  return [...PROJECT_SYSTEM_FOLDERS]
    .map((folder, index) => ({ depth: folder.key.split(".").length, folder, index }))
    .sort((left, right) => left.depth - right.depth || left.index - right.index)
    .map(({ folder }) => folder);
}

/**
 * Describe por qué un nombre de carpeta no es válido con las reglas vigentes de la API.
 * Igual que `projectFolderCreateSchema`: recortado, entre 1 y 120 caracteres.
 *
 * @param {unknown} name - Nombre propuesto.
 * @returns {"empty"|"too_long"|null} Motivo o null si es válido.
 */
export function describeFolderNameError(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "empty";
  if (trimmed.length > FOLDER_NAME_MAX_LENGTH) return "too_long";
  return null;
}

/**
 * Valida el nombre de una carpeta frente a sus hermanas existentes, incluidas las predeterminadas.
 * Un nombre que coincide con una hermana (sin distinguir mayúsculas) se rechaza como duplicado.
 *
 * @param {string} name - Nombre propuesto.
 * @param {Array<{ id?: number|string|null, name: string }>} siblings - Hermanas en la misma ubicación.
 * @param {{ ignoreId?: number|string|null }} [options] - Carpeta que se renombra (no cuenta como duplicado).
 * @returns {"empty"|"too_long"|"duplicate_sibling"|null} Motivo o null si es válido.
 */
export function validateFolderName(name, siblings, { ignoreId = null } = {}) {
  const error = describeFolderNameError(name);
  if (error) return error;
  const key = folderNameKey(name);
  const duplicated = siblings.some((sibling) => (ignoreId === null || String(sibling.id) !== String(ignoreId)) && folderNameKey(sibling.name) === key);
  return duplicated ? "duplicate_sibling" : null;
}

/**
 * Resuelve la sección y la fase funcionales de una carpeta a partir de su cadena de ancestros.
 * Usa la carpeta predeterminada más cercana (la propia o un ancestro); nunca el nombre visible.
 *
 * @param {Array<{ systemKey: string|null }>} chain - Cadena desde la raíz hasta la carpeta (incluida).
 * @returns {{ systemKey: string|null, section: string|null, stage: string|null, pendingDecisions: string[] }}
 *   Clasificación heredada; sin ancestro predeterminado, todo es null.
 */
export function resolveFolderClassification(chain) {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const definition = chain[index]?.systemKey ? getSystemFolder(chain[index].systemKey) : null;
    if (definition) {
      return {
        pendingDecisions: [...definition.pendingDecisions],
        section: definition.section,
        stage: definition.stage,
        systemKey: definition.key,
      };
    }
  }
  return { pendingDecisions: [], section: null, stage: null, systemKey: null };
}

/**
 * Evalúa si una operación sobre carpetas está permitida, prohibida o pendiente de decisión.
 * Aplica solo reglas confirmadas: carpetas con clave funcional protegidas (también si su clave salió
 * del catálogo, como hace la API), carpetas personalizadas dentro de otras salvo en la portada y
 * eliminación solo de carpetas personalizadas vacías; lo demás se devuelve como `pending_decision`.
 *
 * @param {object} request - Operación y contexto.
 * @param {"create_child"|"rename"|"delete"|"move"} request.operation - Operación solicitada.
 * @param {{ systemKey: string|null, hasChildren?: boolean, hasFiles?: boolean }|null} [request.folder] -
 *   Carpeta afectada (rename, delete, move).
 * @param {{ systemKey: string|null }|null} [request.parent] - Carpeta destino o madre (create_child,
 *   move); null es la raíz del proyecto.
 * @returns {{ outcome: "allowed"|"forbidden"|"pending_decision", reason: string, decision?: string }}
 *   Resultado de la evaluación.
 * @throws {Error} Si la operación no es conocida.
 */
export function evaluateFolderOperation({ folder = null, operation, parent = null }) {
  const isSystem = Boolean(folder?.systemKey);
  switch (operation) {
    case "rename":
      return isSystem
        ? { outcome: "forbidden", reason: "SYSTEM_FOLDER_PROTECTED" }
        : { outcome: "allowed", reason: "CUSTOM_FOLDER" };
    case "delete":
      if (isSystem) return { outcome: "forbidden", reason: "SYSTEM_FOLDER_PROTECTED" };
      return folder?.hasChildren || folder?.hasFiles
        ? { outcome: "forbidden", reason: "FOLDER_NOT_EMPTY" }
        : { outcome: "allowed", reason: "EMPTY_CUSTOM_FOLDER" };
    case "move":
      if (isSystem) return { outcome: "forbidden", reason: "SYSTEM_FOLDER_PROTECTED" };
      return { decision: "D13", outcome: "pending_decision", reason: "CUSTOM_FOLDER_MOVE_UNDECIDED" };
    case "create_child":
      return evaluateCustomFolderLocation(parent);
    default:
      throw Object.assign(new Error(`Operación de carpeta desconocida: ${operation}`), { code: "UNKNOWN_FOLDER_OPERATION" });
  }
}

/**
 * Decide si se puede crear una carpeta personalizada en una ubicación: en la raíz (D7 resuelta) y
 * dentro de cualquier carpeta, predeterminada o personalizada, salvo la portada (una sola imagen) y
 * sin superar MAX_FOLDER_DEPTH. `parent.depth` es la profundidad de la madre (1 en la raíz).
 *
 * @param {{ systemKey: string|null, depth?: number }|null} parent - Carpeta madre o null para la raíz.
 * @returns {{ outcome: "allowed"|"forbidden", reason: string }} Resultado.
 */
function evaluateCustomFolderLocation(parent) {
  if (!parent) return { outcome: "allowed", reason: "ROOT_CUSTOM_FOLDER" };
  if (Number.isFinite(parent.depth) && parent.depth >= MAX_FOLDER_DEPTH) return { outcome: "forbidden", reason: "FOLDER_TOO_DEEP" };
  if (!parent.systemKey) return { outcome: "allowed", reason: "INSIDE_CUSTOM_FOLDER" };
  if (getSystemFolder(parent.systemKey)?.content?.allowsSubfolders === false) {
    return { outcome: "forbidden", reason: "FOLDER_DOES_NOT_ALLOW_SUBFOLDERS" };
  }
  return { outcome: "allowed", reason: "INSIDE_SYSTEM_FOLDER" };
}

/**
 * Evalúa si una carpeta admite un archivo más según su contenido confirmado.
 * La portada admite una imagen JPG o PNG reemplazable; el resto de carpetas (también las agrupadoras
 * y «Cotizaciones») admiten cualquier formato aceptado por la subida (D14 resuelta).
 *
 * @param {{ systemKey: string|null }} folder - Carpeta destino.
 * @param {{ extension: string, currentFileCount: number }} file - Extensión y archivos ya presentes.
 * @returns {{ outcome: "allowed"|"forbidden"|"pending_decision", reason: string, decision?: string }} Resultado.
 */
export function evaluateFolderContent(folder, { currentFileCount, extension }) {
  const definition = folder?.systemKey ? getSystemFolder(folder.systemKey) : null;
  // D14 resuelta: sin regla propia (todas salvo la portada), cualquier formato que acepte la subida.
  if (!definition?.content) return { outcome: "allowed", reason: "CONTENT_ACCEPTED" };
  const normalizedExtension = String(extension ?? "").trim().toLowerCase().replace(/^\./, "");
  if (!definition.content.acceptedExtensions.includes(normalizedExtension)) return { outcome: "forbidden", reason: "FILE_TYPE_NOT_ACCEPTED" };
  if (currentFileCount >= definition.content.maxFiles) {
    return { outcome: "forbidden", reason: definition.content.replaceOnly ? "FOLDER_FULL_REPLACE_EXISTING" : "FOLDER_FULL" };
  }
  return { outcome: "allowed", reason: "CONTENT_ACCEPTED" };
}

/**
 * Detecta carpetas existentes que ocupan el nombre de una carpeta predeterminada en su misma ubicación.
 * Solo informa la colisión para un mapeo revisable: nunca adopta ni renombra carpetas automáticamente.
 *
 * @param {Array<{ id: number|string, name: string, parentSystemKey: string|null, parentIsRoot: boolean }>} existing -
 *   Carpetas personalizadas actuales con la ubicación de su madre (raíz o carpeta predeterminada).
 * @returns {Array<{ folderId: string, systemKey: string }>} Colisiones encontradas.
 */
export function findSystemFolderNameCollisions(existing) {
  const collisions = [];
  for (const folder of existing) {
    const parentKey = folder.parentIsRoot ? null : folder.parentSystemKey;
    if (!folder.parentIsRoot && !parentKey) continue;
    const match = PROJECT_SYSTEM_FOLDERS.find((definition) => definition.parentKey === parentKey && folderNameKey(definition.name) === folderNameKey(folder.name));
    if (match) collisions.push({ folderId: String(folder.id), systemKey: match.key });
  }
  return collisions;
}

/**
 * Indica qué módulo genera documentos en una carpeta predeterminada (p. ej. Cotizaciones). Es solo
 * informativo: la carpeta admite además archivos manuales y subcarpetas; los documentos generados no
 * son filas de `files` y por eso nunca se reemplazan ni mueven mediante operaciones manuales.
 *
 * @param {string|null|undefined} systemKey - Clave funcional de la carpeta.
 * @returns {string|null} Módulo que genera documentos en ella o null.
 */
export function getFolderManagingModule(systemKey) {
  return getSystemFolder(systemKey)?.generatedBy ?? null;
}

/**
 * Planifica las carpetas predeterminadas que faltan en un proyecto existente sin tocar las suyas.
 * Una carpeta del catálogo cuyo nombre ya usa otra carpeta en la misma ubicación (p. ej. una
 * personalizada «Cotizaciones» dentro de «Documentos») es un CONFLICTO: no se crea, no se adopta ni
 * se renombra la existente (cambiaría su significado o su propiedad); queda para revisión, junto con
 * las carpetas del catálogo que dependen de ella.
 *
 * @param {Array<{ id: number|string, parentId: number|string|null, systemKey: string|null, name: string }>} folders -
 *   Carpetas vigentes del proyecto.
 * @returns {{ missing: string[], conflicts: Array<{ systemKey: string, folderId: number, folderName: string, existingSystemKey: string|null }>, blocked: string[] }}
 *   Claves que se pueden crear, conflictos y claves bloqueadas por un conflicto de su madre.
 */
export function planMissingSystemFolders(folders) {
  const bySystemKey = new Map(folders.filter((folder) => folder.systemKey).map((folder) => [folder.systemKey, folder]));
  const unavailable = new Set();
  const plan = { blocked: [], conflicts: [], missing: [] };
  for (const definition of systemFolderCreationOrder()) {
    if (bySystemKey.has(definition.key)) continue;
    if (definition.parentKey && unavailable.has(definition.parentKey)) {
      unavailable.add(definition.key);
      plan.blocked.push(definition.key);
      continue;
    }
    // Madre creada en este mismo plan: todavía no tiene hermanas, así que no puede haber conflicto.
    const parent = definition.parentKey ? bySystemKey.get(definition.parentKey) : null;
    const sibling = definition.parentKey && !parent ? null : folders.find((folder) => (
      (folder.parentId === null || folder.parentId === undefined ? null : Number(folder.parentId)) === (parent ? Number(parent.id) : null)
      && folderNameKey(folder.name) === folderNameKey(definition.name)
    ));
    if (sibling) {
      unavailable.add(definition.key);
      plan.conflicts.push({ existingSystemKey: sibling.systemKey ?? null, folderId: Number(sibling.id), folderName: sibling.name, systemKey: definition.key });
    } else {
      plan.missing.push(definition.key);
    }
  }
  return plan;
}
