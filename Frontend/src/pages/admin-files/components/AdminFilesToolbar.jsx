import { Add, SearchNormal1 } from "iconsax-react";

import Button from "../../../components/ui/Button/Button.jsx";
import Input from "../../../components/ui/Input/Input.jsx";

/**
 * Barra de la tabla (Figma 3727:682787): búsqueda de archivos en la API («Buscar...», 320 × 40) a la
 * izquierda y «+ Nuevo» (U3) a la derecha, sin más controles, como en Figma. «+ Nuevo» sube a la
 * carpeta seleccionada en el árbol; sin una carpeta válida se muestra deshabilitado con su motivo.
 * Fuera de Aprobados (sin árbol) no se muestra. La fila mide lo que el buscador (40 px) y el botón de
 * 44 px sobresale 2 px por cada lado (-my-[2px]), de modo que la tabla empieza 64 px bajo la barra;
 * en móvil ambos ocupan todo el ancho en filas separadas 16 px.
 *
 * @param {Object} props - Estado de la consulta y callbacks.
 * @param {string} props.query - Texto escrito en la búsqueda.
 * @param {(value: string) => void} props.onQueryChange - Cambia la búsqueda.
 * @param {{ disabledReason: string, onClick: () => void }|null} [props.newAction] - «+ Nuevo» o null para ocultarlo.
 * @param {boolean} [props.rejected=false] - Usa el alto exterior de 40 px de Rechazados.
 * @returns {import("react").ReactElement} Barra de herramientas.
 */
function AdminFilesToolbar({ newAction = null, onQueryChange, query, rejected = false }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-[12px] gap-y-[16px] ${rejected ? "" : "-my-[2px]"}`} data-admin-files-toolbar>
      <div className="min-w-[200px] max-w-[320px] flex-1 max-[767px]:max-w-none max-[767px]:basis-full">
        <Input
          type="Default input"
          size="M"
          value={query}
          placeholder="Buscar..."
          showLabel={false}
          showHint={false}
          showLeftIcon
          showRightIcon={false}
          required={false}
          leftIcon={<SearchNormal1 size="20" color="currentColor" />}
          className={`w-full max-[767px]:max-w-none ${rejected ? "[&_[data-input-shell]]:h-[40px]" : ""}`}
          aria-label="Buscar archivos por nombre"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      {newAction ? (
        <span className="ml-auto inline-flex max-[767px]:ml-0 max-[767px]:w-full">
          <Button
            theme="Primary"
            type="Solid"
            size="M"
            fitContent
            showLeftIcon
            iconLeft={<Add size="20" color="currentColor" />}
            showRightIcon={false}
            disabled={Boolean(newAction.disabledReason)}
            tooltip={newAction.disabledReason || "Subir archivos a la carpeta seleccionada"}
            aria-label={newAction.disabledReason ? `Nuevo archivo. ${newAction.disabledReason}` : "Nuevo archivo"}
            className="max-[767px]:!w-full"
            onClick={newAction.onClick}
          >
            Nuevo
          </Button>
        </span>
      ) : null}
    </div>
  );
}

export default AdminFilesToolbar;
