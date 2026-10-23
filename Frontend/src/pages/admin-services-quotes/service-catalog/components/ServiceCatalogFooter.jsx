import { CloseCircle, TickCircle } from "iconsax-react";
import { useId } from "react";

import Button from "../../../../components/ui/Button/Button.jsx";
import HintText from "../../../../components/ui/HintText/HintText.jsx";

// Figma 5790:351653: los controles de texto miden 41 px, las acciones con icono 44 px.
// Se conserva Button M y sus tokens; solo se ajusta la geometría de esta composición.
const FOOTER_BUTTON_GEOMETRY = {
  deactivate: { width: 119, height: 44 },
  activate: { width: 97, height: 44 },
  previous: { width: 75, height: 41 },
  next: { width: 114, height: 41 },
};

/**
 * Pie del tabulador (Figma 5790:351653): contador de la selección a la izquierda, acciones
 * «Desactivar» y «Activar» siempre visibles y la paginación a la derecha. Solo una selección
 * homogénea habilita su acción: desactivar activos o activar inactivos; una selección vacía o
 * mixta bloquea ambas. Una ayuda visible explica la mezcla y describe ambos botones. Los grupos
 * mantienen ese orden y pasan a filas sucesivas cuando no caben (flex-wrap).
 *
 * @param {Object} props - Selección, destinos, paginación y callbacks.
 * @param {number} props.selectedCount - Filas seleccionadas de la página.
 * @param {number} props.total - Filas visibles.
 * @param {boolean} props.mixed - Hay servicios activos e inactivos seleccionados a la vez.
 * @param {{activate: Array<Object>, deactivate: Array<Object>}} props.targets - Servicios que cambiarían por acción.
 * @param {boolean} props.busy - Hay un cambio de estado en curso (individual o masivo).
 * @param {(isActive: boolean) => void} props.onStatusRequest - Pide confirmar la acción masiva.
 * @param {{hasPrevious: boolean, hasNext: boolean, previous: () => void, next: () => void}} props.pagination - Paginación por cursor.
 * @returns {import("react").ReactElement} Pie de la tabla.
 */
function ServiceCatalogFooter({ busy, mixed, onStatusRequest, pagination, selectedCount, targets, total }) {
  const mixedHintId = useId();
  const actions = [
    { icon: CloseCircle, isActive: false, label: "Desactivar", count: targets.deactivate.length, geometry: FOOTER_BUTTON_GEOMETRY.deactivate },
    { icon: TickCircle, isActive: true, label: "Activar", count: targets.activate.length, geometry: FOOTER_BUTTON_GEOMETRY.activate },
  ];

  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-[24px] gap-y-[12px]" aria-label="Selección y paginación de servicios" data-service-catalog-footer>
      <span className="text-heading-8 text-[var(--color-text-300)]" aria-live="polite">
        {selectedCount} de {total} seleccionados
      </span>
      <div role="group" className="flex min-w-0 max-w-full flex-col items-start gap-[4px]" aria-label="Acciones para servicios seleccionados" aria-describedby={mixed ? mixedHintId : undefined} data-service-bulk-actions>
        <div className="flex flex-wrap items-center gap-[8px]">
          {actions.map((action) => {
            const ActionIcon = action.icon;
            return (
              <Button
                key={action.label}
                theme="Primary"
                type="Ghost"
                size="M"
                fitContent
                style={action.geometry}
                showLeftIcon
                iconLeft={<ActionIcon size="20" color="currentColor" />}
                showRightIcon={false}
                disabled={busy || mixed || action.count === 0}
                aria-describedby={mixed ? mixedHintId : undefined}
                aria-label={action.count
                  ? `${action.label} ${action.count} ${action.count === 1 ? "servicio seleccionado" : "servicios seleccionados"}`
                  : `${action.label}: ${selectedCount ? "acción no disponible para esta selección" : "ningún servicio seleccionado"}`}
                onClick={() => onStatusRequest(action.isActive)}
              >
                {action.label}
              </Button>
            );
          })}
        </div>
        {mixed ? <HintText id={mixedHintId} role="status" className="max-w-[260px]" hintText="Selecciona solo servicios activos o solo inactivos." hintIcon={false} /> : null}
      </div>
      <nav className="flex items-center gap-[8px] max-[1023px]:ml-auto" aria-label="Paginación de servicios">
        <Button theme="Primary" type="Outline" size="M" fitContent style={FOOTER_BUTTON_GEOMETRY.previous} showLeftIcon={false} showRightIcon={false} disabled={!pagination.hasPrevious} className="disabled:!border-[var(--color-neutral-400)] disabled:!text-[var(--color-neutral-400)]" onClick={pagination.previous}>Anterior</Button>
        <Button theme="Primary" type="Solid" size="M" fitContent style={FOOTER_BUTTON_GEOMETRY.next} showLeftIcon={false} showRightIcon={false} disabled={!pagination.hasNext} onClick={pagination.next}>Siguiente pág.</Button>
      </nav>
    </footer>
  );
}

export default ServiceCatalogFooter;
