import { Folder2 } from "iconsax-react";

import { getFolderDestinationPath } from "../utils/adminFilesPresentation.js";

/**
 * Ruta de destino, solo informativa, de «Nueva carpeta» y «Nuevo archivo»: «Proyecto/Carpeta/
 * Subcarpeta» (o «Proyecto/» en la raíz) con la ubicación abierta en el árbol que el diálogo fijó
 * al abrirse. No se puede editar ni cambiar. Usa el icono de carpeta del árbol y se lee completa:
 * ocupa varias líneas y corta nombres largos sin desbordar ni recortarse con «…». El prefijo
 * accesible «Destino:» lo anuncia como ubicación para los lectores de pantalla.
 *
 * @param {Object} props - Destino.
 * @param {string} props.id - Id del texto (descripción accesible del diálogo).
 * @param {{ name: string, folders?: Array<Object> }} props.project - Proyecto.
 * @param {Object|null} props.folder - Carpeta abierta (null: raíz del proyecto).
 * @returns {import("react").ReactElement} Ruta.
 */
function AdminFileDestinationPath({ folder, id, project }) {
  const path = getFolderDestinationPath(project, folder);
  return (
    <p id={id} className="text-body-4 m-0 flex items-start gap-[4px] text-[var(--color-text-100)]" data-admin-file-destination>
      <Folder2 size="16" variant="Linear" color="currentColor" className="mt-[1px] shrink-0" aria-hidden="true" />
      <span className="min-w-0 wrap-anywhere">
        <span className="sr-only">Destino: </span>
        {path}
      </span>
    </p>
  );
}

export default AdminFileDestinationPath;
