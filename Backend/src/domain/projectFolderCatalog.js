import { deepFreeze } from "./fileContexts.js";

// Catálogo de carpetas predeterminadas de un proyecto (E1, Fase 1.2). Dominio puro, todavía no
// conectado a la creación de proyectos ni a los endpoints de carpetas.
//
// Fuente: Figma 3727:618978, paso «Gestión de archivos» (árbol, nombres, orden y aviso de la portada),
// más los requisitos confirmados de la fase: claves funcionales estables, carpetas que no se
// renombran, eliminan ni mueven, y la jerarquía prevista. Las reglas que dependen de una decisión
// abierta se devuelven como `pending_decision` con su identificador, nunca con un valor supuesto.

export const FOLDER_NAME_MAX_LENGTH = 120;
export const SYSTEM_FOLDER_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

// Decisiones abiertas que afectan a este catálogo. Ver Backend/ARCHITECTURE.md (E1).
export const FOLDER_PENDING_DECISIONS = deepFreeze({
  D1: "Carpeta de garantías: no figura en Figma y no forma parte del catálogo hasta decidirla.",
  D2: "«Antes»: fase o clasificación de su contenido (render en fase inicial o imagen de referencia).",
  D6: "«Modelos 3D»: contenido admitido (panorámicas 360, GLB/GLTF o ambos) y visor que lo muestra.",
  D7: "Carpetas personalizadas en la raíz del proyecto.",
  D13: "Carpetas personalizadas dentro de las carpetas predeterminadas (en cuáles, salvo la portada) y si pueden moverse.",
  D14: "Contenido admitido por cada carpeta (salvo la portada) y si las carpetas agrupadoras admiten archivos directos.",
});

// Árbol confirmado por Figma, en su orden visual. `section` es la sección funcional del proyecto a la
// que pertenece la carpeta; `stage`, la fase que indica su nombre. Los valores nulos con
// `pendingDecisions` no se han asignado a propósito.
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
  { key: "renders", name: "Renders e imágenes", parentKey: null, section: "renders", stage: null, content: null, pendingDecisions: ["D13", "D14"] },
  { key: "renders.models", name: "Modelos 3D", parentKey: "renders", section: "models_3d", stage: null, content: null, pendingDecisions: ["D6", "D13", "D14"] },
  { key: "renders.models.initial_proposal", name: "Propuesta inicial", parentKey: "renders.models", section: "models_3d", stage: "initial_proposal", content: null, pendingDecisions: ["D6", "D13", "D14"] },
  { key: "renders.models.final_proposal", name: "Propuesta final", parentKey: "renders.models", section: "models_3d", stage: "final_proposal", content: null, pendingDecisions: ["D6", "D13", "D14"] },
  { key: "renders.images", name: "Imágenes", parentKey: "renders", section: "images", stage: null, content: null, pendingDecisions: ["D13", "D14"] },
  { key: "renders.images.initial_proposal", name: "Propuesta inicial", parentKey: "renders.images", section: "images", stage: "initial_proposal", content: null, pendingDecisions: ["D13", "D14"] },
  { key: "renders.images.initial_proposal.before", name: "Antes", parentKey: "renders.images.initial_proposal", section: "images", stage: null, content: null, pendingDecisions: ["D2", "D13", "D14"] },
  { key: "renders.images.execution", name: "Ejecución", parentKey: "renders.images", section: "images", stage: "execution", content: null, pendingDecisions: ["D13", "D14"] },
  { key: "renders.images.final_result", name: "Resultado final", parentKey: "renders.images", section: "images", stage: "final_result", content: null, pendingDecisions: ["D13", "D14"] },
  { key: "renders.videos", name: "Videos", parentKey: "renders", section: "videos", stage: null, content: null, pendingDecisions: ["D13", "D14"] },
  { key: "renders.videos.initial_proposal", name: "Propuesta inicial", parentKey: "renders.videos", section: "videos", stage: "initial_proposal", content: null, pendingDecisions: ["D13", "D14"] },
  { key: "renders.videos.execution", name: "Ejecución", parentKey: "renders.videos", section: "videos", stage: "execution", content: null, pendingDecisions: ["D13", "D14"] },
  { key: "renders.videos.final_result", name: "Resultado final", parentKey: "renders.videos", section: "videos", stage: "final_result", content: null, pendingDecisions: ["D13", "D14"] },
  { key: "documents", name: "Documentos", parentKey: null, section: "documents", stage: null, content: null, pendingDecisions: ["D13", "D14"] },
  { key: "documents.initial_proposal", name: "Propuesta inicial", parentKey: "documents", section: "documents", stage: "initial_proposal", content: null, pendingDecisions: ["D13", "D14"] },
  // Los adjuntos de la solicitud de origen se reconocen hoy como «Archivos del cliente»
  // (origin_project_request_id). Qué más puede contener depende de D14.
  { key: "client_files", name: "Archivos del cliente", parentKey: null, section: "client_files", stage: null, content: null, pendingDecisions: ["D13", "D14"] },
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
 * Es el orden que necesitará la creación idempotente de carpetas en una entrega posterior.
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
 * Aplica solo reglas confirmadas: carpetas predeterminadas protegidas, portada sin subcarpetas y
 * eliminación solo de carpetas vacías; lo demás se devuelve como `pending_decision`.
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
  const isSystem = Boolean(folder?.systemKey && getSystemFolder(folder.systemKey));
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
 * Decide si se puede crear una carpeta personalizada dentro de una ubicación.
 * Portada: prohibido (admite una sola imagen); dentro de una carpeta personalizada: se conserva la
 * jerarquía libre vigente; raíz y carpetas predeterminadas: pendientes de D7 y D13.
 *
 * @param {{ systemKey: string|null }|null} parent - Carpeta madre o null para la raíz.
 * @returns {{ outcome: "allowed"|"forbidden"|"pending_decision", reason: string, decision?: string }} Resultado.
 */
function evaluateCustomFolderLocation(parent) {
  if (!parent) return { decision: "D7", outcome: "pending_decision", reason: "ROOT_CUSTOM_FOLDER_UNDECIDED" };
  const definition = parent.systemKey ? getSystemFolder(parent.systemKey) : null;
  if (!definition) return { outcome: "allowed", reason: "INSIDE_CUSTOM_FOLDER" };
  if (definition.content?.allowsSubfolders === false) return { outcome: "forbidden", reason: "FOLDER_DOES_NOT_ALLOW_SUBFOLDERS" };
  return { decision: "D13", outcome: "pending_decision", reason: "CUSTOM_FOLDER_IN_SYSTEM_FOLDER_UNDECIDED" };
}

/**
 * Evalúa si una carpeta admite un archivo más según su contenido confirmado.
 * Solo la portada tiene reglas confirmadas (una imagen JPG o PNG, reemplazable); el resto depende de D14.
 *
 * @param {{ systemKey: string|null }} folder - Carpeta destino.
 * @param {{ extension: string, currentFileCount: number }} file - Extensión y archivos ya presentes.
 * @returns {{ outcome: "allowed"|"forbidden"|"pending_decision", reason: string, decision?: string }} Resultado.
 */
export function evaluateFolderContent(folder, { currentFileCount, extension }) {
  const definition = folder?.systemKey ? getSystemFolder(folder.systemKey) : null;
  if (!definition?.content) return { decision: "D14", outcome: "pending_decision", reason: "FOLDER_CONTENT_UNDECIDED" };
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
