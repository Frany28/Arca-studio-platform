import { NotFoundError } from "../errors/appError.js";
import { PROJECT_SYSTEM_FOLDERS, systemFolderCreationOrder } from "../domain/projectFolderCatalog.js";

// Creación idempotente de las carpetas predeterminadas de un proyecto (Fase 1.2). Se ejecuta dentro
// de la transacción que crea el proyecto, de modo que un fallo revierte proyecto y carpetas juntos.
// Nombres visibles, jerarquía y orden proceden del catálogo; las relaciones usan la clave estable.

// Inserta un nivel del árbol. Cada carpeta resuelve su madre por clave (nivel anterior, ya insertado).
// El árbitro uq_project_folders_system_key hace que una repetición o una ejecución concurrente no
// duplique carpetas; una madre ausente deja la fila sin insertar y la verificación final lo detecta.
const INSERT_LEVEL_SQL = `
  insert into public.project_folders (project_id, parent_id, name, system_key, created_by)
  select $1, parent.id, item.name, item.key, $2
  from unnest($3::text[], $4::text[], $5::text[]) with ordinality as item(key, name, parent_key, position)
  left join public.project_folders parent
    on parent.project_id = $1
   and parent.system_key = item.parent_key
   and parent.deleted_at is null
  where item.parent_key is null or parent.id is not null
  order by item.position
  on conflict (project_id, system_key) where system_key is not null and deleted_at is null do nothing
`;

const SYSTEM_TREE_SQL = `
  select folder.system_key, parent.system_key as parent_key
  from public.project_folders folder
  left join public.project_folders parent on parent.id = folder.parent_id
  where folder.project_id = $1
    and folder.system_key is not null
    and folder.deleted_at is null
`;

/**
 * Agrupa el catálogo por profundidad conservando el orden de Figma dentro de cada nivel.
 * Cada grupo se inserta con una sola sentencia después de que existan sus madres.
 *
 * @returns {Array<Array<object>>} Niveles del árbol, de la raíz a las hojas.
 */
function catalogLevels() {
  const levels = [];
  for (const folder of systemFolderCreationOrder()) {
    const depth = folder.key.split(".").length - 1;
    (levels[depth] ??= []).push(folder);
  }
  return levels;
}

/**
 * Crea las carpetas predeterminadas que falten en un proyecto y comprueba el árbol resultante.
 * Bloquea la fila del proyecto para serializar ejecuciones simultáneas; es idempotente y no adopta
 * ni renombra carpetas existentes. Debe llamarse dentro de la transacción que crea el proyecto.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {{ projectId: number, createdBy: number }} options - Proyecto y usuario que lo crea.
 * @returns {Promise<{ created: number, total: number }>} Carpetas creadas ahora y total del catálogo.
 * @throws {NotFoundError} PROJECT_NOT_FOUND si el proyecto no existe o está eliminado.
 * @throws {Error} PROJECT_SYSTEM_FOLDERS_INCONSISTENT si el árbol no coincide con el catálogo.
 */
export async function ensureProjectSystemFolders(client, { createdBy, projectId }) {
  const project = await client.query(
    "select id from public.projects where id = $1 and deleted_at is null for update",
    [projectId],
  );
  if (!project.rows[0]) throw new NotFoundError("PROJECT_NOT_FOUND", "No se encontro el proyecto.");

  let created = 0;
  for (const level of catalogLevels()) {
    const result = await client.query(INSERT_LEVEL_SQL, [
      projectId,
      createdBy,
      level.map((folder) => folder.key),
      level.map((folder) => folder.name),
      level.map((folder) => folder.parentKey),
    ]);
    created += result.rowCount;
  }

  const existing = await client.query(SYSTEM_TREE_SQL, [projectId]);
  const problems = findSystemTreeProblems(existing.rows);
  if (problems.length) {
    throw Object.assign(new Error(`Árbol de carpetas predeterminadas incoherente: ${problems.join("; ")}`), {
      code: "PROJECT_SYSTEM_FOLDERS_INCONSISTENT",
    });
  }
  return { created, total: PROJECT_SYSTEM_FOLDERS.length };
}

/**
 * Compara las carpetas predeterminadas de un proyecto con el catálogo: presencia y madre de cada clave.
 * Las claves que ya no estén en el catálogo se ignoran: retirar una carpeta del catálogo no la borra.
 *
 * @param {Array<{ system_key: string, parent_key: string|null }>} rows - Carpetas con clave del proyecto.
 * @returns {string[]} Problemas encontrados; vacío si el árbol es coherente.
 */
export function findSystemTreeProblems(rows) {
  const byKey = new Map(rows.map((row) => [row.system_key, row.parent_key ?? null]));
  const problems = [];
  for (const folder of PROJECT_SYSTEM_FOLDERS) {
    if (!byKey.has(folder.key)) problems.push(`falta ${folder.key}`);
    else if (byKey.get(folder.key) !== folder.parentKey) problems.push(`madre incorrecta en ${folder.key}`);
  }
  return problems;
}
