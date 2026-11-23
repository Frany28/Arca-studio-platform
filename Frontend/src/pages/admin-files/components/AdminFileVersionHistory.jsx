import clsx from "clsx";
import { Add, ArrowRight2, Status } from "iconsax-react";

import ActionMenu from "../../../components/ui/ActionMenu/ActionMenu.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import { formatHumanDate } from "../../../utils/relativeTime.js";
import { formatFileDate } from "../utils/adminFilesPresentation.js";
import { describeVersionNote, formatVersionLabel, getRestoreAvailability } from "../utils/adminFileReview.js";

/**
 * Acciones del menú de una versión (Figma 3939:504526, 160 px, solo texto y divisores): ver,
 * restaurar (deshabilitada con su motivo en `hint` si no procede) y descargar.
 *
 * @param {Object} version - Versión.
 * @param {Array<Object>} versions - Versiones cargadas.
 * @returns {Array<Object>} Elementos de ActionMenu.
 */
function versionActions(version, versions) {
  const restore = getRestoreAvailability(version, versions);
  return [
    { id: "view", label: "Ver" },
    { disabled: !restore.allowed, hint: restore.reason || undefined, id: "restore", label: "Restaurar versión", separated: true },
    { id: "download", label: "Descargar", separated: true },
  ];
}

/**
 * Paso del historial (patrón «Progress step base» Featured Icon S de Figma): la versión vigente usa
 * el estado completado (icono `Status` sobre `primary-300`) y el resto el incompleto (chevron con
 * borde). Se compone aquí porque `ProgressStepBase` fija el icono `Image`, alinea arriba con 8 px y
 * mide 304 px, mientras el drawer centra con 12 px y añade el menú y la línea de motivo.
 *
 * @param {Object} props - Versión, posición y callbacks.
 * @returns {import("react").ReactElement} Elemento de la lista.
 */
function VersionStep({ actionsDisabled, displayed, getActions, isLast, onSelect, version, versions }) {
  const current = Boolean(version.isCurrent);
  // Una versión puede traer su propia línea (p. ej. el estado del PDF de una cotización).
  const note = version.note ?? describeVersionNote(version, versions);
  const author = version.uploadedBy?.name || "Usuario";
  return (
    <li className="relative flex items-start justify-between gap-[8px]" data-version-number={version.versionNumber} aria-current={displayed ? "true" : undefined}>
      {/* Conector de 2 px entre centros de iconos (24 px de separación + 18 px hasta el centro). */}
      {!isLast ? <span aria-hidden="true" className="absolute -bottom-[42px] left-[15px] top-[18px] w-[2px] bg-[var(--color-neutral-200)]" /> : null}
      {!isLast && current ? <span aria-hidden="true" className="absolute left-[15px] top-[18px] h-[33px] w-[2px] bg-[var(--color-primary-300)]" /> : null}
      <div className="flex min-w-0 flex-1 items-start gap-[12px]">
        <span
          aria-hidden="true"
          className={clsx(
            "relative z-[1] mt-[2px] flex size-[32px] shrink-0 items-center justify-center rounded-[var(--radius-2)] shadow-[var(--shadow-e1)]",
            current
              ? "bg-[var(--color-primary-300)] text-[var(--color-neutral-100-uniform)]"
              : "border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] text-[var(--color-text-100)]",
          )}
        >
          {current ? <Status size="16" variant="Linear" color="currentColor" /> : <ArrowRight2 size="16" variant="Linear" color="currentColor" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-[4px] pt-[1px]">
          <p className={clsx("text-body-3 m-0 truncate", current ? "text-[var(--color-text-200)]" : "text-[var(--color-text-100)]")} title={`V${version.versionNumber}`}>
            {formatVersionLabel(version)}
          </p>
          <p className={clsx("text-body-4 m-0 truncate", current ? "text-[var(--color-text-100)]" : "text-[var(--color-neutral-400)]")}>
            <time dateTime={version.createdAt} title={formatFileDate(version.createdAt)}>{formatHumanDate(version.createdAt)}</time> | Por {author}
          </p>
          {note ? <p className="text-body-4 m-0 truncate text-[var(--color-text-100)]" title={note}>{note}</p> : null}
        </div>
      </div>
      <ActionMenu
        items={getActions(version, versions)}
        triggerLabel={`Opciones de la versión ${version.versionNumber}`}
        menuLabel={`Acciones para la versión ${version.versionNumber}`}
        tooltip="Más opciones"
        menuWidthClassName="w-[160px]"
        disabled={actionsDisabled}
        onSelect={(item) => onSelect(item.id, version)}
      />
    </li>
  );
}

/**
 * Drawer «Historial de versiones» del visor (Figma 3934:182047): título, «+» para incorporar una
 * versión (anotación de Figma «para reemplazar versión»: abre el mismo flujo que «Reemplazar»),
 * pasos de la más reciente a la más antigua con fecha relativa y autor, menú «Ver», «Restaurar
 * versión» (cualquier aprobada, también la vigente, y sin otra pendiente; crea una versión nueva
 * pendiente y conserva el historial) y «Descargar», y «Mostrar más versiones» con la página
 * siguiente de la API.
 *
 * @param {Object} props - Historial (useAdminFileVersions), versión mostrada, alta y callbacks.
 * @param {{ allowed: boolean, reason: string, onClick: () => void }} props.addVersion - «+» (reemplazo).
 * @param {(version: Object, versions: Array<Object>) => Array<Object>} [props.getVersionActions] - Menú de cada versión
 *   (por defecto ver, restaurar y descargar; los PDF de cotizaciones solo ven y descargan).
 * @returns {import("react").ReactElement} Contenido del drawer.
 */
function AdminFileVersionHistory({ actionsDisabled, addVersion, displayedVersionId, getVersionActions = versionActions, history, onDownload, onRestore, onView }) {
  /**
   * Ejecuta la acción elegida en el menú de una versión.
   *
   * @param {"view"|"restore"|"download"} action - Acción.
   * @param {Object} version - Versión.
   * @returns {void}
   */
  function handleSelect(action, version) {
    if (action === "view") onView(version);
    else if (action === "restore") onRestore?.(version);
    else onDownload(version);
  }

  let content;
  if (history.loading && !history.versions.length) {
    content = <p className="text-body-3 m-0 text-[var(--color-text-100)]" role="status">Cargando versiones...</p>;
  } else if (history.error && !history.versions.length) {
    content = (
      <EmptyState title="No se pudo cargar el historial" description={history.error} size="S" showFeaturedIcon={false} showActions showSecondaryAction={false} primaryActionLabel="Reintentar" onPrimaryAction={history.reload} />
    );
  } else if (!history.versions.length) {
    content = <p className="text-body-3 m-0 text-[var(--color-text-100)]">Este archivo todavía no tiene versiones registradas.</p>;
  } else {
    content = (
      <ol className="flex flex-col gap-[24px]" aria-label="Versiones del archivo">
        {history.versions.map((version, index) => (
          <VersionStep
            key={version.id}
            version={version}
            versions={history.versions}
            displayed={version.id === displayedVersionId}
            isLast={index === history.versions.length - 1}
            actionsDisabled={actionsDisabled}
            getActions={getVersionActions}
            onSelect={handleSelect}
          />
        ))}
      </ol>
    );
  }

  return (
    <section className="flex flex-col gap-[24px]" aria-labelledby="admin-file-history-title" aria-busy={history.loading || undefined}>
      <div className="flex items-center justify-between gap-[8px]">
        <h3 id="admin-file-history-title" className="text-heading-5 m-0 text-[var(--color-text-50)]">Historial de versiones</h3>
        <Button
          theme="Primary"
          type="Ghost"
          size="S"
          showText={false}
          showLeftIcon
          iconLeft={<Add size="20" color="currentColor" />}
          showRightIcon={false}
          disabled={actionsDisabled || !addVersion.allowed}
          tooltip={addVersion.allowed ? "Subir una versión nueva" : addVersion.reason}
          aria-label={addVersion.allowed ? "Subir una versión nueva" : `Subir una versión nueva. ${addVersion.reason}`}
          onClick={addVersion.onClick}
        />
      </div>
      {content}
      {history.error && history.versions.length ? <p className="text-body-3 m-0 text-[var(--color-danger-100)]" role="alert">{history.error}</p> : null}
      {history.hasMore ? (
        <Button theme="Primary" type="Ghost" size="S" fitContent showLeftIcon={false} showRightIcon={false} disabled={history.loadingMore || actionsDisabled} className="self-start" onClick={history.loadMore}>
          {history.loadingMore ? "Cargando versiones..." : "Mostrar más versiones"}
        </Button>
      ) : null}
    </section>
  );
}

export default AdminFileVersionHistory;
