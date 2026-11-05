import { CloseCircle, DocumentText, InfoCircle, TickCircle } from "iconsax-react";

import ActionMenu from "../../../../components/ui/ActionMenu/ActionMenu.jsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../../../components/ui/Loader/Loader.jsx";
import SideOverlayDrawer from "../../../../components/ui/SideOverlayDrawer.jsx";
import AdminRequestDetailsContent from "./AdminRequestDetailsContent.jsx";

// Los IDs coinciden con las acciones del modal de decisión (ProjectRequestWorkflowModal).
const REQUEST_DECISION_ITEMS = [
  { icon: TickCircle, id: "approve", label: "Aprobar" },
  { icon: InfoCircle, id: "changes_requested", label: "Solicitar más información" },
  { icon: CloseCircle, id: "reject", label: "Rechazar", separated: true, tone: "danger" },
];
// Acción de consulta, separada de las decisiones: abre la vista completa de la solicitud.
const OPEN_REQUEST_ITEM = { icon: DocumentText, id: "open_request", label: "Abrir vista completa" };
const ITEMS_WITH_OPEN_REQUEST = [
  OPEN_REQUEST_ITEM,
  { ...REQUEST_DECISION_ITEMS[0], separated: true },
  ...REQUEST_DECISION_ITEMS.slice(1),
];

/**
 * Drawer lateral "Detalles de Solicitud" del dashboard administrativo (Figma 3727:677372).
 * Presenta la solicitud con sus estados de carga, inexistencia y contenido; "Ver solicitud"
 * y las decisiones del menú delegan en el modal de decisión existente, que conserva la
 * validación del motivo y la confirmación contra la API (no se ejecuta ninguna decisión desde
 * aquí). Con `onViewRequest`, el menú ofrece primero «Abrir vista completa». La consulta
 * administrativa lo reutiliza como «Ver resumen & recomendación» sin pie (`showActions={false}`).
 *
 * @param {Object} props - Estado expuesto por `useAdminRequestDetails`.
 * @param {boolean} props.open - Visibilidad del drawer.
 * @param {"loading"|"missing"|"ready"} props.status - Estado de la vista.
 * @param {Object|null} props.details - Modelo de presentación de la solicitud.
 * @param {Object} props.client - Lectura de los datos del cliente.
 * @param {string} [props.queueError] - Error de la cola técnica.
 * @param {Function} props.onClose - Cierra el drawer.
 * @param {(action?: string) => void} [props.onOpenWorkflow] - Abre el modal con una acción opcional.
 * @param {Function} [props.onViewRequest] - Abre la vista completa de la solicitud desde el menú.
 * @param {boolean} [props.showActions=true] - Muestra el pie con «Ver solicitud» y el menú de acciones.
 * @param {Function} props.onRetryQueue - Reintenta la cola técnica.
 * @returns {import("react").ReactElement} Drawer de detalle.
 */
function AdminRequestDetailsDrawer({
  client,
  details,
  onClose,
  onOpenWorkflow,
  onRetryQueue,
  onViewRequest,
  open,
  queueError,
  showActions = true,
  status,
}) {
  const ready = status === "ready" && Boolean(details);
  const projectName = details?.projectName || "la solicitud";

  return (
    <SideOverlayDrawer
      open={open}
      onClose={onClose}
      widthClassName="w-[min(312px,calc(100vw-32px))]"
      ariaLabel="Detalles de solicitud"
      className="z-[90]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 flex-col gap-[24px] px-[16px] pt-[16px]">
          <h2 className="text-heading-5 m-0 text-[var(--color-text-50)]">Detalles de Solicitud</h2>
          <div className="h-px w-full bg-[var(--color-neutral-200)]" aria-hidden="true" />
        </header>

        <div
          className="flex min-h-0 flex-1 flex-col gap-[24px] overflow-y-auto px-[16px] py-[24px] [scrollbar-color:var(--color-neutral-400)_transparent] [scrollbar-width:thin]"
          data-admin-request-details="true"
        >
          {status === "loading" ? (
            <Loader preset="adminRequestDetails" label="Cargando detalles de la solicitud" />
          ) : status === "missing" || !details ? (
            <EmptyState
              title="Solicitud no disponible"
              description="Es posible que ya haya sido gestionada o que el resumen se haya actualizado."
              size="S"
              showFeaturedIcon={false}
              showActions={false}
              className="min-h-[280px]"
            />
          ) : (
            <AdminRequestDetailsContent
              client={client}
              details={details}
              queueError={queueError}
              onRetryQueue={onRetryQueue}
            />
          )}
        </div>

        {showActions ? <footer className="flex shrink-0 items-center justify-between gap-[8px] border-t border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] px-[16px] pb-[16px] pt-[24px]">
          <Button
            theme="Primary"
            type="Solid"
            size="M"
            fitContent
            showLeftIcon={false}
            showRightIcon={false}
            disabled={!ready}
            onClick={() => onOpenWorkflow?.()}
          >
            Ver solicitud
          </Button>
          <ActionMenu
            type="Solid"
            size="M"
            title="Acciones"
            items={onViewRequest ? ITEMS_WITH_OPEN_REQUEST : REQUEST_DECISION_ITEMS}
            disabled={!ready}
            tooltip="Acciones"
            triggerLabel={`Acciones para ${projectName}`}
            menuLabel={`Acciones para ${projectName}`}
            onSelect={(item) => (item.id === OPEN_REQUEST_ITEM.id ? onViewRequest() : onOpenWorkflow?.(item.id))}
          />
        </footer> : null}
      </div>
    </SideOverlayDrawer>
  );
}

export default AdminRequestDetailsDrawer;
