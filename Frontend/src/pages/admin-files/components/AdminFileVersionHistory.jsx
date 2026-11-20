import clsx from "clsx";
import { ArrowRotateLeft, DocumentDownload, Eye } from "iconsax-react";

import ActionMenu from "../../../components/ui/ActionMenu/ActionMenu.jsx";
import Badge from "../../../components/ui/Badge/Badge.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import { formatFileDate } from "../utils/adminFilesPresentation.js";
import { formatReviewStatus, formatVersionLabel, getRestoreAvailability } from "../utils/adminFileReview.js";

const STATUS_BADGE_THEMES = Object.freeze({ approved: "Success", pending: "Info", rejected: "Danger" });

/**
 * Acciones del menú de una versión: ver, restaurar (deshabilitada con su motivo si no procede) y
 * descargar.
 *
 * @param {Object} version - Versión.
 * @param {Array<Object>} versions - Versiones cargadas.
 * @returns {Array<Object>} Elementos de ActionMenu.
 */
function versionActions(version, versions) {
  const restore = getRestoreAvailability(version, versions);
  return [
    { icon: Eye, id: "view", label: "Ver" },
    { disabled: !restore.allowed, icon: ArrowRotateLeft, id: "restore", label: restore.allowed ? "Restaurar versión" : `Restaurar versión (${restore.reason})` },
    { icon: DocumentDownload, id: "download", label: "Descargar" },
  ];
}

/**
 * Historial de versiones del visor (Figma 3952:187549): de la más reciente a la más antigua, con
 * la versión mostrada resaltada, su estado de revisión y el motivo del rechazo o de la restauración.
 * Cada versión ofrece «Ver», «Restaurar versión» (solo aprobadas, no vigentes y sin otra pendiente;
 * crea una versión nueva pendiente y conserva el historial) y «Descargar». «Mostrar más versiones»
 * pide la página siguiente.
 *
 * @param {Object} props - Historial (useAdminFileVersions), versión mostrada y callbacks.
 * @returns {import("react").ReactElement} Panel lateral.
 */
function AdminFileVersionHistory({ actionsDisabled, displayedVersionId, history, onDownload, onRestore, onView }) {
  let content;
  if (history.loading && !history.versions.length) {
    content = <p className="text-body-3 m-0 text-[var(--color-text-100)]" role="status">Cargando versiones...</p>;
  } else if (history.error && !history.versions.length) {
    content = (
      <EmptyState title="No se pudo cargar el historial" description={history.error} size="S" showFeaturedIcon={false} showActions showSecondaryAction={false} primaryActionLabel="Reintentar" onPrimaryAction={history.reload} />
    );
  } else {
    content = (
      <ol className="flex flex-col" aria-label="Versiones del archivo">
        {history.versions.map((version, index) => {
          const displayed = version.id === displayedVersionId;
          const status = version.review?.status || "legacy";
          const note = status === "rejected" ? version.review?.reason : version.changeNote;
          const author = version.uploadedBy?.name || "Usuario";
          return (
            <li key={version.id} className="relative flex gap-[12px] pb-[16px]" data-version-number={version.versionNumber} aria-current={displayed ? "true" : undefined}>
              {index < history.versions.length - 1 ? <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-[32px] w-px bg-[var(--color-neutral-300)]" /> : null}
              <span
                aria-hidden="true"
                className={clsx(
                  "relative z-[1] flex size-[32px] shrink-0 items-center justify-center rounded-[var(--radius-2)] border text-body-4",
                  displayed ? "border-[var(--color-primary-300)] bg-[var(--color-primary-300)] text-[var(--color-neutral-100-uniform)]" : "border-[var(--color-neutral-300)] bg-[var(--color-neutral-100)] text-[var(--color-text-200)]",
                )}
              >
                V{version.versionNumber}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                <div className="relative min-h-[20px] pr-[40px]">
                  <p className="text-heading-8 m-0 truncate pt-[6px] text-[var(--color-text-300)]">{formatVersionLabel(version)}</p>
                  {/* El menú va en la esquina para que la fecha quede pegada a la etiqueta, como en Figma. */}
                  <div className="absolute -top-[2px] right-0">
                    <ActionMenu
                      items={versionActions(version, history.versions)}
                      triggerLabel={`Opciones de la versión ${version.versionNumber}`}
                      menuLabel={`Acciones para la versión ${version.versionNumber}`}
                      tooltip="Más opciones"
                      menuWidthClassName="w-[240px]"
                      disabled={actionsDisabled}
                      onSelect={(item) => {
                        if (item.id === "view") onView(version);
                        else if (item.id === "restore") onRestore(version);
                        else onDownload(version);
                      }}
                    />
                  </div>
                </div>
                <p className="text-body-4 m-0 text-[var(--color-text-100)]">
                  <time dateTime={version.createdAt}>{formatFileDate(version.createdAt)}</time> | Por {author}
                </p>
                <Badge label={formatReviewStatus(status)} theme={STATUS_BADGE_THEMES[status] || "Neutral"} size="S" className="self-start" />
                {version.restoredFromVersionId ? <p className="text-body-4 m-0 text-[var(--color-text-100)]">Restaurada desde otra versión aprobada.</p> : null}
                {note ? <p className="text-body-4 m-0 [overflow-wrap:anywhere] text-[var(--color-text-200)]">{status === "rejected" ? "Motivo del rechazo: " : "Motivo: "}{note}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <section className="flex min-h-0 flex-col gap-[16px]" aria-labelledby="admin-file-history-title" aria-busy={history.loading || undefined}>
      <h3 id="admin-file-history-title" className="text-heading-6 m-0 text-[var(--color-text-300)]">Historial de versiones</h3>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-[4px] [scrollbar-width:thin]">
        {content}
        {history.error && history.versions.length ? <p className="text-body-3 m-0 text-[var(--color-danger-100)]" role="alert">{history.error}</p> : null}
        {history.hasMore ? (
          <Button theme="Primary" type="Link" size="S" fitContent showLeftIcon={false} showRightIcon={false} disabled={history.loadingMore || actionsDisabled} onClick={history.loadMore}>
            {history.loadingMore ? "Cargando versiones..." : "Mostrar más versiones"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export default AdminFileVersionHistory;
