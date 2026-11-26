// Nombre visible de una versión de un archivo de proyecto en las vistas del proyecto (administrador de
// archivos, configuración del borrador y garantías). Ver domain/projectFileNames.js:
// - la v1 se muestra con el nombre lógico (`files.title`, único en su carpeta), que coincide con el
//   nombre subido salvo en los adjuntos homónimos incorporados con sufijo («plano (2).pdf»);
// - las versiones posteriores conservan el nombre con el que se subieron (`original_name`), como antes.
// El detalle de la solicitud de origen y el historial de versiones siguen mostrando `original_name`.

/**
 * Fragmento SQL con el nombre visible de una versión en las vistas del proyecto. Sin versión unida
 * (`left join` vacío) devuelve el nombre lógico.
 *
 * @param {string} [fileAlias] - Alias de public.files.
 * @param {string} [versionAlias] - Alias de public.file_versions.
 * @returns {string} Expresión SQL (sin parámetros de usuario).
 */
export function projectFileVersionNameSql(fileAlias = "file", versionAlias = "version") {
  return `case when ${versionAlias}.version_number = 1 then ${fileAlias}.title else coalesce(${versionAlias}.original_name, ${fileAlias}.title) end`;
}
