// Nombre lógico de los archivos de un proyecto (`files.title`). Dominio puro, sin PostgreSQL.
//
// - Nombre original: el del archivo subido, guardado en cada versión (`file_versions.original_name`).
//   Es histórico: no se modifica nunca y lo siguen mostrando el detalle de la solicitud de origen y
//   el historial de versiones.
// - Nombre lógico: identifica el archivo dentro de su carpeta del proyecto y es único en ella (la raíz
//   incluida, sin distinguir mayúsculas; `uq_files_project_folder_title`). Normalmente coincide con el
//   original; solo difiere cuando un archivo se incorpora a una carpeta donde su nombre ya está usado
//   (adjuntos homónimos de una solicitud), y entonces recibe un sufijo determinista «nombre (2).ext».

// Límite de `files.title` (VARCHAR(255)).
export const FILE_TITLE_MAX_LENGTH = 255;

/**
 * Clave de comparación de un nombre lógico: la misma normalización que la subida y el índice único
 * (`lower(title)`), sobre el nombre recortado.
 *
 * @param {string} name - Nombre.
 * @returns {string} Clave en minúsculas.
 */
export function fileNameKey(name) {
  return String(name ?? "").trim().toLowerCase();
}

/**
 * Construye la variante numerada de un nombre conservando su extensión: «plano.pdf» con 2 da
 * «plano (2).pdf»; sin extensión, «plano (2)». Un nombre que empieza por punto («.env») se trata
 * como sin extensión. Si no cabe en `maxLength`, se recorta la base y nunca el sufijo ni la extensión.
 *
 * @param {string} name - Nombre original.
 * @param {number} number - Número de la variante (≥ 2).
 * @param {number} [maxLength] - Longitud máxima del resultado.
 * @returns {string} Nombre con sufijo.
 */
export function buildNumberedFileName(name, number, maxLength = FILE_TITLE_MAX_LENGTH) {
  const trimmed = String(name ?? "").trim() || "archivo";
  const dot = trimmed.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < trimmed.length - 1;
  const base = hasExtension ? trimmed.slice(0, dot) : trimmed;
  const extension = hasExtension ? trimmed.slice(dot) : "";
  const suffix = ` (${number})`;
  const room = Math.max(1, maxLength - suffix.length - extension.length);
  return `${base.slice(0, room).trimEnd()}${suffix}${extension}`;
}

/**
 * Asigna nombres lógicos únicos a archivos que se incorporan juntos a una misma carpeta, de forma
 * determinista e idempotente:
 * 1. en orden de id, cada archivo conserva su nombre si nadie lo ocupa (ni la carpeta ni un archivo
 *    anterior del lote);
 * 2. los restantes, también en orden de id, reciben el menor sufijo «(n)», n ≥ 2, libre en la carpeta
 *    y en el lote (así «plano (2).pdf» nunca pisa a un adjunto que ya se llamaba así).
 * Volver a calcularlo con el resultado ya aplicado no cambia ningún nombre.
 *
 * @param {Array<{ id: number|string, title: string }>} files - Archivos que se incorporan.
 * @param {{ taken?: Iterable<string> }} [options] - Nombres ya usados en la carpeta destino.
 * @returns {Map<number, string>} Id → nombre lógico (igual al original si no cambia).
 */
export function assignUniqueFileNames(files, { taken = [] } = {}) {
  const ordered = [...files].sort((left, right) => Number(left.id) - Number(right.id));
  const used = new Set([...taken].map(fileNameKey));
  const assigned = new Map();
  const pending = [];
  for (const file of ordered) {
    const title = String(file.title ?? "").trim();
    if (used.has(fileNameKey(title))) {
      pending.push({ id: Number(file.id), title });
      continue;
    }
    used.add(fileNameKey(title));
    assigned.set(Number(file.id), title);
  }
  for (const file of pending) {
    let number = 2;
    while (used.has(fileNameKey(buildNumberedFileName(file.title, number)))) number += 1;
    const title = buildNumberedFileName(file.title, number);
    used.add(fileNameKey(title));
    assigned.set(file.id, title);
  }
  return assigned;
}
