import { useId } from "react";

import Button from "../../../components/ui/Button/Button.jsx";
import Checkbox from "../../../components/ui/Checkbox/Checkbox.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import Modal, { ModalCloseButton } from "../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../hooks/useDialogKeyboard.js";
import { useAdminFileWarranties } from "../hooks/useAdminFileWarranties.js";
import { formatFileDate } from "../utils/adminFilesPresentation.js";

/**
 * Periodo legible de una garantía.
 *
 * @param {{ startDate?: string|null, endDate?: string|null }} warranty - Garantía.
 * @returns {string} Periodo o cadena vacía.
 */
function formatPeriod(warranty) {
  if (!warranty.startDate && !warranty.endDate) return "";
  return `${warranty.startDate ? formatFileDate(warranty.startDate) : "—"} – ${warranty.endDate ? formatFileDate(warranty.endDate) : "—"}`;
}

/**
 * Garantías que respalda un documento de «Documentos › Garantías» (B8). Figma no diseña este
 * diálogo: reutiliza el patrón Modal y una lista de casillas. Cada casilla vincula o desvincula el
 * documento al momento con las rutas del administrador; el estado mostrado es el que confirma el
 * backend y un desvínculo conserva el anterior como historial. Una operación a la vez.
 *
 * @param {Object} props - Documento y cierre.
 * @param {{ projectId: number, fileId: number, name: string }} props.file - Documento.
 * @param {() => void} props.onClose - Cierra el diálogo.
 * @returns {import("react").ReactElement} Modal en portal.
 */
function AdminFileWarrantyDialog({ file, onClose }) {
  const titleId = useId();
  const warranties = useAdminFileWarranties(file);
  const busy = warranties.busyId !== null;

  useDialogKeyboard({
    open: true,
    getContainer: () => document.querySelector("[data-admin-file-warranties]"),
    onEscape: () => {
      if (!busy) onClose();
    },
  });

  let content;
  if (warranties.loading && !warranties.warranties.length) {
    content = <p className="text-body-3 m-0 text-[var(--color-text-100)]" role="status">Cargando garantías...</p>;
  } else if (warranties.error && !warranties.warranties.length) {
    content = <EmptyState title="No se pudieron cargar las garantías" description={warranties.error} size="S" showFeaturedIcon={false} showActions showSecondaryAction={false} primaryActionLabel="Reintentar" onPrimaryAction={warranties.reload} />;
  } else if (!warranties.warranties.length) {
    content = <EmptyState title="El proyecto no tiene garantías" description="Registra las garantías en la configuración del proyecto para vincular sus documentos." size="S" showFeaturedIcon={false} showActions={false} />;
  } else {
    content = (
      <ul className="flex flex-col gap-[8px]" aria-label="Garantías del proyecto">
        {warranties.warranties.map((warranty) => {
          const linked = warranties.linkedIds.includes(warranty.id);
          const period = formatPeriod(warranty);
          const label = [warranty.product, warranty.model].filter(Boolean).join(" · ") || `Garantía ${warranty.id}`;
          return (
            <li key={warranty.id} className="flex items-start gap-[12px] rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] p-[12px]">
              <Checkbox
                size="S"
                checked={linked ? "Yes" : "No"}
                interactive={!busy}
                aria-label={`${linked ? "Desvincular de" : "Vincular a"} ${label}`}
                onCheckedChange={() => warranties.toggle({ ...warranty, product: label })}
              />
              <div className="flex min-w-0 flex-col gap-[2px]">
                <span className="text-heading-8 [overflow-wrap:anywhere] text-[var(--color-text-300)]">{label}</span>
                {warranty.code || period ? <span className="text-body-4 text-[var(--color-text-100)]">{[warranty.code, period].filter(Boolean).join(" · ")}</span> : null}
                {warranties.busyId === warranty.id ? <span className="text-body-4 text-[var(--color-text-100)]" role="status">Guardando...</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Modal mount="viewport" visible onClose={busy ? undefined : onClose} className="z-[110]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-admin-file-warranties
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-[440px] flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative flex min-h-0 flex-col gap-[16px] overflow-y-auto p-[16px]">
          <div className="absolute right-0 top-0">
            <ModalCloseButton disabled={busy} ariaLabel="Cerrar garantías del documento" onClick={onClose} />
          </div>
          <div className="flex flex-col gap-[4px] pr-[28px]">
            <h2 id={titleId} className="text-heading-6 m-0 text-[var(--color-text-300)]">Garantías del documento</h2>
            <p className="text-body-4 m-0 [overflow-wrap:anywhere] text-[var(--color-text-100)]">{file.name}</p>
          </div>
          {content}
          {warranties.operation.error ? <p className="text-body-3 m-0 text-[var(--color-danger-100)]" role="alert">{warranties.operation.error}</p> : null}
          {warranties.operation.message ? <p className="text-body-3 m-0 text-[var(--color-success-200)]" role="status">{warranties.operation.message}</p> : null}
        </div>
        <footer className="flex items-center border-t border-[var(--color-neutral-200)] p-[16px]">
          <Button theme="Primary" type="Solid" size="M" showLeftIcon={false} showRightIcon={false} disabled={busy} className="!h-[41px] !w-full" onClick={onClose}>Listo</Button>
        </footer>
      </div>
    </Modal>
  );
}

export default AdminFileWarrantyDialog;
