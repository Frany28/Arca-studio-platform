import Button from "../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import { getProjectRequestStatus } from "../../../utils/projectRequestStatus.js";

/**
 * Cola de solicitudes asignadas al arquitecto, paginada por cursor.
 * Muestra carga, error con reintento, vacío y lista; «Cargar más» pide la página siguiente
 * y, si falla, conserva lo cargado y muestra el motivo bajo la lista.
 *
 * @param {Object} props - Estado de la cola y acciones.
 * @param {Array} [props.requests=[]] - Solicitudes cargadas.
 * @param {boolean} props.loading - Primera página en curso.
 * @param {string} props.error - Error de la primera página.
 * @param {boolean} [props.hasMore=false] - Hay más páginas.
 * @param {boolean} [props.loadingMore=false] - Página adicional en curso.
 * @param {string} [props.loadMoreError=""] - Error de la página adicional.
 * @param {Function} [props.onLoadMore] - Carga la página siguiente.
 * @param {Function} props.onOpen - Abre la revisión de una solicitud.
 * @param {Function} props.onRetry - Relee la primera página.
 * @returns {import("react").ReactElement} Sección de la cola.
 */
function ProjectRequestReviewQueue({
  error,
  hasMore = false,
  loading,
  loadingMore = false,
  loadMoreError = "",
  onLoadMore,
  onOpen,
  onRetry,
  requests = [],
}) {
  return (
    <section className="mx-auto flex w-full max-w-[1200px] flex-col gap-[12px] px-[16px] pb-[24px] sm:px-[24px] lg:px-[48px]">
      <h2 className="text-heading-5 text-[var(--color-text-300)]">Solicitudes asignadas</h2>
      {loading ? (
        <Loader preset="requestRow" count={2} label="Cargando solicitudes asignadas" />
      ) : error && !requests.length ? (
        <EmptyState
          title="No pudimos cargar las solicitudes"
          description={error}
          size="S"
          showFeaturedIcon={false}
          showActions
          showSecondaryAction={false}
          primaryActionLabel="Reintentar"
          onPrimaryAction={onRetry}
        />
      ) : requests.length ? (
        <div className="flex flex-col rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] px-[16px]">
          {requests.map((request) => (
            <article key={request.id} className="flex flex-col gap-[12px] border-b border-[var(--color-neutral-200)] py-[16px] last:border-b-0 min-[600px]:flex-row min-[600px]:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                <h3 className="truncate text-body-2 text-[var(--color-text-300)]">{request.projectName}</h3>
                <p className="text-body-4 text-[var(--color-text-100)]">{getProjectRequestStatus(request.status).label}</p>
              </div>
              <Button theme="Primary" type="Outline" size="S" fitContent onClick={() => onOpen?.(request)}>
                Revisar
              </Button>
            </article>
          ))}
          {hasMore ? (
            <div className="flex justify-center border-t border-[var(--color-neutral-200)] py-[12px]">
              <Button theme="Primary" type="Outline" size="S" fitContent showLeftIcon={false} showRightIcon={false} disabled={loadingMore} onClick={onLoadMore}>
                {loadingMore ? "Cargando..." : "Cargar más"}
              </Button>
            </div>
          ) : null}
          {loadMoreError ? (
            <p className="pb-[12px] text-center text-body-4 text-[var(--color-danger-100)]" role="alert">{loadMoreError}</p>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title="No tienes solicitudes pendientes"
          description="Las solicitudes que te asigne un administrador aparecerán aquí."
          size="S"
          showFeaturedIcon={false}
          showActions={false}
        />
      )}
    </section>
  );
}

export default ProjectRequestReviewQueue;
