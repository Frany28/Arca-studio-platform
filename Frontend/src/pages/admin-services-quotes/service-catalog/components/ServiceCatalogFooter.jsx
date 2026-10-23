import { CloseCircle, TickCircle } from "iconsax-react";

import Button from "../../../../components/ui/Button/Button.jsx";

/**
 * Pie del tabulador (Figma 5790:351653): contador de la selección a la izquierda, acciones
 * «Desactivar» y «Activar» para los seleccionados y la paginación a la derecha. Como en Figma,
 * las acciones solo aparecen con alguna fila seleccionada (sin selección, las variantes muestran
 * solo contador y paginación); cada una se habilita únicamente si algún seleccionado cambiaría
 * (Desactivar con activos, Activar con inactivos; con una selección mixta, ambas). Los grupos
 * mantienen ese orden y pasan a filas sucesivas cuando no caben (flex-wrap).
 *
 * @param {Object} props - Selección, destinos, paginación y callbacks.
 * @param {number} props.selectedCount - Filas seleccionadas de la página.
 * @param {number} props.total - Filas visibles.
 * @param {{activate: Array<Object>, deactivate: Array<Object>}} props.targets - Servicios que cambiarían por acción.
 * @param {boolean} props.busy - Hay un cambio de estado en curso (individual o masivo).
 * @param {(isActive: boolean) => void} props.onStatusRequest - Pide confirmar la acción masiva.
 * @param {{hasPrevious: boolean, hasNext: boolean, previous: () => void, next: () => void}} props.pagination - Paginación por cursor.
 * @returns {import("react").ReactElement} Pie de la tabla.
 */
function ServiceCatalogFooter({ busy, onStatusRequest, pagination, selectedCount, targets, total }) {
  const actions = [
    { icon: CloseCircle, isActive: false, label: "Desactivar", count: targets.deactivate.length },
    { icon: TickCircle, isActive: true, label: "Activar", count: targets.activate.length },
  ];

  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-[24px] gap-y-[12px]" aria-label="Selección y paginación de servicios" data-service-catalog-footer>
      <span className="text-heading-8 text-[var(--color-text-300)]" aria-live="polite">
        {selectedCount} de {total} seleccionados
      </span>
      {selectedCount ? (
        <div role="group" className="flex flex-wrap items-center gap-[8px]" aria-label="Acciones para servicios seleccionados" data-service-bulk-actions>
          {actions.map((action) => {
            const ActionIcon = action.icon;
            return (
              <Button
                key={action.label}
                theme="Primary"
                type="Ghost"
                size="M"
                fitContent
                showLeftIcon
                iconLeft={<ActionIcon size="20" color="currentColor" />}
                showRightIcon={false}
                disabled={busy || action.count === 0}
                aria-label={action.count
                  ? `${action.label} ${action.count} ${action.count === 1 ? "servicio seleccionado" : "servicios seleccionados"}`
                  : `${action.label}: ningún servicio seleccionado cambiaría`}
                onClick={() => onStatusRequest(action.isActive)}
              >
                {action.label}
              </Button>
            );
          })}
        </div>
      ) : null}
      <nav className="flex items-center gap-[8px] max-[1023px]:ml-auto" aria-label="Paginación de servicios">
        <Button theme="Primary" type="Outline" size="M" fitContent showLeftIcon={false} showRightIcon={false} disabled={!pagination.hasPrevious} className="disabled:!border-[var(--color-neutral-400)] disabled:!text-[var(--color-neutral-400)]" onClick={pagination.previous}>Anterior</Button>
        <Button theme="Primary" type="Solid" size="M" fitContent showLeftIcon={false} showRightIcon={false} disabled={!pagination.hasNext} onClick={pagination.next}>Siguiente pág.</Button>
      </nav>
    </footer>
  );
}

export default ServiceCatalogFooter;
